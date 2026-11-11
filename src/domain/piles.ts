// Piles hold references, never copies. A pile's contents are the board items
// of its board (`pile:<id>`). Piles may contain piles, but not in a circle.

import type { BoardItem, BoardRefType } from './types'

export const pileBoardId = (pileId: string) => `pile:${pileId}`

/** Things a pile can point at. Images and free text are board decoration, not references. */
export const REF_TYPES: readonly BoardRefType[] = ['card', 'cover', 'paper', 'pile']

function live(items: BoardItem[]): BoardItem[] {
  return items.filter((i) => !i.deleted)
}

/** Ids of the piles directly inside this pile. */
export function childPiles(pileId: string, items: BoardItem[]): string[] {
  return live(items)
    .filter((i) => i.board_id === pileBoardId(pileId) && i.ref_type === 'pile')
    .map((i) => i.ref_id)
}

/** Every pile reachable from this one, however deep. */
export function descendantPiles(pileId: string, items: BoardItem[]): Set<string> {
  const seen = new Set<string>()
  const queue = [pileId]
  while (queue.length > 0) {
    for (const child of childPiles(queue.pop()!, items)) {
      if (!seen.has(child)) {
        seen.add(child)
        queue.push(child)
      }
    }
  }
  return seen
}

/** Would putting `child` inside `parent` make a pile contain itself? */
export function wouldCycle(child: string, parent: string, items: BoardItem[]): boolean {
  return child === parent || descendantPiles(child, items).has(parent)
}

export type AddResult = 'added' | 'duplicate' | 'cycle'

export function checkAdd(
  pileId: string,
  ref: { type: BoardRefType; id: string },
  items: BoardItem[],
): AddResult {
  if (ref.type === 'pile' && wouldCycle(ref.id, pileId, items)) return 'cycle'
  const already = live(items).some(
    (i) => i.board_id === pileBoardId(pileId) && i.ref_type === ref.type && i.ref_id === ref.id,
  )
  return already ? 'duplicate' : 'added'
}

export function countContents(pileId: string, items: BoardItem[]): { things: number; piles: number } {
  const inside = live(items).filter((i) => i.board_id === pileBoardId(pileId))
  return {
    things: inside.filter((i) => i.ref_type === 'card' || i.ref_type === 'cover' || i.ref_type === 'paper').length,
    piles: inside.filter((i) => i.ref_type === 'pile').length,
  }
}

const COLS = 3
const SLOT_W = 368
const SLOT_H = 240

/** Where the next thing added to a pile lands: a simple grid, filled row by row. */
export function nextSlot(pileId: string, items: BoardItem[]): { x: number; y: number } {
  const n = live(items).filter((i) => i.board_id === pileBoardId(pileId) && REF_TYPES.includes(i.ref_type)).length
  return { x: (n % COLS) * SLOT_W, y: Math.floor(n / COLS) * SLOT_H }
}
