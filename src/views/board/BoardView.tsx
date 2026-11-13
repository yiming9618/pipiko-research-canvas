// One surface for both kinds of board:
//  - a day: the imported cards in their template layout, plus what was arranged
//  - a pile: references to cards, papers and other piles, freely arranged

import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { boardHref } from '../../domain/boards'
import { candidatesFor, linkCitations } from '../../domain/citations'
import { shortDate } from '../../domain/importer'
import { CARD_W, boardLayout, cardKey, coverKey } from '../../domain/layout'
import { homeBoardId, recordBoardId } from '../../domain/migrate'
import { isManualCard, type Asset, type Board, type BoardItem, type BoardRefType, type Card, type ResearchRecord } from '../../domain/types'
import {
  addConnector,
  addImageItem,
  addManualCard,
  addRefToBoard,
  addStroke,
  addTextItem,
  deleteMany,
  deleteManualCard,
  moveMany,
  patchConnector,
  patchItem,
  removeItem,
  removeStrokes,
  saveManualCard,
} from '../../store/boardActions'
import { historyState, redoLast, startHistory, subscribeHistory, undoLast } from '../../store/history'
import { exportBoard } from '../../domain/exportMarkdown'
import { copyText } from '../../ui/clipboard'
import { CopyExport } from '../../ui/CopyExport'
import { useNotebook } from '../../store/notebook'
import { POINTER_DROP, type PointerDrop } from '../../ui/pointerDrag'
import { boardCounts, deleteBoard, renameBoard, touchBoard } from '../../store/boardStore'
import { db, localChangeListeners, todayLocal } from '../../store/db'
import { DRAG_TYPE, readDrag } from '../../ui/drag'
import { IconBack, IconCheck, IconEraser, IconImage, IconLink, IconMarker, IconPen, IconPlus, IconRedo, IconSelect, IconText, IconUndo } from '../../ui/icons'
import { fileToImage } from '../../ui/image'
import { Markdown } from '../../ui/Markdown'
import { AddToDiscussion } from '../discussions/AddToDiscussion'
import { KIND_COLOR } from '../../domain/colors'
import { Canvas, MARKER_OPACITY, MARKER_SIZE, NOTHING, PEN_SIZE, selectionSize, type CanvasApi, type CanvasNode, type Selection, type Tool } from './Canvas'
import { CardDialog } from './CardDialog'
import { CitePopover, Cover, RawDialog, TextBox, ToolButton, useNarrow } from './parts'

/** The four pens in the tray. Dark enough to read on the board's pale background. */
const PRESET_COLORS = [
  { value: '#d0443c', name: '红' },
  { value: '#e0a100', name: '黄' },
  { value: '#3b82c4', name: '蓝' },
  { value: '#3f9657', name: '绿' },
]

interface InkChoice {
  color: string
  /** Colours picked from the wheel lately, newest first. */
  recent: string[]
}

function loadInk(): InkChoice {
  try {
    const saved = JSON.parse(localStorage.getItem('board.ink') ?? 'null') as Partial<InkChoice> | null
    if (saved && typeof saved.color === 'string') return { color: saved.color, recent: Array.isArray(saved.recent) ? saved.recent.slice(0, 4) : [] }
  } catch {
    // start with the defaults
  }
  return { color: PRESET_COLORS[0].value, recent: [] }
}

function saveInk(next: InkChoice): InkChoice {
  try {
    localStorage.setItem('board.ink', JSON.stringify(next))
  } catch {
    // remembering the colour is a convenience only
  }
  return next
}

/** Called when a stroke has been drawn: a colour from the wheel joins the recent ones. */
function rememberColor(ink: InkChoice): InkChoice {
  if (PRESET_COLORS.some((p) => p.value === ink.color) || ink.recent[0] === ink.color) return ink
  return saveInk({ ...ink, recent: [ink.color, ...ink.recent.filter((c) => c !== ink.color)].slice(0, 4) })
}

const TOOL_HINT: Record<Tool, string> = {
  select: '点一下选中，拖动移动；在空白处圈一圈，选中圈里的；两指移动和缩放',
  connect: '从一张卡片拖到另一张',
  pen: '用笔或手指画；两指移动和缩放',
  marker: '粗的半透明笔，适合划重点',
  eraser: '划过哪一笔，整笔擦掉',
}

/** Rough height before a card has been measured, so the first paint is close. */
function estimate(text: string): number {
  return 70 + Math.ceil(text.length / 20) * 26
}

interface Props {
  boardId: string
  /** A card to bring into view and highlight (coming from the time view or a search result). */
  focus?: string
}

/** One subject board: its own records and cards, plus pointers to papers and to cards from other boards. */
export function BoardView({ boardId, focus }: Props) {
  const narrow = useNarrow()
  const board = useLiveQuery(() => db.boards.get(boardId).then((b) => b ?? null), [boardId])
  const boards = useLiveQuery(() => db.boards.filter((b) => !b.deleted).toArray())

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
    // in the order they were drawn, so a later stroke lies on top of an earlier one
    async () =>
      (await db.strokes.where('board_id').equals(boardId).filter((s) => !s.deleted).toArray()).sort((a, b) =>
        a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : 1,
      ),
    [boardId],
  )
  const papers = useLiveQuery(() => db.papers.filter((p) => !p.deleted).toArray())
  const piles = useLiveQuery(() => db.piles.filter((p) => !p.deleted).sortBy('created_at'))
  const assets = useLiveQuery(async () => {
    const ids = (items ?? []).filter((i) => i.ref_type === 'image').map((i) => i.ref_id)
    const rows = await db.assets.bulkGet(ids)
    return new Map(rows.filter((a): a is Asset => !!a).map((a) => [a.id, a]))
  }, [items])

  // ── what lives on this board, and the originals of anything it points at ──
  const source = useLiveQuery(async () => {
    const [allRecords, allCards] = await Promise.all([
      db.records.filter((r) => !r.deleted).toArray(),
      db.cards.filter((c) => !c.deleted).toArray(),
    ])
    const records = allRecords.filter((r) => recordBoardId(r) === boardId)
    const cards = allCards.filter((c) => homeBoardId(c) === boardId)
    const refCards = new Set((items ?? []).filter((i) => i.ref_type === 'card').map((i) => i.ref_id))
    const refCovers = new Set((items ?? []).filter((i) => i.ref_type === 'cover').map((i) => i.ref_id))
    const guestCards = allCards.filter((c) => refCards.has(c.id) && homeBoardId(c) !== boardId)
    const guestRecordIds = new Set([...guestCards.map((c) => c.record_id), ...refCovers])
    const guestRecords = allRecords.filter((r) => guestRecordIds.has(r.id) && recordBoardId(r) !== boardId)
    return { records, cards, guestCards, guestRecords }
  }, [boardId, items])
  const records = source?.records
  const cards = source?.cards

  const importOrder = useLiveQuery(async () => new Map((await db.imports.toArray()).map((e) => [e.id, e.imported_at])))

  const [editing, setEditing] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [selection, setSelection] = useState<Selection>(NOTHING)
  const [ink, setInk] = useState(loadInk)
  const history = useSyncExternalStore(subscribeHistory, historyState)
  const [typingKey, setTypingKey] = useState<string | null>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [popover, setPopover] = useState<{ paperId: string; x: number; y: number } | null>(null)
  const [rawOf, setRawOf] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [dropping, setDropping] = useState(false)
  /** The card dialog: writing a new card, or changing a hand-written one. */
  const [cardDialog, setCardDialog] = useState<{ card?: Card; kind?: Exclude<Card['kind'], '其他'>; date?: string; round?: number } | null>(null)
  const downAt = useRef<{ x: number; y: number } | null>(null)
  /** How many cards have been written one after another with Enter (each lands a little lower). */
  const chain = useRef(0)
  /** A card that was just written and should be brought into view once it is drawn. */
  const [reveal, setReveal] = useState<string | null>(null)
  const api = useRef<CanvasApi>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const say = useCallback((text: string, error = false) => {
    setNotice({ text, error })
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 3200)
  }, [])

  const isEditing = editing

  const onMeasure = useCallback((key: string, h: number) => {
    setHeights((prev) => (prev[key] === h ? prev : { ...prev, [key]: h }))
  }, [])

  // looked up by id: this board's own, and the originals of what it points at
  const recordById = useMemo(() => new Map([...(records ?? []), ...(source?.guestRecords ?? [])].map((r) => [r.id, r])), [records, source])
  const cardById = useMemo(() => new Map([...(cards ?? []), ...(source?.guestCards ?? [])].map((c) => [c.id, c])), [cards, source])
  const isHome = useCallback(
    (key: string) => {
      if (key.startsWith('card:')) return (cards ?? []).some((c) => c.id === key.slice(5))
      if (key.startsWith('cover:')) return (records ?? []).some((r) => r.id === key.slice(6))
      return false
    },
    [cards, records],
  )

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

  /** Cards written by hand on this day: they belong to no record. */
  const manualCards = useMemo(
    () => (cards ?? []).filter(isManualCard).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1)),
    [cards],
  )

  /** Rows for things that are references (not images or free text), by "type:id". */
  const itemByRef = useMemo(() => {
    const map = new Map<string, BoardItem>()
    for (const i of items ?? []) if (i.ref_type !== 'image' && i.ref_type !== 'text') map.set(`${i.ref_type}:${i.ref_id}`, i)
    return map
  }, [items])

  const edited = (items?.length ?? 0) + (connectors?.length ?? 0) + (strokes?.length ?? 0) > 0
  // On a phone an untouched day reads best as one column; an arranged board keeps its arrangement.
  const columns = narrow && !edited ? 1 : 2

  const layout = useMemo(() => {
    const block = (r: ResearchRecord) => ({ id: r.id, cardIds: (cardsOf.get(r.id) ?? []).map((c) => c.id) })
    return boardLayout({
      // records from the time of daily boards keep their old stacked arrangement
      stacked: sortedRecords.filter((r) => !r.origin).map(block),
      loose: manualCards.map((c) => c.id),
      placed: sortedRecords.filter((r) => r.origin).map((r) => ({ ...block(r), origin: r.origin! })),
      heightOf: (key: string) => {
        if (heights[key]) return heights[key]
        if (key.startsWith('card:')) return estimate(cardById.get(key.slice(5))?.body_md ?? '')
        return 130
      },
      columns,
    })
  }, [sortedRecords, cardsOf, heights, cardById, columns, manualCards])

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
      if (card && isManualCard(card)) {
        // no imported original to preserve: the card itself changes
        if (text.trim() === '') await deleteManualCard(card)
        else if (text.trim() !== card.body_md.trim()) await saveManualCard(card, { text })
        return
      }
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

    const boardName = (id: string) => boards?.find((b) => b.id === id)?.name ?? '另一块画板'
    // `guest` = it lives on another board and is only shown here
    const cardNode = (card: Card, at: { x: number; y: number; w: number }, item: BoardItem | undefined, guest = false): CanvasNode => {
      const key = cardKey(card.id)
      const record = recordById.get(card.record_id)
      const candidates = candidatesFor(record?.paper_dois ?? [], papers ?? [])
      const text = (guest ? undefined : item?.text_override) ?? card.body_md
      return {
        ...base,
        key,
        x: at.x,
        y: at.y,
        w: at.w,
        z: item?.z ?? 0,
        className: `card${focus === card.id ? ' is-focus' : ''}`,
        color: KIND_COLOR[card.kind],
        content: (
          <>
            <p className="card-kind">
              {card.kind === '其他' ? card.heading : card.kind}
              {!guest && item?.text_override !== undefined && <span className="block-edited">改过</span>}
              <span className="card-date">{shortDate(card.date)}</span>
              {guest && (
                <a className="card-source" href={boardHref(homeBoardId(card), card.id)}>
                  来自「{boardName(homeBoardId(card))}」
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
    const coverNode = (record: ResearchRecord, at: { x: number; y: number; w: number }, item: BoardItem | undefined, guest = false): CanvasNode => ({
      ...base,
      key: coverKey(record.id),
      x: at.x,
      y: at.y,
      w: at.w,
      z: item?.z ?? 0,
      className: 'cover',
      content: (
        <>
          {guest && (
            <a className="card-source" href={boardHref(recordBoardId(record))}>
              来自「{boardName(recordBoardId(record))}」
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
      content: <p>原件已经不在了（可能撤销了那次导入，或删掉了它所在的画板）。</p>,
    })

    {
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
      for (const card of manualCards) {
        const item = itemByRef.get(cardKey(card.id))
        const at = item ?? layout.get(cardKey(card.id))
        if (at) out.push(cardNode(card, at, item))
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
      } else if (source) {
        // Pointers: each is drawn from its original, which lives somewhere else.
        if (item.ref_type === 'card') {
          const card = cardById.get(item.ref_id)
          if (card && homeBoardId(card) === boardId) continue // one of this board's own: drawn above, this row is its saved place
          out.push(card ? cardNode(card, item, item, true) : gone(item))
        } else if (item.ref_type === 'cover') {
          const record = recordById.get(item.ref_id)
          if (record && recordBoardId(record) === boardId) continue
          out.push(record ? coverNode(record, item, item, true) : gone(item))
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
                    // from before piles became folders: a pile that was placed inside this one. Now a way over to it.
                    <a className="pile-tile" href={`#/pile/${sub.id}`} data-color="pink">
                      <span className="pile-back" aria-hidden="true" />
                      <span className="pile-front">
                        <span className="pile-name">{sub.name}</span>
                        <span className="pile-count">打开这个堆</span>
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
  }, [sortedRecords, papers, itemByRef, layout, cardsOf, manualCards, items, assets, typingKey, saveText, recordById, cardById, piles, source, boards, boardId, focus])

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

  const onMoveMany = (moves: { key: string; x: number; y: number }[], strokeIds: string[], dx: number, dy: number) => {
    const moved = moves.map((m) => ({ m, r: resolve(m.key) })).filter((x) => x.r).map(({ m, r }) => ({ ref: r!.ref, existing: r!.existing, at: r!.at, x: m.x, y: m.y }))
    const ink = (strokes ?? []).filter((st) => strokeIds.includes(st.id))
    if (moved.length + ink.length > 0) void moveMany(boardId, moved, ink, dx, dy, topZ)
  }
  const onResize = (key: string, w: number) => {
    const r = resolve(key)
    if (r) void patchItem(boardId, r.ref, r.existing, r.at, { w, z: topZ })
  }

  const count = selectionSize(selection)
  const oneKey = selection.nodes.length === 1 && selection.strokes.length === 0 ? selection.nodes[0] : null
  const selectedItem = oneKey ? resolve(oneKey) : null
  const selectedLink = selection.link ? connectors?.find((c) => c.id === selection.link) : undefined

  /**
   * Deletes everything selected, in one change. What was put on this board goes: text, pictures, ink,
   * lines, hand-written cards, and pointers to papers or to cards from other boards. Cards and covers
   * that came from an import stay (that import is undone in the settings).
   */
  const deleteSelection = useCallback(() => {
    if (selectedLink) {
      void patchConnector(selectedLink, { deleted: true })
      setSelection(NOTHING)
      return
    }
    const doomed = { items: [] as BoardItem[], cards: [] as Card[], strokes: (strokes ?? []).filter((st) => selection.strokes.includes(st.id)), connectors: [] }
    let kept = 0
    for (const key of selection.nodes) {
      if (key.startsWith('item:')) {
        const row = items?.find((i) => i.id === key.slice(5))
        if (row) doomed.items.push(row)
      } else if (!isHome(key)) {
        const row = itemByRef.get(key)
        if (row) doomed.items.push(row)
      } else {
        const card = key.startsWith('card:') ? cardById.get(key.slice(5)) : undefined
        if (card && isManualCard(card)) doomed.cards.push(card)
        else kept++
      }
    }
    const n = doomed.items.length + doomed.cards.length + doomed.strokes.length
    if (n === 0) {
      if (kept > 0) say('导入的卡片不在这里删除：到“设置 → 最近导入”里撤销那次导入')
      return
    }
    if (doomed.cards.length > 0 && !window.confirm(`删除选中的 ${n} 样东西？其中 ${doomed.cards.length} 张是你写的卡片，它们在别的画板和讨论框里也会一起消失。`)) return
    void deleteMany(doomed)
    setSelection(NOTHING)
    if (kept > 0) say(`已删除 ${n} 样；另外 ${kept} 张是导入的卡片，留着没动`)
  }, [selectedLink, selection, strokes, items, itemByRef, cardById, isHome, say])

  // everything the export needs, read ahead of time: copying has to happen in the same tap on iPad and iPhone
  const notebook = useNotebook()

  const exportSelection = async () => {
    if (!notebook) return
    const only = new Set([...selection.nodes, ...selection.strokes.map((id) => `stroke:${id}`)])
    const ok = await copyText(exportBoard(boardId, notebook, only))
    say(ok ? `已复制选中的 ${count} 样（Markdown）` : '没能复制，请再试一次', !ok)
  }

  /** Cards and papers among what is selected: what a discussion box can hold. */
  const discussable = selection.nodes
    .map((key) => (key.startsWith('card:') ? { type: 'card' as const, id: key.slice(5) } : key.startsWith('paper:') ? { type: 'paper' as const, id: key.slice(6) } : null))
    .filter((r): r is { type: 'card' | 'paper'; id: string } => r !== null)

  const undo = useCallback(() => {
    setSelection(NOTHING)
    void undoLast().then((did) => did || say('没有可以撤回的了'))
  }, [say])
  const redo = useCallback(() => {
    setSelection(NOTHING)
    void redoLast()
  }, [])

  // what was done on this board can be undone while it stays open
  useEffect(() => startHistory(), [boardId])

  useEffect(() => {
    if (!isEditing) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection()
      if (e.key === 'Escape') setSelection(NOTHING)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isEditing, deleteSelection, undo, redo])

  const quiet = (label: string, onClick: () => void, danger = false) => (
    <button key={label} type="button" className={`btn btn-small btn-quiet${danger ? ' edit-delete' : ''}`} onClick={onClick}>
      {label}
    </button>
  )

  // The bar that floats by the selection. The same on every device: what applies to one thing first,
  // then what applies to any selection (discussion box, export, delete).
  let actions: ReactNode = null
  if (isEditing && tool === 'select' && !typingKey && count > 0) {
    const buttons: ReactNode[] = []
    if (selectedLink) {
      buttons.push(quiet(selectedLink.arrow ? '去掉箭头' : '加上箭头', () => void patchConnector(selectedLink, { arrow: !selectedLink.arrow })))
      buttons.push(quiet('删除', deleteSelection, true))
    } else {
      if (oneKey && selectedItem) {
        const home = isHome(oneKey)
        if ((home && oneKey.startsWith('card:')) || selectedItem.ref.type === 'text') buttons.push(quiet('改文字', () => setTypingKey(oneKey)))
        if (home && selectedItem.existing) {
          buttons.push(
            quiet('恢复原样', () => {
              void removeItem(selectedItem.existing!)
              setSelection(NOTHING)
            }),
          )
        }
        const manual = home && oneKey.startsWith('card:') ? cardById.get(oneKey.slice(5)) : undefined
        if (manual && isManualCard(manual)) buttons.push(quiet('日期和类型', () => setCardDialog({ card: manual })))
      } else {
        buttons.push(
          <span key="n" className="sel-count" role="status">
            已选 {count} 样
          </span>,
        )
      }
      if (discussable.length > 0) {
        buttons.push(<AddToDiscussion key="disc" className="btn btn-small btn-quiet" label="放进讨论框" refs={discussable} />)
      }
      buttons.push(quiet('导出', () => void exportSelection()))
      buttons.push(quiet(oneKey && !oneKey.startsWith('item:') && !isHome(oneKey) ? '移出这块画板' : '删除', deleteSelection, true))
    }
    actions = buttons
  }

  /** Right click, or a finger held still: start arranging with that thing selected. */
  const onGrab = (target: { node?: string; stroke?: string }) => {
    setEditing(true)
    setTool('select')
    setTypingKey(null)
    setSelection((prev) => {
      const already = target.node ? prev.nodes.includes(target.node) : prev.strokes.includes(target.stroke!)
      return already ? prev : { nodes: target.node ? [target.node] : [], strokes: target.stroke ? [target.stroke] : [], link: null }
    })
  }

  const cardKeyAt = (target: EventTarget | null) => {
    const key = (target as HTMLElement | null)?.closest<HTMLElement>('[data-node]')?.dataset.node ?? ''
    return key.startsWith('card:') ? key : ''
  }

  /** `another`: Enter was pressed, so the dialog stays for the next card of the same kind. */
  const saveCard = async (kind: Exclude<Card['kind'], '其他'>, text: string, date: string, another: boolean) => {
    const editingCard = cardDialog?.card
    if (editingCard) {
      setCardDialog(null)
      await saveManualCard(editingCard, { kind, text, date })
      return
    }
    // On a wide screen the new card lands in the middle of what is in view, on top; cards written
    // one after another step down so they do not cover each other.
    // On a phone it takes the next template spot, so an untouched board stays one column.
    const c = !narrow ? api.current?.center() : undefined
    const step = chain.current * 44
    // The next blank card is up before this one is saved, so nothing typed straight after Enter is lost.
    if (another) {
      chain.current += 1
      setCardDialog({ kind, date, round: chain.current })
    } else {
      chain.current = 0
      setCardDialog(null)
    }
    const id = await addManualCard(boardId, date, kind, text, c ? { x: c.x - CARD_W / 2 + step, y: c.y - 60 + step, w: CARD_W, z: topZ + step } : undefined)
    // on a phone the card went to its template spot, which may be out of view: bring it in
    if (!c) setReveal(id)
  }

  const onClick = (e: MouseEvent) => {
    const cite = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.cite')
    if (!cite && narrow && !isEditing) {
      // Phone: the board is not arranged here, but a hand-written card can still be opened to change it.
      const d = downAt.current
      const still = !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8
      const key = still ? cardKeyAt(document.elementFromPoint(e.clientX, e.clientY)) : ''
      const card = key ? cardById.get(key.slice(5)) : undefined
      if (card && isManualCard(card)) setCardDialog({ card })
      return
    }
    if (!cite) return
    e.preventDefault()
    if (isEditing) return
    setPopover({ paperId: cite.dataset.paper ?? '', x: e.clientX, y: e.clientY })
  }

  const pick = (next: Tool) => {
    setTool(next)
    setSelection(NOTHING)
  }
  const openNewCard = () => {
    chain.current = 0
    setCardDialog({})
  }

  const addText = async () => {
    const c = api.current?.center() ?? { x: 0, y: 0 }
    const id = await addTextItem(boardId, { x: c.x - 130, y: c.y - 20 }, topZ)
    setTool('select')
    setSelection({ nodes: [`item:${id}`], strokes: [], link: null })
    setTypingKey(`item:${id}`)
  }

  const addImage = async (file: File | undefined) => {
    if (!file) return
    try {
      const c = api.current?.center() ?? { x: 0, y: 0 }
      await addImageItem(boardId, { x: c.x, y: c.y - 80 }, await fileToImage(file), topZ)
      setTool('select')
    } catch (err) {
      say(err instanceof Error ? err.message : '图片没有加上，请再试一次', true)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // A paper dragged in from the library list (or a card from a search result) is shown here as a pointer.
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    setDropping(true)
  }
  const onDrop = async (e: DragEvent) => {
    setDropping(false)
    const ref = readDrag(e)
    if (!ref || (ref.type !== 'paper' && ref.type !== 'card' && ref.type !== 'cover')) return
    e.preventDefault()
    if (isHome(`${ref.type}:${ref.id}`)) return say('它本来就在这块画板上')
    const at = api.current?.toBoard(e.clientX, e.clientY) ?? { x: 0, y: 0 }
    const result = await addRefToBoard(boardId, { type: ref.type, id: ref.id }, { x: at.x - CARD_W / 2, y: at.y - 30 }, topZ)
    say(result === 'added' ? '已放到画板上' : '这块画板上已经有它了')
  }

  // A paper dragged out of the library list with a finger, a pencil or the mouse (see ui/pointerDrag).
  useEffect(() => {
    const onDropped = (e: Event) => {
      const { ref, clientX, clientY } = (e as CustomEvent<PointerDrop>).detail
      const box = stage.current?.querySelector('.canvas')?.getBoundingClientRect()
      if (!box || clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) return
      const at = api.current?.toBoard(clientX, clientY) ?? { x: 0, y: 0 }
      void addRefToBoard(boardId, ref, { x: at.x - CARD_W / 2, y: at.y - 30 }, topZ).then((result) =>
        say(result === 'added' ? '已放到画板上' : '这块画板上已经有它了'),
      )
    }
    document.addEventListener(POINTER_DROP, onDropped)
    return () => document.removeEventListener(POINTER_DROP, onDropped)
  }, [boardId, topZ, say])

  const popPaper = popover ? papers?.find((p) => p.id === popover.paperId) : undefined
  const loaded = source !== undefined && items !== undefined && board !== undefined

  // opening a board counts as using it; so does any edit made while it is open
  useEffect(() => {
    if (!board || board.deleted) return
    void touchBoard(boardId)
    const onChange = () => void touchBoard(boardId)
    localChangeListeners.add(onChange)
    return () => {
      localChangeListeners.delete(onChange)
    }
  }, [boardId, board])

  // coming from the time view or a search result: bring that card to the middle
  const focused = useRef('')
  useEffect(() => {
    if (!focus || !loaded || focused.current === focus) return
    const node = nodes.find((n) => n.key === `card:${focus}`)
    if (!node) return
    focused.current = focus
    const h = heights[node.key] ?? 160
    // after the board's own first fit
    const t = setTimeout(() => api.current?.focusOn(node.x, node.y, node.w, h), 60)
    return () => clearTimeout(t)
  }, [focus, loaded, nodes, heights])

  useEffect(() => {
    if (!reveal) return
    const node = nodes.find((n) => n.key === `card:${reveal}`)
    if (!node) return
    setReveal(null)
    api.current?.focusOn(node.x, node.y, node.w, heights[node.key] ?? 120)
  }, [reveal, nodes, heights])

  const back = board?.pile_id && piles?.some((p) => p.id === board.pile_id) ? `#/pile/${board.pile_id}` : '#/boards'

  if (loaded && (!board || board.deleted)) {
    return (
      <div className="dayboard">
        <header className="board-head">
          <a className="crumb-link" href="#/boards">
            <IconBack />
            画板
          </a>
        </header>
        <p className="empty board-empty">找不到这块画板，可能已经删掉了。</p>
      </div>
    )
  }

  const hasContent = sortedRecords.length > 0 || manualCards.length > 0
  const head: ReactNode = board ? (
    <>
      <BoardHead board={board} back={back} editing={isEditing} />
      {loaded && hasContent && <span className="board-state">{(cards?.length ?? 0) + ' 张卡片'}</span>}
      {loaded && <AddToDiscussion refs={[{ type: 'board', id: boardId }]} iconOnly label="把这块画板放进讨论框" />}
      {loaded && (
        <CopyExport
          iconOnly
          label="导出这块画板（Markdown）"
          disabled={!notebook}
          text={() => (notebook ? exportBoard(boardId, notebook) : '')}
          done={`已复制画板「${board.name}」（Markdown）`}
          fileName={board.name}
        />
      )}
    </>
  ) : null

  const empty = loaded && nodes.length === 0 && (strokes?.length ?? 0) === 0

  return (
    <div
      className={`dayboard${dropping ? ' is-dropping' : ''}`}
      onClick={onClick}
      onPointerDown={(e) => {
        downAt.current = { x: e.clientX, y: e.clientY }
      }}
      ref={stage}
      onDragOver={onDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <header className="board-head">{head}</header>

      {empty && (
        <p className="empty board-empty">
          这块画板还是空白的。点“加卡片”写下第一张，或者在主页导入时选这块画板。
        </p>
      )}

      <Canvas
        // Wait until everything has loaded: the view is fitted once, to the first content it sees.
        nodes={loaded ? nodes : []}
        links={connectors ?? []}
        strokes={strokes ?? []}
        editing={isEditing}
        tool={tool}
        selection={isEditing ? selection : NOTHING}
        onSelect={(s) => {
          if (typingKey && !(s.nodes.length === 1 && s.nodes[0] === typingKey)) return
          setSelection(s)
        }}
        onMoveMany={onMoveMany}
        onResize={onResize}
        onLink={(from, to) => void addConnector(boardId, from, to)}
        onStroke={(points) => {
          void addStroke(boardId, points, ink.color, tool === 'marker' ? MARKER_SIZE : PEN_SIZE, tool === 'marker' ? 'marker' : 'pen')
          setInk((prev) => rememberColor(prev))
        }}
        onErase={(ids) => void removeStrokes((strokes ?? []).filter((st) => ids.includes(st.id)))}
        onGrab={onGrab}
        onTwoFingerTap={isEditing ? undo : undefined}
        onMeasure={onMeasure}
        actions={actions}
        fitKey={`${boardId}:${columns}`}
        topInset={72}
        ink={{ color: ink.color, size: tool === 'marker' ? MARKER_SIZE : PEN_SIZE, opacity: tool === 'marker' ? MARKER_OPACITY : 1 }}
        apiRef={api}
        // no onZoomOut: pinching in a board only zooms the board, and stops at its smallest size
      />

      {isEditing && (tool === 'pen' || tool === 'marker') && (
        <div className="ink-colors" role="group" aria-label="颜色" data-nocanvas>
          {[...PRESET_COLORS, ...ink.recent.filter((c) => !PRESET_COLORS.some((p) => p.value === c)).map((c) => ({ value: c, name: `最近用过的颜色 ${c}` }))].map((c) => (
            <button
              key={c.value}
              type="button"
              className="ink-color"
              aria-label={c.name}
              aria-pressed={ink.color === c.value}
              style={{ ['--ink' as string]: c.value }}
              onClick={() => setInk((prev) => saveInk({ ...prev, color: c.value }))}
            />
          ))}
          <label className="ink-color ink-custom" style={{ ['--ink' as string]: ink.color }}>
            <span className="sr-only">自己选一个颜色</span>
            <input type="color" value={ink.color} onChange={(e) => setInk((prev) => saveInk({ ...prev, color: e.target.value }))} />
          </label>
        </div>
      )}

      {isEditing ? (
        <div className="toolbar" role="toolbar" aria-label="编排工具">
          <ToolButton label="选择" active={tool === 'select'} onClick={() => setTool('select')} icon={<IconSelect />} />
          <ToolButton label="连线" active={tool === 'connect'} onClick={() => pick('connect')} icon={<IconLink />} />
          <ToolButton label="画笔" active={tool === 'pen'} onClick={() => pick('pen')} icon={<IconPen />} />
          <ToolButton label="马克笔" active={tool === 'marker'} onClick={() => pick('marker')} icon={<IconMarker />} />
          <ToolButton label="橡皮" active={tool === 'eraser'} onClick={() => pick('eraser')} icon={<IconEraser />} />
          <span className="toolbar-gap" aria-hidden="true" />
          <ToolButton label="撤回" disabled={!history.canUndo} onClick={undo} icon={<IconUndo />} />
          <ToolButton label="重做" disabled={!history.canRedo} onClick={redo} icon={<IconRedo />} />
          <span className="toolbar-gap" aria-hidden="true" />
          <ToolButton label="卡片" onClick={() => openNewCard()} icon={<IconPlus />} />
          <ToolButton label="文字" onClick={() => void addText()} icon={<IconText />} />
          <ToolButton label="贴图" onClick={() => fileRef.current?.click()} icon={<IconImage />} />
          <span className="toolbar-gap" aria-hidden="true" />
          <ToolButton
            label="完成"
            onClick={() => {
              setEditing(false)
              setSelection(NOTHING)
              setTypingKey(null)
              setTool('select')
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
          <div className="edit-toggle view-tools">
            <button type="button" className="btn" onClick={() => openNewCard()}>
              <IconPlus />
              加卡片
            </button>
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <IconPen />
              {narrow ? '编辑' : '编排'}
            </button>
          </div>
        )
      )}

      {cardDialog && (
        <CardDialog
          key={cardDialog.round ?? 'one'}
          card={cardDialog.card}
          defaultKind={cardDialog.kind}
          defaultDate={cardDialog.date ?? todayLocal()}
          onSave={(kind, text, date, another) => void saveCard(kind, text, date, another)}
          onDelete={
            cardDialog.card
              ? () => {
                  void deleteManualCard(cardDialog.card!)
                  setCardDialog(null)
                }
              : undefined
          }
          onClose={() => {
            chain.current = 0
            setCardDialog(null)
          }}
        />
      )}

      {notice ? (
        <p className={`tool-hint${notice.error ? ' is-error' : ''}`} role={notice.error ? 'alert' : 'status'}>
          {notice.text}
        </p>
      ) : (
        isEditing &&
        (tool !== 'select' || count === 0) && (
          <p className="tool-hint" role="status">
            {TOOL_HINT[tool]}
          </p>
        )
      )}

      {popover && popPaper && <CitePopover paper={popPaper} x={popover.x} y={popover.y} onClose={() => setPopover(null)} />}
      {rawOf && <RawDialog importId={rawOf} onClose={() => setRawOf(null)} />}
    </div>
  )
}

function BoardHead({ board, back, editing }: { board: Board; back: string; editing: boolean }) {
  const [name, setName] = useState<string | null>(null)
  const save = () => {
    if (name !== null) void renameBoard(board, name)
    setName(null)
  }

  return (
    <>
      <a className="crumb-link" href={back} aria-label="回到画板列表">
        <IconBack />
      </a>
      {name === null ? (
        <h1 className="pile-title">
          <button type="button" onClick={() => setName(board.name)} aria-label={`改名：${board.name}`}>
            {board.name}
          </button>
        </h1>
      ) : (
        <label className="pile-title-edit">
          <span className="sr-only">画板的名字</span>
          <input
            value={name}
            autoFocus
            maxLength={40}
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
      {editing && (
        <div className="pile-tools">
          <button
            type="button"
            className="btn btn-small btn-quiet edit-delete"
            onClick={() => {
              void boardCounts(board.id).then(({ cards, other }) => {
                const what = [cards > 0 ? `${cards} 张卡片` : '', other > 0 ? `${other} 样别的东西（文字、贴图、笔迹、论文卡片）` : ''].filter(Boolean).join('和')
                if (window.confirm(`删除画板「${board.name}」？${what ? `上面的 ${what}会一起删除。` : '它是空的。'}论文库里的论文不受影响。`)) {
                  void deleteBoard(board).then(() => {
                    window.location.hash = '#/boards'
                  })
                }
              })
            }}
          >
            删除这块画板
          </button>
        </div>
      )}
    </>
  )
}
