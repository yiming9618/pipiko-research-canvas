// The readings of a paper (第 N 次阅读), worked out from what is stored.
//
// Nothing old is rewritten for this. A past import is a reading of its own, under an
// id made from the import's id; a highlight or note that came with an import belongs
// to that import's reading; one added by hand before readings existed belongs to the
// first reading. Rows in the `readings` table only add to this: a title, a reading
// made by hand, a removed one. Because every id is worked out the same way on every
// device, two devices can never make two copies of the same reading.
// Numbers are not stored either: readings are numbered by date when shown.

import type { Comment, ImportEntry, ISODate, Paper, PaperBlock, Reading } from './types'

export const readingIdOfImport = (importId: string) => `r-${importId}`
/** The first reading of a paper that has no import (added by hand, or "想看" that was read). */
export const firstReadingId = (paperId: string) => `r0-${paperId}`

export interface ReadingView {
  id: string
  paper_id: string
  number: number
  date: ISODate
  title: string
  created_at: string
  /** Imports whose highlights and notes are in this reading. */
  import_ids: string[]
  /** The stored row, when there is one. */
  row?: Reading
}

export interface ReadingInput {
  paper: Pick<Paper, 'id' | 'created_at' | 'status'>
  readings: Reading[]
  imports: ImportEntry[]
  blocks: Pick<PaperBlock, 'paper_id' | 'import_id' | 'reading_id' | 'deleted'>[]
  comments: Pick<Comment, 'paper_id' | 'import_id' | 'reading_id' | 'deleted'>[]
}

type Item = { import_id?: string; reading_id?: string }

export interface PaperReadings {
  /** Oldest first, numbered from 1. */
  list: ReadingView[]
  /** The reading a highlight block or note belongs to. */
  readingOf: (item: Item) => string
}

export function paperReadings(input: ReadingInput): PaperReadings {
  const { paper } = input
  const rows = new Map(input.readings.filter((r) => r.paper_id === paper.id).map((r) => [r.id, r]))
  const removed = (id: string) => rows.get(id)?.deleted === true
  const imports = input.imports
    .filter((e) => e.paper_id === paper.id && e.kind === 'paper' && !e.undone && !e.deleted)
    .sort((a, b) => (a.imported_at < b.imported_at ? -1 : a.imported_at > b.imported_at ? 1 : 0))

  const found = new Map<string, ReadingView>()
  const add = (v: Omit<ReadingView, 'number' | 'import_ids' | 'row'>) => {
    const row = rows.get(v.id)
    found.set(v.id, {
      ...v,
      number: 0,
      import_ids: [],
      title: row && !row.deleted ? row.title : v.title,
      date: row && !row.deleted ? row.date : v.date,
      ...(row && !row.deleted ? { row } : {}),
    })
  }

  // 1. readings made by hand (and named first readings)
  for (const r of rows.values()) {
    if (r.deleted || r.id.startsWith('r-')) continue
    add({ id: r.id, paper_id: paper.id, date: r.date, title: r.title, created_at: r.created_at })
  }
  // 2. each import that stands on its own is a reading
  const own = (e: ImportEntry) => !e.reading_id || e.reading_id === readingIdOfImport(e.id)
  for (const e of imports) {
    const id = readingIdOfImport(e.id)
    if (!own(e) || removed(id)) continue
    add({ id, paper_id: paper.id, date: e.date, title: e.reading_title ?? '', created_at: e.imported_at })
  }
  // 3. imports added to another reading go there; if that reading is gone, they stand on their own again
  const importReading = new Map<string, string>()
  for (const e of imports) {
    if (own(e)) {
      if (found.has(readingIdOfImport(e.id))) importReading.set(e.id, readingIdOfImport(e.id))
      continue
    }
    if (found.has(e.reading_id!)) importReading.set(e.id, e.reading_id!)
    else {
      const id = readingIdOfImport(e.id)
      add({ id, paper_id: paper.id, date: e.date, title: e.reading_title ?? '', created_at: e.imported_at })
      importReading.set(e.id, id)
    }
  }

  const sorted = () => [...found.values()].sort(byDate)
  const direct = (item: Item): string | undefined => {
    if (item.reading_id && found.has(item.reading_id)) return item.reading_id
    if (item.import_id && importReading.has(item.import_id)) return importReading.get(item.import_id)
    return undefined
  }

  // 4. the first reading of a paper without imports: only when something needs it
  const live = [...input.blocks, ...input.comments].filter((x) => x.paper_id === paper.id && !x.deleted)
  const r0 = firstReadingId(paper.id)
  if (!found.has(r0) && !removed(r0)) {
    // things put into it by hand keep it; otherwise it is there only while the paper has no other reading
    const kept = live.some((x) => x.reading_id === r0)
    if (kept || (found.size === 0 && (paper.status === 'read' || live.length > 0))) {
      add({ id: r0, paper_id: paper.id, date: paper.created_at.slice(0, 10), title: '', created_at: paper.created_at })
    }
  }

  const list = sorted()
  list.forEach((r, i) => (r.number = i + 1))
  for (const [importId, readingId] of importReading) found.get(readingId)?.import_ids.push(importId)
  const first = list[0]?.id ?? r0
  return { list, readingOf: (item) => direct(item) ?? first }
}

function byDate(a: ReadingView, b: ReadingView): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** "第 2 次阅读｜原文精读｜2026-11-10" */
export function readingLabel(r: Pick<ReadingView, 'number' | 'title' | 'date'>): string {
  return [`第 ${r.number} 次阅读`, r.title.trim(), r.date].filter(Boolean).join('｜')
}

/** A reading is empty when no live highlight or note is in it. Only empty readings can be removed. */
export function readingIsEmpty(id: string, readingOf: PaperReadings['readingOf'], items: (Item & { deleted?: boolean })[]): boolean {
  return !items.some((x) => !x.deleted && readingOf(x) === id)
}
