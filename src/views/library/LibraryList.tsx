import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type FormEvent } from 'react'
import type { HighlightType, Paper } from '../../domain/types'
import { db } from '../../store/db'
import { addWant, removeWant } from '../../store/paperActions'
import { DRAG_TYPE } from '../../store/pileActions'
import { IconChevron, IconClose, IconPlus } from '../../ui/icons'

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

export function LibraryList({ activeId }: { activeId?: string }) {
  const papers = useLiveQuery(() => db.papers.filter((p) => !p.deleted).toArray())
  const blocks = useLiveQuery(() => db.blocks.filter((b) => !b.deleted && b.type_id !== null).toArray())
  const types = useLiveQuery(() => db.types.filter((t) => !t.deleted).toArray())
  const imports = useLiveQuery(() =>
    db.imports.filter((e) => e.kind === 'paper' && !e.undone && !e.deleted).toArray(),
  )

  const [tab, setTab] = useState<'read' | 'want'>(() => remember('lib.tab', 'read'))
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [closed, setClosed] = useState<string[]>(() => remember('lib.closed', []))

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

  const groups = useMemo(() => {
    const map = new Map<string, Paper[]>()
    for (const p of shown) {
      const key = p.category || UNCATEGORISED
      map.set(key, [...(map.get(key) ?? []), p])
    }
    return [...map.entries()]
      .sort(([a], [b]) => (a === UNCATEGORISED ? 1 : b === UNCATEGORISED ? -1 : a.localeCompare(b, 'zh')))
      .map(([name, list]) => [name, list.sort((a, b) => a.title.localeCompare(b.title, 'zh'))] as const)
  }, [shown])

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
      <h1 className="liblist-title">论文库</h1>

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
            <p className="empty">还没有论文。在主页粘贴一篇论文的 Markdown，它会出现在这里。</p>
          )}
          {typeFilter && shown.length === 0 && read.length > 0 && (
            <p className="empty">没有带这个重点的论文。</p>
          )}

          {groups.map(([name, list]) => {
            const open = !closed.includes(name)
            return (
              <section key={name} className="group">
                <button
                  type="button"
                  className="group-head"
                  aria-expanded={open}
                  onClick={() => toggleGroup(name)}
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
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type: 'paper', id: p.id }))
                              e.dataTransfer.effectAllowed = 'copy'
                            }}
                          >
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
        </>
      )}

      {tab === 'want' && <WantList items={want} />}
    </div>
  )
}

function WantList({ items }: { items: Paper[] }) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (title.trim() === '') return
    await addWant(title, url)
    setTitle('')
    setUrl('')
  }

  return (
    <>
      <form className="want-form" onSubmit={(e) => void submit(e)}>
        <label>
          <span className="sr-only">标题</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="想看的论文标题" />
        </label>
        <label>
          <span className="sr-only">链接</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="链接（可以不填）"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <button type="submit" className="btn" disabled={title.trim() === ''}>
          <IconPlus />
          加进想看
        </button>
      </form>

      {items.length === 0 && <p className="empty">想看的论文记在这里。导入后会自动移到"已读"。</p>}
      <ul className="want-list">
        {[...items]
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .map((p) => (
            <li key={p.id} className="want-item">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {p.title}
                </a>
              ) : (
                <span>{p.title}</span>
              )}
              <button
                type="button"
                className="icon-btn"
                aria-label={`从想看里去掉：${p.title}`}
                onClick={() => {
                  if (window.confirm(`从"想看"里去掉「${p.title}」？`)) void removeWant(p)
                }}
              >
                <IconClose />
              </button>
            </li>
          ))}
      </ul>
    </>
  )
}
