import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { shortDate } from '../../domain/importer'
import type { HighlightType, Paper, PaperBlock } from '../../domain/types'
import { db } from '../../store/db'
import { addBlock, deleteBlock, saveBlockText, savePaperField } from '../../store/paperActions'
import { EditableText } from '../../ui/EditableText'
import { IconBack, IconPlus } from '../../ui/icons'
import { CommentRail } from './CommentRail'

export function PaperPage({ id }: { id: string }) {
  const paper = useLiveQuery(() => db.papers.get(id), [id])
  const blocks = useLiveQuery(
    () => db.blocks.where('paper_id').equals(id).filter((b) => !b.deleted).sortBy('order'),
    [id],
  )
  const types = useLiveQuery(() => db.types.filter((t) => !t.deleted).sortBy('order'))
  const imports = useLiveQuery(
    () => db.imports.filter((e) => e.paper_id === id && !e.undone && !e.deleted).sortBy('date'),
    [id],
  )
  const citedOn = useLiveQuery(async () => {
    const p = await db.papers.get(id)
    if (!p?.doi) return []
    const records = await db.records.filter((r) => !r.deleted && r.paper_dois.includes(p.doi)).toArray()
    return [...new Set(records.map((r) => r.date))].sort()
  }, [id])

  if (paper === undefined && blocks === undefined) return null
  if (!paper || paper.deleted) {
    return (
      <div className="paper">
        <BackLink />
        <p className="empty">找不到这篇论文，可能已经被撤销导入了。</p>
      </div>
    )
  }

  const typeById = new Map((types ?? []).map((t) => [t.id, t]))
  const highlights = (blocks ?? []).filter((b) => b.type_id !== null)
  const others = (blocks ?? []).filter((b) => b.type_id === null)
  const readDates = [...new Set((imports ?? []).map((e) => e.date))]
  const meta = [paper.authors.join(', '), paper.year, paper.venue].filter(Boolean)

  return (
    <div className="paper">
      <article className="paper-main">
        <BackLink />
        <header className="paper-head">
          <h1>{paper.title || '（没有标题）'}</h1>
          {meta.length > 0 && <p className="paper-meta">{meta.join(' · ')}</p>}
          <p className="paper-meta">
            {paper.doi && (
              <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer">
                doi.org/{paper.doi}
              </a>
            )}
            {paper.category && <span className="tag">{paper.category}</span>}
          </p>
        </header>

        <section className="oneliner" aria-label="一句话总结">
          <EditableText
            value={paper.one_liner}
            label="一句话总结"
            placeholder="一句话总结：点一下写"
            onSave={(text) => savePaperField(paper, 'one_liner', text)}
          />
        </section>

        <details className="basics">
          <summary>基础</summary>
          <EditableText
            value={paper.basics_md}
            label="基础"
            placeholder="还没有基础部分，点一下写"
            onSave={(text) => savePaperField(paper, 'basics_md', text)}
          />
        </details>

        <section className="blocks" aria-label="重点">
          {highlights.map((b) => (
            <BlockCard key={b.id} block={b} type={typeById.get(b.type_id!)} />
          ))}
          <AddBlock paper={paper} types={types ?? []} />
        </section>

        {others.length > 0 && (
          <section className="blocks" aria-label="其他内容">
            {others.map((b) => (
              <BlockCard key={b.id} block={b} />
            ))}
          </section>
        )}

        <footer className="paper-foot">
          {citedOn && citedOn.length > 0 && <p>被引用于：{citedOn.map(shortDate).join('、')} 的画板</p>}
          {readDates.length > 0 && (
            <p>
              {readDates.length > 1 ? `读过 ${readDates.length} 次：` : '读于 '}
              {readDates.map(shortDate).join('、')}
            </p>
          )}
          {imports && imports.length > 0 && (
            <details className="raw-box">
              <summary>查看原始 Markdown</summary>
              {imports.map((e) => (
                <pre key={e.id} className="raw">
                  {e.raw_md}
                </pre>
              ))}
            </details>
          )}
        </footer>
      </article>

      <CommentRail paperId={paper.id} />
    </div>
  )
}

function BackLink() {
  return (
    <a className="back-link" href="#/library">
      <IconBack />
      论文库
    </a>
  )
}

function BlockCard({ block, type }: { block: PaperBlock; type?: HighlightType }) {
  const name = type ? type.name : block.heading || '其他内容'
  return (
    <section className="block" data-color={type?.color ?? 'plain'}>
      <h2 className="block-type">
        {name}
        {block.edited_md !== undefined && <span className="block-edited">改过</span>}
      </h2>
      <EditableText
        value={block.edited_md ?? block.body_md}
        label={`「${name}」这一块`}
        original={block.edited_md !== undefined ? block.body_md : undefined}
        onSave={(text) => saveBlockText(block, text)}
        onDelete={() => deleteBlock(block)}
      />
    </section>
  )
}

function AddBlock({ paper, types }: { paper: Paper; types: HighlightType[] }) {
  const [open, setOpen] = useState(false)
  const [typeId, setTypeId] = useState('')
  const [text, setText] = useState('')

  if (!open) {
    return (
      <button type="button" className="btn btn-quiet add-block" onClick={() => setOpen(true)}>
        <IconPlus />
        加一个重点
      </button>
    )
  }

  const chosen = typeId || types[0]?.id || ''
  const close = () => {
    setOpen(false)
    setText('')
  }

  return (
    <form
      className="block add-form"
      data-color="plain"
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim() === '' || !chosen) return
        void addBlock(paper.id, chosen, text).then(close)
      }}
    >
      <label className="field">
        <span>类型</span>
        <select value={chosen} onChange={(e) => setTypeId(e.target.value)}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>内容</span>
        <textarea className="edit-input" rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </label>
      <div className="edit-actions">
        <button type="submit" className="btn btn-small btn-dark" disabled={text.trim() === ''}>
          保存
        </button>
        <button type="button" className="btn btn-small" onClick={close}>
          取消
        </button>
      </div>
    </form>
  )
}
