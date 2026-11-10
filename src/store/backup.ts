// Full JSON export and import. Independent of sync: works with no account.

import type { Changes, Synced, TableName } from '../domain/types'
import { applyChanges, db, TABLE_NAMES } from './db'
import { mergeEntries } from './merge'

const APP = 'research-notebook'
const VERSION = 1

export interface BackupFile {
  app: typeof APP
  version: number
  exported_at: string
  tables: Record<string, Synced[]>
}

export async function exportAll(): Promise<BackupFile> {
  const tables: Record<string, Synced[]> = {}
  for (const name of TABLE_NAMES) {
    tables[name] = (await db.table(name).toArray()) as Synced[]
  }
  return { app: APP, version: VERSION, exported_at: new Date().toISOString(), tables }
}

export function parseBackup(text: string): BackupFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('这个文件不是有效的 JSON，可能没有下载完整')
  }
  const file = data as Partial<BackupFile>
  if (!file || file.app !== APP || typeof file.tables !== 'object' || file.tables === null) {
    throw new Error('这不是研究笔记本导出的备份文件')
  }
  if ((file.version ?? 0) > VERSION) {
    throw new Error('这个备份来自更新的版本，请先更新笔记本再导入')
  }
  return file as BackupFile
}

/**
 * Merges a backup into this device entry by entry: anything missing here is
 * added, and for entries on both sides the newer one is kept. Nothing local
 * that is newer gets overwritten.
 */
export async function importBackup(file: BackupFile): Promise<{ added: number; total: number }> {
  const changes: Changes = {}
  let added = 0
  let total = 0
  for (const name of TABLE_NAMES) {
    const incoming = (file.tables[name] ?? []).filter(
      (e) => e && typeof e.id === 'string' && typeof e.updated_at === 'string',
    )
    total += incoming.length
    const local = (await db.table(name).toArray()) as Synced[]
    const { toLocal } = mergeEntries(local, incoming)
    if (toLocal.length > 0) {
      ;(changes as Record<TableName, Synced[]>)[name] = toLocal
      added += toLocal.length
    }
  }
  await applyChanges(changes)
  return { added, total }
}

export function downloadJson(file: BackupFile, date: string): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `研究笔记本-备份-${date}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
