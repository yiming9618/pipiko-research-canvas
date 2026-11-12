import { useEffect, useRef, useState, type FormEvent } from 'react'
import { KIND_COLOR } from '../../domain/colors'
import { CARD_KINDS, type Card } from '../../domain/types'

type Kind = (typeof CARD_KINDS)[number]

interface Props {
  /** Editing this hand-written card; absent when writing a new one. */
  card?: Card
  /** The date the card belongs to (today for a new one). */
  defaultDate: string
  onSave: (kind: Kind, text: string, date: string) => void
  onDelete?: () => void
  onClose: () => void
}

/**
 * Writing a research card by hand: pick the kind, then the words. A plain
 * text field, so the keyboard's dictation works as it does anywhere else.
 */
export function CardDialog({ card, defaultDate, onSave, onDelete, onClose }: Props) {
  const [date, setDate] = useState(card?.date ?? defaultDate)
  const [kind, setKind] = useState<Kind>(card && card.kind !== '其他' ? card.kind : '发现')
  const [text, setText] = useState(card?.body_md ?? '')
  const ref = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
    input.current?.focus()
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    onSave(kind, text, date || defaultDate)
  }

  return (
    <dialog ref={ref} className="dialog card-dialog" onClose={onClose} aria-labelledby="card-dialog-title">
      <form onSubmit={submit}>
        <h2 id="card-dialog-title">{card ? '改这张卡片' : '写一张卡片'}</h2>
        <div className="kind-row" role="group" aria-label="卡片类型">
          {CARD_KINDS.map((k) => (
            <button key={k} type="button" className="chip" data-color={KIND_COLOR[k]} aria-pressed={kind === k} onClick={() => setKind(k)}>
              <span className="dot" aria-hidden="true" />
              {k}
            </button>
          ))}
        </div>
        <label>
          <span className="sr-only">卡片内容</span>
          <textarea
            ref={input}
            className="card-dialog-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="写下来，或点键盘上的话筒说出来"
            rows={5}
          />
        </label>
        <label className="field card-dialog-date">
          <span>日期</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="dialog-actions">
          {card && onDelete && (
            <button
              type="button"
              className="btn btn-quiet form-remove card-dialog-delete"
              onClick={() => {
                if (window.confirm('删除这张卡片？它在堆和讨论框里也会一起消失。')) onDelete()
              }}
            >
              删除
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => ref.current?.close()}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
            {card ? '保存' : '放到画板上'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
