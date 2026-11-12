// Boards and the piles (folders) that hold them. Pure helpers.

import { homeBoardId, recordBoardId } from './migrate'
import type { Board, BoardItem, BoardUse, Card, Connector, Pile, ResearchRecord, Stroke } from './types'

export type BoardSort = 'created' | 'used'

const live = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)

/** When each board was last opened or edited; a board never used counts from its creation. */
export function lastUsed(board: Board, use: BoardUse[]): string {
  const row = use.find((u) => u.id === board.id && !u.deleted)
  return row && row.last_used_at > board.created_at ? row.last_used_at : board.created_at
}

/** Newest first, either by creation or by last use. */
export function sortBoards(boards: Board[], use: BoardUse[], by: BoardSort): Board[] {
  const key = (b: Board) => (by === 'used' ? lastUsed(b, use) : b.created_at)
  return [...live(boards)].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : a.id < b.id ? -1 : 1))
}

/** The board new things go onto by default. */
export function mostRecentBoard(boards: Board[], use: BoardUse[]): Board | undefined {
  return sortBoards(boards, use, 'used')[0]
}

/** Boards outside any pile (a board whose pile was deleted is back outside). */
export function looseBoards(boards: Board[], piles: Pile[]): Board[] {
  const alive = new Set(live(piles).map((p) => p.id))
  return live(boards).filter((b) => !b.pile_id || !alive.has(b.pile_id))
}

export function boardsInPile(pileId: string, boards: Board[]): Board[] {
  return live(boards).filter((b) => b.pile_id === pileId)
}

export interface BoardContents {
  records: ResearchRecord[]
  cards: Card[]
  boardItems: BoardItem[]
  connectors: Connector[]
  strokes: Stroke[]
}

/** Everything that lives on a board (and goes with it when it is deleted). */
export function contentsOf(boardId: string, all: BoardContents): BoardContents {
  return {
    records: live(all.records).filter((r) => recordBoardId(r) === boardId),
    cards: live(all.cards).filter((c) => homeBoardId(c) === boardId),
    boardItems: live(all.boardItems).filter((i) => i.board_id === boardId),
    connectors: live(all.connectors).filter((c) => c.board_id === boardId),
    strokes: live(all.strokes).filter((s) => s.board_id === boardId),
  }
}

/** The address of a board, optionally bringing one of its cards into view. */
export function boardHref(boardId: string, cardId?: string): string {
  return `#/board/${encodeURIComponent(boardId)}${cardId ? `?card=${encodeURIComponent(cardId)}` : ''}`
}
