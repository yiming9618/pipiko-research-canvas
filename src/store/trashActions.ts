// Moving between the library / boards and the trash. One entry changes each time, so the
// move syncs as a single change and two devices cannot end up with two copies.

import type { Board, Paper } from '../domain/types'
import { applyChanges, db, nowIso } from './db'

export async function trashBoard(board: Board): Promise<void> {
  const now = nowIso()
  await applyChanges({ boards: [{ ...board, trashed_at: now, updated_at: now }] })
}

/** Back where it was, in the pile it was in (if that pile still exists), with everything on it. */
export async function restoreBoard(board: Board): Promise<void> {
  const next: Board = { ...board, updated_at: nowIso() }
  delete next.trashed_at
  await applyChanges({ boards: [next] })
}

export async function trashPaper(paper: Paper): Promise<void> {
  const now = nowIso()
  await applyChanges({ papers: [{ ...paper, trashed_at: now, updated_at: now }] })
}

export async function restorePaper(paper: Paper): Promise<void> {
  const now = nowIso()
  const next: Paper = { ...paper, restored_at: now, updated_at: now }
  delete next.trashed_at
  await applyChanges({ papers: [next] })
}

/** Ids of what is in the trash, for views that read cards and imports directly. */
export async function loadTrashed(): Promise<{ boards: Set<string>; papers: Set<string> }> {
  const [boards, papers] = await Promise.all([
    db.boards.filter((b) => !b.deleted && !!b.trashed_at).primaryKeys(),
    db.papers.filter((p) => !p.deleted && !!p.trashed_at).primaryKeys(),
  ])
  return { boards: new Set(boards as string[]), papers: new Set(papers as string[]) }
}
