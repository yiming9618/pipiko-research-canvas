import { useEffect, useRef, useState, type ReactNode } from 'react'
import { copyText } from './clipboard'
import { IconDownload, IconExport } from './icons'
import { toast } from './toast'

interface Props {
  /** Builds the text. Called inside the tap, so it must not wait for anything. */
  text: () => string
  /** Shown after copying, e.g. "已复制这块画板（Markdown）". */
  done: string
  /** File name (without .md) offered when copying is not possible. */
  fileName: string
  label?: string
  iconOnly?: boolean
  className?: string
  disabled?: boolean
  children?: ReactNode
}

export function downloadText(text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileName.replace(/[\\/:*?"<>|]+/g, ' ').trim() || '导出'}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * "导出": copies Markdown to the clipboard. When the browser refuses, the text is
 * shown to copy by hand, with a download as the other way out.
 */
export function CopyExport({ text, done, fileName, label = '导出', iconOnly, className, disabled }: Props) {
  const [manual, setManual] = useState<string | null>(null)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (manual !== null && el && !el.open) el.showModal()
  }, [manual])

  const run = async () => {
    const body = text()
    if (await copyText(body)) toast(done)
    else setManual(body)
  }

  return (
    <>
      <button
        type="button"
        className={className ?? (iconOnly ? 'icon-btn' : 'btn btn-quiet')}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        disabled={disabled}
        onClick={() => void run()}
      >
        <IconExport />
        {!iconOnly && label}
      </button>
      {manual !== null && (
        <dialog ref={ref} className="dialog export-dialog" onClose={() => setManual(null)} aria-labelledby="export-title">
          <h2 id="export-title">没能自动复制</h2>
          <p>请在下面全选后手动复制，或者存成文件。</p>
          <label>
            <span className="sr-only">导出的内容</span>
            <textarea className="md-input" readOnly value={manual} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => downloadText(manual, fileName)}>
              <IconDownload />
              存成 .md 文件
            </button>
            <button type="button" className="btn btn-primary" onClick={() => ref.current?.close()}>
              好
            </button>
          </div>
        </dialog>
      )}
    </>
  )
}
