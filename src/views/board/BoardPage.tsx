import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { candidatesFor, linkCitations } from '../../domain/citations'
import { shortDate } from '../../domain/importer'
import { cardKey, coverKey, defaultLayout } from '../../domain/layout'
import type { Asset, BoardItem, BoardRefType, Card, CardKind, Paper, ResearchRecord } from '../../domain/types'
import {
  addConnector,
  addImageItem,
  addStroke,
  addTextItem,
  patchConnector,
  patchItem,
  removeItem,
  removeStroke,
} from '../../store/boardActions'
import { db } from '../../store/db'
import { IconBack, IconCheck, IconForward, IconHand, IconImage, IconLink, IconPen, IconText } from '../../ui/icons'
import { fileToImage } from '../../ui/image'
import { Markdown } from '../../ui/Markdown'
import { TopNav } from '../../ui/TopNav'
import { LibraryList } from '../library/LibraryList'
import { Canvas, DEFAULT_INK_SIZE, type CanvasApi, type CanvasNode, type Selection, type Tool } from './Canvas'

const KIND_COLOR: Record<CardKind, string> = {
  发现: 'blue',
  实验: 'green',
  问题: 'pink',
  思考: 'yellow',
  下一步: 'orange',
  其他: 'default',
}
const INK = '#b4455c'

function useNarrow(): boolean {
  const query = '(max-width: 759px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

/** Rough height before a card has been measured, so the first paint is close. */
function estimate(text: string): number {
  return 70 + Math.ceil(text.length / 20) * 26
}

export function BoardPage({ date }: { date?: string }) {
  const days = useLiveQuery(async () => {
    const records = await db.records.filter((r) => !r.deleted).toArray()
    const reads = await db.imports.filter((e) => e.kind === 'paper' && !e.undone && !e.deleted).toArray()
    return [...new Set([...records.map((r) => r.date), ...reads.map((e) => e.date)])].sort()
  })

  // "#/board" with no date opens the most recent day that has something.
  useEffect(() => {
    if (date || !days || days.length === 0) return
    window.location.replace(`#/board/${days[days.length - 1]}`)
  }, [date, days])

  return (
    <div className="boardpage">
      <TopNav current="board" />
      <div className="board-body">
        <aside className="board-side">
          <LibraryList />
        </aside>
        <main className="board-main">
          {date ? (
            <DayBoard key={date} date={date} days={days ?? []} />
          ) : (
            days &&
            days.length === 0 && (
              <p className="empty board-empty">还没有研究记录。在主页粘贴一份，它会出现在那一天的画板上。</p>
            )
          )}
        </main>
      </div>
    </div>
  )
}

function DayBoard({ date, days }: { date: string; days: string[] }) {
  const boardId = `day:${date}`
  const narrow = useNarrow()

  const records = useLiveQuery(
    () => db.records.where('date').equals(date).filter((r) => !r.deleted).toArray(),
    [date],
  )
  const cards = useLiveQuery(() => db.cards.where('date').equals(date).filter((c) => !c.deleted).toArray(), [date])
  const items = useLiveQuery(
    () => db.boardItems.where('board_id').equals(boardId).filter((i) => !i.deleted).toArray(),
    [boardId],
  )
  const connectors = useLiveQuery(
    () => db.connectors.where('board_id').equals(boardId).filter((c) => !c.deleted).toArray(),
    [boardId],
  )
  const strokes = useLiveQuery(
    () => db.strokes.where('board_id').equals(boardId).filter((s) => !s.deleted).toArray(),
    [boardId],
  )
  const papers = useLiveQuery(() => db.papers.filter((p) => !p.deleted).toArray())
  const paperImports = useLiveQuery(() =>
    db.imports.filter((e) => e.kind === 'paper' && !e.undone && !e.deleted).toArray(),
  )
  const importOrder = useLiveQuery(async () => {
    const all = await db.imports.where('imported_at').above('').toArray()
    return new Map(all.map((e) => [e.id, e.imported_at]))
  })
  const assets = useLiveQuery(async () => {
    const ids = (items ?? []).filter((i) => i.ref_type === 'image').map((i) => i.ref_id)
    const rows = await db.assets.bulkGet(ids)
    return new Map(rows.filter((a): a is Asset => !!a).map((a) => [a.id, a]))
  }, [items])

  const [editing, setEditing] = useState(false)
  const [tool, setTool] = useState<Tool>('move')
  const [selection, setSelection] = useState<Selection>(null)
  const [typingKey, setTypingKey] = useState<string | null>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [popover, setPopover] = useState<{ paperId: string; x: number; y: number } | null>(null)
  const [rawOf, setRawOf] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const api = useRef<CanvasApi>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const canEdit = !narrow
  const isEditing = editing && canEdit

  const onMeasure = useCallback((key: string, h: number) => {
    setHeights((prev) => (prev[key] === h ? prev : { ...prev, [key]: h }))
  }, [])

  const sortedRecords = useMemo(
    () =>
      [...(records ?? [])].sort((a, b) =>
        (importOrder?.get(a.import_id) ?? '') < (importOrder?.get(b.import_id) ?? '') ? -1 : 1,
      ),
    [records, importOrder],
  )
  const cardsOf = useMemo(() => {
    const map = new Map<string, Card[]>()
    for (const c of cards ?? []) map.set(c.record_id, [...(map.get(c.record_id) ?? []), c])
    for (const list of map.values()) list.sort((a, b) => a.order - b.order)
    return map
  }, [cards])

  const itemByRef = useMemo(() => {
    const map = new Map<string, BoardItem>()
    for (const i of items ?? []) if (i.ref_type === 'card' || i.ref_type === 'cover') map.set(`${i.ref_type}:${i.ref_id}`, i)
    return map
  }, [items])

  const edited = (items?.length ?? 0) + (connectors?.length ?? 0) + (strokes?.length ?? 0) > 0
  // On a phone an untouched board reads best as one column; an arranged board keeps its arrangement.
  const columns = narrow && !edited ? 1 : 2

  const layout = useMemo(
    () =>
      defaultLayout(
        sortedRecords.map((r) => ({ id: r.id, cardIds: (cardsOf.get(r.id) ?? []).map((c) => c.id) })),
        (key) => {
          if (heights[key]) return heights[key]
          if (key.startsWith('card:')) {
            const card = cards?.find((c) => c.id === key.slice(5))
            return estimate(card?.body_md ?? '')
          }
          return 130
        },
        columns,
      ),
    [sortedRecords, cardsOf, heights, cards, columns],
  )

  const saveText = useCallback(
    async (key: string, text: string) => {
      setTypingKey(null)
      if (key.startsWith('item:')) {
        const item = items?.find((i) => i.id === key.slice(5))
        if (!item) return
        if (text.trim() === '') await removeItem(item)
        else if (text !== item.text_override) await patchItem(boardId, { type: 'text', id: '' }, item, item, { text_override: text })
        return
      }
      const card = cards?.find((c) => c.id === key.slice(5))
      const at = layout.get(key)
      if (!card || !at) return
      const existing = itemByRef.get(key)
      const same = text.trim() === card.body_md.trim()
      if (same && !existing) return
      await patchItem(boardId, { type: 'card', id: card.id }, existing, at, { text_override: same ? undefined : text.trim() })
    },
    [items, cards, layout, itemByRef, boardId],
  )

  const nodes: CanvasNode[] = useMemo(() => {
    const out: CanvasNode[] = []
    for (const record of sortedRecords) {
      const candidates = candidatesFor(record.paper_dois, papers ?? [])
      const ck = coverKey(record.id)
      const coverItem = itemByRef.get(ck)
      const coverAt = coverItem ?? layout.get(ck)
      if (coverAt) {
        out.push({
          key: ck,
          x: coverAt.x,
          y: coverAt.y,
          w: coverAt.w,
          movable: true,
          resizable: true,
          z: coverItem?.z ?? 0,
          className: 'cover',
          content: <Cover record={record} onRaw={() => setRawOf(record.import_id)} />,
        })
      }
      for (const card of cardsOf.get(record.id) ?? []) {
        const key = cardKey(card.id)
        const item = itemByRef.get(key)
        const at = item ?? layout.get(key)
        if (!at) continue
        const text = item?.text_override ?? card.body_md
        out.push({
          key,
          x: at.x,
          y: at.y,
          w: at.w,
          movable: true,
          resizable: true,
          z: item?.z ?? 0,
          className: 'card',
          color: KIND_COLOR[card.kind],
          content: (
            <>
              <p className="card-kind">
                {card.kind === '其他' ? card.heading : card.kind}
                {item?.text_override !== undefined && <span className="block-edited">改过</span>}
              </p>
              {typingKey === key ? (
                <TextBox initial={text} label="卡片文字" onDone={(t) => void saveText(key, t)} />
              ) : (
                <Markdown text={linkCitations(text, candidates)} />
              )}
            </>
          ),
        })
      }
    }
    for (const item of items ?? []) {
      if (item.ref_type === 'image') {
        const asset = assets?.get(item.ref_id)
        out.push({
          key: `item:${item.id}`,
          x: item.x,
          y: item.y,
          w: item.w,
          movable: true,
          resizable: true,
          z: item.z,
          className: 'photo',
          content: asset ? (
            <img src={`data:${asset.mime};base64,${asset.data}`} width={asset.w} height={asset.h} alt="贴图" draggable={false} />
          ) : (
            <span className="empty">图片还没同步到这台设备</span>
          ),
        })
      } else if (item.ref_type === 'text') {
        const key = `item:${item.id}`
        out.push({
          key,
          x: item.x,
          y: item.y,
          w: item.w,
          movable: true,
          resizable: true,
          z: item.z,
          className: 'note',
          content:
            typingKey === key ? (
              <TextBox initial={item.text_override ?? ''} label="文字" onDone={(t) => void saveText(key, t)} />
            ) : (
              <Markdown text={item.text_override || '（空）'} />
            ),
        })
      }
    }
    // Untouched cards keep their order; anything moved is drawn above them, most recent on top.
    return out.sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
  }, [sortedRecords, papers, itemByRef, layout, cardsOf, items, assets, typingKey, saveText])

  const topZ = (items ?? []).reduce((max, i) => Math.max(max, i.z), 0) + 1

  /** Finds what a canvas key refers to, and where it is drawn right now. */
  const resolve = (key: string) => {
    const node = nodes.find((n) => n.key === key)
    if (!node) return null
    const at = { x: node.x, y: node.y, w: node.w }
    if (key.startsWith('item:')) {
      const item = items?.find((i) => i.id === key.slice(5))
      return item ? { ref: { type: item.ref_type, id: item.ref_id }, existing: item, at } : null
    }
    const [type, id] = [key.slice(0, key.indexOf(':')) as BoardRefType, key.slice(key.indexOf(':') + 1)]
    return { ref: { type, id }, existing: itemByRef.get(key), at }
  }

  const onMove = (key: string, x: number, y: number) => {
    const r = resolve(key)
    if (r) void patchItem(boardId, r.ref, r.existing, r.at, { x, y, z: topZ })
  }
  const onResize = (key: string, w: number) => {
    const r = resolve(key)
    if (r) void patchItem(boardId, r.ref, r.existing, r.at, { w, z: topZ })
  }

  const selectedItem = selection?.kind === 'node' ? resolve(selection.id) : null
  const selectedLink = selection?.kind === 'link' ? connectors?.find((c) => c.id === selection.id) : undefined
  const selectedStroke = selection?.kind === 'stroke' ? strokes?.find((s) => s.id === selection.id) : undefined

  const deleteSelection = useCallback(() => {
    if (selectedLink) void patchConnector(selectedLink, { deleted: true })
    else if (selectedStroke) void removeStroke(selectedStroke)
    else if (selectedItem?.existing && selection?.id.startsWith('item:')) void removeItem(selectedItem.existing)
    else return
    setSelection(null)
  }, [selectedLink, selectedStroke, selectedItem, selection])

  useEffect(() => {
    if (!isEditing) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection()
      if (e.key === 'Escape') setSelection(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isEditing, deleteSelection])

  let actions = null
  if (isEditing && tool === 'move' && !typingKey) {
    if (selection?.kind === 'node' && selectedItem) {
      const key = selection.id
      const isOwn = key.startsWith('item:')
      const canType = key.startsWith('card:') || selectedItem.ref.type === 'text'
      actions = (
        <>
          {canType && (
            <button type="button" className="btn btn-small btn-quiet" onClick={() => setTypingKey(key)}>
              改文字
            </button>
          )}
          {!isOwn && selectedItem.existing && (
            <button
              type="button"
              className="btn btn-small btn-quiet"
              onClick={() => {
                void removeItem(selectedItem.existing!)
                setSelection(null)
              }}
            >
              恢复原样
            </button>
          )}
          {isOwn && (
            <button type="button" className="btn btn-small btn-quiet edit-delete" onClick={deleteSelection}>
              删除
            </button>
          )}
        </>
      )
      if (!canType && !isOwn && !selectedItem.existing) actions = null
    } else if (selectedLink) {
      actions = (
        <>
          <button
            type="button"
            className="btn btn-small btn-quiet"
            onClick={() => void patchConnector(selectedLink, { arrow: !selectedLink.arrow })}
          >
            {selectedLink.arrow ? '去掉箭头' : '加上箭头'}
          </button>
          <button type="button" className="btn btn-small btn-quiet edit-delete" onClick={deleteSelection}>
            删除
          </button>
        </>
      )
    } else if (selectedStroke) {
      actions = (
        <button type="button" className="btn btn-small btn-quiet edit-delete" onClick={deleteSelection}>
          删除
        </button>
      )
    }
  }

  // ── "读了 / 重读了" markers ───────────────────────────────────────────
  const markers = useMemo(() => {
    const out: { paper: Paper; again: boolean }[] = []
    const seen = new Set<string>()
    for (const e of paperImports ?? []) {
      if (e.date !== date || !e.paper_id || seen.has(e.paper_id)) continue
      const paper = papers?.find((p) => p.id === e.paper_id)
      if (!paper) continue
      seen.add(e.paper_id)
      const again = (paperImports ?? []).some((o) => o.paper_id === e.paper_id && o.date < date)
      out.push({ paper, again })
    }
    return out
  }, [paperImports, papers, date])

  const keywords = [...new Set(sortedRecords.flatMap((r) => r.keywords))].slice(0, 6)
  const index = days.indexOf(date)
  const prev = index > 0 ? days[index - 1] : index === -1 ? [...days].reverse().find((d) => d < date) : undefined
  const next = index >= 0 && index < days.length - 1 ? days[index + 1] : index === -1 ? days.find((d) => d > date) : undefined
  const [year, month] = date.split('-')

  const onClick = (e: MouseEvent) => {
    const cite = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.cite')
    if (!cite) return
    e.preventDefault()
    if (isEditing) return
    setPopover({ paperId: cite.dataset.paper ?? '', x: e.clientX, y: e.clientY })
  }

  const addText = async () => {
    const c = api.current?.center() ?? { x: 0, y: 0 }
    const id = await addTextItem(boardId, { x: c.x - 130, y: c.y - 20 }, topZ)
    setTool('move')
    setSelection({ kind: 'node', id: `item:${id}` })
    setTypingKey(`item:${id}`)
  }

  const addImage = async (file: File | undefined) => {
    if (!file) return
    setNotice('')
    try {
      const c = api.current?.center() ?? { x: 0, y: 0 }
      await addImageItem(boardId, { x: c.x, y: c.y - 80 }, await fileToImage(file), topZ)
      setTool('move')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '图片没有加上，请再试一次')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const popPaper = popover ? papers?.find((p) => p.id === popover.paperId) : undefined
  const loaded = records !== undefined && cards !== undefined && items !== undefined

  return (
    <div className="dayboard" onClick={onClick}>
      <header className="board-head">
        <div className="crumb">
          <span className="crumb-path">
            {year} › {Number(month)} 月 ›
          </span>
          <h1>{shortDate(date)}</h1>
        </div>
        <div className="crumb-nav">
          <a
            className="icon-btn"
            href={prev ? `#/board/${prev}` : undefined}
            aria-label={prev ? `前一天有记录的日子：${shortDate(prev)}` : '前面没有了'}
            aria-disabled={!prev}
          >
            <IconBack />
          </a>
          <a
            className="icon-btn"
            href={next ? `#/board/${next}` : undefined}
            aria-label={next ? `后一天有记录的日子：${shortDate(next)}` : '后面没有了'}
            aria-disabled={!next}
          >
            <IconForward />
          </a>
        </div>
        {loaded && sortedRecords.length > 0 && <span className="board-state">{edited ? '已编排' : '模板布局 · 未编辑'}</span>}
        <div className="board-keys">
          {keywords.map((k) => (
            <span key={k} className="key-tag">
              {k}
            </span>
          ))}
        </div>
      </header>

      {loaded && nodes.length === 0 && markers.length === 0 && <p className="empty board-empty">这一天还没有记录。</p>}

      <Canvas
        nodes={nodes}
        links={connectors ?? []}
        strokes={strokes ?? []}
        editing={isEditing}
        tool={tool}
        selection={isEditing ? selection : null}
        onSelect={(s) => {
          if (typingKey && (s?.kind !== 'node' || s.id !== typingKey)) return
          setSelection(s)
        }}
        onMove={onMove}
        onResize={onResize}
        onLink={(from, to) => void addConnector(boardId, from, to)}
        onStroke={(points) => void addStroke(boardId, points, INK, DEFAULT_INK_SIZE)}
        onMeasure={onMeasure}
        actions={actions}
        fitKey={`${boardId}:${columns}`}
        topInset={72}
        inkColor={INK}
        apiRef={api}
      />

      {markers.length > 0 && (
        <div className="markers">
          {markers.map(({ paper, again }) => (
            <a key={paper.id} className="marker" href={`#/paper/${paper.id}`}>
              {again ? '重读了' : '读了'} {paper.title}
            </a>
          ))}
        </div>
      )}

      {canEdit &&
        (isEditing ? (
          <div className="toolbar" role="toolbar" aria-label="编排工具">
            <ToolButton label="移动" active={tool === 'move'} onClick={() => setTool('move')} icon={<IconHand />} />
            <ToolButton
              label="连线"
              active={tool === 'connect'}
              onClick={() => {
                setTool('connect')
                setSelection(null)
              }}
              icon={<IconLink />}
            />
            <ToolButton
              label="画笔"
              active={tool === 'draw'}
              onClick={() => {
                setTool('draw')
                setSelection(null)
              }}
              icon={<IconPen />}
            />
            <span className="toolbar-gap" aria-hidden="true" />
            <ToolButton label="文字" onClick={() => void addText()} icon={<IconText />} />
            <ToolButton label="贴图" onClick={() => fileRef.current?.click()} icon={<IconImage />} />
            <span className="toolbar-gap" aria-hidden="true" />
            <ToolButton
              label="完成"
              onClick={() => {
                setEditing(false)
                setSelection(null)
                setTypingKey(null)
                setTool('move')
              }}
              icon={<IconCheck />}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => void addImage(e.target.files?.[0])}
            />
          </div>
        ) : (
          loaded && (
            <button type="button" className="btn edit-toggle" onClick={() => setEditing(true)}>
              <IconPen />
              编排
            </button>
          )
        ))}

      {isEditing && tool !== 'move' && (
        <p className="tool-hint" role="status">
          {tool === 'connect' ? '从一张卡片拖到另一张' : '用笔或手指画；两指移动和缩放'}
        </p>
      )}
      {notice && (
        <p className="tool-hint is-error" role="alert">
          {notice}
        </p>
      )}

      {popover && popPaper && <CitePopover paper={popPaper} x={popover.x} y={popover.y} onClose={() => setPopover(null)} />}
      {rawOf && <RawDialog importId={rawOf} onClose={() => setRawOf(null)} />}
    </div>
  )
}

function Cover({ record, onRaw }: { record: ResearchRecord; onRaw: () => void }) {
  return (
    <>
      <h2 className="cover-title">{record.title || '（没有标题）'}</h2>
      {record.summary && <p className="cover-summary">{record.summary}</p>}
      {record.preamble_md && <Markdown text={record.preamble_md} />}
      <div className="cover-foot">
        {record.activities.map((a) => (
          <span key={a} className="key-tag">
            {a}
          </span>
        ))}
        <button type="button" className="btn btn-quiet cover-raw" onClick={onRaw}>
          原文
        </button>
      </div>
    </>
  )
}

function TextBox({ initial, label, onDone }: { initial: string; label: string; onDone: (text: string) => void }) {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [text])

  return (
    <textarea
      ref={ref}
      className="edit-input"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDone(initial)
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onDone(text)
      }}
    />
  )
}

function ToolButton({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="tool" aria-pressed={active} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

function CitePopover({ paper, x, y, onClose }: { paper: Paper; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // Registered after the opening tap has finished, so that tap does not close it.
    const t = setTimeout(() => window.addEventListener('pointerdown', onDown), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const width = Math.min(340, window.innerWidth - 32)
  const left = Math.max(16, Math.min(window.innerWidth - width - 16, x - width / 2))
  const below = y + 220 < window.innerHeight
  return (
    <div
      ref={ref}
      className="cite-pop"
      role="dialog"
      aria-label="论文预览"
      style={{ left, width, ...(below ? { top: y + 14 } : { bottom: window.innerHeight - y + 14 }) }}
    >
      <p className="cite-pop-meta">{[paper.authors[0], paper.year, paper.venue].filter(Boolean).join(' · ')}</p>
      <p className="cite-pop-title">{paper.title}</p>
      {paper.one_liner && <p className="cite-pop-line">{paper.one_liner}</p>}
      <a className="cite-pop-open" href={`#/paper/${paper.id}`}>
        打开论文页
        <IconForward />
      </a>
    </div>
  )
}

function RawDialog({ importId, onClose }: { importId: string; onClose: () => void }) {
  const entry = useLiveQuery(() => db.imports.get(importId), [importId])
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])
  return (
    <dialog ref={ref} className="dialog dialog-wide" onClose={onClose} aria-labelledby="raw-title">
      <h2 id="raw-title">原始 Markdown</h2>
      <pre className="raw">{entry?.raw_md ?? ''}</pre>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose} autoFocus>
          关闭
        </button>
      </div>
    </dialog>
  )
}
