// One paper as Markdown: for an AI conversation, for someone else to read, or
// to keep. Pure: the same paper always gives the same text.

import { fieldOfPaper } from './migrate'
import type { Comment, CommentSource, Field, HighlightType, Paper, PaperBlock } from './types'

export interface PaperExportData {
  paper: Paper
  blocks: PaperBlock[]
  types: HighlightType[]
  comments: Comment[]
  fields: Field[]
}

export const SOURCE_LABEL: Record<CommentSource, string> = { ai: 'AI 整理', me: '我写的', drawing: '手绘' }

const live = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)

/** The parts of a paper in reading order, shared by the Markdown and the printed page. */
export function paperParts(data: PaperExportData) {
  const { paper } = data
  const typeById = new Map(live(data.types).map((t) => [t.id, t]))
  const blocks = live(data.blocks)
    .filter((b) => b.paper_id === paper.id)
    .sort((a, b) => a.order - b.order)
  const highlights = blocks
    .filter((b) => b.type_id !== null)
    .map((b) => ({ block: b, type: typeById.get(b.type_id!), text: (b.edited_md ?? b.body_md).trim() }))
  const others = blocks.filter((b) => b.type_id === null).map((b) => ({ block: b, heading: b.heading || '其他内容', text: (b.edited_md ?? b.body_md).trim() }))
  // understanding, oldest first, so it reads as it grew
  const understanding = live(data.comments)
    .filter((c) => c.paper_id === paper.id && (c.text.trim() || c.asset_id))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.created_at ?? a.updated_at) < (b.created_at ?? b.updated_at) ? -1 : 1))
  const field = fieldOfPaper(paper, data.fields)?.name ?? '未分类'
  // a short name for each highlight card: its type, numbered when a type has several cards
  const cardName = new Map<string, string>()
  const perType = new Map<string, number>()
  for (const h of highlights) perType.set(h.type?.name ?? '重点', (perType.get(h.type?.name ?? '重点') ?? 0) + 1)
  const seen = new Map<string, number>()
  for (const h of highlights) {
    const name = h.type?.name ?? '重点'
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    cardName.set(h.block.id, perType.get(name)! > 1 ? `${name} ${n}` : name)
  }
  /** The card a note is about, if that card still exists. */
  const aboutCard = (c: Comment) => (c.block_id ? cardName.get(c.block_id) : undefined)
  return { paper, highlights, others, understanding, field, cardName, aboutCard }
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
  const { paper, highlights, others, understanding, field, cardName, aboutCard } = paperParts(data)
  const out: string[] = [`# ${paper.title || paper.doi || '（没有标题）'}`, '']

  const info: string[] = []
  if (paper.authors.length > 0) info.push(`- 作者：${paper.authors.join(', ')}`)
  if (paper.year !== null) info.push(`- 年份：${paper.year}`)
  if (paper.venue) info.push(`- 期刊/会议：${paper.venue}`)
  if (paper.doi) info.push(`- DOI：${paper.doi}`)
  if (paper.url) info.push(`- 链接：${paper.url}`)
  info.push(`- 领域：${field}`)
  if (paper.status === 'want') info.push('- 状态：想看（还没读）')
  if (paper.why) info.push(`- 为什么想看：${paper.why}`)
  out.push(...info, '')

  if (paper.one_liner.trim()) out.push('## 一句话总结', '', paper.one_liner.trim(), '')
  if (paper.basics_md.trim()) out.push('## 基础', '', paper.basics_md.trim(), '')

  if (highlights.length > 0) {
    out.push('## 重点', '')
    for (const h of highlights) out.push(`### ${cardName.get(h.block.id) ?? h.type?.name ?? '重点'}`, '', h.text, '')
  }
  for (const o of others) out.push(`## ${o.heading}`, '', o.text, '')

  if (understanding.length > 0) {
    out.push('## 我的理解', '')
    for (const c of understanding) {
      const about = aboutCard(c)
      out.push(`### ${noteStamp(c)} · ${SOURCE_LABEL[c.source]}${about ? ` · 对应重点：${about}` : ''}`, '')
      out.push(c.source === 'drawing' || (!c.text.trim() && c.asset_id) ? `[手绘图片：${c.date}]` : c.text.trim(), '')
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
