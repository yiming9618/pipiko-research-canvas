// Turns "(作者, 年份)" in card text into links to papers in the library.
// Strict on purpose: a citation links only when exactly one of the papers the
// record itself lists (its `papers:` DOIs) has that year and that author.
// Anything else stays as written.

import type { Paper } from './types'

export interface Citation {
  /** Position of the whole "(…)" group, or of one "作者, 年份" part inside it. */
  start: number
  end: number
  text: string
  author: string
  year: number
}

const GROUP = /[（(]([^()（）\n]{3,200})[)）]/g
const PART = /^\s*(.+?)\s*[,，]\s*(\d{4})[a-z]?\s*$/

export function findCitations(text: string): Citation[] {
  const out: Citation[] = []
  for (const m of text.matchAll(GROUP)) {
    const inner = m[1]
    const innerStart = m.index + 1
    const parts = inner.split(/[;；]/)
    let offset = 0
    const found: Citation[] = []
    let allParts = true
    for (const part of parts) {
      const pm = PART.exec(part)
      if (!pm) {
        allParts = false
        break
      }
      const lead = part.length - part.trimStart().length
      found.push({
        start: innerStart + offset + lead,
        end: innerStart + offset + part.trimEnd().length,
        text: part.trim(),
        author: pm[1],
        year: Number(pm[2]),
      })
      offset += part.length + 1
    }
    if (!allParts) continue
    if (found.length === 1) {
      // A single citation: the link covers the brackets too.
      out.push({ ...found[0], start: m.index, end: m.index + m[0].length, text: m[0] })
    } else {
      out.push(...found)
    }
  }
  return out
}

function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim()
}

/** "Smith et al." → "smith"; "Smith & Lee" → "smith"; "李明等" → "李明". */
function leadName(author: string): string {
  return norm(author)
    .replace(/\bet\s*al\.?/g, '')
    .replace(/等$/, '')
    .split(/\s*(?:&|＆|\band\b|和|与)\s*/)[0]
    .trim()
}

function authorMatches(cited: string, paper: Paper): boolean {
  const name = leadName(cited)
  if (!name) return false
  return paper.authors.some((a) => {
    const full = norm(a)
    if (full === name) return true
    // "Jane Smith" is cited as "Smith"; allow any whole word of the name.
    return full.split(/[\s,.]+/).includes(name)
  })
}

export function matchCitation(c: Citation, candidates: Paper[]): Paper | null {
  const hits = candidates.filter((p) => !p.deleted && p.year === c.year && authorMatches(c.author, p))
  return hits.length === 1 ? hits[0] : null
}

/** Papers a record declared in its `papers:` field that exist in the library. */
export function candidatesFor(dois: string[], papers: Paper[]): Paper[] {
  return papers.filter((p) => !p.deleted && p.doi !== '' && dois.includes(p.doi))
}

/** Rewrites matched citations as Markdown links `[…](#cite:<paper id>)`. Unmatched text is untouched. */
export function linkCitations(text: string, candidates: Paper[]): string {
  if (candidates.length === 0) return text
  let out = ''
  let last = 0
  for (const c of findCitations(text)) {
    const paper = matchCitation(c, candidates)
    if (!paper) continue
    out += text.slice(last, c.start) + `[${c.text.replace(/([[\]])/g, '\\$1')}](#cite:${paper.id})`
    last = c.end
  }
  return out + text.slice(last)
}
