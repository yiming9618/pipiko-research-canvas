import { planImport, type ImportOutcome } from '../domain/importer'
import type { ImportEntry, ImportKind } from '../domain/types'
import { planUndo, type UndoPlan } from '../domain/undo'
import { applyChanges, db, newId, nowIso, todayLocal } from './db'
import { runLookups } from './lookup'
import { mergeWant } from '../domain/mergeWant'

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
  if (outcome.stored) {
    await applyChanges(outcome.changes)
    void runLookups()
  }
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
  await applyChanges({ settings: [{ id, value, updated_at: nowIso() }] })
}

/** The person confirmed: the "想看" entry and the paper just imported are the same paper. */
export async function confirmSameAsWant(entryId: string, paperId: string, wantId: string): Promise<boolean> {
  const [entry, paper, want] = await Promise.all([db.imports.get(entryId), db.papers.get(paperId), db.papers.get(wantId)])
  if (!entry || !paper || !want || paper.deleted || want.deleted || want.status !== 'want') return false
  await applyChanges(mergeWant(entry, paper, want, nowIso()))
  return true
}
