// The trash: papers and boards are moved there and back, never copied and never destroyed.
// A paper or a board in the trash carries `trashed_at`; nothing else changes, so whatever
// hangs off it (a board's cards and layout, a paper's highlights and notes) goes and comes
// back with it. The library and the boards show only what is not in the trash.

import type { NotebookData } from './exportMarkdown'
import { homeBoardId, recordBoardId } from './migrate'
import { normalizeTitle } from './importer'
import type { Board, Paper } from './types'

type Entry = { deleted?: boolean; trashed_at?: string }

/** In use: neither deleted nor in the trash. */
export const inUse = <T extends Entry>(rows: T[]): T[] => rows.filter((r) => !r.deleted && !r.trashed_at)

/** In the trash (and not deleted). */
export const inTrash = <T extends Entry>(rows: T[]): T[] => rows.filter((r) => !r.deleted && !!r.trashed_at)

/** Ids of boards in the trash: their contents are out of sight with them. */
export function trashedBoardIds(boards: Board[]): Set<string> {
  return new Set(inTrash(boards).map((b) => b.id))
}

/**
 * Another paper in the library is the same paper (same DOI, or, with no DOI, the same title).
 * A restored copy is marked 【恢复】 then, so the two can be told apart. They are never merged.
 */
export function hasTwin(paper: Paper, papers: Paper[]): boolean {
  const title = normalizeTitle(paper.title)
  return inUse(papers).some(
    (p) => p.id !== paper.id && (paper.doi ? p.doi === paper.doi : !p.doi && !!title && normalizeTitle(p.title) === title),
  )
}

export const showRestoredMark = (paper: Paper, papers: Paper[]) => !!paper.restored_at && hasTwin(paper, papers)

/**
 * The notebook as the normal side sees it: what is in the trash (and what hangs off it)
 * is left out. Used for exports, discussion boxes and the time view.
 */
export function withoutTrash(data: NotebookData): NotebookData {
  const gone = trashedBoardIds(data.boards)
  const goneP = new Set(inTrash(data.papers).map((p) => p.id))
  const goneCards = new Set(data.cards.filter((c) => gone.has(homeBoardId(c))).map((c) => c.id))
  const goneRecords = new Set(data.records.filter((r) => gone.has(recordBoardId(r))).map((r) => r.id))
  return {
    ...data,
    boards: data.boards.filter((b) => !gone.has(b.id)),
    papers: data.papers.filter((p) => !goneP.has(p.id)),
    blocks: data.blocks.filter((b) => !goneP.has(b.paper_id)),
    records: data.records.filter((r) => !goneRecords.has(r.id)),
    cards: data.cards.filter((c) => !goneCards.has(c.id)),
    boardItems: data.boardItems.filter(
      (i) =>
        !gone.has(i.board_id) &&
        !(i.ref_type === 'paper' && goneP.has(i.ref_id)) &&
        !(i.ref_type === 'card' && goneCards.has(i.ref_id)) &&
        !(i.ref_type === 'cover' && goneRecords.has(i.ref_id)),
    ),
    connectors: data.connectors.filter((c) => !gone.has(c.board_id)),
    strokes: data.strokes.filter((s) => !gone.has(s.board_id)),
  }
}
