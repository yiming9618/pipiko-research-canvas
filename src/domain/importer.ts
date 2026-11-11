// Turns a pasted Markdown into a set of changes to store. Pure: it reads a
// snapshot and returns what to write, so the same paste gives the same result.

import { normalizeInput } from '../parser/frontmatter'
import { parseMarkdown, type ParsedPaper, type ParsedResearch } from '../parser'
import { SIMILAR_ENOUGH, titleSimilarity } from './similar'
import {
  BUILTIN_TYPES,
  DEFAULT_TYPE_COLOR,
  type Card,
  type Changes,
  type Comment,
  type HighlightType,
  type ImportEntry,
  type ImportKind,
  type ISODate,
  type ISODateTime,
  type Paper,
  type PaperBlock,
  type PaperFillable,
  type PaperImportEffects,
  type ResearchRecord,
} from './types'

export interface ImportContext {
  papers: Paper[]
  types: HighlightType[]
  blocks: PaperBlock[]
  imports: ImportEntry[]
  today: ISODate
  now: ISODateTime
  kindHint: ImportKind
  newId: (prefix: string) => string
}

export interface ImportOutcome {
  /** False when nothing was stored (the same text was already imported). */
  stored: boolean
  message: string
  notices: string[]
  changes: Changes
  entry?: ImportEntry
  /** A paper import that matched nothing, but a "想看" entry has a similar title: ask before merging. */
  similar?: { paper_id: string; want_id: string; want_title: string }
}

/** Small stable string hash (cyrb53), used to spot an identical paste. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function normalizeTypeName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

export function shortDate(date: ISODate): string {
  const [, m, d] = date.split('-')
  return `${Number(m)}/${Number(d)}`
}

export function builtinTypes(): HighlightType[] {
  return BUILTIN_TYPES.map((t, i) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    builtin: true,
    aliases: [],
    order: i,
    // Fixed timestamp: every device creates identical rows, so nothing to merge.
    updated_at: '2000-01-01T00:00:00.000Z',
  }))
}

/** DOI match first; a paper without a DOI (or an incoming one without) matches by title. */
export function findPaper(papers: Paper[], doi: string, title: string): Paper | undefined {
  const live = papers.filter((p) => !p.deleted)
  if (doi) {
    const byDoi = live.find((p) => p.doi === doi)
    if (byDoi) return byDoi
  }
  const t = normalizeTitle(title)
  if (!t) return undefined
  return live.find((p) => normalizeTitle(p.title) === t && (!doi || !p.doi))
}

export function planImport(raw: string, ctx: ImportContext): ImportOutcome {
  const normalized = normalizeInput(raw).trim()
  if (normalized === '') {
    return { stored: false, message: '没有内容，什么都没放进去', notices: [], changes: {} }
  }
  const raw_hash = hashText(normalized)
  const dup = ctx.imports.find((e) => e.raw_hash === raw_hash && !e.undone && !e.deleted)
  if (dup) {
    return {
      stored: false,
      message: `这份内容已经导入过了（${shortDate(dup.date)}），没有重复生成`,
      notices: [],
      changes: {},
    }
  }

  const parsed = parseMarkdown(raw, { today: ctx.today, kindHint: ctx.kindHint })
  const entry: ImportEntry = {
    id: ctx.newId('imp'),
    kind: parsed.kind,
    raw_md: raw,
    raw_hash,
    date: parsed.date,
    imported_at: ctx.now,
    notices: parsed.notices,
    message: '',
    updated_at: ctx.now,
  }
  let similar: ImportOutcome['similar']
  let changes: Changes
  if (parsed.kind === 'paper') {
    const out = importPaper(parsed, entry, ctx)
    changes = out.changes
    similar = out.similar
  } else {
    changes = importResearch(parsed, entry, ctx)
  }
  changes.imports = [entry]
  return { stored: true, message: entry.message, notices: parsed.notices, changes, entry, similar }
}

function importResearch(parsed: ParsedResearch, entry: ImportEntry, ctx: ImportContext): Changes {
  const record: ResearchRecord = {
    id: ctx.newId('rec'),
    date: parsed.date,
    title: parsed.title,
    summary: parsed.summary,
    activities: parsed.activities,
    keywords: parsed.keywords,
    paper_dois: parsed.paper_dois,
    preamble_md: parsed.preamble_md,
    import_id: entry.id,
    updated_at: ctx.now,
  }
  const cards: Card[] = parsed.cards.map((c, i) => ({
    id: ctx.newId('card'),
    record_id: record.id,
    date: parsed.date,
    kind: c.kind,
    heading: c.heading,
    body_md: c.body_md,
    order: i,
    import_id: entry.id,
    updated_at: ctx.now,
  }))
  entry.record_id = record.id
  const where = `${shortDate(parsed.date)} 的画板`
  entry.message =
    cards.length > 0 ? `生成了 ${cards.length} 张卡片，放进 ${where}` : `只有封面，放进 ${where}`

  // Papers the record names that the library does not have go to "想看", marked as mentioned by the AI.
  const papers: Paper[] = []
  const created: string[] = []
  const mentioned: string[] = []
  const source = { date: parsed.date, record_id: record.id }
  for (const doi of [...new Set(parsed.paper_dois)]) {
    const have = ctx.papers.find((p) => !p.deleted && p.doi === doi)
    if (!have) {
      const id = ctx.newId('paper')
      papers.push({
        id,
        title: '',
        authors: [],
        year: null,
        venue: '',
        doi,
        category: '',
        keywords: [],
        status: 'want',
        url: '',
        one_liner: '',
        basics_md: '',
        created_at: ctx.now,
        updated_at: ctx.now,
        why: '',
        added_by: 'ai',
        mentioned_in: [source],
        lookup: 'pending',
      })
      created.push(id)
    } else if (have.status === 'want' && have.added_by === 'ai') {
      papers.push({ ...have, mentioned_in: [...(have.mentioned_in ?? []), source], updated_at: ctx.now })
      mentioned.push(have.id)
    }
  }
  if (created.length > 0) {
    entry.wants_created = created
    entry.message += `；提到的 ${created.length} 篇论文库里没有，已加进"想看"`
  }
  if (mentioned.length > 0) entry.mentions_added = mentioned
  return { records: [record], cards, ...(papers.length > 0 ? { papers } : {}) }
}

function importPaper(
  parsed: ParsedPaper,
  entry: ImportEntry,
  ctx: ImportContext,
): { changes: Changes; similar?: ImportOutcome['similar'] } {
  const existing = findPaper(ctx.papers, parsed.doi, parsed.title)
  const effects: PaperImportEffects = {
    paper_created: !existing,
    filled: [],
    keywords_added: [],
    types_created: [],
  }

  let paper: Paper
  if (!existing) {
    paper = {
      id: ctx.newId('paper'),
      title: parsed.title,
      authors: parsed.authors,
      year: parsed.year,
      venue: parsed.venue,
      doi: parsed.doi,
      category: parsed.category,
      keywords: parsed.keywords,
      status: 'read',
      url: '',
      one_liner: parsed.one_liner,
      basics_md: parsed.basics_md,
      created_at: ctx.now,
      updated_at: ctx.now,
    }
  } else {
    paper = { ...existing, updated_at: ctx.now }
    const wasWant = existing.status === 'want'
    if (wasWant) {
      effects.want_before = { title: existing.title, url: existing.url }
      paper.status = 'read'
      // A "想看" entry only has a rough title; take the full one from the paper.
      if (parsed.title) paper.title = parsed.title
    }
    // Existing content is never overwritten; only empty fields are filled.
    const fill = <K extends PaperFillable>(key: K, value: Paper[K], empty: boolean) => {
      const has = Array.isArray(value) ? value.length > 0 : value !== '' && value !== null
      if (empty && has) {
        paper[key] = value
        effects.filled.push(key)
      }
    }
    if (!wasWant) fill('title', parsed.title, existing.title === '')
    fill('authors', parsed.authors, existing.authors.length === 0)
    fill('year', parsed.year, existing.year === null)
    fill('venue', parsed.venue, existing.venue === '')
    fill('doi', parsed.doi, existing.doi === '')
    fill('category', parsed.category, existing.category === '')
    fill('one_liner', parsed.one_liner, existing.one_liner === '')
    fill('basics_md', parsed.basics_md, existing.basics_md === '')
    effects.keywords_added = parsed.keywords.filter((k) => !existing.keywords.includes(k))
    paper.keywords = [...existing.keywords, ...effects.keywords_added]
  }

  const types = [...ctx.types]
  const newTypes: HighlightType[] = []
  const typeIdFor = (name: string): string => {
    const key = normalizeTypeName(name)
    const found = types.find(
      (t) =>
        !t.deleted &&
        (normalizeTypeName(t.name) === key || t.aliases.some((a) => normalizeTypeName(a) === key)),
    )
    if (found) return found.id
    const created: HighlightType = {
      id: ctx.newId('type'),
      name,
      color: DEFAULT_TYPE_COLOR,
      builtin: false,
      aliases: [],
      order: types.length,
      updated_at: ctx.now,
    }
    types.push(created)
    newTypes.push(created)
    effects.types_created.push(created.id)
    return created.id
  }

  const startOrder = ctx.blocks
    .filter((b) => b.paper_id === paper.id)
    .reduce((max, b) => Math.max(max, b.order + 1), 0)
  const blocks: PaperBlock[] = parsed.blocks.map((b, i) => ({
    id: ctx.newId('block'),
    paper_id: paper.id,
    type_id: b.type_name === null ? null : typeIdFor(b.type_name),
    heading: b.heading,
    body_md: b.body_md,
    import_id: entry.id,
    order: startOrder + i,
    updated_at: ctx.now,
  }))

  const comments: Comment[] = parsed.understanding_md
    ? [
        {
          id: ctx.newId('cmt'),
          paper_id: paper.id,
          date: parsed.date,
          source: 'ai',
          text: parsed.understanding_md,
          import_id: entry.id,
          updated_at: ctx.now,
        },
      ]
    : []

  entry.paper_id = paper.id
  entry.effects = effects

  const highlights = blocks.filter((b) => b.type_id !== null).length
  const parts: string[] = []
  if (!existing) parts.push('1 篇论文放进论文库')
  else if (effects.want_before) parts.push('1 篇论文从"想看"移到"已读"')
  else parts.push('1 篇论文已合并')
  if (highlights > 0) parts.push(`${existing ? '追加' : '生成'}了 ${highlights} 个重点区块`)
  if (comments.length > 0) parts.push('1 条理解')
  if (newTypes.length > 0) parts.push(`新的重点类型：${newTypes.map((t) => t.name).join('、')}`)
  if (existing && parsed.basics_md && !effects.filled.includes('basics_md')) {
    parts.push('基础部分已有内容，没有覆盖')
  }
  entry.message = parts.join('；')

  // Nothing matched by DOI or exact title. A "想看" entry with a similar title might be this paper: ask.
  let similar: ImportOutcome['similar']
  if (!existing) {
    const candidates = ctx.papers
      .filter((p) => !p.deleted && p.status === 'want' && p.title !== '' && !(parsed.doi && p.doi && p.doi !== parsed.doi))
      .map((p) => ({ p, score: titleSimilarity(p.title, parsed.title) }))
      .filter((c) => c.score >= SIMILAR_ENOUGH)
      .sort((a, b) => b.score - a.score || (a.p.id < b.p.id ? -1 : 1))
    if (candidates.length > 0) {
      similar = { paper_id: paper.id, want_id: candidates[0].p.id, want_title: candidates[0].p.title }
    }
  }

  return { changes: { papers: [paper], blocks, comments, types: newTypes }, similar }
}
