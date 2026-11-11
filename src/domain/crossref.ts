// Reading bibliographic details from Crossref's public DOI lookup
// (api.crossref.org). A plain catalogue query: same DOI, same answer.

import type { Paper } from './types'

export interface BibInfo {
  title: string
  authors: string[]
  year: number | null
  venue: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Crossref titles sometimes carry markup (<i>, &amp;) and line breaks. */
function clean(text: unknown): string {
  if (typeof text !== 'string') return ''
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole
      }
      return ENTITIES[code.toLowerCase()] ?? whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v)

/** Returns null when the answer is not a usable work record. */
export function parseCrossref(json: unknown): BibInfo | null {
  const m = (json as { message?: Record<string, unknown> } | null)?.message
  if (!m || typeof m !== 'object') return null
  const authors = Array.isArray(m.author)
    ? (m.author as Record<string, unknown>[])
        .map((a) => clean(a.name) || [clean(a.given), clean(a.family)].filter(Boolean).join(' '))
        .filter(Boolean)
    : []
  let year: number | null = null
  for (const key of ['issued', 'published', 'published-print', 'published-online', 'created']) {
    const y = (m[key] as { 'date-parts'?: unknown[][] } | undefined)?.['date-parts']?.[0]?.[0]
    if (typeof y === 'number' && y > 1000) {
      year = y
      break
    }
  }
  const info: BibInfo = {
    title: clean(first(m.title)),
    authors,
    year,
    venue: clean(first(m['container-title'])) || clean(m.publisher),
  }
  return info.title || info.authors.length > 0 ? info : null
}

/** Fills only what is empty; anything already written stays. */
export function fillFromLookup(paper: Paper, info: BibInfo): Paper {
  return {
    ...paper,
    title: paper.title || info.title,
    authors: paper.authors.length > 0 ? paper.authors : info.authors,
    year: paper.year ?? info.year,
    venue: paper.venue || info.venue,
  }
}

/** Finds a DOI inside whatever was typed or pasted: a bare DOI, "doi: …", or a doi.org / publisher link. */
export function extractDoi(text: string): string {
  const m = text.normalize('NFKC').match(/10\.\d{4,9}\/[^\s"'<>]+/)
  if (!m) return ''
  let doi = m[0]
  try {
    doi = decodeURIComponent(doi)
  } catch {
    // keep as typed
  }
  return doi.replace(/[.,;:)\]]+$/, '').toLowerCase()
}

export const needsLookup = (p: Paper) => !p.deleted && p.doi !== '' && p.lookup === 'pending'

/** Details still missing that a lookup could supply. */
export const incomplete = (p: Pick<Paper, 'title' | 'authors' | 'year' | 'venue'>) =>
  p.title === '' || p.authors.length === 0 || p.year === null || p.venue === ''
