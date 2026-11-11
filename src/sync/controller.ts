// Connects the sync engine to the app: keeps this device's connection details,
// decides when a round runs, and publishes a small status for the UI.

import { db, localChangeListeners, nowIso } from '../store/db'
import { DexieLocal, forgetSyncMeta, markAllDirty } from './dexieLocal'
import { syncOnce } from './engine'
import { GitHubRemote, SyncProblem, type SyncProblemKind } from './github'
import { SyncScheduler } from './scheduler'

const CONFIG_KEY = 'sync-config'
const RETRY_MS = 2 * 60_000

/** Stays on this device only: never synced, never in a backup file. */
export interface SyncConfig {
  owner: string
  repo: string
  token: string
}

export interface SyncState {
  /** off: no token on this device. */
  phase: 'off' | 'syncing' | 'ok' | 'problem'
  owner: string
  repo: string
  lastSyncAt: string | null
  problem: { kind: SyncProblemKind; message: string; steps: string[] } | null
  /** Entries received in the latest round (to tell the person something arrived). */
  pulled: number
}

let state: SyncState = { phase: 'off', owner: '', repo: '', lastSyncAt: null, problem: null, pulled: 0 }
let config: SyncConfig | null = null
let scheduler: SyncScheduler | null = null
let retry: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function set(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSyncState(): SyncState {
  return state
}

/** Problems that need the person to do something; the others clear up by waiting. */
export function needsAttention(kind: SyncProblemKind): boolean {
  return kind === 'token' || kind === 'permission' || kind === 'not_found'
}

async function round(): Promise<void> {
  if (!config) return
  if (retry) clearTimeout(retry)
  retry = null
  set({ phase: 'syncing' })
  try {
    const report = await syncOnce(new DexieLocal(), new GitHubRemote(config), nowIso)
    set({ phase: 'ok', problem: null, lastSyncAt: nowIso(), pulled: report.pulled })
  } catch (err) {
    const problem =
      err instanceof SyncProblem
        ? { kind: err.kind, message: err.message, steps: err.steps }
        : { kind: 'other' as const, message: `同步没成功：${err instanceof Error ? err.message : String(err)}`, steps: [] }
    set({ phase: 'problem', problem })
    if (!needsAttention(problem.kind)) retry = setTimeout(() => scheduler?.requestSoon(), RETRY_MS)
  }
}

function start(next: SyncConfig): void {
  config = next
  scheduler?.stop()
  scheduler = new SyncScheduler({ run: round })
  set({ owner: next.owner, repo: next.repo, problem: null, phase: 'syncing' })
  scheduler.runNow()
}

let wired = false

/** Called once when the app opens. */
export async function initSync(): Promise<void> {
  if (wired) return
  {
    wired = true
    localChangeListeners.add(() => scheduler?.notifyChange())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduler?.requestSoon()
    })
    window.addEventListener('online', () => scheduler?.requestSoon())
  }
  const row = await db.device.get(CONFIG_KEY)
  const saved = row?.value as SyncConfig | undefined
  if (!saved?.token) return
  const meta = (await db.device.get('sync-meta'))?.value as { last_sync_at?: string | null } | undefined
  set({ lastSyncAt: meta?.last_sync_at ?? null })
  start(saved)
}

/** First connection on this device, or a different repo: everything here is sent, everything there is fetched. */
export async function connectSync(next: SyncConfig): Promise<void> {
  const sameRepo = config && config.owner === next.owner && config.repo === next.repo
  await db.device.put({ key: CONFIG_KEY, value: next })
  if (!sameRepo) {
    await forgetSyncMeta()
    await markAllDirty()
    set({ lastSyncAt: null })
  }
  start(next)
}

/** Same repo, new token (the old one expired). */
export async function replaceToken(token: string): Promise<void> {
  if (!config) return
  await connectSync({ ...config, token })
}

export function syncNow(): void {
  scheduler?.runNow()
}

/** Removes the token from this device. Nothing stored here or in the repo is deleted. */
export async function disconnectSync(): Promise<void> {
  scheduler?.stop()
  scheduler = null
  config = null
  if (retry) clearTimeout(retry)
  await db.device.delete(CONFIG_KEY)
  set({ phase: 'off', problem: null, owner: '', repo: '' })
}
