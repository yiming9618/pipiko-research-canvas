import { planImport, type ImportOutcome } from '../domain/importer'
import type { ImportEntry, ImportKind } from '../domain/types'
import { planUndo, type UndoPlan } from '../domain/undo'
import { applyChanges, db, newId, nowIso, todayLocal } from './db'

export async function runImport(raw: string, kindHint: ImportKind): Promise<ImportOutcome> {
  const [papers, types, blocks, imports] = await Promise.all([
    db.papers.toArray(),
    db.types.toArray(),
    db.blocks.toArray(),
    db.imports.toArray(),
  ])
  const outcome = planImport(raw, {
    papers,
    types,
    blocks,
    imports,
    today: todayLocal(),
    now: nowIso(),
    kindHint,
    newId,
  })
  if (outcome.stored) await applyChanges(outcome.changes)
  return outcome
}

/** Step one of undo: what would be lost. Nothing is changed yet. */
export async function prepareUndo(entry: ImportEntry): Promise<UndoPlan> {
  const [imports, papers, blocks, comments, types, records, cards, boardItems, connectors, piles] =
    await Promise.all([
      db.imports.toArray(),
      db.papers.toArray(),
      db.blocks.toArray(),
      db.comments.toArray(),
      db.types.toArray(),
      db.records.toArray(),
      db.cards.toArray(),
      db.boardItems.toArray(),
      db.connectors.toArray(),
      db.piles.toArray(),
    ])
  return planUndo(
    entry,
    { imports, papers, blocks, comments, types, records, cards, boardItems, connectors, piles },
    nowIso(),
  )
}

export async function commitUndo(plan: UndoPlan): Promise<void> {
  await applyChanges(plan.changes)
}

export async function saveSetting(id: string, value: string): Promise<void> {
  await db.settings.put({ id, value, updated_at: nowIso() })
}
