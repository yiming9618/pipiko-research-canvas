// "Could these two titles be the same paper?" Fixed rules, no guessing engine:
// used only to ASK the person, never to merge on its own.

import { normalizeTitle } from './importer'

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'are', 'its', 'how', 'what', 'via', 'using', 'towards', 'toward'])

/** Latin words (3+ letters, minus filler words) and pairs of neighbouring CJK characters. */
export function titleTokens(title: string): Set<string> {
  const text = title.normalize('NFKC').toLowerCase()
  const out = new Set<string>()
  for (const word of text.match(/[a-z0-9]{3,}/g) ?? []) if (!STOP.has(word)) out.add(word)
  for (const run of text.match(/[㐀-鿿぀-ヿ]+/g) ?? []) {
    if (run.length === 1) out.add(run)
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2))
  }
  return out
}

/** 0..1: how much of the shorter title's wording appears in the other. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ta = titleTokens(a)
  const tb = titleTokens(b)
  const smaller = Math.min(ta.size, tb.size)
  // a single word (or two characters) is too little to go on
  if (smaller < 2) return 0
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na]
  if (long.includes(short)) return 0.95
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared >= 2 ? shared / smaller : 0
}

export const SIMILAR_ENOUGH = 0.6

export function similarTitle(a: string, b: string): boolean {
  return titleSimilarity(a, b) >= SIMILAR_ENOUGH
}
