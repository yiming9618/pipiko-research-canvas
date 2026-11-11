import { useLiveQuery } from 'dexie-react-hooks'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { shortDate } from '../domain/importer'
import { isEmptyQuery, parseQuery, runSearch, type Hit } from '../domain/search'
import { db, todayLocal } from '../store/db'
import { ADD_MESSAGE, DRAG_TYPE, addToPile } from '../store/pileActions'
import { loadSearchData } from '../store/searchIndex'
import { IconClose, IconPlus, IconSearch } from './icons'

const MAX_SHOWN = 60

// Kept while moving between pages, so reopening the panel shows the last search.
let lastText = ''

/**
 * The small search control in the top-right corner of every page. It opens a
 * panel in that corner, leaving the rest of the page visible so a result can
 * be dragged onto a pile.
 */
export function SearchBox() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(lastText)
  const [status, setStatus] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const data = useLiveQuery(() => (open ? loadSearchData() : undefined), [open])
  const pileId = open && window.location.hash.startsWith('#/pile/') ? decodeURIComponent(window.location.hash.slice(7)) : ''
  const pile = useLiveQuery(() => (pileId ? db.piles.get(pileId) : undefined), [pileId])

  const deferred = useDeferredValue(text)
  const query = useMemo(() => (data ? parseQuery(deferred, data.types, todayLocal()) : null), [data, deferred])
  const hits = useMemo(() => (data && query ? runSearch(data.docs, query) : []), [data, query])

  useEffect(() => {
    lastText = text
  }, [text])

  useEffect(() => {
    if (!open) return
    input.current?.focus()
    input.current?.select()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(false)
    }
    const onHash = () => setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('hashchange', onHash)
    const t = setTimeout(() => window.addEventListener('pointerdown', onDown), 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  const put = async (hit: Hit) => {
    if (!pile || !hit.doc.ref) return
    setStatus(ADD_MESSAGE[await addToPile(pile.id, hit.doc.ref)](pile.name))
    setTimeout(() => setStatus(''), 3200)
  }

  if (!open) {
    return (
      <button type="button" className="search-trigger" onClick={() => setOpen(true)} aria-label="搜索" aria-expanded={false}>
        <IconSearch />
        <span>搜索</span>
      </button>
    )
  }

  const empty = !query || isEmptyQuery(query)
  return (
    <div className="search-panel" ref={panel} role="dialog" aria-label="搜索">
      <div className="search-row">
        <IconSearch />
        <label>
          <span className="sr-only">搜索</span>
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="日期、类型、关键词"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <button type="button" className="icon-btn" aria-label="关上搜索" onClick={() => setOpen(false)}>
          <IconClose />
        </button>
      </div>

      {empty ? (
        <p className="search-hint">
          三样可以随意组合，用空格隔开：
          <br />
          日期（11月10日、2026-11、昨天）
          <br />
          类型（论文、发现、实验、问题、思考、下一步、重点类型名）
          <br />
          关键词
          <br />
          例如：11月 问题 霉菌
        </p>
      ) : (
        <>
          <p className="search-count" role="status" aria-live="polite">
            {status || (hits.length === 0 ? '没有找到。换个说法，或少写一个条件试试。' : `找到 ${hits.length} 条${hits.length > MAX_SHOWN ? `，先显示前 ${MAX_SHOWN} 条` : ''}`)}
          </p>
          <ul className="search-list">
            {hits.slice(0, MAX_SHOWN).map((hit) => {
              const d = hit.doc
              const date = d.dates.length > 0 ? [...d.dates].sort().at(-1)! : ''
              return (
                <li key={d.key} className="search-item">
                  <a
                    href={d.href}
                    draggable={d.ref !== null}
                    onDragStart={(e) => {
                      if (!d.ref) return
                      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(d.ref))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                  >
                    <span className="search-meta">
                      <span className="search-kind" data-color={d.color}>
                        {d.label}
                      </span>
                      {date && d.kind !== 'pile' && <span>{date.slice(0, 4) === todayLocal().slice(0, 4) ? shortDate(date) : date}</span>}
                    </span>
                    <span className="search-title">{d.title || '（没有标题）'}</span>
                    {hit.snippet ? (
                      <span className="search-snippet">
                        {hit.snippet.before}
                        <mark>{hit.snippet.match}</mark>
                        {hit.snippet.after}
                      </span>
                    ) : (
                      d.body && <span className="search-snippet">{d.body.replace(/\s+/g, ' ').slice(0, 72)}</span>
                    )}
                  </a>
                  {pile && d.ref && !(d.ref.type === 'pile' && d.ref.id === pile.id) && (
                    <button type="button" className="icon-btn" aria-label={`放进「${pile.name}」：${d.title}`} onClick={() => void put(hit)}>
                      <IconPlus />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
