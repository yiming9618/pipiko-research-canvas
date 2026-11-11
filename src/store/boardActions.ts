// Edits on a board. These never touch the imported cards themselves: positions,
// sizes, changed wording, connectors, images and ink all live in their own rows.

import { hashText } from '../domain/importer'
import type { BoardItem, BoardRefType, Card, CardKind, Connector, Stroke } from '../domain/types'
import { applyChanges, db, newId, nowIso } from './db'

export interface Placement {
  x: number
  y: number
  w: number
}

/**
 * Saves a change to something on a board. Cards and covers have no row until
 * they are first moved or edited; `current` is where the item is shown now.
 */
export async function patchItem(
  boardId: string,
  ref: { type: BoardRefType; id: string },
  existing: BoardItem | undefined,
  current: Placement,
  patch: Partial<Pick<BoardItem, 'x' | 'y' | 'w' | 'z' | 'text_override'>>,
): Promise<void> {
  const base: BoardItem = existing ?? {
    id: newId('bi'),
    board_id: boardId,
    ref_type: ref.type,
    ref_id: ref.id,
    x: current.x,
    y: current.y,
    w: current.w,
    h: 0,
    z: 0,
    updated_at: '',
  }
  await applyChanges({ boardItems: [{ ...base, ...patch, updated_at: nowIso() }] })
}

/** Removes the row: a card goes back to its template position and original wording; an image or text is deleted. */
export async function removeItem(item: BoardItem): Promise<void> {
  await applyChanges({ boardItems: [{ ...item, deleted: true, updated_at: nowIso() }] })
}

export async function addTextItem(boardId: string, at: { x: number; y: number }, z: number): Promise<string> {
  const id = newId('bi')
  await applyChanges({
    boardItems: [
      { id, board_id: boardId, ref_type: 'text', ref_id: '', x: at.x, y: at.y, w: 260, h: 0, z, text_override: '', updated_at: nowIso() },
    ],
  })
  return id
}

export async function addImageItem(
  boardId: string,
  at: { x: number; y: number },
  image: { mime: string; w: number; h: number; data: string },
  z: number,
): Promise<void> {
  const now = nowIso()
  const assetId = `asset_${hashText(image.data)}`
  const w = Math.max(160, Math.min(320, image.w))
  await applyChanges({
    assets: [{ id: assetId, ...image, updated_at: now }],
    boardItems: [
      { id: newId('bi'), board_id: boardId, ref_type: 'image', ref_id: assetId, x: at.x - w / 2, y: at.y, w, h: 0, z, updated_at: now },
    ],
  })
}

export async function addConnector(boardId: string, from: string, to: string): Promise<void> {
  await applyChanges({
    connectors: [{ id: newId('conn'), board_id: boardId, from, to, arrow: true, updated_at: nowIso() }],
  })
}

export async function patchConnector(conn: Connector, patch: Partial<Pick<Connector, 'arrow' | 'deleted'>>): Promise<void> {
  await applyChanges({ connectors: [{ ...conn, ...patch, updated_at: nowIso() }] })
}

export async function addStroke(boardId: string, points: number[], color: string, size: number): Promise<void> {
  // Two decimals are plenty for ink and keep the stored file small.
  const rounded = points.map((n) => Math.round(n * 100) / 100)
  await applyChanges({
    strokes: [{ id: newId('ink'), board_id: boardId, points: rounded, color, size, updated_at: nowIso() }],
  })
}

export async function removeStroke(stroke: Stroke): Promise<void> {
  await applyChanges({ strokes: [{ ...stroke, deleted: true, updated_at: nowIso() }] })
}

/**
 * A research card written by hand on a day's board. It is an ordinary card
 * (same table, same file in the data repo), just without a record or an import.
 * `at` places it on the board; without it the card takes the next template spot.
 */
export async function addManualCard(
  date: string,
  kind: Exclude<CardKind, '其他'>,
  text: string,
  at?: { x: number; y: number; w: number; z: number },
): Promise<string> {
  const now = nowIso()
  const id = newId('card')
  const card: Card = { id, record_id: '', date, kind, heading: kind, body_md: text.trim(), order: Date.now(), updated_at: now }
  await applyChanges({
    cards: [card],
    ...(at
      ? { boardItems: [{ id: newId('bi'), board_id: `day:${date}`, ref_type: 'card' as const, ref_id: id, x: at.x, y: at.y, w: at.w, h: 0, z: at.z, updated_at: now }] }
      : {}),
  })
  return id
}

/** Hand-written cards are edited in place: there is no imported original to keep. */
export async function saveManualCard(card: Card, patch: { text?: string; kind?: Exclude<CardKind, '其他'> }): Promise<void> {
  const next: Card = { ...card, updated_at: nowIso() }
  if (patch.text !== undefined) next.body_md = patch.text.trim()
  if (patch.kind) {
    next.kind = patch.kind
    next.heading = patch.kind
  }
  await applyChanges({ cards: [next] })
}

/** Deletes a hand-written card everywhere: its place on the day, in piles, and the lines drawn to it. */
export async function deleteManualCard(card: Card): Promise<void> {
  const now = nowIso()
  const items = (await db.boardItems.toArray()).filter((i) => !i.deleted && i.ref_type === 'card' && i.ref_id === card.id)
  const ends = new Set([`card:${card.id}`, ...items.flatMap((i) => [i.id, `item:${i.id}`])])
  const connectors = (await db.connectors.toArray()).filter((c) => !c.deleted && (ends.has(c.from) || ends.has(c.to)))
  await applyChanges({
    cards: [{ ...card, deleted: true, updated_at: now }],
    boardItems: items.map((i) => ({ ...i, deleted: true, updated_at: now })),
    connectors: connectors.map((c) => ({ ...c, deleted: true, updated_at: now })),
  })
}
