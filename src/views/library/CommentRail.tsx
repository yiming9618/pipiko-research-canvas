import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { shortDate } from '../../domain/importer'
import type { Asset, Comment, CommentSource } from '../../domain/types'
import { db } from '../../store/db'
import { addComment, addImageComment, deleteComment, saveComment } from '../../store/paperActions'
import { EditableText } from '../../ui/EditableText'
import { IconImage } from '../../ui/icons'
import { fileToImage } from '../../ui/image'
import { Markdown } from '../../ui/Markdown'

const SOURCE_LABEL: Record<CommentSource, string> = { ai: 'AI 整理', me: '我写的', drawing: '手绘' }

export function CommentRail({ paperId }: { paperId: string }) {
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

  const sorted = [...(comments ?? [])].sort((a, b) =>
    a.date === b.date ? (a.updated_at < b.updated_at ? 1 : -1) : a.date < b.date ? 1 : -1,
  )

  const submit = async () => {
    if (text.trim() === '') return
    await addComment(paperId, text)
    setText('')
  }

  const upload = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      await addImageComment(paperId, await fileToImage(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片没有加上，请再试一次')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <aside className="rail" aria-labelledby="rail-title">
      <h2 id="rail-title">我的理解</h2>

      <div className="rail-add">
        <label>
          <span className="sr-only">写一条理解</span>
          <textarea
            className="edit-input"
            rows={3}
            value={text}
            placeholder="写一条理解…"
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

      {comments && sorted.length === 0 && <p className="empty">还没有评论。</p>}
      <ul className="rail-list">
        {sorted.map((c) => (
          <CommentItem key={c.id} comment={c} asset={c.asset_id ? assets?.get(c.asset_id) : undefined} />
        ))}
      </ul>
    </aside>
  )
}

function CommentItem({ comment, asset }: { comment: Comment; asset?: Asset }) {
  const [open, setOpen] = useState(false)
  const label = `${shortDate(comment.date)} 的这条评论`

  return (
    <li className="comment">
      <p className="comment-meta">
        <span>{shortDate(comment.date)}</span>
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
