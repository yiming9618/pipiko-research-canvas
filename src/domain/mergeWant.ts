// Folding a "想看" entry into the paper that was just imported, after the
// person confirmed they are the same. Pure.

import type { Changes, ImportEntry, ISODateTime, Paper } from './types'

export function mergeWant(entry: ImportEntry, paper: Paper, want: Paper, now: ISODateTime): Changes {
  const sources = [...(paper.mentioned_in ?? [])]
  for (const m of want.mentioned_in ?? []) {
    if (!sources.some((s) => s.record_id === m.record_id)) sources.push(m)
  }
  const merged: Paper = {
    ...paper,
    url: paper.url || want.url,
    doi: paper.doi || want.doi,
    why: paper.why || want.why || '',
    ...(sources.length > 0 ? { mentioned_in: sources } : {}),
    updated_at: now,
  }
  const effects = entry.effects ?? { paper_created: true, filled: [], keywords_added: [], types_created: [] }
  return {
    papers: [merged, { ...want, deleted: true, updated_at: now }],
    // the entry as it was, so undoing the import brings it back
    imports: [{ ...entry, effects: { ...effects, merged_want: want }, updated_at: now }],
  }
}
