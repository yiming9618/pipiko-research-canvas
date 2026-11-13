import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { noteStamp } from '../../domain/exportPaper'
import type { Asset, Comment, CommentSource } from '../../domain/types'
import { db } from '../../store/db'
import { addComment, addImageComment, deleteComment, saveComment } from '../../store/paperActions'
import { EditableText } from '../../ui/EditableText'
import { IconImage } from '../../ui/icons'
import { fileToImage } from '../../ui/image'
import { Markdown } from '../../ui/Markdown'

const SOURCE_LABEL: Record<CommentSource, string> = { ai: 'AI 整理', me: '我写的', drawing: '手绘' }

interface RailProps {
  paperId: string
  /** Short names of the paper's live highlight cards (id → "研究方法", "研究方法 2"). */
  cardName: Map<string, string>
  /** The selected card: only its notes are shown, and a new note is about it. */
  selected: string | null
  onSelectCard: (id: string) => void
  onShowAll: () => void
}

export function CommentRail({ paperId, cardName, selected, onSelectCard, onShowAll }: RailProps) {
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
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const when = (c: Comment) => c.created_at ?? c.updated_at
  const all = [...(comments ?? [])].sort((a, b) => (a.date === b.date ? (when(a) < when(b) ? 1 : -1) : a.date < b.date ? 1 : -1))
  // a note whose card is gone counts as about the whole paper
  const sorted = selected ? all.filter((c) => c.block_id === selected) : all
  const about = selected ? cardName.get(selected) : undefined

  const submit = async () => {
    if (text.trim() === '') return
    await addComment(paperId, text, selected ?? undefined)
    setText('')
  }

  const upload = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      await addImageComment(paperId, await fileToImage(file), selected ?? undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片没有加上，请再试一次')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <aside className="rail" aria-labelledby="rail-title">
      <div className="rail-head">
        <h2 id="rail-title">我的理解</h2>
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
            className="edit-input"
            rows={3}
            value={text}
            placeholder={about ? `关于「${about}」写一条理解…` : '对整篇论文写一条理解…'}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="rail-add-row">
          <button type="button" className="btn btn-small btn-dark" disabled={text.trim() === ''} onClick={() => void submit()}>
            加上
          </button>
          <button type="button" className="icon-btn" aria-label="上传一张图片" onClick={() => fileRef.current?.click()}>
            <IconImage />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </div>
        {error && (
          <p className="status-line is-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {comments && sorted.length === 0 && <p className="empty">{about ? '这张重点卡片还没有理解，在上面写下第一条。' : '还没有理解。'}</p>}
      <ul className="rail-list">
        {sorted.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            asset={c.asset_id ? assets?.get(c.asset_id) : undefined}
            card={!selected && c.block_id ? cardName.get(c.block_id) : undefined}
            onCard={() => c.block_id && onSelectCard(c.block_id)}
          />
        ))}
      </ul>
    </aside>
  )
}

function CommentItem({ comment, asset, card, onCard }: { comment: Comment; asset?: Asset; card?: string; onCard: () => void }) {
  const [open, setOpen] = useState(false)
  const stamp = noteStamp(comment)
  const label = `${stamp} 的这条理解`

  return (
    <li className="comment">
      <p className="comment-meta">
        <time dateTime={comment.created_at ?? comment.date}>{stamp}</time>
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
          onDelete={() => deleteComment(comment)}
        />
      ) : (
        <Markdown text={comment.text} />
      )}
    </li>
  )
}
