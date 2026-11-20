// The order of papers in the library. Pure.
//
// 在读 papers come first in every order, newest 在读 first (the last real edit, or switched on by hand).
// Then, by the chosen order:
//   最近阅读  the last real edit or import (older papers, from before this was recorded: their latest reading)
//   发表时间  newest year first; the same year by when it came into the library, newest first; no year last
//   收藏时间  when it came into the library, newest first

import type { Comment, ImportEntry, Paper, PaperBlock, PaperUse } from './types'

export type PaperSort = 'read' | 'published' | 'added'
/** 'desc' = newest first (the default). Papers without a value for the order go last either way. */
export type SortDirection = 'desc' | 'asc'
export const PAPER_SORTS: [PaperSort, string][] = [
  ['read', '最近阅读'],
  ['published', '发表时间'],
  ['added', '收藏时间'],
]

/**
 * 已编辑: the paper has reading notes of its own — 一句话总结, 基础, a highlight (or an unrecognised
 * section kept from an import), or a note (drawings too). Worked out, never stored. Its details
 * (DOI, title, authors, field), "为什么想看" and an empty reading do not count.
 */
export function isEdited(paper: Pick<Paper, 'id' | 'one_liner' | 'basics_md'>, blocks: Pick<PaperBlock, 'paper_id' | 'deleted'>[], comments: Pick<Comment, 'paper_id' | 'deleted' | 'text' | 'asset_id'>[]): boolean {
  if (paper.one_liner.trim() || paper.basics_md.trim()) return true
  if (blocks.some((b) => b.paper_id === paper.id && !b.deleted)) return true
  return comments.some((c) => c.paper_id === paper.id && !c.deleted && (!!c.text.trim() || !!c.asset_id))
}

/** Collected from a research record because the AI named it, and nothing written for it yet. Hidden in the library unless asked for. */
export const isAiMention = (paper: Pick<Paper, 'added_by'>, edited: boolean) => paper.added_by === 'ai' && !edited

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
  direction: SortDirection = 'desc',
): Paper[] {
  const flip = direction === 'asc' ? -1 : 1
  const by = (a: Paper, b: Paper): number => {
    const ra = isReadingNow(use.get(a.id))
    const rb = isReadingNow(use.get(b.id))
    if (ra !== rb) return ra ? -1 : 1
    if (ra && rb) {
      const d = desc(use.get(a.id)!.reading_since!, use.get(b.id)!.reading_since!)
      if (d) return d
    }
    let d = 0
    if (sort === 'read') {
      const [x, y] = [readAt(a), readAt(b)]
      // never read: last, whichever way
      if (!x !== !y) return x ? -1 : 1
      d = desc(x, y) * flip
    } else if (sort === 'published') {
      if (a.year !== b.year) {
        if (a.year === null || b.year === null) return a.year === null ? 1 : -1
        d = (b.year - a.year) * flip
      }
    }
    if (!d) d = desc(a.created_at, b.created_at) * flip
    return d || a.title.localeCompare(b.title, 'zh') || (a.id < b.id ? -1 : 1)
  }
  return [...papers].sort(by)
}
