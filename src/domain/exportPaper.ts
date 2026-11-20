// One paper as Markdown: for an AI conversation, for someone else to read, or
// to keep. Pure: the same paper always gives the same text.

import { fieldOfPaper } from './migrate'
import { paperReadings, readingLabel, type ReadingView } from './readings'
import { isEdited } from './library'
import { withImagePlaceholders } from './noteImages'
import type { Comment, CommentSource, Field, HighlightType, ImportEntry, Paper, PaperBlock, Reading } from './types'

export interface PaperExportData {
  paper: Paper
  blocks: PaperBlock[]
  types: HighlightType[]
  comments: Comment[]
  fields: Field[]
  readings?: Reading[]
  imports?: ImportEntry[]
}

export const SOURCE_LABEL: Record<CommentSource, string> = { ai: 'AI 整理', me: '我写的', drawing: '手绘' }

const live = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)

type Highlight = { block: PaperBlock; type?: HighlightType; text: string }

export interface ReadingPart {
  reading: ReadingView
  /** "第 2 次阅读｜原文精读｜2026-11-10" */
  label: string
  highlights: Highlight[]
  others: { block: PaperBlock; heading: string; text: string }[]
  /** Oldest first, so it reads as it grew. */
  understanding: Comment[]
}

/** The parts of a paper in reading order, shared by the paper page, the Markdown and the printed page. */
export function paperParts(data: PaperExportData) {
  const { paper } = data
  const typeById = new Map(live(data.types).map((t) => [t.id, t]))
  const blocks = live(data.blocks)
    .filter((b) => b.paper_id === paper.id)
    .sort((a, b) => a.order - b.order)
  const comments = live(data.comments)
    .filter((c) => c.paper_id === paper.id && (c.text.trim() || c.asset_id))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.created_at ?? a.updated_at) < (b.created_at ?? b.updated_at) ? -1 : 1))
  const pr = paperReadings({ paper, readings: data.readings ?? [], imports: data.imports ?? [], blocks, comments: live(data.comments) })

  // a short name for each highlight card: its type, numbered when a type has several cards in the same reading
  const cardName = new Map<string, string>()
  const readings: ReadingPart[] = pr.list.map((reading) => {
    const mine = blocks.filter((b) => pr.readingOf(b) === reading.id)
    const highlights = mine.filter((b) => b.type_id !== null).map((b) => ({ block: b, type: typeById.get(b.type_id!), text: (b.edited_md ?? b.body_md).trim() }))
    const perType = new Map<string, number>()
    for (const h of highlights) perType.set(h.type?.name ?? '重点', (perType.get(h.type?.name ?? '重点') ?? 0) + 1)
    const seen = new Map<string, number>()
    for (const h of highlights) {
      const name = h.type?.name ?? '重点'
      const n = (seen.get(name) ?? 0) + 1
      seen.set(name, n)
      cardName.set(h.block.id, perType.get(name)! > 1 ? `${name} ${n}` : name)
    }
    return {
      reading,
      label: readingLabel(reading),
      highlights,
      others: mine.filter((b) => b.type_id === null).map((b) => ({ block: b, heading: b.heading || '其他内容', text: (b.edited_md ?? b.body_md).trim() })),
      understanding: comments.filter((c) => pr.readingOf(c) === reading.id),
    }
  })
  const field = fieldOfPaper(paper, data.fields)?.name ?? '未分类'
  /** The card a note is about, if that card still exists. */
  const aboutCard = (c: Comment) => (c.block_id ? cardName.get(c.block_id) : undefined)
  return { paper, readings, field, cardName, aboutCard, readingOf: pr.readingOf }
}

/** 参考价值 as names, in the types' order, "Full" last. Types since removed are left out. */
export function paperValue(paper: Paper, types: HighlightType[]): string[] {
  const chosen = new Set(paper.value_types ?? [])
  const names = live(types).filter((t) => chosen.has(t.id)).sort((a, b) => a.order - b.order).map((t) => t.name)
  return paper.value_full ? [...names, 'Full'] : names
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-11-10 14:05" for a note written here; just the date for an imported or older one (no time is made up). */
export function noteStamp(c: Pick<Comment, 'date' | 'created_at'>): string {
  if (!c.created_at) return c.date
  const d = new Date(c.created_at)
  if (Number.isNaN(d.getTime())) return c.date
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function exportPaper(data: PaperExportData): string {
  const { paper, readings, field, cardName, aboutCard } = paperParts(data)
  const out: string[] = [`# ${paper.title || paper.doi || '（没有标题）'}`, '']

  const info: string[] = []
  if (paper.authors.length > 0) info.push(`- 作者：${paper.authors.join(', ')}`)
  if (paper.year !== null) info.push(`- 年份：${paper.year}`)
  if (paper.venue) info.push(`- 期刊/会议：${paper.venue}`)
  if (paper.doi) info.push(`- DOI：${paper.doi}`)
  if (paper.url) info.push(`- 链接：${paper.url}`)
  info.push(`- 领域：${field}`)
  const value = paperValue(paper, data.types)
  if (value.length > 0) info.push(`- 参考价值：${value.join('、')}`)
  if (!isEdited(paper, data.blocks, data.comments)) info.push('- 状态：未编辑（还没有阅读笔记）')
  if (paper.why) info.push(`- 为什么想看：${paper.why}`)
  out.push(...info, '')

  if (paper.one_liner.trim()) out.push('## 一句话总结', '', paper.one_liner.trim(), '')
  if (paper.basics_md.trim()) out.push('## 基础', '', withImagePlaceholders(paper.basics_md.trim()), '')

  for (const r of readings) {
    const empty = r.highlights.length + r.others.length + r.understanding.length === 0
    if (empty && !r.reading.row) continue // the first reading the page shows for a paper with nothing in it yet
    out.push(`## ${r.label}`, '')
    if (empty) out.push('（这次还没有内容）', '')
    for (const h of r.highlights) out.push(`### ${cardName.get(h.block.id) ?? h.type?.name ?? '重点'}`, '', withImagePlaceholders(h.text), '')
    for (const o of r.others) out.push(`### ${o.heading}`, '', withImagePlaceholders(o.text), '')
    if (r.understanding.length > 0) {
      out.push('### 我的理解', '')
      for (const c of r.understanding) {
        const about = aboutCard(c)
        out.push(`#### ${noteStamp(c)} · ${SOURCE_LABEL[c.source]}${about ? ` · 对应重点：${about}` : ''}`, '')
        out.push(c.source === 'drawing' || (!c.text.trim() && c.asset_id) ? `[手绘图片：${c.date}]` : withImagePlaceholders(c.text.trim()), '')
      }
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
