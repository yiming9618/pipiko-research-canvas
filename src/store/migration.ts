// Runs the move to subject boards on this device (see domain/migrate.ts).
//
// Order, every time:
//   1. work out which rows are missing (pure);
//   2. the first time anything is about to be added, save a full backup of this
//      device as it is. If the backup cannot be saved, stop: nothing is changed;
//   3. add the missing rows in one transaction (all of them, or none);
//   4. check that every card, position, line and stroke has a board.
// It is not a one-off: it runs when the app opens, after every sync and after
// every import, so content written by a device that has not updated yet is
// picked up too. When nothing is missing it does nothing.

import { checkBoards, planMigration, type BoardCheck, type MigrationSnapshot } from '../domain/migrate'
import { exportAll, type BackupFile } from './backup'
import { applyChanges, db } from './db'

const BACKUP_KEY = 'backup-before-boards'
const REPORT_KEY = 'boards-migration'

export interface MigrationReport {
  /** False when the backup could not be saved and so nothing was changed. */
  ok: boolean
  error?: string
  boardsAdded: number
  fieldsAdded: number
  check: BoardCheck
  at: string
}

async function snapshot(): Promise<MigrationSnapshot> {
  const [boards, fields, piles, papers, records, cards, boardItems, connectors, strokes] = await Promise.all([
    db.boards.toArray(),
    db.fields.toArray(),
    db.piles.toArray(),
    db.papers.toArray(),
    db.records.toArray(),
    db.cards.toArray(),
    db.boardItems.toArray(),
    db.connectors.toArray(),
    db.strokes.toArray(),
  ])
  return { boards, fields, piles, papers, records, cards, boardItems, connectors, strokes }
}

let running: Promise<MigrationReport | null> | null = null

/** Returns null when there was nothing to do. Never throws. */
export function ensureBoards(): Promise<MigrationReport | null> {
  running ??= run().finally(() => {
    running = null
  })
  return running
}

async function run(): Promise<MigrationReport | null> {
  try {
    const before = await snapshot()
    const changes = planMigration(before)
    const boardsAdded = changes.boards?.length ?? 0
    const fieldsAdded = changes.fields?.length ?? 0
    if (boardsAdded + fieldsAdded === 0) return null

    if (!(await db.device.get(BACKUP_KEY))) {
      // Taken before the first change, of everything, exactly as it is now.
      const file = await exportAll()
      await db.device.put({ key: BACKUP_KEY, value: file })
      if (!(await db.device.get(BACKUP_KEY))) throw new Error('备份没有存上')
    }

    await applyChanges(changes)

    const report: MigrationReport = { ok: true, boardsAdded, fieldsAdded, check: checkBoards(await snapshot()), at: new Date().toISOString() }
    await db.device.put({ key: REPORT_KEY, value: report })
    return report
  } catch (err) {
    const report: MigrationReport = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      boardsAdded: 0,
      fieldsAdded: 0,
      check: { cards: 0, records: 0, boardItems: 0, connectors: 0, strokes: 0, total: 0 },
      at: new Date().toISOString(),
    }
    await db.device.put({ key: REPORT_KEY, value: report }).catch(() => undefined)
    return report
  }
}

/** The backup taken just before the first change, if there was one. */
export async function backupBeforeBoards(): Promise<BackupFile | null> {
  return ((await db.device.get(BACKUP_KEY))?.value as BackupFile | undefined) ?? null
}

export async function deleteBackupBeforeBoards(): Promise<void> {
  await db.device.delete(BACKUP_KEY)
}

export async function lastMigrationReport(): Promise<MigrationReport | null> {
  return ((await db.device.get(REPORT_KEY))?.value as MigrationReport | undefined) ?? null
}

/** Checked afresh against what is on the device now (for the settings page). */
export async function currentBoardCheck(): Promise<BoardCheck> {
  return checkBoards(await snapshot())
}
