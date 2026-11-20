import { useLiveQuery } from 'dexie-react-hooks'
import { paperReadings } from '../../domain/readings'
import { useEffect, useMemo, useState } from 'react'
import type { HighlightType, Paper } from '../../domain/types'
import { db } from '../../store/db'
import { AddPaperForm } from './PaperForm'
import { AddToDiscussion } from '../discussions/AddToDiscussion'
import { POINTER_DROP, watchPointerDrag, type PointerDrop } from '../../ui/pointerDrag'
import { fieldOfPaper } from '../../domain/migrate'
import { showRestoredMark } from '../../domain/trash'
import { setPaperField } from '../../store/fieldActions'
import { toast } from '../../ui/toast'
import { IconCheck, IconChevron, IconFold, IconGrip, IconPlus } from '../../ui/icons'
import { isAiMention, isReadingNow, lastRead, PAPER_SORTS, sortPapers, type PaperSort, type SortDirection } from '../../domain/library'
import { BoxMark, useBoxMarks, ValueMarks } from '../../ui/marks'

const UNCATEGORISED = '未分类'
/** The filter chip for 参考价值 "Full". */
const FULL = '__full'

type Progress = 'all' | 'edited' | 'unedited'
const PROGRESS: [Progress, string][] = [
  ['all', '全部'],
  ['edited', '已编辑'],
  ['unedited', '未编辑'],
]

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
  const blocks = useLiveQuery(() => db.blocks.filter((b) => !b.deleted).toArray())
  const types = useLiveQuery(() => db.types.filter((t) => !t.deleted).toArray())
  const fields = useLiveQuery(() => db.fields.toArray())
  const imports = useLiveQuery(() =>
    db.imports.filter((e) => e.kind === 'paper' && !e.undone && !e.deleted).toArray(),
  )
  const readingRows = useLiveQuery(() => db.readings.toArray())
  const uses = useLiveQuery(async () => new Map((await db.paperUse.toArray()).map((u) => [u.id, u])))
  const boxMarks = useBoxMarks()
  const [sort, setSort] = useState<PaperSort>(() => remember<PaperSort>('lib.sort', 'read'))
  const [direction, setDirection] = useState<SortDirection>(() => remember<SortDirection>('lib.sort.dir', 'desc'))
  /** 全部 / 已编辑 / 未编辑 */
  const [progress, setProgress] = useState<Progress>(() => remember<Progress>('lib.progress', 'all'))
  /** Papers the AI named in a research record, with nothing written for them yet: hidden unless asked for. */
  const [showAi, setShowAi] = useState<boolean>(() => remember('lib.ai', false))
  /** 选择: tick several papers and put them in a discussion box together. */
  const [picking, setPicking] = useState<string[] | null>(null)
  const notes = useLiveQuery(() => db.comments.filter((c) => !c.deleted).toArray())

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

  // one library: whether a paper has reading notes is worked out from them, not stored
  const edited = useMemo(() => {
    const has = new Set<string>()
    for (const b of blocks ?? []) has.add(b.paper_id)
    for (const c of notes ?? []) if (c.text.trim() || c.asset_id) has.add(c.paper_id)
    for (const p of papers ?? []) if (p.one_liner.trim() || p.basics_md.trim()) has.add(p.id)
    return has
  }, [papers, blocks, notes])
  const all = papers ?? []
  const aiCount = all.filter((p) => isAiMention(p, edited.has(p.id))).length
  const read = all.filter(
    (p) =>
      (showAi || !isAiMention(p, edited.has(p.id))) &&
      (progress === 'all' || (progress === 'edited') === edited.has(p.id)),
  )

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
      .map(([id, g]) => ({ id, name: g.name, papers: sortPapers(g.papers, sort, uses ?? new Map(), readAt, direction) }))
  }, [shown, fields, typeFilter, sort, direction, uses, imports, readCount])

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
        <AddPaperForm onDone={() => setAdding(false)} />
      )}

      {all.length > 0 && (
        <div className="lib-filter">
          <div className="seg seg-small" role="group" aria-label="阅读进度">
            {PROGRESS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="btn"
                aria-pressed={progress === value}
                onClick={() => {
                  setProgress(value)
                  store('lib.progress', value)
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {aiCount > 0 && (
            <button
              type="button"
              className="chip ai-chip"
              aria-pressed={showAi}
              onClick={() => {
                setShowAi(!showAi)
                store('lib.ai', !showAi)
              }}
            >
              显示 AI 提到的（{aiCount}）
            </button>
          )}
        </div>
      )}

      {(
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
              <div className="sort-pick">
                <label>
                  <span className="sr-only">排序方式</span>
                  <select
                    value={sort}
                    onChange={(e) => {
                      const value = e.target.value as PaperSort
                      setSort(value)
                      store('lib.sort', value)
                    }}
                  >
                    {PAPER_SORTS.map(([value, label]) => (
                      <option key={value} value={value}>
                        按{label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-quiet sort-dir"
                  aria-label={direction === 'desc' ? '现在是新的在前，点一下改成旧的在前' : '现在是旧的在前，点一下改成新的在前'}
                  title={direction === 'desc' ? '新的在前' : '旧的在前'}
                  onClick={() => {
                    const next = direction === 'desc' ? 'asc' : 'desc'
                    setDirection(next)
                    store('lib.sort.dir', next)
                  }}
                >
                  {direction === 'desc' ? '↓ 新的在前' : '↑ 旧的在前'}
                </button>
              </div>
              {!picking && (
                <button type="button" className="btn btn-quiet" onClick={() => setPicking([])}>
                  选择
                </button>
              )}
            </div>
          )}

          {papers && all.length === 0 && (
            <p className="empty">还没有论文。在主页粘贴一篇论文的 Markdown，或点上面的“添加论文”。</p>
          )}
          {papers && all.length > 0 && read.length === 0 && (
            <p className="empty">{progress === 'edited' ? '还没有写过笔记的论文。' : progress === 'unedited' ? '每篇论文都已经有笔记了。' : '论文都是 AI 提到的，点上面的“显示 AI 提到的”就能看到。'}</p>
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
                      const ai = isAiMention(p, edited.has(p.id))
                      const ticked = picking?.includes(p.id) ?? false
                      const body = (
                        <>
                          <span className="paper-row-title">
                            {showRestoredMark(p, papers ?? []) && <span className="restored-mark">【恢复】</span>}
                            {p.title || p.doi || p.url || '（没有标题）'}
                          </span>
                          {(meta.length > 0 || now || ai) && (
                            <span className="paper-row-line">
                              <span className="paper-row-meta">{meta.join(' · ')}</span>
                              {ai && <span className="ai-tag">AI 提到</span>}
                              {now && <span className="reading-tag">在读</span>}
                            </span>
                          )}
                          {p.why && !edited.has(p.id) && <span className="paper-row-why">{p.why}</span>}
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
                              watchPointerDrag(e, { type: 'paper', id: p.id }, p.title || p.doi || '（没有标题）', onDragOut, grip)
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
    </div>
  )
}
