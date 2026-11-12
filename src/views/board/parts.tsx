// Small pieces shared by the day board and the pile board.

import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Paper, ResearchRecord } from '../../domain/types'
import { db } from '../../store/db'
import { IconForward } from '../../ui/icons'
import { Markdown } from '../../ui/Markdown'

export function Cover({ record, onRaw }: { record: ResearchRecord; onRaw: () => void }) {
  return (
    <>
      <h2 className="cover-title">{record.title || '（没有标题）'}</h2>
      {record.summary && <p className="cover-summary">{record.summary}</p>}
      {record.preamble_md && <Markdown text={record.preamble_md} />}
      <div className="cover-foot">
        {record.activities.map((a) => (
          <span key={a} className="key-tag">
            {a}
          </span>
        ))}
        <button type="button" className="btn btn-quiet cover-raw" onClick={onRaw}>
          原文
        </button>
      </div>
    </>
  )
}

export function TextBox({ initial, label, onDone }: { initial: string; label: string; onDone: (text: string) => void }) {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [text])

  return (
    <textarea
      ref={ref}
      className="edit-input"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDone(initial)
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onDone(text)
      }}
    />
  )
}

export function ToolButton({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string
  icon: ReactNode
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className="tool" aria-pressed={active} disabled={disabled} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

export function CitePopover({ paper, x, y, onClose }: { paper: Paper; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // Registered after the opening tap has finished, so that tap does not close it.
    const t = setTimeout(() => window.addEventListener('pointerdown', onDown), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const width = Math.min(340, window.innerWidth - 32)
  const left = Math.max(16, Math.min(window.innerWidth - width - 16, x - width / 2))
  const below = y + 220 < window.innerHeight
  return (
    <div
      ref={ref}
      className="cite-pop"
      role="dialog"
      aria-label="论文预览"
      style={{ left, width, ...(below ? { top: y + 14 } : { bottom: window.innerHeight - y + 14 }) }}
    >
      <p className="cite-pop-meta">{[paper.authors[0], paper.year, paper.venue].filter(Boolean).join(' · ')}</p>
      <p className="cite-pop-title">{paper.title}</p>
      {paper.one_liner && <p className="cite-pop-line">{paper.one_liner}</p>}
      <a className="cite-pop-open" href={`#/paper/${paper.id}`}>
        打开论文页
        <IconForward />
      </a>
    </div>
  )
}

export function RawDialog({ importId, onClose }: { importId: string; onClose: () => void }) {
  const entry = useLiveQuery(() => db.imports.get(importId), [importId])
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])
  return (
    <dialog ref={ref} className="dialog dialog-wide" onClose={onClose} aria-labelledby="raw-title">
      <h2 id="raw-title">原始 Markdown</h2>
      <pre className="raw">{entry?.raw_md ?? ''}</pre>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose} autoFocus>
          关闭
        </button>
      </div>
    </dialog>
  )
}

export function useNarrow(): boolean {
  const query = '(max-width: 759px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}
