// This device's side of a sync round, backed by the IndexedDB tables.

import type { Changes, Synced, TableName } from '../domain/types'
import { db, TABLE_NAMES } from '../store/db'
import type { DirtyMark, LocalStore, SyncMeta } from './engine'
import { fileOf, tablesIn, type FileTables } from './files'

const META_KEY = 'sync-meta'

export class DexieLocal implements LocalStore {
  /** table → (file path → entries), read once per round. */
  private cache = new Map<TableName, Map<string, Synced[]>>()

  async getMeta(): Promise<SyncMeta> {
    this.cache.clear() // a new attempt starts here: read fresh
    const row = await db.device.get(META_KEY)
    return (row?.value as SyncMeta | undefined) ?? { known: {}, last_sync_at: null }
  }

  async setMeta(meta: SyncMeta): Promise<void> {
    await db.device.put({ key: META_KEY, value: meta })
  }

  async listDirty(): Promise<DirtyMark[]> {
    const marks: DirtyMark[] = []
    for (const row of await db.dirty.toArray()) {
      const entry = (await db.table(row.table).get(row.id)) as Synced | undefined
      if (!entry) continue
      marks.push({ table: row.table, id: row.id, updated_at: row.updated_at, path: fileOf(row.table, entry) })
    }
    return marks
  }

  async clearDirty(marks: DirtyMark[]): Promise<void> {
    await db.transaction('rw', db.dirty, async () => {
      for (const m of marks) {
        const key = `${m.table}:${m.id}`
        const row = await db.dirty.get(key)
        // Edited again while the round was running: keep the mark so the next round sends it.
        if (row && row.updated_at === m.updated_at) await db.dirty.delete(key)
      }
    })
  }

  async entriesFor(path: string): Promise<FileTables> {
    const out: FileTables = {}
    for (const table of tablesIn(path)) {
      let byPath = this.cache.get(table)
      if (!byPath) {
        byPath = new Map()
        for (const entry of (await db.table(table).toArray()) as Synced[]) {
          const p = fileOf(table, entry)
          const list = byPath.get(p)
          if (list) list.push(entry)
          else byPath.set(p, [entry])
        }
        this.cache.set(table, byPath)
      }
      out[table] = byPath.get(path) ?? []
    }
    return out
  }

  async putFromRemote(changes: Changes): Promise<void> {
    const names = (Object.keys(changes) as TableName[]).filter((n) => (changes[n]?.length ?? 0) > 0)
    if (names.length === 0) return
    await db.transaction('rw', names.map((n) => db[n]), async () => {
      for (const name of names) {
        for (const incoming of changes[name] as Synced[]) {
          const mine = (await db.table(name).get(incoming.id)) as Synced | undefined
          // Edited here while the round was running: the local edit is newer, keep it.
          if (mine && mine.updated_at > incoming.updated_at) continue
          await db.table(name).put(incoming)
        }
      }
    })
  }
}

/** Marks everything on this device as "to be sent", so the first sync after connecting uploads it all. */
export async function markAllDirty(): Promise<void> {
  await db.transaction('rw', [...TABLE_NAMES.map((n) => db[n]), db.dirty], async () => {
    for (const name of TABLE_NAMES) {
      const rows = (await db.table(name).toArray()) as Synced[]
      await db.dirty.bulkPut(rows.map((r) => ({ key: `${name}:${r.id}`, table: name, id: r.id, updated_at: r.updated_at })))
    }
  })
}

export async function forgetSyncMeta(): Promise<void> {
  await db.device.delete(META_KEY)
}
