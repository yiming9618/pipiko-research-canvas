// In-memory stand-ins for the data repo and for a device, used by the tests.
// They follow the same rules as the real ones (one commit at a time, refuse
// to write on top of a stale state).

import type { Changes, Synced, TableName } from '../domain/types'
import { hashText } from '../domain/importer'
import {
  ConflictError,
  type DirtyMark,
  type LocalStore,
  type RemoteSnapshot,
  type RemoteStore,
  type RemoteWrite,
  type SyncMeta,
} from './engine'
import { fileOf, tablesIn, type FileTables } from './files'

export class MemoryRemote implements RemoteStore {
  files = new Map<string, string>()
  commits: { message: string; paths: string[] }[] = []
  /** Test hook: runs once just before the next commit is accepted. */
  beforeCommit: (() => Promise<void>) | null = null
  private version = 1

  private snapshot(): RemoteSnapshot {
    const ids = new Map<string, string>()
    for (const [path, content] of this.files) ids.set(path, hashText(content))
    return { head: `c${this.version}`, files: ids }
  }

  async list(): Promise<RemoteSnapshot> {
    return this.snapshot()
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path)
    if (content === undefined) throw new Error(`missing ${path}`)
    return content
  }

  async commit(head: string | null, writes: RemoteWrite[], message: string): Promise<RemoteSnapshot> {
    if (this.beforeCommit) {
      const hook = this.beforeCommit
      this.beforeCommit = null
      await hook()
    }
    if (head !== `c${this.version}`) throw new ConflictError()
    for (const w of writes) this.files.set(w.path, w.content)
    this.version++
    this.commits.push({ message, paths: writes.map((w) => w.path) })
    return this.snapshot()
  }
}

export class MemoryLocal implements LocalStore {
  tables = new Map<TableName, Map<string, Synced>>()
  private dirty = new Map<string, DirtyMark>()
  private meta: SyncMeta = { known: {}, last_sync_at: null }

  /** A change made on this device. */
  write(table: TableName, entry: Synced): void {
    this.rows(table).set(entry.id, entry)
    this.dirty.set(`${table}:${entry.id}`, {
      table,
      id: entry.id,
      updated_at: entry.updated_at,
      path: fileOf(table, entry),
    })
  }

  get<T extends Synced>(table: TableName, id: string): T | undefined {
    return this.rows(table).get(id) as T | undefined
  }

  all<T extends Synced>(table: TableName): T[] {
    return [...this.rows(table).values()] as T[]
  }

  private rows(table: TableName): Map<string, Synced> {
    if (!this.tables.has(table)) this.tables.set(table, new Map())
    return this.tables.get(table)!
  }

  async getMeta(): Promise<SyncMeta> {
    return this.meta
  }

  async setMeta(meta: SyncMeta): Promise<void> {
    this.meta = meta
  }

  async listDirty(): Promise<DirtyMark[]> {
    return [...this.dirty.values()]
  }

  async clearDirty(marks: DirtyMark[]): Promise<void> {
    for (const m of marks) {
      const key = `${m.table}:${m.id}`
      if (this.dirty.get(key)?.updated_at === m.updated_at) this.dirty.delete(key)
    }
  }

  async entriesFor(path: string): Promise<FileTables> {
    const out: FileTables = {}
    for (const table of tablesIn(path)) {
      out[table] = this.all(table).filter((e) => fileOf(table, e) === path)
    }
    return out
  }

  async putFromRemote(changes: Changes): Promise<void> {
    for (const table of Object.keys(changes) as TableName[]) {
      for (const entry of changes[table] as Synced[]) this.rows(table).set(entry.id, entry)
    }
  }
}
