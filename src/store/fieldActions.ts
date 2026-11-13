// Fields (领域): one per paper at most.

import { normalizeFieldName } from '../domain/migrate'
import type { Field, Paper } from '../domain/types'
import { applyChanges, db, newId, nowIso } from './db'

const live = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)

// Creating and renaming run one after another: two quick edits must not both pass the
// "is this name free?" check before either is saved.
let queue: Promise<unknown> = Promise.resolve()
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job)
  queue = next.catch(() => undefined)
  return next
}

/** Another live field already has this name (ignoring case and spacing). */
export async function nameTaken(name: string, except?: string): Promise<Field | undefined> {
  const key = normalizeFieldName(name)
  return live(await db.fields.toArray()).find((f) => f.id !== except && normalizeFieldName(f.name) === key)
}

export function createField(name: string): Promise<Field | 'taken' | 'empty'> {
  return inTurn(() => create(name))
}

async function create(name: string): Promise<Field | 'taken' | 'empty'> {
  const clean = name.trim()
  if (!clean) return 'empty'
  if (await nameTaken(clean)) return 'taken'
  const now = nowIso()
  const field: Field = { id: newId('field'), name: clean, created_at: now, updated_at: now }
  await applyChanges({ fields: [field] })
  return field
}

/** Renaming changes one entry; every paper in the field shows the new name. */
export function renameField(field: Field, name: string): Promise<'done' | 'taken' | 'empty'> {
  return inTurn(() => rename(field, name))
}

async function rename(field: Field, name: string): Promise<'done' | 'taken' | 'empty'> {
  const clean = name.trim()
  if (!clean) return 'empty'
  if (clean === field.name) return 'done'
  if (await nameTaken(clean, field.id)) return 'taken'
  await applyChanges({ fields: [{ ...field, name: clean, updated_at: nowIso() }] })
  return 'done'
}

/** The papers in it become 未分类 (they point at a field that is gone). Nothing else changes. */
export async function deleteField(field: Field): Promise<void> {
  await applyChanges({ fields: [{ ...field, deleted: true, updated_at: nowIso() }] })
}

/** '' = 未分类, on purpose. */
export async function setPaperField(paper: Paper, fieldId: string): Promise<void> {
  if (paper.field_id === fieldId) return
  await applyChanges({ papers: [{ ...paper, field_id: fieldId, updated_at: nowIso() }] })
}
