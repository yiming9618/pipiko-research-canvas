// One surface for both kinds of board:
//  - a day: the imported cards in their template layout, plus what was arranged
//  - a pile: references to cards, papers and other piles, freely arranged

import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { candidatesFor, linkCitations } from '../../domain/citations'
import { shortDate } from '../../domain/importer'
import { cardKey, coverKey, defaultLayout } from '../../domain/layout'
import { REF_TYPES, countContents, pileBoardId } from '../../domain/piles'
import type { Asset, BoardItem, BoardRefType, Card, Paper, Pile, ResearchRecord } from '../../domain/types'
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
import { ADD_MESSAGE, DRAG_TYPE, addToPile, createPile, deletePile, readDrag, renamePile } from '../../store/pileActions'
import { IconBack, IconCheck, IconHand, IconImage, IconLink, IconPen, IconPlus, IconText } from '../../ui/icons'
import { fileToImage } from '../../ui/image'
import { Markdown } from '../../ui/Markdown'
import { AddToPile } from '../piles/AddToPile'
import { countLabel } from '../piles/PileShelf'
import { Crumb } from '../time/Crumb'
import { KIND_COLOR } from '../time/MonthView'
import { useStageAnimation } from '../time/zoom'
import { Canvas, DEFAULT_INK_SIZE, type CanvasApi, type CanvasNode, type Selection, type Tool } from './Canvas'
import { CitePopover, Cover, RawDialog, TextBox, ToolButton, useNarrow } from './parts'

const INK = '#b4455c'

/** Rough height before a card has been measured, so the first paint is close. */
function estimate(text: string): number {
  return 70 + Math.ceil(text.length / 20) * 26
}

type Props = { kind: 'day'; date: string; days: string[] } | { kind: 'pile'; pileId: string }

export function BoardView(props: Props) {
  const isDay = props.kind === 'day'
  const date = props.kind === 'day' ? props.date : ''
  const pileId = props.kind === 'pile' ? props.pileId : ''
  const boardId = isDay ? `day:${date}` : pileBoardId(pileId)
  const narrow = useNarrow()

  // ── what is arranged on this board ───────────────────────────────────
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
  const piles = useLiveQuery(() => db.piles.filter((p) => !p.deleted).sortBy('created_at'))
  const pileItems = useLiveQuery(() => db.boardItems.filter((i) => !i.deleted && i.board_id.startsWith('pile:')).toArray())
  const assets = useLiveQuery(async () => {
    const ids = (items ?? []).filter((i) => i.ref_type === 'image').map((i) => i.ref_id)
    const rows = await db.assets.bulkGet(ids)
    return new Map(rows.filter((a): a is Asset => !!a).map((a) => [a.id, a]))
  }, [items])

  // ── the originals: a day's own records, or whatever a pile points at ──
  const source = useLiveQuery(async () => {
    if (isDay) {
      const [records, cards] = await Promise.all([
        db.records.where('date').equals(date).filter((r) => !r.deleted).toArray(),
        db.cards.where('date').equals(date).filter((c) => !c.deleted).toArray(),
      ])
      return { records, cards }
    }
    const refs = (items ?? []).filter((i) => i.ref_type === 'card' || i.ref_type === 'cover')
    const cards = (await db.cards.bulkGet(refs.filter((i) => i.ref_type === 'card').map((i) => i.ref_id))).filter(
      (c): c is Card => !!c && !c.deleted,
    )
    const recordIds = new Set([...cards.map((c) => c.record_id), ...refs.filter((i) => i.ref_type === 'cover').map((i) => i.ref_id)])
    const records = (await db.records.bulkGet([...recordIds])).filter((r): r is ResearchRecord => !!r && !r.deleted)
    return { records, cards }
  }, [isDay, date, items])
  const records = source?.records
  const cards = source?.cards

  const paperImports = useLiveQuery(() =>
    db.imports.filter((e) => e.kind === 'paper' && !e.undone && !e.deleted).toArray(),
  )
  const importOrder = useLiveQuery(async () => new Map((await db.imports.toArray()).map((e) => [e.id, e.imported_at])))
  const pile = useLiveQuery(() => (pileId ? db.piles.get(pileId) : undefined), [pileId])

  const [editing, setEditing] = useState(false)
  const [tool, setTool] = useState<Tool>('move')
  const [selection, setSelection] = useState<Selection>(null)
  const [typingKey, setTypingKey] = useState<string | null>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [popover, setPopover] = useState<{ paperId: string; x: number; y: number } | null>(null)
  const [rawOf, setRawOf] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [dropping, setDropping] = useState(false)
  const api = useRef<CanvasApi>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const say = useCallback((text: string, error = false) => {
    setNotice({ text, error })
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 3200)
  }, [])

  const canEdit = !narrow
  const isEditing = editing && canEdit

  const onMeasure = useCallback((key: string, h: number) => {
    setHeights((prev) => (prev[key] === h ? prev : { ...prev, [key]: h }))
  }, [])

  const recordById = useMemo(() => new Map((records ?? []).map((r) => [r.id, r])), [records])
  const cardById = useMemo(() => new Map((cards ?? []).map((c) => [c.id, c])), [cards])

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

  /** Rows for things that are references (not images or free text), by "type:id". */
  const itemByRef = useMemo(() => {
    const map = new Map<string, BoardItem>()
    for (const i of items ?? []) if (REF_TYPES.includes(i.ref_type)) map.set(`${i.ref_type}:${i.ref_id}`, i)
    return map
  }, [items])

  const edited = (items?.length ?? 0) + (connectors?.length ?? 0) + (strokes?.length ?? 0) > 0
  // On a phone an untouched day reads best as one column; an arranged board keeps its arrangement.
  const columns = narrow && !edited ? 1 : 2

  const layout = useMemo(() => {
    if (!isDay) return new Map<string, { x: number; y: number; w: number }>()
    return defaultLayout(
      sortedRecords.map((r) => ({ id: r.id, cardIds: (cardsOf.get(r.id) ?? []).map((c) => c.id) })),
      (key) => {
        if (heights[key]) return heights[key]
        if (key.startsWith('card:')) return estimate(cardById.get(key.slice(5))?.body_md ?? '')
        return 130
      },
      columns,
    )
  }, [isDay, sortedRecords, cardsOf, heights, cardById, columns])

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
      const card = cardById.get(key.slice(5))
      const at = layout.get(key)
      if (!card || !at) return
      const existing = itemByRef.get(key)
      const same = text.trim() === card.body_md.trim()
      if (same && !existing) return
      await patchItem(boardId, { type: 'card', id: card.id }, existing, at, { text_override: same ? undefined : text.trim() })
    },
    [items, cardById, layout, itemByRef, boardId],
  )

  const nodes: CanvasNode[] = useMemo(() => {
    const out: CanvasNode[] = []
    const base = { movable: true, resizable: true }

    const cardNode = (card: Card, at: { x: number; y: number; w: number }, item: BoardItem | undefined): CanvasNode => {
      const key = cardKey(card.id)
      const record = recordById.get(card.record_id)
      const candidates = candidatesFor(record?.paper_dois ?? [], papers ?? [])
      const text = (isDay ? item?.text_override : undefined) ?? card.body_md
      return {
        ...base,
        key,
        x: at.x,
        y: at.y,
        w: at.w,
        z: item?.z ?? 0,
        className: 'card',
        color: KIND_COLOR[card.kind],
        content: (
          <>
            <p className="card-kind">
              {card.kind === '其他' ? card.heading : card.kind}
              {isDay && item?.text_override !== undefined && <span className="block-edited">改过</span>}
              {!isDay && (
                <a className="card-source" href={`#/board/${card.date}`}>
                  来自 {shortDate(card.date)}
                </a>
              )}
            </p>
            {typingKey === key ? (
              <TextBox initial={text} label="卡片文字" onDone={(t) => void saveText(key, t)} />
            ) : (
              <Markdown text={linkCitations(text, candidates)} />
            )}
          </>
        ),
      }
    }
    const coverNode = (record: ResearchRecord, at: { x: number; y: number; w: number }, item: BoardItem | undefined): CanvasNode => ({
      ...base,
      key: coverKey(record.id),
      x: at.x,
      y: at.y,
      w: at.w,
      z: item?.z ?? 0,
      className: 'cover',
      content: (
        <>
          {!isDay && (
            <a className="card-source" href={`#/board/${record.date}`}>
              来自 {shortDate(record.date)}
            </a>
          )}
          <Cover record={record} onRaw={() => setRawOf(record.import_id)} />
        </>
      ),
    })
    const gone = (item: BoardItem): CanvasNode => ({
      ...base,
      resizable: false,
      key: `${item.ref_type}:${item.ref_id}`,
      x: item.x,
      y: item.y,
      w: item.w,
      z: item.z,
      className: 'ghost',
      content: <p>原件已经不在了（可能撤销了那次导入，或删掉了那个堆）。</p>,
    })

    if (isDay) {
      for (const record of sortedRecords) {
        const coverItem = itemByRef.get(coverKey(record.id))
        const coverAt = coverItem ?? layout.get(coverKey(record.id))
        if (coverAt) out.push(coverNode(record, coverAt, coverItem))
        for (const card of cardsOf.get(record.id) ?? []) {
          const item = itemByRef.get(cardKey(card.id))
          const at = item ?? layout.get(cardKey(card.id))
          if (at) out.push(cardNode(card, at, item))
        }
      }
    }

    for (const item of items ?? []) {
      if (item.ref_type === 'image') {
        const asset = assets?.get(item.ref_id)
        out.push({
          ...base,
          key: `item:${item.id}`,
          x: item.x,
          y: item.y,
          w: item.w,
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
          ...base,
          key,
          x: item.x,
          y: item.y,
          w: item.w,
          z: item.z,
          className: 'note',
          content:
            typingKey === key ? (
              <TextBox initial={item.text_override ?? ''} label="文字" onDone={(t) => void saveText(key, t)} />
            ) : (
              <Markdown text={item.text_override || '（空）'} />
            ),
        })
      } else if (!isDay && source) {
        // A pile's own contents: references, each drawn from its original.
        if (item.ref_type === 'card') {
          const card = cardById.get(item.ref_id)
          out.push(card ? cardNode(card, item, item) : gone(item))
        } else if (item.ref_type === 'cover') {
          const record = recordById.get(item.ref_id)
          out.push(record ? coverNode(record, item, item) : gone(item))
        } else if (item.ref_type === 'paper') {
          const paper = papers?.find((p) => p.id === item.ref_id)
          if (!paper && papers === undefined) continue
          out.push(
            paper
              ? {
                  ...base,
                  key: `paper:${paper.id}`,
                  x: item.x,
                  y: item.y,
                  w: item.w,
                  z: item.z,
                  className: 'papercard',
                  content: (
                    <a href={`#/paper/${paper.id}`}>
                      <span className="papercard-kind">论文</span>
                      <span className="papercard-title">{paper.title || '（没有标题）'}</span>
                      <span className="papercard-meta">
                        {[paper.authors[0], paper.year, paper.venue].filter(Boolean).join(' · ')}
                      </span>
                      {paper.one_liner && <span className="papercard-line">{paper.one_liner}</span>}
                    </a>
                  ),
                }
              : gone(item),
          )
        } else if (item.ref_type === 'pile') {
          const sub = piles?.find((p) => p.id === item.ref_id)
          if (!sub && piles === undefined) continue
          out.push(
            sub
              ? {
                  ...base,
                  resizable: false,
                  key: `pile:${sub.id}`,
                  x: item.x,
                  y: item.y,
                  w: 200,
                  z: item.z,
                  className: 'subpile',
                  content: (
                    <a className="pile-tile" href={`#/pile/${sub.id}`} data-color="pink">
                      <span className="pile-back" aria-hidden="true" />
                      <span className="pile-front">
                        <span className="pile-name">{sub.name}</span>
                        <span className="pile-count">{countLabel(countContents(sub.id, pileItems ?? []))}</span>
                      </span>
                    </a>
                  ),
                }
              : gone(item),
          )
        }
      }
    }
    // Untouched cards keep their order; anything moved is drawn above them, most recent on top.
    return out.sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
  }, [isDay, sortedRecords, papers, itemByRef, layout, cardsOf, items, assets, typingKey, saveText, recordById, cardById, piles, pileItems, source])

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
    const cut = key.indexOf(':')
    return { ref: { type: key.slice(0, cut) as BoardRefType, id: key.slice(cut + 1) }, existing: itemByRef.get(key), at }
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
  const selectedIsRef = !!selectedItem && REF_TYPES.includes(selectedItem.ref.type)

  /** Deletes what was added to this board. On a day, the day's own cards cannot be deleted here. */
  const deleteSelection = useCallback(() => {
    if (selectedLink) void patchConnector(selectedLink, { deleted: true })
    else if (selectedStroke) void removeStroke(selectedStroke)
    else if (selectedItem?.existing && (selection?.id.startsWith('item:') || !isDay)) void removeItem(selectedItem.existing)
    else return
    setSelection(null)
  }, [selectedLink, selectedStroke, selectedItem, selection, isDay])

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

  const quiet = (label: string, onClick: () => void, danger = false) => (
    <button key={label} type="button" className={`btn btn-small btn-quiet${danger ? ' edit-delete' : ''}`} onClick={onClick}>
      {label}
    </button>
  )

  let actions: ReactNode = null
  if (isEditing && tool === 'move' && !typingKey) {
    const buttons: ReactNode[] = []
    if (selection?.kind === 'node' && selectedItem) {
      const key = selection.id
      const isOwn = key.startsWith('item:')
      if ((isDay && key.startsWith('card:')) || selectedItem.ref.type === 'text') {
        buttons.push(quiet('改文字', () => setTypingKey(key)))
      }
      if (isDay && !isOwn && selectedItem.existing) {
        buttons.push(
          quiet('恢复原样', () => {
            void removeItem(selectedItem.existing!)
            setSelection(null)
          }),
        )
      }
      if (!isDay && !isOwn) buttons.push(quiet('移出这个堆', deleteSelection))
      if (isOwn) buttons.push(quiet('删除', deleteSelection, true))
    } else if (selectedLink) {
      buttons.push(quiet(selectedLink.arrow ? '去掉箭头' : '加上箭头', () => void patchConnector(selectedLink, { arrow: !selectedLink.arrow })))
      buttons.push(quiet('删除', deleteSelection, true))
    } else if (selectedStroke) {
      buttons.push(quiet('删除', deleteSelection, true))
    }
    if (buttons.length > 0) actions = buttons
  }

  // ── putting a card of this day into a pile ───────────────────────────
  const dropInto = async (target: Pile | 'new', ref: { type: BoardRefType; id: string }) => {
    const into = target === 'new' ? await createPile('新的堆') : target
    say(ADD_MESSAGE[await addToPile(into.id, ref)](into.name))
  }
  const showDock = isDay && isEditing && tool === 'move' && selectedIsRef && !typingKey

  // ── "读了 / 重读了" markers (days only) ────────────────────────────────
  const markers = useMemo(() => {
    const out: { paper: Paper; again: boolean }[] = []
    if (!isDay) return out
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
  }, [isDay, paperImports, papers, date])

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
    try {
      const c = api.current?.center() ?? { x: 0, y: 0 }
      await addImageItem(boardId, { x: c.x, y: c.y - 80 }, await fileToImage(file), topZ)
      setTool('move')
    } catch (err) {
      say(err instanceof Error ? err.message : '图片没有加上，请再试一次', true)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Papers and piles dragged in from the side list or the shelf land in this pile.
  const onDragOver = (e: DragEvent) => {
    if (isDay || !e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    setDropping(true)
  }
  const onDrop = async (e: DragEvent) => {
    setDropping(false)
    if (isDay || !pile) return
    const ref = readDrag(e)
    if (!ref) return
    e.preventDefault()
    say(ADD_MESSAGE[await addToPile(pile.id, ref)](pile.name))
  }

  const popPaper = popover ? papers?.find((p) => p.id === popover.paperId) : undefined
  const loaded = source !== undefined && items !== undefined && (isDay || pile !== undefined)
  useStageAnimation(stage, 2, isDay ? date : `pile:${pileId}`, loaded)

  if (!isDay && loaded && (!pile || pile.deleted)) {
    return (
      <div className="dayboard">
        <header className="board-head">
          <a className="crumb-link" href="#/board">
            <IconBack />
            画板
          </a>
        </header>
        <p className="empty board-empty">找不到这个堆，可能已经删掉了。</p>
      </div>
    )
  }

  let head: ReactNode
  if (isDay) {
    const { days } = props as { days: string[] }
    const keywords = [...new Set(sortedRecords.flatMap((r) => r.keywords))].slice(0, 6)
    const index = days.indexOf(date)
    const prev = index > 0 ? days[index - 1] : index === -1 ? [...days].reverse().find((d) => d < date) : undefined
    const next = index >= 0 && index < days.length - 1 ? days[index + 1] : index === -1 ? days.find((d) => d > date) : undefined
    const [year, month] = date.split('-')
    head = (
      <>
        <Crumb
          year={year}
          month={month}
          date={date}
          prev={prev ? { href: `#/board/${prev}`, label: shortDate(prev) } : undefined}
          next={next ? { href: `#/board/${next}`, label: shortDate(next) } : undefined}
        />
        {loaded && sortedRecords.length > 0 && <span className="board-state">{edited ? '已编排' : '模板布局 · 未编辑'}</span>}
        <div className="board-keys">
          {keywords.map((k) => (
            <span key={k} className="key-tag">
              {k}
            </span>
          ))}
        </div>
      </>
    )
  } else {
    head = pile ? <PileHead pile={pile} count={countLabel(countContents(pile.id, pileItems ?? []))} editing={isEditing} /> : null
  }

  const empty = loaded && nodes.length === 0 && markers.length === 0
  const [year, month] = date.split('-')

  return (
    <div
      className={`dayboard${dropping ? ' is-dropping' : ''}`}
      onClick={onClick}
      ref={stage}
      onDragOver={onDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <header className="board-head">{head}</header>

      {empty && (
        <p className="empty board-empty">
          {isDay ? '这一天还没有记录。' : '这个堆还是空的。把论文从左边拖进来，或在画板、论文页里用"放进堆"。'}
        </p>
      )}

      <Canvas
        // Wait until everything has loaded: the view is fitted once, to the first content it sees.
        nodes={loaded ? nodes : []}
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
        onZoomOut={() => {
          window.location.hash = isDay ? `#/board/${year}-${month}` : '#/board'
        }}
        onDropOn={
          isDay
            ? (key, el) => {
                const r = resolve(key)
                const id = el.dataset.pileDrop
                const target = id === 'new' ? 'new' : piles?.find((p) => p.id === id)
                if (r && target) void dropInto(target, r.ref)
              }
            : undefined
        }
      />

      {showDock && selectedItem && (
        <div className="dock" role="group" aria-label="放进堆">
          <span className="dock-label">放进堆</span>
          {piles?.map((p) => (
            <button key={p.id} type="button" className="chip" data-pile-drop={p.id} onClick={() => void dropInto(p, selectedItem.ref)}>
              {p.name}
            </button>
          ))}
          <button type="button" className="chip" data-pile-drop="new" onClick={() => void dropInto('new', selectedItem.ref)}>
            <IconPlus />
            新的堆
          </button>
        </div>
      )}

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

      {notice ? (
        <p className={`tool-hint${notice.error ? ' is-error' : ''}`} role={notice.error ? 'alert' : 'status'}>
          {notice.text}
        </p>
      ) : (
        isEditing &&
        tool !== 'move' && (
          <p className="tool-hint" role="status">
            {tool === 'connect' ? '从一张卡片拖到另一张' : '用笔或手指画；两指移动和缩放'}
          </p>
        )
      )}

      {popover && popPaper && <CitePopover paper={popPaper} x={popover.x} y={popover.y} onClose={() => setPopover(null)} />}
      {rawOf && <RawDialog importId={rawOf} onClose={() => setRawOf(null)} />}
    </div>
  )
}

function PileHead({ pile, count, editing }: { pile: Pile; count: string; editing: boolean }) {
  const [name, setName] = useState<string | null>(null)

  const save = () => {
    if (name !== null) void renamePile(pile, name)
    setName(null)
  }

  return (
    <>
      <a className="crumb-link" href="#/board" aria-label="回到画板">
        <IconBack />
      </a>
      {name === null ? (
        <h1 className="pile-title">
          <button type="button" onClick={() => setName(pile.name)} aria-label={`改名：${pile.name}`}>
            {pile.name}
          </button>
        </h1>
      ) : (
        <label className="pile-title-edit">
          <span className="sr-only">堆的名字</span>
          <input
            value={name}
            autoFocus
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setName(null)
            }}
          />
        </label>
      )}
      <span className="board-state">{count}</span>
      {editing && (
        <div className="pile-tools">
          <AddToPile target={{ type: 'pile', id: pile.id }} label="把这个堆放进…" />
          <button
            type="button"
            className="btn btn-small btn-quiet edit-delete"
            onClick={() => {
              if (window.confirm(`删除堆「${pile.name}」？里面的卡片和论文不会受影响，只是不再放在这个堆里。`)) {
                void deletePile(pile).then(() => {
                  window.location.hash = '#/board'
                })
              }
            }}
          >
            删除这个堆
          </button>
        </div>
      )}
    </>
  )
}
