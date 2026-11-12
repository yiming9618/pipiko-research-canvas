// Boards and piles (folders of boards).

import { contentsOf } from '../domain/boards'
import { nextOrigin } from '../domain/layout'
import { homeBoardId, recordBoardId } from '../domain/migrate'
import { isManualCard, type Board, type Pile } from '../domain/types'
import { applyChanges, db, newId, nowIso } from './db'

export async function createBoard(name: string, pileId?: string): Promise<Board> {
  const now = nowIso()
  const board: Board = { id: newId('board'), name: name.trim() || '未命名画板', created_at: now, updated_at: now, ...(pileId ? { pile_id: pileId } : {}) }
  await applyChanges({ boards: [board], boardUse: [{ id: board.id, last_used_at: now, updated_at: now }] })
  return board
}

export async function renameBoard(board: Board, name: string): Promise<void> {
  const next = name.trim()
  if (!next || next === board.name) return
  await applyChanges({ boards: [{ ...board, name: next, updated_at: nowIso() }] })
}

/** Into a pile, or (with no pile) back out. */
export async function moveBoardToPile(board: Board, pileId: string | undefined): Promise<void> {
  if ((board.pile_id ?? '') === (pileId ?? '')) return
  const next: Board = { ...board, updated_at: nowIso() }
  if (pileId) next.pile_id = pileId
  else delete next.pile_id
  await applyChanges({ boards: [next] })
}

const lastTouch = new Map<string, number>()
const TOUCH_EVERY = 10 * 60_000

/**
 * Notes that a board was opened or edited. Written at most every ten minutes
 * per board, so browsing does not turn into a stream of sync commits.
 */
export async function touchBoard(boardId: string, force = false): Promise<void> {
  const now = Date.now()
  if (!force && now - (lastTouch.get(boardId) ?? 0) < TOUCH_EVERY) return
  lastTouch.set(boardId, now)
  const iso = nowIso()
  await applyChanges({ boardUse: [{ id: boardId, last_used_at: iso, updated_at: iso }] })
}

export async function boardCounts(boardId: string): Promise<{ cards: number; other: number }> {
  const all = contentsOf(boardId, await loadAll())
  return { cards: all.cards.length, other: all.boardItems.filter((i) => i.ref_type === 'text' || i.ref_type === 'image' || i.ref_type === 'paper').length + all.strokes.length }
}

async function loadAll() {
  const [records, cards, boardItems, connectors, strokes] = await Promise.all([
    db.records.toArray(),
    db.cards.toArray(),
    db.boardItems.toArray(),
    db.connectors.toArray(),
    db.strokes.toArray(),
  ])
  return { records, cards, boardItems, connectors, strokes }
}

/** Deletes a board with everything that lives on it. Papers it showed are untouched. */
export async function deleteBoard(board: Board): Promise<void> {
  const now = nowIso()
  const tomb = <T extends { deleted?: boolean; updated_at: string }>(e: T): T => ({ ...e, deleted: true, updated_at: now })
  const c = contentsOf(board.id, await loadAll())
  await applyChanges({
    boards: [tomb(board)],
    records: c.records.map(tomb),
    cards: c.cards.map(tomb),
    boardItems: c.boardItems.map(tomb),
    connectors: c.connectors.map(tomb),
    strokes: c.strokes.map(tomb),
  })
}

export async function createPile(name: string): Promise<Pile> {
  const now = nowIso()
  const pile: Pile = { id: newId('pile'), name: name.trim() || '新的堆', created_at: now, updated_at: now }
  await applyChanges({ piles: [pile] })
  return pile
}

export async function renamePile(pile: Pile, name: string): Promise<void> {
  const next = name.trim()
  if (!next || next === pile.name) return
  await applyChanges({ piles: [{ ...pile, name: next, updated_at: nowIso() }] })
}

/** Deletes the pile only. The boards in it come back out; nothing on them changes. */
export async function deletePile(pile: Pile): Promise<void> {
  const now = nowIso()
  const inside = (await db.boards.toArray()).filter((b) => !b.deleted && b.pile_id === pile.id)
  await applyChanges({
    piles: [{ ...pile, deleted: true, updated_at: now }],
    boards: inside.map((b) => {
      const next: Board = { ...b, updated_at: now }
      delete next.pile_id
      return next
    }),
  })
}

/** Where the next import should be put down on a board: beside everything that is there. */
export async function placeOnBoard(): Promise<(boardId: string) => { x: number; y: number }> {
  const all = await loadAll()
  return (boardId) => {
    const c = contentsOf(boardId, all)
    const placed = new Set(c.boardItems.filter((i) => i.ref_type === 'card').map((i) => i.ref_id))
    let minX = Infinity
    let maxX = -Infinity
    for (const s of c.strokes) {
      for (let i = 0; i < s.points.length; i += 3) {
        minX = Math.min(minX, s.points[i])
        maxX = Math.max(maxX, s.points[i])
      }
    }
    return nextOrigin({
      hasStacked: c.records.some((r) => !r.origin) || c.cards.some((card) => isManualCard(card) && !placed.has(card.id)),
      origins: c.records.filter((r) => r.origin).map((r) => r.origin!),
      items: c.boardItems.map((i) => ({ x: i.x, w: i.w })),
      ink: Number.isFinite(maxX) ? { minX, maxX } : undefined,
    })
  }
}

export { homeBoardId, recordBoardId }
