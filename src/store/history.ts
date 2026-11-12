// Undo and redo for a board. While a board is open, every change made to what
// is on a board (cards, positions, lines, ink) is noted with what was there
// before. Undoing writes the earlier state back as a new change, so it syncs
// like any other edit. The list lives on this device only and is forgotten
// when the board is closed.

import type { Changes, Synced, TableName } from '../domain/types'
import { applyChanges, db, nowIso, setRecorder } from './db'

/** The tables whose changes can be undone. */
export const UNDOABLE: readonly TableName[] = ['cards', 'boardItems', 'connectors', 'strokes']

interface Step {
  /** Each changed entry as it was before (null = it did not exist). */
  before: { table: TableName; id: string; row: Synced | null }[]
  /** …and as it was after. */
  after: { table: TableName; id: string; row: Synced }[]
}

const MAX_STEPS = 100
let undo: Step[] = []
let redo: Step[] = []
let active = false
let replaying = false
const listeners = new Set<() => void>()
let snapshot = { canUndo: false, canRedo: false }

function publish(): void {
  snapshot = { canUndo: undo.length > 0, canRedo: redo.length > 0 }
  for (const l of listeners) l()
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function historyState(): { canUndo: boolean; canRedo: boolean } {
  return snapshot
}

/** Start noting changes (a board was opened). Returns the function that stops it. */
export function startHistory(): () => void {
  undo = []
  redo = []
  active = true
  setRecorder((before, changes) => {
    if (!active || replaying) return
    const step: Step = { before: [], after: [] }
    for (const table of UNDOABLE) {
      for (const row of (changes[table] ?? []) as Synced[]) {
        step.before.push({ table, id: row.id, row: before.get(`${table}:${row.id}`) ?? null })
        step.after.push({ table, id: row.id, row })
      }
    }
    if (step.after.length === 0) return
    undo.push(step)
    if (undo.length > MAX_STEPS) undo.shift()
    redo = [] // a new action after undoing: the undone ones can no longer be redone
    publish()
  })
  publish()
  return () => {
    active = false
    setRecorder(null)
    undo = []
    redo = []
    publish()
  }
}

/** Writes rows back as fresh changes. An entry that did not exist before is marked deleted. */
async function write(rows: { table: TableName; id: string; row: Synced | null }[], fallback: Step['after']): Promise<void> {
  const now = nowIso()
  const changes: Record<string, Synced[]> = {}
  for (const r of rows) {
    const current = (await db.table(r.table).get(r.id)) as Synced | undefined
    const base = r.row ?? fallback.find((f) => f.table === r.table && f.id === r.id)?.row ?? current
    if (!base) continue
    const next: Synced = r.row ? { ...r.row, updated_at: now } : { ...base, deleted: true, updated_at: now }
    if (r.row && !r.row.deleted) delete next.deleted
    ;(changes[r.table] ??= []).push(next)
  }
  replaying = true
  try {
    await applyChanges(changes as Changes)
  } finally {
    replaying = false
  }
}

export async function undoLast(): Promise<boolean> {
  const step = undo.pop()
  if (!step) return false
  await write(step.before, step.after)
  redo.push(step)
  publish()
  return true
}

export async function redoLast(): Promise<boolean> {
  const step = redo.pop()
  if (!step) return false
  await write(step.after, step.after)
  undo.push(step)
  publish()
  return true
}
