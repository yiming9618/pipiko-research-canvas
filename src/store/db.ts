import Dexie, { type EntityTable } from 'dexie'
import { builtinTypes } from '../domain/importer'
import type { Changes, TableName, Tables } from '../domain/types'

export const TABLE_NAMES: TableName[] = [
  'imports',
  'papers',
  'blocks',
  'types',
  'comments',
  'records',
  'cards',
  'boardItems',
  'connectors',
  'strokes',
  'piles',
  'settings',
  'assets',
]

/** Local-only: which entries changed on this device and still need to be sent when sync is connected. */
export interface DirtyRow {
  key: string
  table: TableName
  id: string
  updated_at: string
}

type Db = Dexie & { [K in TableName]: EntityTable<Tables[K], 'id'> } & {
  dirty: EntityTable<DirtyRow, 'key'>
}

export const db = new Dexie('research-notebook') as Db

db.version(1).stores({
  imports: 'id, updated_at, raw_hash, imported_at',
  papers: 'id, updated_at, doi, status',
  blocks: 'id, updated_at, paper_id',
  types: 'id, updated_at',
  comments: 'id, updated_at, paper_id',
  records: 'id, updated_at, date',
  cards: 'id, updated_at, record_id, date',
  boardItems: 'id, updated_at, board_id',
  connectors: 'id, updated_at, board_id',
  strokes: 'id, updated_at, board_id',
  piles: 'id, updated_at',
  settings: 'id, updated_at',
  assets: 'id, updated_at',
})

db.version(2).stores({ dirty: 'key' })

db.on('populate', (tx) => {
  tx.table('types').bulkAdd(builtinTypes())
})

/** Writes a set of changes in one transaction: all of it lands, or none. */
export async function applyChanges(changes: Changes): Promise<void> {
  const names = (Object.keys(changes) as TableName[]).filter((n) => (changes[n]?.length ?? 0) > 0)
  if (names.length === 0) return
  await db.transaction('rw', [...names.map((n) => db[n]), db.dirty], async () => {
    for (const name of names) {
      const rows = changes[name] as { id: string; updated_at: string }[]
      await db.table(name).bulkPut(rows)
      await db.dirty.bulkPut(
        rows.map((r) => ({ key: `${name}:${r.id}`, table: name, id: r.id, updated_at: r.updated_at })),
      )
    }
  })
}

/** Random id that also works on plain http (where crypto.randomUUID is missing). */
export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  let s = ''
  for (const b of bytes) s += (b % 36).toString(36)
  return `${prefix}_${s}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** Today in the device's own time zone, as YYYY-MM-DD. */
export function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
