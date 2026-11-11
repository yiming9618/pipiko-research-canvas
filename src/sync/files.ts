// Which file in the data repo each entry lives in, and how files are written.
// Files are plain JSON (and .md / image files) so they can be read and fixed by hand.

import type { Asset, Synced, TableName } from '../domain/types'

type AnyEntry = Synced & Record<string, unknown>
export type FileTables = Partial<Record<TableName, Synced[]>>

export function fileOf(table: TableName, e: Synced): string {
  const x = e as AnyEntry
  switch (table) {
    case 'imports':
      return `data/imports/${String(x.date).slice(0, 7)}.json`
    case 'papers':
      return `data/papers/${x.id}.json`
    case 'blocks':
    case 'comments':
      return `data/papers/${x.paper_id}.json`
    case 'records':
    case 'cards':
      return `data/days/${x.date}.json`
    case 'boardItems':
    case 'connectors':
    case 'strokes':
      return `data/boards/${String(x.board_id).replace(':', '-')}.json`
    case 'piles':
      return 'data/piles.json'
    case 'types':
    case 'settings':
      return 'data/settings.json'
    case 'assets':
      return 'data/assets.json'
    case 'discussions':
    case 'discussionItems':
      return 'data/discussions.json'
  }
}

const TABLES_BY_PREFIX: [string, TableName[]][] = [
  ['data/imports/', ['imports']],
  ['data/papers/', ['papers', 'blocks', 'comments']],
  ['data/days/', ['records', 'cards']],
  ['data/boards/', ['boardItems', 'connectors', 'strokes']],
  ['data/piles.json', ['piles']],
  ['data/settings.json', ['types', 'settings']],
  ['data/assets.json', ['assets']],
  ['data/discussions.json', ['discussions', 'discussionItems']],
]

export function tablesIn(path: string): TableName[] {
  return TABLES_BY_PREFIX.find(([prefix]) => path.startsWith(prefix))?.[1] ?? []
}

export function isDataFile(path: string): boolean {
  return tablesIn(path).length > 0
}

export interface Payload {
  path: string
  field: string
  encoding: 'utf-8' | 'base64'
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * Large, never-changing content is kept out of the JSON and stored as its own
 * file: the original Markdown as a readable .md, images as real image files.
 */
export function payloadOf(table: TableName, e: Synced): Payload | null {
  const x = e as AnyEntry
  if (table === 'imports') {
    return { path: `raw/${x.date}-${x.id}.md`, field: 'raw_md', encoding: 'utf-8' }
  }
  if (table === 'assets') {
    const ext = EXT[(e as Asset).mime] ?? 'bin'
    return { path: `assets/${x.id}.${ext}`, field: 'data', encoding: 'base64' }
  }
  return null
}

export function stripPayload<T extends Synced>(table: TableName, e: T): T {
  const p = payloadOf(table, e)
  if (!p || !(p.field in e)) return e
  const copy = { ...e } as Record<string, unknown>
  delete copy[p.field]
  return copy as T
}

/** Stable output: same entries always give the same text, so unchanged files are not rewritten. */
export function serialize(tables: FileTables): string {
  const out: Record<string, Synced[]> = {}
  for (const name of Object.keys(tables).sort() as TableName[]) {
    out[name] = [...(tables[name] ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
  return JSON.stringify({ format: 1, tables: out }, null, 2) + '\n'
}

export function parseFile(text: string, path: string): FileTables {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`数据仓库里的 ${path} 不是有效的 JSON，需要手动检查这个文件`)
  }
  const tables = (data as { tables?: Record<string, unknown> })?.tables
  if (!tables || typeof tables !== 'object') return {}
  const out: FileTables = {}
  for (const name of tablesIn(path)) {
    const rows = tables[name]
    if (Array.isArray(rows)) {
      out[name] = rows.filter(
        (r): r is Synced => !!r && typeof r.id === 'string' && typeof r.updated_at === 'string',
      )
    }
  }
  return out
}
