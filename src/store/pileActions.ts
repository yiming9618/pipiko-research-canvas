import { checkAdd, nextSlot, pileBoardId, type AddResult } from '../domain/piles'
import type { BoardRefType, Pile } from '../domain/types'
import { applyChanges, db, newId, nowIso } from './db'

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

/** Puts a reference to something into a pile. The original is not copied or changed. */
export async function addToPile(pileId: string, ref: { type: BoardRefType; id: string }): Promise<AddResult> {
  const items = await db.boardItems.toArray()
  const result = checkAdd(pileId, ref, items)
  if (result !== 'added') return result
  const at = nextSlot(pileId, items)
  const w = ref.type === 'pile' ? 200 : 340
  await applyChanges({
    boardItems: [
      {
        id: newId('bi'),
        board_id: pileBoardId(pileId),
        ref_type: ref.type,
        ref_id: ref.id,
        x: at.x,
        y: at.y,
        w,
        h: 0,
        z: 0,
        updated_at: nowIso(),
      },
    ],
  })
  return result
}

/**
 * Deletes a pile: its arrangement goes, and other piles stop pointing at it.
 * Cards, papers and piles that were inside are untouched.
 */
export async function deletePile(pile: Pile): Promise<void> {
  const now = nowIso()
  const board = pileBoardId(pile.id)
  const tomb = <T extends { deleted?: boolean; updated_at: string }>(e: T): T => ({ ...e, deleted: true, updated_at: now })
  const [items, connectors, strokes] = await Promise.all([
    db.boardItems.filter((i) => !i.deleted && (i.board_id === board || (i.ref_type === 'pile' && i.ref_id === pile.id))).toArray(),
    db.connectors.where('board_id').equals(board).filter((c) => !c.deleted).toArray(),
    db.strokes.where('board_id').equals(board).filter((s) => !s.deleted).toArray(),
  ])
  await applyChanges({
    piles: [tomb(pile)],
    boardItems: items.map(tomb),
    connectors: connectors.map(tomb),
    strokes: strokes.map(tomb),
  })
}

export const ADD_MESSAGE: Record<AddResult, (pile: string) => string> = {
  added: (pile) => `已放进「${pile}」`,
  duplicate: (pile) => `「${pile}」里已经有它了`,
  cycle: (pile) => `不能放进「${pile}」：它已经在这个堆的里面，会绕成一圈`,
}

/** What gets carried when a paper or pile is dragged with the mouse or a long press. */
export const DRAG_TYPE = 'application/x-notebook-ref'

export function readDrag(e: { dataTransfer: DataTransfer | null }): { type: BoardRefType; id: string } | null {
  const raw = e.dataTransfer?.getData(DRAG_TYPE)
  if (!raw) return null
  try {
    const ref = JSON.parse(raw) as { type: BoardRefType; id: string }
    return typeof ref.id === 'string' && typeof ref.type === 'string' ? ref : null
  } catch {
    return null
  }
}
