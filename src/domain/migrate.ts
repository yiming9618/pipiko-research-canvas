// From daily boards to subject boards.
//
// The whole change is ADDITIVE. Nothing that exists is rewritten or removed:
//   - every former daily board gets a `Board` row whose id is the id its
//     contents already point at (`day:<date>`), so positions, lines, ink and
//     pictures follow without being touched;
//   - what was laid out inside a pile becomes a board (`pile:<pile id>`) in
//     that pile, which is now a folder;
//   - every paper category in use gets a `Field` row.
// Older cards, records and papers carry no pointer to their board or field;
// the rules below (`homeBoardId`, `fieldOfPaper`) derive it.
//
// Every row made here is fully determined by the data it comes from (same id,
// same timestamp on every device), so two devices migrating on their own
// produce identical rows and syncing merges them into one. The timestamp is a
// fixed moment in the past, so any real edit made since (a rename, say) wins.

import { hashText } from './importer'
import type { Board, BoardItem, Card, Changes, Connector, Field, Paper, Pile, ResearchRecord, Stroke } from './types'

/** Timestamp of every migration-made row. In the past on purpose: see above. */
export const MIGRATION_AT = '2026-11-13T00:00:00.000Z'

export const dayBoardId = (date: string) => `day:${date}`
export const pileBoardId = (pileId: string) => `pile:${pileId}`

/** The board a card is on. */
export function homeBoardId(card: Pick<Card, 'board_id' | 'home_date' | 'date'>): string {
  return card.board_id || dayBoardId(card.home_date ?? card.date)
}

/** The board a record (and its cover) is on. */
export function recordBoardId(record: Pick<ResearchRecord, 'board_id' | 'date'>): string {
  return record.board_id || dayBoardId(record.date)
}

/** "2026-11-10" → "2026/11/10": the name a former daily board starts with. */
export function dayBoardName(date: string): string {
  const [y, m, d] = date.split('-')
  return `${y}/${Number(m)}/${Number(d)}`
}

export function normalizeFieldName(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** The id of the field that an old `category` value maps to. */
export function legacyFieldId(category: string): string {
  return `field_${hashText(normalizeFieldName(category))}`
}

/** A paper's field, or null for "未分类". */
export function fieldOfPaper(paper: Pick<Paper, 'field_id' | 'category'>, fields: Field[]): Field | null {
  const id = paper.field_id !== undefined ? paper.field_id : paper.category.trim() ? legacyFieldId(paper.category) : ''
  if (!id) return null
  return fields.find((f) => f.id === id && !f.deleted) ?? null
}

export interface MigrationSnapshot {
  boards: Board[]
  fields: Field[]
  piles: Pile[]
  papers: Paper[]
  records: ResearchRecord[]
  cards: Card[]
  boardItems: BoardItem[]
  connectors: Connector[]
  strokes: Stroke[]
}

const live = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)

/**
 * The rows still missing. Returns only NEW rows for `boards` and `fields`;
 * running it again after applying them returns nothing.
 * A row that exists (even a deleted one) is never made again, so a board or
 * field the person deleted stays deleted.
 */
export function planMigration(snap: MigrationSnapshot): Changes {
  const haveBoard = new Set(snap.boards.map((b) => b.id))
  const haveField = new Set(snap.fields.map((f) => f.id))
  const boards = new Map<string, Board>()

  const onBoard = [...live(snap.boardItems), ...live(snap.connectors), ...live(snap.strokes)].map((r) => r.board_id)

  // ── former daily boards
  const dates = new Set<string>()
  for (const r of live(snap.records)) if (!r.board_id) dates.add(r.date)
  for (const c of live(snap.cards)) if (!c.board_id) dates.add(c.home_date ?? c.date)
  for (const id of onBoard) if (id.startsWith('day:')) dates.add(id.slice(4))
  for (const date of [...dates].sort()) {
    const id = dayBoardId(date)
    if (haveBoard.has(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    boards.set(id, { id, name: dayBoardName(date), created_at: `${date}T00:00:00.000Z`, updated_at: MIGRATION_AT })
  }

  // ── what was laid out inside each pile
  const used = new Set(onBoard.filter((id) => id.startsWith('pile:')))
  for (const pile of [...live(snap.piles)].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const id = pileBoardId(pile.id)
    if (haveBoard.has(id) || !used.has(id)) continue
    boards.set(id, { id, name: pile.name, created_at: pile.created_at, pile_id: pile.id, updated_at: MIGRATION_AT })
  }

  // ── fields, from the categories in use
  const fields = new Map<string, Field>()
  const spellings = [...new Set(live(snap.papers).filter((p) => p.field_id === undefined).map((p) => p.category.trim()))]
    .filter(Boolean)
    .sort() // so every device picks the same spelling when two differ only in case or spacing
  for (const name of spellings) {
    const id = legacyFieldId(name)
    if (haveField.has(id) || fields.has(id)) continue
    fields.set(id, { id, name, created_at: MIGRATION_AT, updated_at: MIGRATION_AT })
  }

  const changes: Changes = {}
  if (boards.size > 0) changes.boards = [...boards.values()]
  if (fields.size > 0) changes.fields = [...fields.values()]
  return changes
}

export interface BoardCheck {
  /** Live entries whose board does not exist (or was deleted). Should be all zero. */
  cards: number
  records: number
  boardItems: number
  connectors: number
  strokes: number
  total: number
}

/** After migrating: does everything have a board to be on? */
export function checkBoards(snap: MigrationSnapshot): BoardCheck {
  const ok = new Set(live(snap.boards).map((b) => b.id))
  const count = (ids: string[]) => ids.filter((id) => !ok.has(id)).length
  const out = {
    cards: count(live(snap.cards).map(homeBoardId)),
    records: count(live(snap.records).map(recordBoardId)),
    boardItems: count(live(snap.boardItems).map((r) => r.board_id)),
    connectors: count(live(snap.connectors).map((r) => r.board_id)),
    strokes: count(live(snap.strokes).map((r) => r.board_id)),
  }
  return { ...out, total: out.cards + out.records + out.boardItems + out.connectors + out.strokes }
}
