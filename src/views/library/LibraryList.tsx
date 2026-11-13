import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import type { HighlightType, Paper } from '../../domain/types'
import { db } from '../../store/db'
import { markRead, retryLookup } from '../../store/paperActions'
import { shortDate } from '../../domain/importer'
import { AddPaperForm, EditPaperForm } from './PaperForm'
import { AddToDiscussion } from '../discussions/AddToDiscussion'
import { POINTER_DROP, watchPointerDrag, type PointerDrop } from '../../ui/pointerDrag'
import { fieldOfPaper } from '../../domain/migrate'
import { setPaperField } from '../../store/fieldActions'
import { toast } from '../../ui/toast'
import { boardHref } from '../../domain/boards'
import { recordBoardId } from '../../domain/migrate'
import { IconChevron, IconEdit, IconFold, IconGrip, IconPlus } from '../../ui/icons'

const UNCATEGORISED = '未分类'

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
  const papers = useLiveQuery(() => db.papers.filter((p) => !p.deleted).toArray())
  const blocks = useLiveQuery(() => db.blocks.filter((b) => !b.deleted && b.type_id !== null).toArray())
  const types = useLiveQuery(() => db.types.filter((t) => !t.deleted).toArray())
  const fields = useLiveQuery(() => db.fields.toArray())
  const imports = useLiveQuery(() =>
    db.imports.filter((e) => e.kind === 'paper' && !e.undone && !e.deleted).toArray(),
  )

  const [tab, setTab] = useState<'read' | 'want'>(() => remember('lib.tab', 'read'))
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [closed, setClosed] = useState<string[]>(() => remember('lib.closed', []))
  const [adding, setAdding] = useState(false)

  const typeById = useMemo(() => new Map((types ?? []).map((t) => [t.id, t])), [types])

  /** paper id → its highlight types, one per type, in the list's fixed order. */
  const typesOfPaper = useMemo(() => {
    const map = new Map<string, HighlightType[]>()
    for (const b of blocks ?? []) {
      const type = typeById.get(b.type_id!)
      if (!type) continue
      const list = map.get(b.paper_id) ?? []
      if (!list.includes(type)) list.push(type)
      map.set(b.paper_id, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order)
    return map
  }, [blocks, typeById])

  const readCount = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const e of imports ?? []) {
      if (!e.paper_id) continue
      if (!map.has(e.paper_id)) map.set(e.paper_id, new Set())
      map.get(e.paper_id)!.add(e.date)
    }
    return map
  }, [imports])

  const read = (papers ?? []).filter((p) => p.status === 'read')
  const want = (papers ?? []).filter((p) => p.status === 'want')

  const usedTypes = useMemo(() => {
    const set = new Set<HighlightType>()
    for (const p of read) for (const t of typesOfPaper.get(p.id) ?? []) set.add(t)
    return [...set].sort((a, b) => a.order - b.order)
  }, [read, typesOfPaper])

  const shown = typeFilter ? read.filter((p) => typesOfPaper.get(p.id)?.some((t) => t.id === typeFilter)) : read

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
      .map(([id, g]) => ({ id, name: g.name, papers: g.papers.sort((a, b) => a.title.localeCompare(b.title, 'zh')) }))
  }, [shown, fields, typeFilter])

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
          {usedTypes.length > 0 && (
            <div className="chips" role="group" aria-label="按重点类型筛选">
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
            </div>
          )}

          {papers && read.length === 0 && (
            <p className="empty">还没有论文。在主页粘贴一篇论文的 Markdown，或点上面的“添加论文”。</p>
          )}
          {typeFilter && shown.length === 0 && read.length > 0 && (
            <p className="empty">没有带这个重点的论文。</p>
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
                      const dots = typesOfPaper.get(p.id) ?? []
                      const times = readCount.get(p.id)?.size ?? 0
                      const meta = [
                        p.authors[0] ? p.authors[0] + (p.authors.length > 1 ? ' 等' : '') : '',
                        p.year ?? '',
                        p.venue,
                        times > 1 ? `读过 ${times} 次` : '',
                      ].filter(Boolean)
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
                            <span className="paper-row-title">{p.title || '（没有标题）'}</span>
                            {meta.length > 0 && <span className="paper-row-meta">{meta.join(' · ')}</span>}
                            {dots.length > 0 && (
                              <span className="dots" role="img" aria-label={`重点：${dots.map((t) => t.name).join('、')}`}>
                                {dots.map((t) => (
                                  <span key={t.id} className="dot" data-color={t.color} title={t.name} />
                                ))}
                              </span>
                            )}
                          </a>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          })}
          {read.length > 0 && (
            <p className="lib-foot">
              按住论文右边的把手，拖到某个领域的标题上，就能换领域。
              <a href="#/settings?section=fields">管理领域</a>
            </p>
          )}
        </>
      )}

      {tab === 'want' && <WantList items={want} />}
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

function WantItem({ paper }: { paper: Paper }) {
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

function WantList({ items }: { items: Paper[] }) {
  const [aiOpen, setAiOpen] = useState(false)
  const newest = (list: Paper[]) => [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  const mine = newest(items.filter((p) => p.added_by !== 'ai'))
  const ai = newest(items.filter((p) => p.added_by === 'ai'))

  return (
    <>
      {items.length === 0 && <p className="empty">想看的论文记在这里。导入它的 Markdown 后会自动移到“已读”。</p>}
      <ul className="want-list">
        {mine.map((p) => (
          <WantItem key={p.id} paper={p} />
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
                <WantItem key={p.id} paper={p} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  )
}
