// Adding a picture to a note while it is being written: a picture button (every device: the system
// picker, which on iPad and iPhone includes the photo library and the camera), and on a Mac also
// dropping a picture onto the text box or pasting it. The picture is compressed like a board's 贴图,
// stored once in the shared image table, and goes into the text as one line where the cursor is.

import { useRef, useState, type ClipboardEvent, type DragEvent, type RefObject } from 'react'
import { hashText } from '../domain/importer'
import { imageLine } from '../domain/noteImages'
import { applyChanges, nowIso } from '../store/db'
import { IconImage } from './icons'
import { fileToImage } from './image'

async function store(file: File): Promise<string> {
  const image = await fileToImage(file)
  const id = `asset_${hashText(image.data)}`
  await applyChanges({ assets: [{ id, ...image, updated_at: nowIso() }] })
  return imageLine(id)
}

/** `text` with `lines` on lines of their own where the cursor was (at the end when there is none). */
function insertLines(text: string, at: number, lines: string[]): { text: string; cursor: number } {
  const before = text.slice(0, at)
  const after = text.slice(at)
  const lead = before === '' || before.endsWith('\n') ? '' : '\n'
  const tail = after === '' || after.startsWith('\n') ? '' : '\n'
  const piece = lead + lines.join('\n') + tail
  return { text: before + piece + after, cursor: (before + piece).length }
}

/**
 * Wires a text box for pictures. Returns the handlers for the textarea and the picture button.
 * `setText` receives the new text; the cursor is put after the picture.
 */
export function useNoteImages(ref: RefObject<HTMLTextAreaElement | null>, text: string, setText: (t: string) => void) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    if (images.length === 0) {
      if (files.length > 0) setError('只能插入图片')
      return
    }
    setError('')
    setBusy(true)
    const el = ref.current
    const at = el ? el.selectionStart : text.length
    const lines: string[] = []
    for (const f of images) {
      try {
        lines.push(await store(f))
      } catch (err) {
        setError(err instanceof Error ? err.message : '图片没有加上，请再试一次')
      }
    }
    setBusy(false)
    if (lines.length === 0) return
    const next = insertLines(el?.value ?? text, at, lines)
    setText(next.text)
    requestAnimationFrame(() => {
      const t = ref.current
      if (!t) return
      t.focus()
      t.setSelectionRange(next.cursor, next.cursor)
    })
  }

  const fromTransfer = (dt: DataTransfer | null) => [...(dt?.files ?? [])]

  return {
    error,
    busy,
    add,
    textareaProps: {
      onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => {
        const files = fromTransfer(e.clipboardData).filter((f) => f.type.startsWith('image/'))
        if (files.length === 0) return // ordinary text pastes as usual
        e.preventDefault()
        void add(files)
      },
      onDragOver: (e: DragEvent<HTMLTextAreaElement>) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      },
      onDrop: (e: DragEvent<HTMLTextAreaElement>) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        void add(fromTransfer(e.dataTransfer))
      },
    },
  }
}

/** The picture button: opens the system's picker. */
export function ImageButton({ onFiles, busy, label = '插入图片' }: { onFiles: (files: File[]) => void; busy?: boolean; label?: string }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className="icon-btn note-image-btn" aria-label={label} title={label} disabled={busy} onClick={() => input.current?.click()}>
        <IconImage />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
    </>
  )
}
