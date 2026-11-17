// The order of papers in the library. Pure.
//
// 在读 papers come first in every order, newest 在读 first (the last real edit, or switched on by hand).
// Then, by the chosen order:
//   最近阅读  the last real edit or import (older papers, from before this was recorded: their latest reading)
//   发表时间  newest year first; the same year by when it came into the library, newest first; no year last
//   收藏时间  when it came into the library, newest first

import type { ImportEntry, Paper, PaperUse } from './types'

export type PaperSort = 'read' | 'published' | 'added'
export const PAPER_SORTS: [PaperSort, string][] = [
  ['read', '最近阅读'],
  ['published', '发表时间'],
  ['added', '收藏时间'],
]

export const isReadingNow = (use: PaperUse | undefined) => !!use && !use.deleted && !!use.reading_since

/** When the paper was last read: the recorded last real edit, else its latest import or reading. '' when never. */
export function lastRead(paper: Paper, use: PaperUse | undefined, imports: ImportEntry[], readingDates: string[] = []): string {
  let at = use && !use.deleted ? (use.worked_at ?? '') : ''
  for (const e of imports) if (e.paper_id === paper.id && !e.undone && !e.deleted && e.imported_at > at) at = e.imported_at
  for (const d of readingDates) if (d > at) at = d
  return at
}

const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0)

export function sortPapers(
  papers: Paper[],
  sort: PaperSort,
  use: Map<string, PaperUse>,
  readAt: (p: Paper) => string,
): Paper[] {
  const by = (a: Paper, b: Paper): number => {
    const ra = isReadingNow(use.get(a.id))
    const rb = isReadingNow(use.get(b.id))
    if (ra !== rb) return ra ? -1 : 1
    if (ra && rb) {
      const d = desc(use.get(a.id)!.reading_since!, use.get(b.id)!.reading_since!)
      if (d) return d
    }
    let d = 0
    if (sort === 'read') d = desc(readAt(a), readAt(b))
    else if (sort === 'published') {
      if (a.year !== b.year) d = a.year === null ? 1 : b.year === null ? -1 : b.year - a.year
    }
    if (!d) d = desc(a.created_at, b.created_at)
    return d || a.title.localeCompare(b.title, 'zh') || (a.id < b.id ? -1 : 1)
  }
  return [...papers].sort(by)
}
