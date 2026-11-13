import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Markdown } from './Markdown'

interface Props {
  /** What is shown and edited. */
  value: string
  /** Name of the thing, for screen readers: "编辑 一句话总结". */
  label: string
  onSave: (text: string) => Promise<void> | void
  /** When given, edit mode offers "删除". */
  onDelete?: () => Promise<void> | void
  /** The imported original, when the text has been edited by hand. */
  original?: string
  placeholder?: string
  /** false: a tap does not open the editor (the owner opens it with `editRequest`). Default true. */
  tapToEdit?: boolean
  /** Each new value (above 0) opens the editor. */
  editRequest?: number
  /** Told when the editor opens or closes. */
  onEditingChange?: (editing: boolean) => void
}

/**
 * Text that reads as plain content until tapped. Tapping opens it for
 * editing; the buttons only exist while editing.
 */
export function EditableText({ value, label, onSave, onDelete, original, placeholder, tapToEdit = true, editRequest = 0, onEditingChange }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const editing = draft !== null

  useEffect(() => {
    if (editRequest > 0) setDraft((d) => d ?? value)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new request opens it
  }, [editRequest])

  const reported = useRef(false)
  useEffect(() => {
    if (reported.current === editing) return
    reported.current = editing
    onEditingChange?.(editing)
  }, [editing, onEditingChange])

  useEffect(() => {
    if (!editing) return
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  // Grow with the text so nothing is hidden behind an inner scrollbar.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [draft])

  const open = (e: MouseEvent) => {
    if (!tapToEdit) return
    if ((e.target as HTMLElement).closest('a')) return // links still work as links
    if (window.getSelection()?.toString()) return // selecting text is not a tap
    setDraft(value)
  }

  if (!editing) {
    return (
      <div className={`editable${value ? '' : ' is-empty'}`} onClick={open}>
        {value ? <Markdown text={value} /> : <p>{placeholder ?? '点一下开始写'}</p>}
        {tapToEdit && (
          <button type="button" className="sr-only" onClick={() => setDraft(value)}>
            编辑{label}
          </button>
        )}
      </div>
    )
  }

  const save = async () => {
    const text = draft ?? ''
    setDraft(null)
    if (text.trim() !== value.trim()) await onSave(text)
  }

  return (
    <div className="editing">
      <textarea
        ref={ref}
        className="edit-input"
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDraft(null)
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save()
        }}
      />
      {/* destructive on the left, away from Save; Save is the last button on the right */}
      <div className="edit-actions">
        <div className="edit-actions-side">
          {onDelete && (
            <button
              type="button"
              className="btn btn-small btn-quiet edit-delete"
              onClick={() => {
                if (window.confirm(`删除${label}？`)) {
                  setDraft(null)
                  void onDelete()
                }
              }}
            >
              删除
            </button>
          )}
          {original !== undefined && (
            <button
              type="button"
              className="btn btn-small btn-quiet"
              onClick={() => {
                setDraft(null)
                void onSave(original)
              }}
            >
              恢复原文
            </button>
          )}
        </div>
        <div className="edit-actions-side">
          <button type="button" className="btn btn-small" onClick={() => setDraft(null)}>
            取消
          </button>
          <button type="button" className="btn btn-small btn-dark" onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
