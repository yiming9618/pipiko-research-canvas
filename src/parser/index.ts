// Markdown in, structured data out. No guessing, no rewriting: the same
// input always gives the same result, and anything unrecognised is kept.

import type { CardKind, ImportKind, ISODate } from '../domain/types'
import { CARD_KINDS } from '../domain/types'
import { normalizeInput, parseDate, parseFrontmatter, splitList } from './frontmatter'
import { isEmptyBody, splitSections } from './sections'

export interface ParsedPaper {
  kind: 'paper'
  date: ISODate
  title: string
  authors: string[]
  year: number | null
  venue: string
  doi: string
  category: string
  keywords: string[]
  one_liner: string
  basics_md: string
  /** `type_name` is null for sections the parser does not recognise. */
  blocks: { type_name: string | null; heading: string; body_md: string }[]
  understanding_md: string
  notices: string[]
}

export interface ParsedResearch {
  kind: 'research'
  date: ISODate
  title: string
  summary: string
  activities: string[]
  keywords: string[]
  paper_dois: string[]
  preamble_md: string
  cards: { kind: CardKind; heading: string; body_md: string }[]
  notices: string[]
}

export type Parsed = ParsedPaper | ParsedResearch

export interface ParseOptions {
  today: ISODate
  /** The button chosen in the paste panel; used when the Markdown has no `type`. */
  kindHint: ImportKind
}

const TYPE_WORDS: Record<string, ImportKind> = {
  paper: 'paper',
  论文: 'paper',
  research: 'research',
  研究记录: 'research',
  研究: 'research',
}

export function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi\s*[:：]\s*/, '')
    .replace(/[\s.,;]+$/, '')
}

const HIGHLIGHT_HEADING = /^重点\s*(?:[:：]\s*(.*))?$/

export function parseMarkdown(raw: string, opts: ParseOptions): Parsed {
  const text = normalizeInput(raw)
  const fm = parseFrontmatter(text)
  const notices: string[] = []
  if (!fm.found) notices.push('没有找到开头的信息区（frontmatter），用了默认值')

  const declared = fm.data.type ? TYPE_WORDS[fm.data.type.trim().toLowerCase()] : undefined
  let kind: ImportKind = opts.kindHint
  if (declared) {
    kind = declared
    if (declared !== opts.kindHint) {
      notices.push(`内容里写的是${declared === 'paper' ? '论文' : '研究记录'}，已按它处理`)
    }
  } else if (fm.data.type) {
    notices.push(`不认识的 type「${fm.data.type}」，按选中的类型处理`)
  }

  let date = parseDate(fm.data.date)
  if (!date) {
    date = opts.today
    notices.push(fm.data.date ? `看不懂日期「${fm.data.date}」，用了今天` : '没有写日期，用了今天')
  }

  const { preamble, sections } = splitSections(fm.body)
  return kind === 'paper'
    ? parsePaper(fm.data, date, preamble, sections, notices)
    : parseResearch(fm.data, date, preamble, sections, notices)
}

function parsePaper(
  data: Record<string, string>,
  date: ISODate,
  preamble: string,
  sections: { heading: string; body: string }[],
  notices: string[],
): ParsedPaper {
  const title = data.title ?? ''
  if (!title) notices.push('没有写论文标题')

  let year: number | null = null
  if (data.year) {
    const m = /\d{4}/.exec(data.year)
    if (m) year = Number(m[0])
    else notices.push(`看不懂年份「${data.year}」`)
  }

  const paper: ParsedPaper = {
    kind: 'paper',
    date,
    title,
    authors: splitList(data.authors),
    year,
    venue: data.venue ?? '',
    doi: normalizeDoi(data.doi ?? ''),
    category: data.category ?? '',
    keywords: splitList(data.keywords),
    one_liner: '',
    basics_md: '',
    blocks: [],
    understanding_md: '',
    notices,
  }

  const join = (a: string, b: string) => (a ? `${a}\n\n${b}` : b)

  if (!isEmptyBody(preamble)) {
    paper.blocks.push({ type_name: null, heading: '', body_md: preamble })
  }
  for (const s of sections) {
    if (isEmptyBody(s.body)) continue
    const highlight = HIGHLIGHT_HEADING.exec(s.heading)
    if (s.heading === '一句话总结') {
      paper.one_liner = join(paper.one_liner, s.body)
    } else if (s.heading === '基础') {
      paper.basics_md = join(paper.basics_md, s.body)
    } else if (s.heading === '我的理解') {
      paper.understanding_md = join(paper.understanding_md, s.body)
    } else if (highlight) {
      const name = (highlight[1] ?? '').trim()
      paper.blocks.push({ type_name: name || '未命名', heading: s.heading, body_md: s.body })
    } else {
      paper.blocks.push({ type_name: null, heading: s.heading, body_md: s.body })
    }
  }
  return paper
}

function parseResearch(
  data: Record<string, string>,
  date: ISODate,
  preamble: string,
  sections: { heading: string; body: string }[],
  notices: string[],
): ParsedResearch {
  const kinds: readonly string[] = CARD_KINDS
  const cards: ParsedResearch['cards'] = []
  for (const s of sections) {
    if (isEmptyBody(s.body)) continue
    const kind = kinds.includes(s.heading) ? (s.heading as CardKind) : '其他'
    cards.push({ kind, heading: s.heading, body_md: s.body })
  }
  const title = data.title ?? ''
  if (!title) notices.push('没有写标题')
  return {
    kind: 'research',
    date,
    title,
    summary: data.summary ?? '',
    activities: splitList(data.activities),
    keywords: splitList(data.keywords),
    paper_dois: splitList(data.papers).map(normalizeDoi).filter(Boolean),
    preamble_md: isEmptyBody(preamble) ? '' : preamble,
    cards,
    notices,
  }
}
