// The default "template" layout of a day's board. Positions are computed, not
// stored: only things the user moved get a saved position. Changing this file
// changes how every untouched board looks, without touching any data.

export const CARD_W = 340
export const GAP = 28
export const RECORD_GAP = 72

export interface LayoutRecord {
  id: string
  cardIds: string[]
}

export interface Placed {
  x: number
  y: number
  w: number
}

export const coverKey = (recordId: string) => `cover:${recordId}`
export const cardKey = (cardId: string) => `card:${cardId}`

/**
 * Records stack top to bottom. Each has its cover across the top and its cards
 * below in columns, every card going into the shorter column so far.
 */
export function defaultLayout(
  records: LayoutRecord[],
  heightOf: (key: string) => number,
  columns: 1 | 2 = 2,
  /** Cards written by hand: no record, so no cover. They go after the records, in the same columns. */
  loose: string[] = [],
): Map<string, Placed> {
  const out = new Map<string, Placed>()
  const fullWidth = CARD_W * columns + GAP * (columns - 1)
  let y = 0
  for (const record of records) {
    const cover = coverKey(record.id)
    out.set(cover, { x: 0, y, w: fullWidth })
    y += heightOf(cover) + GAP

    const colY = Array.from({ length: columns }, () => y)
    for (const id of record.cardIds) {
      const key = cardKey(id)
      let col = 0
      for (let i = 1; i < columns; i++) if (colY[i] < colY[col]) col = i
      out.set(key, { x: col * (CARD_W + GAP), y: colY[col], w: CARD_W })
      colY[col] += heightOf(key) + GAP
    }
    y = Math.max(...colY) - GAP + RECORD_GAP
  }
  const colY = Array.from({ length: columns }, () => y)
  for (const id of loose) {
    const key = cardKey(id)
    let col = 0
    for (let i = 1; i < columns; i++) if (colY[i] < colY[col]) col = i
    out.set(key, { x: col * (CARD_W + GAP), y: colY[col], w: CARD_W })
    colY[col] += heightOf(key) + GAP
  }
  return out
}
