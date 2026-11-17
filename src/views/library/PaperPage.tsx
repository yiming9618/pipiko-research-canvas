import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { boardHref } from '../../domain/boards'
import { recordBoardId } from '../../domain/migrate'
import { paperParts, type ReadingPart } from '../../domain/exportPaper'
import { readingIsEmpty, readingLabel } from '../../domain/readings'
import { showRestoredMark } from '../../domain/trash'
import { trashPaper } from '../../store/trashActions'
import type { HighlightType, Paper, PaperBlock } from '../../domain/types'
import { db } from '../../store/db'
import { addBlock, addReading, deleteBlock, removeReading, saveBlockText, savePaperField, saveReadingTitle } from '../../store/paperActions'
import { EditableText } from '../../ui/EditableText'
import { IconBack, IconChevron, IconPlus, IconTrash } from '../../ui/icons'
import { AddToDiscussion } from '../discussions/AddToDiscussion'
import { CommentRail } from './CommentRail'
import { EditPaperForm } from './PaperForm'
import { PaperExport } from './PaperExport'
import { FieldPicker } from './FieldPicker'

export function PaperPage({ id }: { id: string }) {
  const [editingInfo, setEditingInfo] = useState(false)
  /** The highlight card that is selected (read-only until "编辑"); the rail then shows its notes. */
  const [selected, setSelected] = useState<string | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  /** Readings opened or closed by hand. Until then only the latest is open. */
  const [openState, setOpenState] = useState<Record<string, boolean>>({})
  /** The reading new notes go to and the rail shows. Default: the latest. */
  const [current, setCurrent] = useState<string | null>(null)

  // A tap anywhere outside the cards and the rail lets go of the selection.
  useEffect(() => {
    if (!selected) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('.block, .rail, dialog, .toast')) return
      setSelected(null)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [selected])
  const paper = useLiveQuery(() => db.papers.get(id), [id])
  const libraryPapers = useLiveQuery(() => db.papers.filter((p) => !p.deleted && !p.trashed_at).toArray())
  const blocks = useLiveQuery(
    () => db.blocks.where('paper_id').equals(id).filter((b) => !b.deleted).sortBy('order'),
    [id],
  )
  const types = useLiveQuery(() => db.types.filter((t) => !t.deleted).sortBy('order'))
  const imports = useLiveQuery(
    () => db.imports.filter((e) => e.paper_id === id && !e.undone && !e.deleted).sortBy('date'),
    [id],
  )
  const readingRows = useLiveQuery(() => db.readings.where('paper_id').equals(id).toArray(), [id])
  const comments = useLiveQuery(() => db.comments.where('paper_id').equals(id).toArray(), [id])
  const citedOn = useLiveQuery(async () => {
    const p = await db.papers.get(id)
    if (!p?.doi) return []
    const records = await db.records.filter((r) => !r.deleted && r.paper_dois.includes(p.doi)).toArray()
    const boards = (await db.boards.toArray()).filter((b) => !b.trashed_at)
    // the boards those records are on, each once
    const ids = [...new Set(records.map(recordBoardId))]
    return ids
      .map((boardId) => ({ boardId, name: boards.find((b) => b.id === boardId && !b.deleted)?.name }))
      .filter((x): x is { boardId: string; name: string } => !!x.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [id])

  if (paper === undefined && blocks === undefined) return null
  if (!paper || paper.deleted) {
    return (
      <div className="paper" ref={pageRef}>
        <BackLink />
        <p className="empty">找不到这篇论文，可能已经被撤销导入了。</p>
      </div>
    )
  }
  if (paper.trashed_at) {
    return (
      <div className="paper" ref={pageRef}>
        <BackLink />
        <p className="empty">
          这篇论文在垃圾桶里。要用它，到 <a href="#/settings?section=trash">设置 → 垃圾桶</a> 里恢复。
        </p>
      </div>
    )
  }

  const typeById = new Map((types ?? []).map((t) => [t.id, t]))
  const restoredMark = !!paper.restored_at && !!libraryPapers && showRestoredMark(paper, libraryPapers)
  // the readings, each with its cards; short card names ("研究方法 2") are shared with the export
  const parts = paperParts({ paper, blocks: blocks ?? [], types: types ?? [], comments: comments ?? [], fields: [], readings: readingRows ?? [], imports: imports ?? [] })
  const { readings, cardName, readingOf } = parts
  const latest = readings[readings.length - 1]?.reading.id ?? null
  const isOpen = (rid: string) => openState[rid] ?? rid === latest
  const currentId = current && readings.some((r) => r.reading.id === current) ? current : latest
  const currentReading = readings.find((r) => r.reading.id === currentId)?.reading
  const highlights = (blocks ?? []).filter((b) => b.type_id !== null)
  const chosen = selected && highlights.some((b) => b.id === selected) ? selected : null
  const select = (id: string, scroll = false) => {
    setSelected(id)
    const block = highlights.find((b) => b.id === id)
    if (block) {
      const rid = readingOf(block)
      setCurrent(rid)
      setOpenState((s) => ({ ...s, [rid]: true }))
    }
    if (scroll) requestAnimationFrame(() => pageRef.current?.querySelector(`[data-block="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }
  const toggle = (rid: string) => {
    const open = !isOpen(rid)
    setOpenState((s) => ({ ...s, [rid]: open }))
    if (open) setCurrent(rid)
    if (!open && chosen && readingOf(highlights.find((b) => b.id === chosen)!) === rid) setSelected(null)
  }
  const meta = [paper.authors.join(', '), paper.year, paper.venue].filter(Boolean)

  return (
    <div className="paper" ref={pageRef}>
      <article className="paper-main">
        <BackLink />
        <header className="paper-head">
          <h1>
            {restoredMark && <span className="restored-mark">【恢复】</span>}
            {paper.title || paper.doi || '（没有标题）'}
          </h1>
          {restoredMark && <p className="paper-meta">这一份是从垃圾桶恢复的；论文库里还有同一篇的另一份，两份各自独立。</p>}
          {meta.length > 0 && <p className="paper-meta">{meta.join(' · ')}</p>}
          <p className="paper-meta">
            {paper.doi && (
              <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer">
                doi.org/{paper.doi}
              </a>
            )}
            {paper.url && (
              <a href={paper.url} target="_blank" rel="noopener noreferrer">
                打开链接
              </a>
            )}
          </p>
          <FieldPicker paper={paper} />
          {paper.lookup === 'pending' && <p className="paper-meta">文献信息还没查到，联网后会自动补上</p>}
          {paper.why && <p className="want-why">{paper.why}</p>}
          {editingInfo ? (
            <EditPaperForm paper={paper} full onDone={() => setEditingInfo(false)} />
          ) : (
            <div className="paper-head-tools">
              <button type="button" className="btn btn-quiet paper-edit-info" onClick={() => setEditingInfo(true)}>
                编辑信息
              </button>
              <PaperExport paper={paper} />
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  if (window.confirm(`把「${paper.title || '这篇论文'}」移到垃圾桶？它的重点、我的理解，以及画板上的这张论文卡片会一起移过去；研究卡片不受影响。以后可以在“设置 → 垃圾桶”里完整恢复。`)) {
                    void trashPaper(paper).then(() => {
                      window.location.hash = '#/library'
                    })
                  }
                }}
              >
                <IconTrash />
                删除
              </button>
            </div>
          )}
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

        <div className="readings">
          {readings.map((r) => (
            <ReadingSection
              key={r.reading.id}
              part={r}
              paper={paper}
              types={types ?? []}
              typeById={typeById}
              open={isOpen(r.reading.id)}
              current={r.reading.id === currentId && readings.length > 1}
              chosen={chosen}
              removable={readings.length > 1 && readingIsEmpty(r.reading.id, readingOf, [...(blocks ?? []), ...(comments ?? [])])}
              onToggle={() => toggle(r.reading.id)}
              onSelect={(id) => select(id)}
            />
          ))}
          <button
            type="button"
            className="btn btn-quiet add-reading"
            onClick={() =>
              void addReading(paper.id).then((rid) => {
                setOpenState((s) => ({ ...s, [rid]: true }))
                setCurrent(rid)
                setSelected(null)
              })
            }
          >
            <IconPlus />
            新的一次阅读
          </button>
        </div>

        <footer className="paper-foot">
          <AddToDiscussion refs={[{ type: 'paper', id: paper.id }]} />
          {citedOn && citedOn.length > 0 && (
            <p className="cited">
              被引用于：
              {citedOn.map((b) => (
                <a key={b.boardId} href={boardHref(b.boardId)}>
                  {b.name}
                </a>
              ))}
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

      <CommentRail
        paperId={paper.id}
        reading={currentReading ? { id: currentReading.id, label: readingLabel(currentReading), many: readings.length > 1 } : null}
        readingOf={readingOf}
        cardName={cardName}
        selected={chosen}
        onSelectCard={(id) => select(id, true)}
        onShowAll={() => setSelected(null)}
      />
    </div>
  )
}

/** One reading: "第 N 次阅读｜小标题｜日期", folds open and shut on its own. */
function ReadingSection({
  part,
  paper,
  types,
  typeById,
  open,
  current,
  chosen,
  removable,
  onToggle,
  onSelect,
}: {
  part: ReadingPart
  paper: Paper
  types: HighlightType[]
  typeById: Map<string, HighlightType>
  open: boolean
  current: boolean
  chosen: string | null
  removable: boolean
  onToggle: () => void
  onSelect: (id: string) => void
}) {
  const r = part.reading
  const [naming, setNaming] = useState(false)
  const count = part.highlights.length
  const bodyId = `reading-${r.id}`
  return (
    <section className={`reading${current ? ' is-current' : ''}`} aria-labelledby={`${bodyId}-head`}>
      <div className="reading-head">
        <button type="button" id={`${bodyId}-head`} className="reading-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <IconChevron />
          <span className="reading-number">第 {r.number} 次阅读</span>
          {r.title.trim() && !naming && <span className="reading-title">｜{r.title.trim()}</span>}
          <span className="reading-date">｜{r.date}</span>
          {!open && <span className="group-count">{count > 0 ? `${count} 个重点` : ''}{part.understanding.length > 0 ? `${count > 0 ? '，' : ''}${part.understanding.length} 条理解` : ''}</span>}
        </button>
        {open && !naming && (
          <button type="button" className="btn btn-small btn-quiet reading-name" onClick={() => setNaming(true)}>
            {r.title.trim() ? '改小标题' : '加小标题'}
          </button>
        )}
      </div>
      {naming && (
        <form
          className="reading-title-form"
          onSubmit={(e) => {
            e.preventDefault()
            const value = String(new FormData(e.currentTarget).get('title') ?? '')
            void saveReadingTitle(r, value).then(() => setNaming(false))
          }}
        >
          <label className="field">
            <span className="sr-only">这次阅读的小标题</span>
            <input name="title" defaultValue={r.title} placeholder="例如：原文精读（可以留空）" autoFocus onKeyDown={(e) => e.key === 'Escape' && setNaming(false)} />
          </label>
          <button type="submit" className="btn btn-small btn-dark">
            保存
          </button>
          <button type="button" className="btn btn-small" onClick={() => setNaming(false)}>
            取消
          </button>
        </form>
      )}
      {open && (
        <div className="reading-body" id={bodyId}>
          <div className="blocks" aria-label="重点">
            {part.highlights.map((h) => (
              <BlockCard key={h.block.id} block={h.block} type={typeById.get(h.block.type_id!)} selected={chosen === h.block.id} onSelect={() => onSelect(h.block.id)} />
            ))}
            {part.others.map((o) => (
              <BlockCard key={o.block.id} block={o.block} />
            ))}
            {part.highlights.length + part.others.length === 0 && <p className="empty reading-empty">这次还没有重点。</p>}
            <div className="reading-actions">
              <AddBlock paper={paper} types={types} readingId={r.id} />
              {removable && (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    if (window.confirm(`删除「第 ${r.number} 次阅读」？它是空的，没有重点也没有理解。`)) void removeReading(r)
                  }}
                >
                  <IconTrash />
                  删除这次阅读
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
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

/**
 * A highlight card. A tap selects it (and shows only its notes in the rail); it stays read-only.
 * Editing: double-click (mouse), or the small "编辑" button that appears on a selected card (touch).
 * No long press, so scrolling and selecting text are left alone.
 */
function BlockCard({ block, type, selected = false, onSelect }: { block: PaperBlock; type?: HighlightType; selected?: boolean; onSelect?: () => void }) {
  const name = type ? type.name : block.heading || '其他内容'
  const [request, setRequest] = useState(0)
  const [editing, setEditing] = useState(false)
  const selectable = !!onSelect
  const edit = () => {
    window.getSelection()?.removeAllRanges()
    setRequest((n) => n + 1)
  }
  return (
    <section
      className={`block${selected ? ' is-selected' : ''}`}
      data-color={type?.color ?? 'plain'}
      data-block={block.id}
      onClick={(e) => {
        if (!selectable || editing || (e.target as HTMLElement).closest('a, button, textarea')) return
        onSelect()
      }}
      onDoubleClick={(e) => {
        if (!selectable || editing || (e.target as HTMLElement).closest('a, button, textarea')) return
        onSelect()
        edit()
      }}
    >
      <h2 className="block-type">
        {name}
        {block.edited_md !== undefined && <span className="block-edited">改过</span>}
      </h2>
      {selectable && !editing && (
        <button
          type="button"
          className={`btn btn-small block-edit${selected ? '' : ' is-hidden'}`}
          aria-label={`编辑「${name}」这一块`}
          onClick={edit}
        >
          编辑
        </button>
      )}
      <EditableText
        value={block.edited_md ?? block.body_md}
        label={`「${name}」这一块`}
        original={block.edited_md !== undefined ? block.body_md : undefined}
        onSave={(text) => saveBlockText(block, text)}
        onDelete={() => deleteBlock(block)}
        tapToEdit={!selectable}
        editRequest={request}
        onEditingChange={setEditing}
      />
    </section>
  )
}

function AddBlock({ paper, types, readingId }: { paper: Paper; types: HighlightType[]; readingId: string }) {
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
        void addBlock(paper.id, chosen, text, readingId).then(close)
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
