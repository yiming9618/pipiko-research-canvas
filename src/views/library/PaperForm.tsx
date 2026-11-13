import { useState, type FormEvent } from 'react'
import type { Paper } from '../../domain/types'
import { addPaper, savePaperInfo } from '../../store/paperActions'
import { trashPaper } from '../../store/trashActions'

const plain = { autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false } as const

/** "添加论文": one of DOI, link or title is enough. */
export function AddPaperForm({ defaultStatus, onDone }: { defaultStatus: 'read' | 'want'; onDone: (status: 'read' | 'want') => void }) {
  const [doi, setDoi] = useState('')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [why, setWhy] = useState('')
  const [status, setStatus] = useState(defaultStatus)
  const [note, setNote] = useState('')
  const empty = !doi.trim() && !url.trim() && !title.trim()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const out = await addPaper({ doi, url, title, why, status })
    if (out.result === 'exists') {
      setNote(`库里已经有这篇了：「${out.paper.title || out.paper.doi}」（在${out.paper.status === 'want' ? '想看' : '已读'}里）`)
      return
    }
    if (out.result === 'added') onDone(status)
  }

  return (
    <form className="paper-form" onSubmit={(e) => void submit(e)} aria-label="添加论文">
      <p className="form-note">DOI、链接、标题填一样就行。有 DOI 的话，标题、作者、年份、期刊会自动查出来。</p>
      <label className="field">
        <span>DOI</span>
        <input value={doi} onChange={(e) => setDoi(e.target.value)} placeholder="10.1145/…" inputMode="url" {...plain} />
      </label>
      <label className="field">
        <span>链接</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" {...plain} />
      </label>
      <label className="field">
        <span>标题</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>为什么想看（可以不填）</span>
        <input value={why} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <div className="seg" role="group" aria-label="放在哪里">
        <button type="button" className="btn" aria-pressed={status === 'want'} onClick={() => setStatus('want')}>
          想看
        </button>
        <button type="button" className="btn" aria-pressed={status === 'read'} onClick={() => setStatus('read')}>
          已读
        </button>
      </div>
      <div className="row-actions">
        <button type="submit" className="btn btn-primary" disabled={empty}>
          保存
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => onDone(defaultStatus)}>
          取消
        </button>
      </div>
      <p className="status-line" role="status" aria-live="polite">
        {note}
      </p>
    </form>
  )
}

/** Editing an entry's details. `full` adds authors / year / venue (for a paper's own page). */
export function EditPaperForm({ paper, full, onDone }: { paper: Paper; full?: boolean; onDone: () => void }) {
  const [title, setTitle] = useState(paper.title)
  const [url, setUrl] = useState(paper.url)
  const [doi, setDoi] = useState(paper.doi)
  const [why, setWhy] = useState(paper.why ?? '')
  const [authors, setAuthors] = useState(paper.authors.join(', '))
  const [year, setYear] = useState(paper.year === null ? '' : String(paper.year))
  const [venue, setVenue] = useState(paper.venue)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const y = parseInt(year, 10)
    await savePaperInfo(paper, {
      title,
      url,
      doi,
      why,
      ...(full
        ? {
            authors: authors.split(/[,，;；、]/).map((a) => a.trim()).filter(Boolean),
            year: Number.isFinite(y) ? y : null,
            venue,
          }
        : {}),
    })
    onDone()
  }

  return (
    <form className="paper-form" onSubmit={(e) => void submit(e)} aria-label={`编辑：${paper.title || paper.doi}`}>
      <label className="field">
        <span>标题</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {full && (
        <>
          <label className="field">
            <span>作者（用逗号隔开）</span>
            <input value={authors} onChange={(e) => setAuthors(e.target.value)} />
          </label>
          <label className="field">
            <span>年份</span>
            <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" />
          </label>
          <label className="field">
            <span>期刊或会议</span>
            <input value={venue} onChange={(e) => setVenue(e.target.value)} />
          </label>
        </>
      )}
      <label className="field">
        <span>DOI</span>
        <input value={doi} onChange={(e) => setDoi(e.target.value)} inputMode="url" {...plain} />
      </label>
      <label className="field">
        <span>链接</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" {...plain} />
      </label>
      <label className="field">
        <span>为什么想看</span>
        <input value={why} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <div className="row-actions">
        <button type="submit" className="btn btn-primary">
          保存
        </button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>
          取消
        </button>
        {paper.status === 'want' && (
          <button
            type="button"
            className="btn btn-quiet form-remove"
            onClick={() => {
              if (window.confirm(`把「${paper.title || paper.doi || paper.url}」移到垃圾桶？以后可以在“设置 → 垃圾桶”里恢复。`)) void trashPaper(paper).then(onDone)
            }}
          >
            移到垃圾桶
          </button>
        )}
      </div>
    </form>
  )
}
