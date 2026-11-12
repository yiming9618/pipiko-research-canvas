// Global search: date + type + keywords, in any order, typed or dictated.
// Everything here is plain matching. Nothing is guessed or ranked by a model.

import { CARD_KINDS, type BoardRefType, type CardKind, type ISODate } from './types'

export interface DateFilter {
  y?: number
  m?: number
  d?: number
}

export type KindFilter =
  | { kind: 'paper' }
  | { kind: 'record' }
  | { kind: 'card'; card: CardKind }
  | { kind: 'block'; typeId: string }

export interface Query {
  dates: DateFilter[]
  kinds: KindFilter[]
  /** All must appear (lower-cased). */
  terms: string[]
}

/** A highlight type and every name it answers to (current name and old ones). */
export interface TypeNames {
  id: string
  names: string[]
}

export type DocKind = 'paper' | 'block' | 'comment' | 'record' | 'card' | 'pile' | 'board'

export interface Doc {
  key: string
  kind: DocKind
  cardKind?: CardKind
  typeId?: string
  /** Dates this thing belongs to (a paper can have several: each time it was read). */
  dates: ISODate[]
  title: string
  keywords: string
  body: string
  /** Extra text that only counts when searching papers as a whole (their blocks and comments). */
  deep?: string
  /** Shown on the result: "论文", "问题", "研究方法" … */
  label: string
  color: string
  href: string
  /** What dragging the result onto a board shows there. */
  ref: { type: BoardRefType; id: string } | null
}

export interface Hit {
  doc: Doc
  score: number
  snippet: { before: string; match: string; after: string } | null
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase()
const squash = (s: string) => norm(s).replace(/\s+/g, '')

const CN: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 一 … 三十一 → number; anything else → null. Dictation sometimes writes dates this way. */
export function chineseNumber(s: string): number | null {
  if (s in CN) return CN[s]
  const m = /^([二三]?)十([一二三四五六七八九]?)$/.exec(s)
  if (!m) return null
  return (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0)
}

function shiftDay(today: ISODate, days: number): DateFilter {
  const d = new Date(`${today}T12:00:00`)
  d.setDate(d.getDate() + days)
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }
}

function shiftMonth(today: ISODate, months: number): DateFilter {
  const d = new Date(`${today.slice(0, 7)}-01T12:00:00`)
  d.setMonth(d.getMonth() + months)
  return { y: d.getFullYear(), m: d.getMonth() + 1 }
}

const validMonth = (m: number) => m >= 1 && m <= 12
const validDay = (d: number) => d >= 1 && d <= 31
const validYear = (y: number) => y >= 1900 && y <= 2100

export function parseQuery(input: string, types: TypeNames[], today: ISODate): Query {
  const q: Query = { dates: [], kinds: [], terms: [] }
  let text = input.normalize('NFKC')

  // "…" keeps a phrase as a plain keyword, even if it looks like a type or a date.
  text = text.replace(/["“「]([^"”」]+)["”」]/g, (_, phrase: string) => {
    const t = norm(phrase).trim()
    if (t) q.terms.push(t)
    return ' '
  })

  const year = Number(today.slice(0, 4))
  const words: [RegExp, () => DateFilter][] = [
    [/今天/g, () => shiftDay(today, 0)],
    [/昨天/g, () => shiftDay(today, -1)],
    [/前天/g, () => shiftDay(today, -2)],
    [/(?:这个月|本月)/g, () => shiftMonth(today, 0)],
    [/上个月/g, () => shiftMonth(today, -1)],
    [/今年/g, () => ({ y: year })],
    [/去年/g, () => ({ y: year - 1 })],
  ]
  for (const [re, make] of words) {
    text = text.replace(re, () => {
      q.dates.push(make())
      return ' '
    })
  }

  // 十一月十日 → 11月10日
  text = text.replace(/([一二三四五六七八九十]{1,3})(月|日|号)/g, (whole, n: string, unit: string) => {
    const value = chineseNumber(n)
    return value === null ? whole : `${value}${unit}`
  })

  const take = (re: RegExp, make: (m: RegExpExecArray) => DateFilter | null) => {
    text = text.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray
      const filter = make(m)
      if (!filter) return args[0] as string
      q.dates.push(filter)
      return ' '
    })
  }
  const n = (s: string) => Number(s)
  // Most specific first. (?<![\d.]) and (?!\d) keep numbers inside a DOI from reading as dates.
  take(/(?<![\d.])(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*[日号]?(?!\d)/g, (m) =>
    validYear(n(m[1])) && validMonth(n(m[2])) && validDay(n(m[3])) ? { y: n(m[1]), m: n(m[2]), d: n(m[3]) } : null,
  )
  take(/(?<![\d.])(\d{4})\s*[-/年]\s*(\d{1,2})\s*月?(?!\d)/g, (m) =>
    validYear(n(m[1])) && validMonth(n(m[2])) ? { y: n(m[1]), m: n(m[2]) } : null,
  )
  take(/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?(?!\d)/g, (m) =>
    validMonth(n(m[1])) && validDay(n(m[2])) ? { m: n(m[1]), d: n(m[2]) } : null,
  )
  take(/(?<![\d./])(\d{1,2})\/(\d{1,2})(?![\d/])/g, (m) =>
    validMonth(n(m[1])) && validDay(n(m[2])) ? { m: n(m[1]), d: n(m[2]) } : null,
  )
  take(/(?<!\d)(\d{4})\s*年/g, (m) => (validYear(n(m[1])) ? { y: n(m[1]) } : null))
  take(/(?<!\d)(\d{1,2})\s*月(?!\d)/g, (m) => (validMonth(n(m[1])) ? { m: n(m[1]) } : null))

  // Type words. Card kinds win over a highlight type that happens to contain the same word.
  const typeWords = new Map<string, KindFilter>()
  for (const t of types) {
    for (const name of t.names) {
      typeWords.set(squash(name), { kind: 'block', typeId: t.id })
      // "研究主旨/贡献" also answers to "研究主旨" and "贡献"
      for (const part of name.split(/[/&＆]/)) {
        const key = squash(part)
        if (key && !typeWords.has(key)) typeWords.set(key, { kind: 'block', typeId: t.id })
      }
    }
  }
  for (const word of ['论文', 'paper']) typeWords.set(word, { kind: 'paper' })
  for (const word of ['记录', '研究记录']) typeWords.set(word, { kind: 'record' })
  for (const kind of CARD_KINDS) typeWords.set(kind, { kind: 'card', card: kind })

  for (const raw of text.split(/[\s,，、;；。]+/)) {
    // "11月10日的问题" leaves "的问题" behind
    const token = raw.replace(/^的+|的+$/g, '')
    if (!token) continue
    if (/^(19|20)\d{2}$/.test(token)) {
      q.dates.push({ y: Number(token) })
      continue
    }
    const kind = typeWords.get(squash(token))
    if (kind) {
      if (!q.kinds.some((k) => JSON.stringify(k) === JSON.stringify(kind))) q.kinds.push(kind)
    } else {
      q.terms.push(norm(token))
    }
  }
  return q
}

export function isEmptyQuery(q: Query): boolean {
  return q.dates.length === 0 && q.kinds.length === 0 && q.terms.length === 0
}

function dateMatches(date: ISODate, f: DateFilter): boolean {
  const [y, m, d] = date.split('-').map(Number)
  return (f.y === undefined || f.y === y) && (f.m === undefined || f.m === m) && (f.d === undefined || f.d === d)
}

function kindMatches(doc: Doc, k: KindFilter): boolean {
  switch (k.kind) {
    case 'paper':
      return doc.kind === 'paper'
    case 'record':
      return doc.kind === 'record'
    case 'card':
      return doc.kind === 'card' && doc.cardKind === k.card
    case 'block':
      return doc.kind === 'block' && doc.typeId === k.typeId
  }
}

function snippetOf(text: string, term: string): Hit['snippet'] {
  const at = norm(text).indexOf(term)
  if (at < 0) return null
  const start = Math.max(0, at - 24)
  const end = Math.min(text.length, at + term.length + 48)
  const clean = (s: string) => s.replace(/\s+/g, ' ')
  return {
    before: (start > 0 ? '…' : '') + clean(text.slice(start, at)),
    match: text.slice(at, at + term.length),
    after: clean(text.slice(at + term.length, end)) + (end < text.length ? '…' : ''),
  }
}

/**
 * Dates: any of them. Types: any of them. Keywords: all of them.
 * Order: matches in the title first, then keywords, then body; newest first within that.
 */
export function runSearch(docs: Doc[], q: Query): Hit[] {
  if (isEmptyQuery(q)) return []
  const wantsPaper = q.kinds.some((k) => k.kind === 'paper')
  const hits: Hit[] = []

  for (const doc of docs) {
    if (q.kinds.length > 0 && !q.kinds.some((k) => kindMatches(doc, k))) continue
    if (q.dates.length > 0 && !doc.dates.some((date) => q.dates.some((f) => dateMatches(date, f)))) continue

    const title = norm(doc.title)
    const keywords = norm(doc.keywords)
    const body = norm(doc.body)
    const deep = wantsPaper && doc.deep ? norm(doc.deep) : ''
    let score = 0
    let all = true
    for (const term of q.terms) {
      if (title.includes(term)) score += 3
      else if (keywords.includes(term)) score += 2
      else if (body.includes(term) || deep.includes(term)) score += 1
      else {
        all = false
        break
      }
    }
    if (!all) continue

    let snippet: Hit['snippet'] = null
    for (const term of q.terms) {
      snippet = snippetOf(doc.body, term) ?? (deep ? snippetOf(doc.deep!, term) : null) ?? snippetOf(doc.keywords, term)
      if (snippet) break
    }
    hits.push({ doc, score, snippet })
  }

  const latest = (d: Doc) => d.dates.reduce((max, x) => (x > max ? x : max), '')
  return hits.sort((a, b) => b.score - a.score || (latest(a.doc) < latest(b.doc) ? 1 : latest(a.doc) > latest(b.doc) ? -1 : 0))
}
