import { notYetIn, type BoxRef } from '../domain/discussions'
import type { Discussion, DiscussionItem } from '../domain/types'
import { applyChanges, db, newId, nowIso } from './db'

export async function createDiscussion(name: string): Promise<Discussion> {
  const now = nowIso()
  const box: Discussion = { id: newId('disc'), name: name.trim() || '新的讨论', created_at: now, updated_at: now }
  await applyChanges({ discussions: [box] })
  return box
}

export async function renameDiscussion(box: Discussion, name: string): Promise<void> {
  const next = name.trim()
  if (!next || next === box.name) return
  await applyChanges({ discussions: [{ ...box, name: next, updated_at: nowIso() }] })
}

/** Returns how many were added (things already in the box are skipped). */
export async function addToDiscussion(boxId: string, refs: BoxRef[]): Promise<{ added: number; already: number }> {
  const existing = await db.discussionItems.where('discussion_id').equals(boxId).toArray()
  const fresh = notYetIn(boxId, refs, existing)
  const now = Date.now()
  const rows: DiscussionItem[] = fresh.map((r, i) => {
    // one millisecond apart so the order of a multi-selection is kept
    const at = new Date(now + i).toISOString()
    return { id: newId('di'), discussion_id: boxId, ref_type: r.type, ref_id: r.id, added_at: at, updated_at: at }
  })
  await applyChanges({ discussionItems: rows })
  return { added: rows.length, already: refs.length - rows.length }
}

export async function removeFromDiscussion(item: DiscussionItem): Promise<void> {
  await applyChanges({ discussionItems: [{ ...item, deleted: true, updated_at: nowIso() }] })
}

export async function archiveDiscussion(box: Discussion, archived: boolean): Promise<void> {
  const next: Discussion = { ...box, updated_at: nowIso() }
  if (archived) next.archived_at = nowIso()
  else delete next.archived_at
  await applyChanges({ discussions: [next] })
}

/** Deletes the box and its list. The things that were in it are untouched. */
export async function deleteDiscussion(box: Discussion): Promise<void> {
  const now = nowIso()
  const items = await db.discussionItems.where('discussion_id').equals(box.id).toArray()
  await applyChanges({
    discussions: [{ ...box, deleted: true, updated_at: now }],
    discussionItems: items.filter((i) => !i.deleted).map((i) => ({ ...i, deleted: true, updated_at: now })),
  })
}
