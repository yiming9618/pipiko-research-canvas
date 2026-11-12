// One surface for both kinds of board:
//  - a day: the imported cards in their template layout, plus what was arranged
//  - a pile: references to cards, papers and other piles, freely arranged

import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
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
  deleteManualCard,
  patchConnector,
  patchItem,
  removeItem,
  removeStroke,
  saveManualCard,
} from '../../store/boardActions'
import { boardCounts, deleteBoard, renameBoard, touchBoard } from '../../store/boardStore'
import { db, localChangeListeners, todayLocal } from '../../store/db'
import { DRAG_TYPE, readDrag } from '../../ui/drag'
import { IconBack, IconCheck, IconHand, IconImage, IconLink, IconPen, IconPlus, IconText } from '../../ui/icons'
import { fileToImage } from '../../ui/image'
import { Markdown } from '../../ui/Markdown'
import { AddToDiscussion } from '../discussions/AddToDiscussion'
import { KIND_COLOR } from '../../domain/colors'
import { Canvas, DEFAULT_INK_SIZE, type CanvasApi, type CanvasNode, type Selection, type Tool } from './Canvas'
import { CardDialog } from './CardDialog'
import { CitePopover, Cover, RawDialog, TextBox, ToolButton, useNarrow } from './parts'

const INK = '#b4455c'

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
    () => db.strokes.where('board_id').equals(boardId).filter((s) => !s.deleted).toArray(),
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
  const [tool, setTool] = useState<Tool>('move')
  const [selection, setSelection] = useState<Selection>(null)
  const [typingKey, setTypingKey] = useState<string | null>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [popover, setPopover] = useState<{ paperId: string; x: number; y: number } | null>(null)
  const [rawOf, setRawOf] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [dropping, setDropping] = useState(false)
  /** Cards being chosen for a discussion box. null = not choosing. */
  const [picked, setPicked] = useState<string[] | null>(null)
  /** The card dialog: writing a new card, or changing a hand-written one. */
  const [cardDialog, setCardDialog] = useState<{ card?: Card } | null>(null)
  const downAt = useRef<{ x: number; y: number } | null>(null)
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const swallowClick = useRef(false)
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
  const isEditing = editing && canEdit && picked === null
  const canPick = canEdit

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
  /** Removes what was put on this board: text, pictures, lines, ink, and pointers to things from elsewhere. Imported cards of this board are not deleted here. */
  const deleteSelection = useCallback(() => {
    if (selectedLink) void patchConnector(selectedLink, { deleted: true })
    else if (selectedStroke) void removeStroke(selectedStroke)
    else if (selectedItem?.existing && selection && (selection.id.startsWith('item:') || !isHome(selection.id))) void removeItem(selectedItem.existing)
    else return
    setSelection(null)
  }, [selectedLink, selectedStroke, selectedItem, selection, isHome])

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
      const home = isHome(key)
      if ((home && key.startsWith('card:')) || selectedItem.ref.type === 'text') {
        buttons.push(quiet('改文字', () => setTypingKey(key)))
      }
      if (home && selectedItem.existing) {
        buttons.push(
          quiet('恢复原样', () => {
            void removeItem(selectedItem.existing!)
            setSelection(null)
          }),
        )
      }
      const manual = home && key.startsWith('card:') ? cardById.get(key.slice(5)) : undefined
      if (manual && isManualCard(manual)) {
        buttons.push(quiet('日期和类型', () => setCardDialog({ card: manual })))
        buttons.push(
          quiet(
            '删除',
            () => {
              if (window.confirm('删除这张卡片？它在堆和讨论框里也会一起消失。')) {
                void deleteManualCard(manual)
                setSelection(null)
              }
            },
            true,
          ),
        )
      }
      if (!home && !isOwn) buttons.push(quiet('移出这块画板', deleteSelection))
      if (isOwn) buttons.push(quiet('删除', deleteSelection, true))
    } else if (selectedLink) {
      buttons.push(quiet(selectedLink.arrow ? '去掉箭头' : '加上箭头', () => void patchConnector(selectedLink, { arrow: !selectedLink.arrow })))
      buttons.push(quiet('删除', deleteSelection, true))
    } else if (selectedStroke) {
      buttons.push(quiet('删除', deleteSelection, true))
    }
    if (buttons.length > 0) actions = buttons
  }

  // ── choosing cards for a discussion box: long press (touch), right click (mouse), or the "选卡片" button
  const cardKeyAt = (target: EventTarget | null) => {
    const key = (target as HTMLElement | null)?.closest<HTMLElement>('[data-node]')?.dataset.node ?? ''
    return key.startsWith('card:') ? key : ''
  }
  const togglePick = (key: string) =>
    setPicked((prev) => (prev === null ? [key] : prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer)
    press.current = null
  }
  const pickHandlers = canPick
    ? {
        onContextMenu: (e: MouseEvent) => {
          const key = cardKeyAt(e.target)
          if (!key || isEditing) return
          e.preventDefault()
          setPicked((prev) => (prev === null ? [key] : prev.includes(key) ? prev : [...prev, key]))
        },
        onPointerDownCapture: (e: ReactPointerEvent) => {
          cancelPress()
          const key = cardKeyAt(e.target)
          if (!key || e.pointerType === 'mouse' || isEditing || picked !== null) return
          press.current = {
            x: e.clientX,
            y: e.clientY,
            timer: setTimeout(() => {
              press.current = null
              swallowClick.current = true
              setPicked([key])
            }, 550),
          }
        },
        onPointerMoveCapture: (e: ReactPointerEvent) => {
          const p = press.current
          if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) cancelPress()
        },
        onPointerUpCapture: cancelPress,
        onPointerCancelCapture: cancelPress,
        onClickCapture: (e: MouseEvent) => {
          if (swallowClick.current) {
            // the tap that ends a long press must not immediately un-choose the card
            swallowClick.current = false
            e.preventDefault()
            e.stopPropagation()
            return
          }
          if (picked === null) return
          // The board captures the pointer for panning, so the click's own target is the board:
          // look at what is under the finger instead.
          if ((e.target as HTMLElement).closest('.pick-bar, .board-head, dialog')) return
          const key = cardKeyAt(document.elementFromPoint(e.clientX, e.clientY))
          if (!key) return
          e.preventDefault()
          e.stopPropagation()
          togglePick(key)
        },
      }
    : {}

  const saveCard = async (kind: Exclude<Card['kind'], '其他'>, text: string, date: string) => {
    const editingCard = cardDialog?.card
    setCardDialog(null)
    if (editingCard) {
      await saveManualCard(editingCard, { kind, text, date })
      return
    }
    // On a wide screen the new card lands in the middle of what is in view, on top.
    // On a phone it takes the next template spot, so an untouched day stays one column.
    const c = !narrow ? api.current?.center() : undefined
    await addManualCard(boardId, date, kind, text, c ? { x: c.x - CARD_W / 2, y: c.y - 60, w: CARD_W, z: topZ } : undefined)
  }

  const onClick = (e: MouseEvent) => {
    const cite = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.cite')
    if (!cite && narrow && picked === null) {
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

  const shownNodes = useMemo(
    () => (picked && picked.length > 0 ? nodes.map((n) => (picked.includes(n.key) ? { ...n, className: `${n.className ?? ''} is-picked` } : n)) : nodes),
    [nodes, picked],
  )

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
    </>
  ) : null

  const empty = loaded && nodes.length === 0 && (strokes?.length ?? 0) === 0

  return (
    <div
      className={`dayboard${dropping ? ' is-dropping' : ''}${picked !== null ? ' is-picking' : ''}`}
      onClick={onClick}
      onPointerDown={(e) => {
        downAt.current = { x: e.clientX, y: e.clientY }
      }}
      {...pickHandlers}
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
        nodes={loaded ? shownNodes : []}
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
          window.location.hash = back
        }}
      />

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
            <ToolButton label="卡片" onClick={() => setCardDialog({})} icon={<IconPlus />} />
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
          loaded &&
          picked === null && (
            <div className="edit-toggle view-tools">
              <button type="button" className="btn" onClick={() => setCardDialog({})}>
                <IconPlus />
                加卡片
              </button>
              {canPick && (cards?.length ?? 0) > 0 && (
                <button type="button" className="btn" onClick={() => setPicked([])}>
                  选卡片
                </button>
              )}
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                <IconPen />
                编排
              </button>
            </div>
          )
        ))}

      {!canEdit && loaded && (
        <button type="button" className="btn edit-toggle" onClick={() => setCardDialog({})}>
          <IconPlus />
          加卡片
        </button>
      )}

      {cardDialog && (
        <CardDialog
          card={cardDialog.card}
          defaultDate={todayLocal()}
          onSave={(kind, text, date) => void saveCard(kind, text, date)}
          onDelete={
            cardDialog.card
              ? () => {
                  void deleteManualCard(cardDialog.card!)
                  setCardDialog(null)
                }
              : undefined
          }
          onClose={() => setCardDialog(null)}
        />
      )}

      {picked !== null && (
        <div className="pick-bar" role="group" aria-label="选卡片放进讨论框">
          <span role="status">{picked.length === 0 ? '点卡片来选' : `已选 ${picked.length} 张`}</span>
          {picked.length > 0 && (
            <AddToDiscussion
              className="btn btn-primary btn-small"
              refs={() => picked.map((k) => ({ type: 'card' as const, id: k.slice(5) }))}
              onDone={() => setPicked(null)}
            />
          )}
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setPicked(null)}>
            取消
          </button>
        </div>
      )}

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
