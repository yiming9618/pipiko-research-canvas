// Entry-by-entry merge for sync. A file in the data repo holds many entries;
// two devices may both have changed it. We never let one file replace the
// other: each entry is compared on its own.

import type { Synced } from '../domain/types'

/** The newer `updated_at` wins. On a tie a deletion wins, then the remote copy. */
export function pickNewer<T extends Synced>(local: T, remote: T): T {
  if (local.updated_at > remote.updated_at) return local
  if (local.updated_at < remote.updated_at) return remote
  if (local.deleted && !remote.deleted) return local
  return remote
}

export interface MergeResult<T> {
  merged: T[]
  /** Entries the local device should store (new or newer on the remote). */
  toLocal: T[]
  /** True when the remote file needs rewriting (local had something newer). */
  remoteChanged: boolean
}

export function mergeEntries<T extends Synced>(local: T[], remote: T[]): MergeResult<T> {
  const localById = new Map(local.map((e) => [e.id, e]))
  const remoteById = new Map(remote.map((e) => [e.id, e]))
  const merged: T[] = []
  const toLocal: T[] = []
  let remoteChanged = false

  for (const [id, r] of remoteById) {
    const l = localById.get(id)
    if (!l) {
      merged.push(r)
      toLocal.push(r)
      continue
    }
    if (sameEntry(l, r)) {
      merged.push(r)
      continue
    }
    const winner = pickNewer(l, r)
    merged.push(winner)
    if (winner === r) toLocal.push(r)
    else remoteChanged = true
  }
  for (const [id, l] of localById) {
    if (!remoteById.has(id)) {
      merged.push(l)
      remoteChanged = true
    }
  }
  merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { merged, toLocal, remoteChanged }
}

function sameEntry<T extends Synced>(a: T, b: T): boolean {
  return a.updated_at === b.updated_at && !!a.deleted === !!b.deleted
}
