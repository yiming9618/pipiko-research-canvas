// Dragging a paper (or a search result) onto a board.

import type { BoardRefType } from '../domain/types'

export const DRAG_TYPE = 'application/x-notebook-ref'

export function readDrag(e: { dataTransfer: DataTransfer | null }): { type: BoardRefType; id: string } | null {
  const raw = e.dataTransfer?.getData(DRAG_TYPE)
  if (!raw) return null
  try {
    const ref = JSON.parse(raw) as { type?: string; id?: string }
    if (typeof ref.type === 'string' && typeof ref.id === 'string') return { type: ref.type as BoardRefType, id: ref.id }
  } catch {
    // not ours
  }
  return null
}
