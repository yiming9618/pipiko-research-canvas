// Discussion boxes: named lists of references, exported as Markdown for an AI
// conversation. Separate from piles on purpose: a pile is a board (things have
// positions, piles nest); a box is a flat list.

import type { Discussion, DiscussionItem, DiscussionRefType } from './types'

export interface BoxRef {
  type: DiscussionRefType
  id: string
}

export const live = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)

export function itemsOf(boxId: string, items: DiscussionItem[]): DiscussionItem[] {
  return live(items)
    .filter((i) => i.discussion_id === boxId)
    .sort((a, b) => (a.added_at < b.added_at ? -1 : a.added_at > b.added_at ? 1 : a.id < b.id ? -1 : 1))
}

/** Which of the refs are not in the box yet (a thing appears in a box once). */
export function notYetIn(boxId: string, refs: BoxRef[], items: DiscussionItem[]): BoxRef[] {
  const have = new Set(itemsOf(boxId, items).map((i) => `${i.ref_type}:${i.ref_id}`))
  const out: BoxRef[] = []
  for (const r of refs) {
    const key = `${r.type}:${r.id}`
    if (have.has(key)) continue
    have.add(key)
    out.push(r)
  }
  return out
}

export const activeBoxes = (boxes: Discussion[]) =>
  live(boxes)
    .filter((b) => !b.archived_at)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

export const archivedBoxes = (boxes: Discussion[]) =>
  live(boxes)
    .filter((b) => !!b.archived_at)
    .sort((a, b) => ((a.archived_at ?? '') < (b.archived_at ?? '') ? 1 : -1))
