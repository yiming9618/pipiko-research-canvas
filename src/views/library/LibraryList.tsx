import { useLiveQuery } from 'dexie-react-hooks'
import { paperReadings } from '../../domain/readings'
import { useEffect, useMemo, useState } from 'react'
import type { HighlightType, Paper } from '../../domain/types'
import { db } from '../../store/db'
import { markRead, retryLookup } from '../../store/paperActions'
import { shortDate } from '../../domain/importer'
import { AddPaperForm, EditPaperForm } from './PaperForm'
import { AddToDiscussion } from '../discussions/AddToDiscussion'
import { POINTER_DROP, watchPointerDrag, type PointerDrop } from '../../ui/pointerDrag'
import { fieldOfPaper } from '../../domain/migrate'
import { showRestoredMark } from '../../domain/trash'
import { setPaperField } from '../../store/fieldActions'
import { toast } from '../../ui/toast'
import { boardHref } from '../../domain/boards'
import { recordBoardId } from '../../domain/migrate'
import { IconCheck, IconChevron, IconEdit, IconFold, IconGrip, IconPlus } from '../../ui/icons'
import { isReadingNow, lastRead, PAPER_SORTS, sortPapers, type PaperSort } from '../../domain/library'
import { BoxMark, useBoxMarks, ValueMarks } from '../../ui/marks'

const UNCATEGORISED = '未分类'
/** The filter chip for 参考价值 "Full". */
const FULL = '__full'

function remember<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // remembering the view is a convenience only
  }
}

interface ListProps {
  activeId?: string
  /** Beside a board: papers can be dragged out of the list onto it. Called when a drag starts. */
  onDragOut?: () => void
  /** On the library page (wide screens): fold the list away. */
  onCollapse?: () => void
}

export function LibraryList({ activeId, onDragOut, onCollapse }: ListProps) {
  const papers = useLiveQuery(() => db.papers.filter((p) => !p.deleted && !p.trashed_at).toArray())
  const blocks = useLiveQuery(() => db.blocks.filter((b) => !b.deleted && b.type_id !== null).toArray())
  const types = useLiveQuery(() => db.types.filter((t) => !t.deleted).toArray())
  const fields = useLiveQuery(() => db.fields.toArray())
  const imports = useLiveQuery(() =>
    db.imports.filter((e) => e.kind === 'paper' && !e.undone && !e.deleted).toArray(),
  )
  const readingRows = useLiveQuery(() => db.readings.toArray())
  const uses = useLiveQuery(async () => new Map((await db.paperUse.toArray()).map((u) => [u.id, u])))
  const boxMarks = useBoxMarks()
  const [sort, setSort] = useState<PaperSort>(() => remember<PaperSort>('lib.sort', 'read'))
  /** 选择: tick several papers and put them in a discussion box together. */
  const [picking, setPicking] = useState<string[] | null>(null)
  const notes = useLiveQuery(() => db.comments.filter((c) => !c.deleted).toArray())

  const [tab, setTab] = useState<'read' | 'want'>(() => remember('lib.tab', 'read'))
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [closed, setClosed] = useState<string[]>(() => remember('lib.closed', []))
  const [adding, setAdding] = useState(false)

  const typeById = useMemo(() => new Map((types ?? []).map((t) => [t.id, t])), [types])

  /** paper id → how many readings it has (the same count as on its page). */
  const readCount = useMemo(() => {
    const group = <T extends { paper_id?: string }>(rows: T[] | undefined) => {
      const m = new Map<string, T[]>()
      for (const r of rows ?? []) if (r.paper_id) m.set(r.paper_id, [...(m.get(r.paper_id) ?? []), r])
      return m
    }
    const [byImports, byRows, byBlocks, byNotes] = [group(imports), group(readingRows), group(blocks), group(notes)]
    const map = new Map<string, { count: number; dates: string[] }>()
    for (const p of papers ?? []) {
      const list = paperReadings({ paper: p, imports: byImports.get(p.id) ?? [], readings: byRows.get(p.id) ?? [], blocks: byBlocks.get(p.id) ?? [], comments: byNotes.get(p.id) ?? [] }).list
      // a reading made by hand counts from its date; the paper's own first reading does not (it is just where it was added)
      map.set(p.id, { count: list.length, dates: list.filter((r) => r.row || r.import_ids.length > 0).map((r) => r.date) })
    }
    return map
  }, [papers, imports, readingRows, blocks, notes])

  const read = (papers ?? []).filter((p) => p.status === 'read')
  const want = (papers ?? []).filter((p) => p.status === 'want')

  // the filter is by 参考价值 (chosen by hand), not by the highlights inside
  const usedTypes = useMemo(() => {
    const ids = new Set(read.flatMap((p) => p.value_types ?? []))
    return [...ids].map((id) => typeById.get(id)).filter((t): t is HighlightType => !!t && !t.deleted).sort((a, b) => a.order - b.order)
  }, [read, typeById])
  const anyFull = read.some((p) => p.value_full)

  const shown = !typeFilter ? read : typeFilter === FULL ? read.filter((p) => p.value_full) : read.filter((p) => p.value_types?.includes(typeFilter))
  const readAt = (p: Paper) => lastRead(p, uses?.get(p.id), imports ?? [], readCount.get(p.id)?.dates)

  /** One group per field (empty fields too, so papers can be pulled into them), 未分类 last. Keyed by field id, '' for 未分类. */
  const groups = useMemo(() => {
    const live = (fields ?? []).filter((f) => !f.deleted)
    const map = new Map<string, { name: string; papers: Paper[] }>()
    if (!typeFilter) for (const f of live) map.set(f.id, { name: f.name, papers: [] })
    for (const p of shown) {
      const field = fieldOfPaper(p, live)
      const key = field?.id ?? ''
      if (!map.has(key)) map.set(key, { name: field?.name ?? UNCATEGORISED, papers: [] })
      map.get(key)!.papers.push(p)
    }
    return [...map.entries()]
      .sort(([a, x], [b, y]) => (a === '' ? 1 : b === '' ? -1 : x.name.localeCompare(y.name, 'zh')))
      .map(([id, g]) => ({ id, name: g.name, papers: sortPapers(g.papers, sort, uses ?? new Map(), readAt) }))
  }, [shown, fields, typeFilter, sort, uses, imports, readCount])

  // A paper let go on a field's heading moves into that field (see ui/pointerDrag).
  useEffect(() => {
    const onDropped = (e: Event) => {
      const { ref, clientX, clientY } = (e as CustomEvent<PointerDrop>).detail
      if (ref.type !== 'paper') return
      const head = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-field-drop]')
      const paper = papers?.find((p) => p.id === ref.id)
      if (!head || !paper) return
      const target = head.dataset.fieldDrop ?? ''
      const now = fieldOfPaper(paper, fields ?? [])?.id ?? ''
      if (target === now) return
      void setPaperField(paper, target).then(() => toast(`「${paper.title || '论文'}」已放进${target ? `领域「${head.dataset.fieldName}」` : '“未分类”'}`))
    }
    document.addEventListener(POINTER_DROP, onDropped)
    return () => document.removeEventListener(POINTER_DROP, onDropped)
  }, [papers, fields])

  const pickTab = (next: 'read' | 'want') => {
    setTab(next)
    store('lib.tab', next)
  }

  const toggleGroup = (name: string) => {
    const next = closed.includes(name) ? closed.filter((n) => n !== name) : [...closed, name]
    setClosed(next)
    store('lib.closed', next)
  }

  return (
    <div className="liblist">
      <div className="liblist-head">
        {onCollapse && (
          <button type="button" className="icon-btn lib-collapse" aria-label="收起论文库" title="收起论文库" onClick={onCollapse}>
            <IconFold />
          </button>
        )}
        <h1 className="liblist-title">论文库</h1>
        {!adding && (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <IconPlus />
            添加论文
          </button>
        )}
      </div>

      {adding && (
        <AddPaperForm
          defaultStatus={tab}
          onDone={(status) => {
            setAdding(false)
            pickTab(status)
          }}
        />
      )}

      <div className="seg" role="group" aria-label="筛选">
        <button type="button" className="btn" aria-pressed={tab === 'read'} onClick={() => pickTab('read')}>
          已读 · {read.length}
        </button>
        <button type="button" className="btn" aria-pressed={tab === 'want'} onClick={() => pickTab('want')}>
          想看 · {want.length}
        </button>
      </div>

      {tab === 'read' && (
        <>
          {(usedTypes.length > 0 || anyFull) && (
            <div className="chips" role="group" aria-label="按参考价值筛选">
              {usedTypes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="chip"
                  data-color={t.color}
                  aria-pressed={typeFilter === t.id}
                  onClick={() => setTypeFilter(typeFilter === t.id ? null : t.id)}
                >
                  <span className="dot" aria-hidden="true" />
                  {t.name}
                </button>
              ))}
              {anyFull && (
                <button type="button" className="chip" aria-pressed={typeFilter === FULL} onClick={() => setTypeFilter(typeFilter === FULL ? null : FULL)}>
                  <span className="full-tag" aria-hidden="true">
                    Full
                  </span>
                  整篇
                </button>
              )}
            </div>
          )}

          {read.length > 0 && (
            <div className="lib-tools">
              <div className="seg seg-small" role="group" aria-label="排序">
                {PAPER_SORTS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="btn"
                    aria-pressed={sort === value}
                    onClick={() => {
                      setSort(value)
                      store('lib.sort', value)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {!picking && (
                <button type="button" className="btn btn-quiet" onClick={() => setPicking([])}>
                  选择
                </button>
              )}
            </div>
          )}

          {papers && read.length === 0 && (
            <p className="empty">还没有论文。在主页粘贴一篇论文的 Markdown，或点上面的“添加论文”。</p>
          )}
          {typeFilter && shown.length === 0 && read.length > 0 && (
            <p className="empty">还没有标了这项参考价值的论文。在论文页的“编辑信息”里标。</p>
          )}

          {groups.map(({ id: groupId, name, papers: list }) => {
            const open = !closed.includes(groupId || UNCATEGORISED) && list.length > 0
            return (
              <section key={groupId || UNCATEGORISED} className="group">
                <button
                  type="button"
                  className="group-head"
                  aria-expanded={open}
                  data-field-drop={groupId}
                  data-field-name={name}
                  data-drop-target
                  onClick={() => toggleGroup(groupId || UNCATEGORISED)}
                >
                  <span>{name}</span>
                  <span className="group-count">{list.length}</span>
                  <IconChevron />
                </button>
                {open && (
                  <ul className="paper-list">
                    {list.map((p) => {
                      const times = readCount.get(p.id)?.count ?? 0
                      const meta = [
                        p.authors[0] ? p.authors[0] + (p.authors.length > 1 ? ' 等' : '') : '',
                        p.year ?? '',
                        p.venue,
                        times > 1 ? `读过 ${times} 次` : '',
                      ].filter(Boolean)
                      const now = isReadingNow(uses?.get(p.id))
                      const ticked = picking?.includes(p.id) ?? false
                      const body = (
                        <>
                          <span className="paper-row-title">
                            {showRestoredMark(p, papers ?? []) && <span className="restored-mark">【恢复】</span>}
                            {p.title || '（没有标题）'}
                          </span>
                          {(meta.length > 0 || now) && (
                            <span className="paper-row-line">
                              <span className="paper-row-meta">{meta.join(' · ')}</span>
                              {now && <span className="reading-tag">在读</span>}
                            </span>
                          )}
                          <span className="paper-row-marks">
                            <ValueMarks paper={p} types={types ?? []} />
                            <BoxMark names={boxMarks.get(`paper:${p.id}`)} />
                          </span>
                        </>
                      )
                      if (picking) {
                        return (
                          <li key={p.id}>
                            <button
                              type="button"
                              className={`paper-row is-picking${ticked ? ' is-ticked' : ''}`}
                              aria-pressed={ticked}
                              onClick={() => setPicking(ticked ? picking.filter((x) => x !== p.id) : [...picking, p.id])}
                            >
                              <span className="pick-box" aria-hidden="true">
                                {ticked && <IconCheck />}
                              </span>
                              {body}
                            </button>
                          </li>
                        )
                      }
                      return (
                        <li key={p.id}>
                          <a
                            className="paper-row"
                            href={`#/paper/${p.id}`}
                            aria-current={p.id === activeId ? 'page' : undefined}
                            // dragged with Pointer Events, so it works with a finger as well as the mouse
                            draggable={false}
                            data-drag=""
                            onPointerDown={(e) => {
                              if (e.pointerType === 'mouse' && e.button !== 0) return
                              // from the grip a finger can pull in any direction; elsewhere on the row, sideways only
                              const grip = !!(e.target as HTMLElement).closest('[data-grip]')
                              watchPointerDrag(e, { type: 'paper', id: p.id }, p.title || '（没有标题）', onDragOut, grip)
                            }}
                          >
                            <span className="row-grip" data-grip aria-hidden="true">
                              <IconGrip />
                            </span>
                            {body}
                          </a>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          })}
          {picking && (
            <div className="pick-bar" role="region" aria-label="选中的论文">
              <span className="sel-count" role="status">
                已选 {picking.length} 篇
              </span>
              <AddToDiscussion
                className="btn btn-dark"
                label={picking.length > 0 ? `放进讨论框（${picking.length}）` : '放进讨论框'}
                refs={() => picking.map((id) => ({ type: 'paper' as const, id }))}
                onDone={() => setPicking(null)}
              />
              <button type="button" className="btn btn-quiet" onClick={() => setPicking(null)}>
                取消
              </button>
            </div>
          )}
          {read.length > 0 && !picking && (
            <p className="lib-foot">
              按住论文右边的把手，拖到某个领域的标题上，就能换领域。
              <a href="#/settings?section=fields">管理领域</a>
            </p>
          )}
        </>
      )}

      {tab === 'want' && <WantList items={want} boxMarks={boxMarks} />}
    </div>
  )
}

/** Where an AI-mentioned entry came from: the days whose record named it. */
function Sources({ paper }: { paper: Paper }) {
  const list = paper.mentioned_in ?? []
  // each source is a research record; the link goes to the board that record is on
  const where = useLiveQuery(async () => {
    const records = await db.records.bulkGet(list.map((m) => m.record_id))
    return new Map(records.filter((r) => !!r).map((r) => [r!.id, boardHref(recordBoardId(r!))]))
  }, [list.map((m) => m.record_id).join(',')])
  if (list.length === 0) return null
  return (
    <span className="want-meta">
      提到它的记录：
      {list.map((m, i) => (
        <span key={m.record_id}>
          {i > 0 && '、'}
          <a href={where?.get(m.record_id) ?? '#/boards'}>{shortDate(m.date)}</a>
        </span>
      ))}
    </span>
  )
}

function WantItem({ paper, boxMarks }: { paper: Paper; boxMarks?: Map<string, string[]> }) {
  const [editing, setEditing] = useState(false)
  const name = paper.title || paper.doi || paper.url
  const link = paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : '')
  const meta = [
    paper.authors[0] ? paper.authors[0] + (paper.authors.length > 1 ? ' 等' : '') : '',
    paper.year ?? '',
    paper.venue,
  ].filter(Boolean)

  if (editing) {
    return (
      <li className="want-item is-editing">
        <EditPaperForm paper={paper} onDone={() => setEditing(false)} />
      </li>
    )
  }
  return (
    <li className="want-item">
      <div className="want-text">
        {link ? (
          <a className="want-title" href={link} target="_blank" rel="noopener noreferrer">
            {name}
          </a>
        ) : (
          <span className="want-title">{name}</span>
        )}
        {meta.length > 0 && <span className="want-meta">{meta.join(' · ')}</span>}
        <BoxMark names={boxMarks?.get(`paper:${paper.id}`)} />
        {paper.lookup === 'pending' && <span className="want-meta">文献信息还没查到，联网后会自动补上</span>}
        {paper.lookup === 'failed' && (
          <span className="want-meta">
            按这个 DOI 没查到文献信息。
            <button type="button" className="link-btn" onClick={() => void retryLookup(paper)}>
              再查一次
            </button>
          </span>
        )}
        {paper.why && <span className="want-why">{paper.why}</span>}
        <Sources paper={paper} />
      </div>
      <div className="want-actions">
        <button type="button" className="btn btn-quiet" aria-label={`标为已读：${name}`} onClick={() => void markRead(paper)}>
          标为已读
        </button>
        <AddToDiscussion refs={[{ type: 'paper', id: paper.id }]} iconOnly label={`放进讨论框：${name}`} />
        <button type="button" className="icon-btn" aria-label={`编辑：${name}`} onClick={() => setEditing(true)}>
          <IconEdit />
        </button>
      </div>
    </li>
  )
}

function WantList({ items, boxMarks }: { items: Paper[]; boxMarks: Map<string, string[]> }) {
  const [aiOpen, setAiOpen] = useState(false)
  const newest = (list: Paper[]) => [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  const mine = newest(items.filter((p) => p.added_by !== 'ai'))
  const ai = newest(items.filter((p) => p.added_by === 'ai'))

  return (
    <>
      {items.length === 0 && <p className="empty">想看的论文记在这里。导入它的 Markdown 后会自动移到“已读”。</p>}
      <ul className="want-list">
        {mine.map((p) => (
          <WantItem key={p.id} paper={p} boxMarks={boxMarks} />
        ))}
      </ul>
      {ai.length > 0 && (
        <section className="group">
          <button type="button" className="group-head" aria-expanded={aiOpen} onClick={() => setAiOpen(!aiOpen)}>
            <span>AI 提到的</span>
            <span className="group-count">{ai.length}</span>
            <IconChevron />
          </button>
          {aiOpen && (
            <ul className="want-list">
              {ai.map((p) => (
                <WantItem key={p.id} paper={p} boxMarks={boxMarks} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  )
}
