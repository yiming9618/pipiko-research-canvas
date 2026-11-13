// One sync round between this device and the data repo.
// Rule: files are never replaced wholesale. For every file that changed on
// either side, the remote copy is read and merged entry by entry with local.

import type { Changes, Synced, TableName } from '../domain/types'
import { mergeEntries } from '../store/merge'
import { isDataFile, parseFile, payloadOf, serialize, stripPayload, tablesIn, type FileTables } from './files'

export interface RemoteSnapshot {
  /** Id of the latest commit; null for a repo with nothing in it. */
  head: string | null
  /** path → content id (changes whenever the file changes). */
  files: Map<string, string>
}

export interface RemoteWrite {
  path: string
  content: string
  encoding: 'utf-8' | 'base64'
}

export interface RemoteStore {
  list(): Promise<RemoteSnapshot>
  read(path: string, encoding: 'utf-8' | 'base64'): Promise<string>
  /** Writes all files as ONE commit on top of `head`. Throws ConflictError if the repo moved on. */
  commit(head: string | null, writes: RemoteWrite[], message: string): Promise<RemoteSnapshot>
}

export class ConflictError extends Error {
  constructor() {
    super('remote changed during sync')
  }
}

export interface DirtyMark {
  table: TableName
  id: string
  updated_at: string
  /** The data file this entry belongs in. */
  path: string
}

export interface SyncMeta {
  /** Content id of each remote file as of the last successful sync. */
  known: Record<string, string>
  last_sync_at: string | null
}

export interface LocalStore {
  getMeta(): Promise<SyncMeta>
  setMeta(meta: SyncMeta): Promise<void>
  /** Entries changed on this device since they were last pushed. */
  listDirty(): Promise<DirtyMark[]>
  /** Clears a mark only if the entry has not been changed again since. */
  clearDirty(marks: DirtyMark[]): Promise<void>
  /** Every local entry (including deleted markers) that belongs in this file. */
  entriesFor(path: string): Promise<FileTables>
  /** Stores entries that came from the repo, without marking them as changed. */
  putFromRemote(changes: Changes): Promise<void>
}

export interface SyncReport {
  /** Entries this device received. */
  pulled: number
  /** Entries this device sent. */
  pushed: number
  /** 0 or 1: a round never makes more than one commit. */
  commits: number
  files: string[]
}

const MAX_ATTEMPTS = 4

export async function syncOnce(local: LocalStore, remote: RemoteStore, now: () => string): Promise<SyncReport> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptSync(local, remote, now)
    } catch (err) {
      // Someone else committed between our read and our write: start over and merge again.
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS) continue
      throw err
    }
  }
}

async function attemptSync(local: LocalStore, remote: RemoteStore, now: () => string): Promise<SyncReport> {
  const meta = await local.getMeta()
  const snap = await remote.list()
  const dirty = await local.listDirty()

  const paths = new Set<string>()
  for (const [path, id] of snap.files) {
    if (isDataFile(path) && meta.known[path] !== id) paths.add(path)
  }
  for (const mark of dirty) paths.add(mark.path)

  const writes: RemoteWrite[] = []
  const toLocal: Changes = {}
  let pulled = 0
  let pushed = 0

  for (const path of [...paths].sort()) {
    const remoteTables = snap.files.has(path) ? parseFile(await remote.read(path, 'utf-8'), path) : {}
    const localTables = await local.entriesFor(path)
    const out: FileTables = {}
    let fileChanged = false

    for (const table of tablesIn(path)) {
      const l = localTables[table] ?? []
      const r = remoteTables[table] ?? []
      const localById = new Map(l.map((e) => [e.id, e]))
      const remoteById = new Map(r.map((e) => [e.id, e]))
      const m = mergeEntries(l, r)
      if (m.remoteChanged) fileChanged = true

      for (const entry of m.toLocal) {
        const full = await withPayload(table, entry, localById.get(entry.id), snap, remote)
        ;((toLocal[table] ??= []) as Synced[]).push(full)
        pulled++
      }

      for (const entry of m.merged) {
        if (localById.get(entry.id) !== entry) continue // the remote copy won
        const theirs = remoteById.get(entry.id)
        if (theirs && theirs.updated_at === entry.updated_at && !!theirs.deleted === !!entry.deleted) continue
        pushed++
        const payload = payloadOf(table, entry)
        const value = payload ? (entry as unknown as Record<string, unknown>)[payload.field] : undefined
        if (
          payload &&
          typeof value === 'string' &&
          !snap.files.has(payload.path) &&
          !writes.some((w) => w.path === payload.path)
        ) {
          writes.push({ path: payload.path, content: value, encoding: payload.encoding })
        }
      }
      out[table] = m.merged.map((e) => stripPayload(table, e))
    }
    if (fileChanged) writes.push({ path, content: serialize(out), encoding: 'utf-8' })
  }

  let finalSnap = snap
  const dataFiles = writes.filter((w) => isDataFile(w.path)).map((w) => w.path)
  if (writes.length > 0) {
    const names = dataFiles.map((p) => p.replace(/^data\//, '').replace(/\.json$/, ''))
    const message = `同步：${names.slice(0, 3).join('、')}${names.length > 3 ? ` 等 ${names.length} 个文件` : ''}`
    finalSnap = await remote.commit(snap.head, writes, message)
  }

  await local.putFromRemote(toLocal)
  await local.clearDirty(dirty)
  await local.setMeta({ known: Object.fromEntries(finalSnap.files), last_sync_at: now() })

  return { pulled, pushed, commits: writes.length > 0 ? 1 : 0, files: dataFiles }
}

/** Entries pulled from the repo arrive without their large field; fill it in. */
async function withPayload(
  table: TableName,
  entry: Synced,
  localCopy: Synced | undefined,
  snap: RemoteSnapshot,
  remote: RemoteStore,
): Promise<Synced> {
  const payload = payloadOf(table, entry)
  if (!payload) return entry
  const have = (localCopy as Record<string, unknown> | undefined)?.[payload.field]
  if (typeof have === 'string') return { ...entry, [payload.field]: have } as Synced
  // a deleted entry is never shown: its file (original Markdown, picture) is not fetched
  if (entry.deleted) return { ...entry, [payload.field]: '' } as Synced
  if (!snap.files.has(payload.path)) return { ...entry, [payload.field]: '' } as Synced
  return { ...entry, [payload.field]: await remote.read(payload.path, payload.encoding) } as Synced
}
