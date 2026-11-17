// 在读 and "last worked on" for papers (see PaperUse in domain/types.ts).
//
// A real edit of a paper's content puts it 在读 and records the time. What counts:
// 基础, 一句话总结, adding or editing a highlight, adding or editing a note (drawings too),
// a new reading or a reading's title, and importing it. Deleting does not count, nor does
// looking, editing its details, changing its field, or putting it on a board or in a discussion box.

import type { PaperUse } from '../domain/types'
import { applyChanges, db, nowIso } from './db'

/** The row to write with a real edit of this paper: 在读 from now, worked on now. */
export async function workedRow(paperId: string, now = nowIso()): Promise<PaperUse> {
  const old = await db.paperUse.get(paperId)
  const row: PaperUse = { ...(old ?? {}), id: paperId, reading_since: now, worked_at: now, updated_at: now }
  delete row.deleted
  return row
}

/** The switch on the paper's page. Turning it on does not count as working on the paper. */
export async function setReadingNow(paperId: string, on: boolean): Promise<void> {
  const now = nowIso()
  const old = await db.paperUse.get(paperId)
  const next: PaperUse = { ...(old ?? {}), id: paperId, updated_at: now }
  delete next.deleted
  if (on) next.reading_since = now
  else delete next.reading_since
  await applyChanges({ paperUse: [next] })
}
