import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { noteStamp } from '../../domain/exportPaper'
import type { Asset, Comment, CommentSource } from '../../domain/types'
import { db } from '../../store/db'
import { addComment, addPictureNote, deleteComment, saveComment } from '../../store/paperActions'
import { imagesIn, withoutImages } from '../../domain/noteImages'
import { EditableText } from '../../ui/EditableText'
import { IconChevron } from '../../ui/icons'
import { ImageButton, useNoteImages } from '../../ui/NoteImages'
import { Markdown } from '../../ui/Markdown'

const SOURCE_LABEL: Record<CommentSource, string> = { ai: 'AI 整理', me: '我写的', drawing: '手绘' }

interface RailProps {
  paperId: string
  /** The reading shown, and where a new note goes. `many`: the paper has more than one reading. */
  reading: { id: string; label: string; many: boolean } | null
  readingOf: (item: { import_id?: string; reading_id?: string }) => string
  /** Short names of the paper's live highlight cards (id → "研究方法", "研究方法 2"). */
  cardName: Map<string, string>
  /** The selected card: only its notes are shown, and a new note is about it. */
  selected: string | null
  onSelectCard: (id: string) => void
  onShowAll: () => void
}

export function CommentRail({ paperId, reading, readingOf, cardName, selected, onSelectCard, onShowAll }: RailProps) {
  const comments = useLiveQuery(
    () => db.comments.where('paper_id').equals(paperId).filter((c) => !c.deleted).toArray(),
    [paperId],
  )
  const assets = useLiveQuery(async () => {
    const ids = (comments ?? []).map((c) => c.asset_id).filter((x): x is string => !!x)
    const rows = await db.assets.bulkGet(ids)
    return new Map(rows.filter((a): a is Asset => !!a).map((a) => [a.id, a]))
  }, [comments])

  const [text, setText] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const pics = useNoteImages(area, text, setText)
  /** Dates opened or closed by hand. Until then only the most recent date is open. */
  const [openDates, setOpenDates] = useState<Record<string, boolean>>({})

  const when = (c: Comment) => c.created_at ?? c.updated_at
  const all = [...(comments ?? [])].filter((c) => !reading || readingOf(c) === reading.id).sort((a, b) => (a.date === b.date ? (when(a) < when(b) ? 1 : -1) : a.date < b.date ? 1 : -1))
  // a note whose card is gone counts as about the whole paper
  const sorted = selected ? all.filter((c) => c.block_id === selected) : all
  const about = selected ? cardName.get(selected) : undefined
  // grouped by the day they were written, newest first (already sorted that way)
  const days: { date: string; notes: Comment[] }[] = []
  for (const c of sorted) {
    const last = days[days.length - 1]
    if (last && last.date === c.date) last.notes.push(c)
    else days.push({ date: c.date, notes: [c] })
  }
  const isOpen = (date: string) => openDates[date] ?? date === days[0]?.date

  const submit = async () => {
    if (text.trim() === '') return
    // just one picture and no words: a 手绘 note, as a picture posted on its own always was
    const only = imagesIn(text)
    if (only.length === 1 && withoutImages(text).trim() === '') await addPictureNote(paperId, only[0], selected ?? undefined, reading?.id)
    else await addComment(paperId, text, selected ?? undefined, reading?.id)
    setText('')
  }



  return (
    <aside className="rail" aria-labelledby="rail-title">
      <div className="rail-head">
        <h2 id="rail-title">我的理解</h2>
        {reading?.many && <p className="rail-reading">{reading.label}</p>}
        {about && (
          <p className="rail-scope">
            只看「{about}」
            <button type="button" className="link-btn" onClick={onShowAll}>
              看全部
            </button>
          </p>
        )}
      </div>

      <div className="rail-add">
        <label>
          <span className="sr-only">写一条理解</span>
          <textarea
            ref={area}
            {...pics.textareaProps}
            className="edit-input"
            rows={3}
            value={text}
            placeholder={about ? `关于「${about}」写一条理解…` : reading?.many ? '对这次阅读写一条理解…' : '对整篇论文写一条理解…'}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="rail-add-row">
          <button type="button" className="btn btn-small btn-dark" disabled={text.trim() === ''} onClick={() => void submit()}>
            加上
          </button>
          <ImageButton busy={pics.busy} onFiles={(f) => void pics.add(f)} label="插入图片（只放一张图、不写字，就是一条手绘）" />
        </div>
        {pics.error && (
          <p className="status-line is-error" role="alert">
            {pics.error}
          </p>
        )}
      </div>

      {comments && sorted.length === 0 && <p className="empty">{about ? '这张重点卡片还没有理解，在上面写下第一条。' : reading?.many ? '这次阅读还没有理解。' : '还没有理解。'}</p>}
      <div className="rail-days">
        {days.map((d) => {
          const open = isOpen(d.date)
          return (
            <section key={d.date} className="rail-day">
              <h3>
                <button type="button" className="group-head rail-day-head" aria-expanded={open} onClick={() => setOpenDates((s) => ({ ...s, [d.date]: !open }))}>
                  <span>{d.date}</span>
                  <span className="group-count">{d.notes.length} 条</span>
                  <IconChevron />
                </button>
              </h3>
              {open && (
                <ul className="rail-list">
                  {d.notes.map((c) => (
                    <CommentItem
                      key={c.id}
                      comment={c}
                      asset={c.asset_id ? assets?.get(c.asset_id) : undefined}
                      card={!selected && c.block_id ? cardName.get(c.block_id) : undefined}
                      onCard={() => c.block_id && onSelectCard(c.block_id)}
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </aside>
  )
}

function CommentItem({ comment, asset, card, onCard }: { comment: Comment; asset?: Asset; card?: string; onCard: () => void }) {
  const [open, setOpen] = useState(false)
  const stamp = noteStamp(comment)
  const label = `${stamp} 的这条理解`
  const time = stamp.length > 10 ? stamp.slice(11) : ''

  return (
    <li className="comment">
      <p className="comment-meta">
        {time && <time dateTime={comment.created_at ?? comment.date}>{time}</time>}
        {card && (
          <button type="button" className="comment-card" onClick={onCard} aria-label={`对应重点：${card}，点一下选中它`}>
            · {card}
          </button>
        )}
        <span className="source" data-source={comment.source}>
          {SOURCE_LABEL[comment.source]}
        </span>
      </p>

      {comment.source === 'drawing' ? (
        <>
          <button type="button" className="comment-image" aria-expanded={open} onClick={() => setOpen(!open)}>
            {asset ? (
              <img src={`data:${asset.mime};base64,${asset.data}`} width={asset.w} height={asset.h} alt="手绘或贴图" />
            ) : (
              <span className="empty">图片还没同步到这台设备</span>
            )}
          </button>
          {open && (
            <div className="edit-actions">
              <button
                type="button"
                className="btn btn-small btn-quiet edit-delete"
                onClick={() => {
                  if (window.confirm('删除这张图片？')) void deleteComment(comment)
                }}
              >
                删除
              </button>
            </div>
          )}
        </>
      ) : comment.source === 'me' ? (
        <EditableText
          value={comment.text}
          label={label}
          onSave={(text) => (text.trim() === '' ? deleteComment(comment) : saveComment(comment, text))}
          images
          onDelete={() => deleteComment(comment)}
        />
      ) : (
        <Markdown text={comment.text} />
      )}
    </li>
  )
}
