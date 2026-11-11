// "导出给 AI": turns a discussion box into one Markdown text for the clipboard.
// Pure: the same box and the same notebook always give the same text.

import { candidatesFor, findCitations, matchCitation } from './citations'
import { PAPER_PROMPT, RESEARCH_PROMPT } from './templates'
import type {
  BoardItem,
  Card,
  Connector,
  Discussion,
  DiscussionItem,
  HighlightType,
  ImportEntry,
  Paper,
  PaperBlock,
  Pile,
  ResearchRecord,
  Stroke,
} from './types'

export interface ExportData {
  box: Discussion
  /** The box's items, in the order they were added. */
  items: DiscussionItem[]
  papers: Paper[]
  blocks: PaperBlock[]
  types: HighlightType[]
  records: ResearchRecord[]
  cards: Card[]
  boardItems: BoardItem[]
  connectors: Connector[]
  strokes: Stroke[]
  piles: Pile[]
  imports: ImportEntry[]
}

export const INTRO_ONE_PAPER = '请用我的五个问题带我读这篇论文。'
export const INTRO_PAPERS = '请先帮我理清这些论文之间的关系，再建议从哪篇开始读。'
export const INTRO_RESEARCH = '这是我最近的研究进展，请和我一起讨论。'

/** Which opening line fits what is in the box. */
export function chooseIntro(items: Pick<DiscussionItem, 'ref_type'>[]): string {
  if (items.some((i) => i.ref_type !== 'paper')) return INTRO_RESEARCH
  return items.length === 1 ? INTRO_ONE_PAPER : INTRO_PAPERS
}

const live = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)
const oneLine = (text: string, max = 60) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

export function buildExport(data: ExportData): string {
  const papers = live(data.papers)
  const paperById = new Map(papers.map((p) => [p.id, p]))
  const records = live(data.records)
  const recordById = new Map(records.map((r) => [r.id, r]))
  const cards = live(data.cards)
  const cardById = new Map(cards.map((c) => [c.id, c]))
  const pileById = new Map(live(data.piles).map((p) => [p.id, p]))
  const typeById = new Map(live(data.types).map((t) => [t.id, t]))
  const boardItems = live(data.boardItems)
  const itemById = new Map(boardItems.map((i) => [i.id, i]))
  const importedAt = new Map(data.imports.map((e) => [e.id, e.imported_at]))

  const listed = new Set<string>() // papers written out in full
  const cited = new Map<string, Paper>() // papers only referred to

  const paperName = (p: Paper) => p.title || p.doi || p.url || '（没有标题）'
  const kindOf = (c: Card) => (c.kind === '其他' ? c.heading || '其他' : c.kind)

  /** The wording as it reads on the day's board now. */
  const cardText = (c: Card) => {
    const edited = boardItems.find(
      (i) => i.board_id === `day:${c.date}` && i.ref_type === 'card' && i.ref_id === c.id && i.text_override !== undefined,
    )
    return (edited?.text_override ?? c.body_md).trim()
  }

  const noteCitations = (c: Card, text: string) => {
    const record = recordById.get(c.record_id)
    const candidates = candidatesFor(record?.paper_dois ?? [], papers)
    if (candidates.length === 0) return
    for (const cite of findCitations(text)) {
      const paper = matchCitation(cite, candidates)
      if (paper) cited.set(paper.id, paper)
    }
  }

  const cardLines = (c: Card): string[] => {
    const text = cardText(c)
    noteCitations(c, text)
    return [`【${kindOf(c)}】`, text, '']
  }

  const recordsOfDay = (date: string) =>
    records
      .filter((r) => r.date === date)
      .sort((a, b) => {
        const x = importedAt.get(a.import_id) ?? ''
        const y = importedAt.get(b.import_id) ?? ''
        return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : 1
      })

  const recordLines = (r: ResearchRecord, heading: string): string[] => {
    const out = [`${heading} ${r.title || '（没有标题）'}（${r.date}）`, '']
    if (r.summary) out.push(`摘要：${r.summary}`, '')
    if (r.preamble_md) out.push(r.preamble_md.trim(), '')
    for (const c of cards.filter((x) => x.record_id === r.id).sort((a, b) => a.order - b.order)) out.push(...cardLines(c))
    return out
  }

  /** A connector end → a short description of what it touches. */
  const describeEnd = (key: string): string | null => {
    let type: string
    let id: string
    let item: BoardItem | undefined
    if (key.startsWith('item:') || !key.includes(':')) {
      item = itemById.get(key.replace(/^item:/, ''))
      if (!item) return null
      type = item.ref_type
      id = item.ref_id
    } else {
      type = key.slice(0, key.indexOf(':'))
      id = key.slice(key.indexOf(':') + 1)
    }
    if (type === 'card') {
      const c = cardById.get(id)
      return c ? `【${kindOf(c)}】${oneLine(cardText(c))}` : null
    }
    if (type === 'cover') {
      const r = recordById.get(id)
      return r ? `【记录】${r.title}` : null
    }
    if (type === 'paper') {
      const p = paperById.get(id)
      return p ? `【论文】${paperName(p)}` : null
    }
    if (type === 'pile') {
      const p = pileById.get(id)
      return p ? `【堆】${p.name}` : null
    }
    if (type === 'text') return item?.text_override ? `【文字】${oneLine(item.text_override)}` : null
    if (type === 'image') return '[贴图]'
    return null
  }

  const connectorLines = (boardId: string, only?: (c: Connector) => boolean): string[] => {
    const out: string[] = []
    for (const c of live(data.connectors).filter((x) => x.board_id === boardId).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (only && !only(c)) continue
      const from = describeEnd(c.from)
      const to = describeEnd(c.to)
      if (from && to) out.push(`- ${from} ${c.arrow ? '→' : '—'} ${to}`)
    }
    return out
  }

  /** Free text, pasted images and drawings on a board. `when` is the date or the pile's name. */
  const extrasOf = (boardId: string, when: string): string[] => {
    const out: string[] = []
    const own = boardItems.filter((i) => i.board_id === boardId).sort((a, b) => (a.id < b.id ? -1 : 1))
    for (const i of own) if (i.ref_type === 'text' && i.text_override?.trim()) out.push(`【文字】${i.text_override.trim()}`)
    for (const i of own) if (i.ref_type === 'image') out.push(`[贴图：${when}]`)
    if (live(data.strokes).some((s) => s.board_id === boardId)) out.push(`[手绘图片：${when}]`)
    return out
  }

  const paperLines = (p: Paper): string[] => {
    listed.add(p.id)
    const out = [`### ${paperName(p)}`, '', `- 状态：${p.status === 'want' ? '想看（还没读）' : '已读'}`]
    if (p.authors.length > 0) out.push(`- 作者：${p.authors.join(', ')}`)
    if (p.year !== null) out.push(`- 年份：${p.year}`)
    if (p.venue) out.push(`- 期刊/会议：${p.venue}`)
    if (p.doi) out.push(`- DOI：${p.doi}`)
    if (p.url) out.push(`- 链接：${p.url}`)
    if (p.why) out.push(`- 为什么想看：${p.why}`)
    out.push('')
    if (p.status === 'read') {
      if (p.one_liner) out.push(`一句话总结：${p.one_liner}`, '')
      const blocks = live(data.blocks)
        .filter((b) => b.paper_id === p.id)
        .sort((a, b) => a.order - b.order)
      for (const b of blocks) {
        const name = b.type_id ? typeById.get(b.type_id)?.name : undefined
        out.push(`**${name ? `重点 · ${name}` : b.heading || '其他内容'}**`, '', (b.edited_md ?? b.body_md).trim(), '')
      }
    }
    return out
  }

  const pileLines = (pile: Pile, depth: number, seen: Set<string>): string[] => {
    const h = '#'.repeat(Math.min(depth, 6))
    const out = [`${h} 堆：${pile.name}`, '']
    if (seen.has(pile.id)) return [...out, '（这个堆在上面已经列过）', '']
    seen.add(pile.id)
    const boardId = `pile:${pile.id}`
    const inside = boardItems
      .filter((i) => i.board_id === boardId)
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : 1))
    const sub = '#'.repeat(Math.min(depth + 1, 6))

    for (const i of inside.filter((x) => x.ref_type === 'cover')) {
      const r = recordById.get(i.ref_id)
      if (r) out.push(...recordLines(r, sub))
    }
    const loose = inside.filter((x) => x.ref_type === 'card').map((x) => cardById.get(x.ref_id)).filter((c): c is Card => !!c)
    for (const c of loose) {
      const r = recordById.get(c.record_id)
      out.push(`${c.date} · ${r?.title ?? ''}`, ...cardLines(c))
    }
    const inPile = inside.filter((x) => x.ref_type === 'paper').map((x) => paperById.get(x.ref_id)).filter((p): p is Paper => !!p)
    if (inPile.length > 0) {
      out.push('堆里的论文：')
      for (const p of inPile) {
        out.push(`- ${paperName(p)}`)
        if (!listed.has(p.id)) cited.set(p.id, p)
      }
      out.push('')
    }
    const links = connectorLines(boardId)
    if (links.length > 0) out.push('连线：', ...links, '')
    const extras = extrasOf(boardId, pile.name)
    if (extras.length > 0) out.push(...extras, '')
    for (const i of inside.filter((x) => x.ref_type === 'pile')) {
      const child = pileById.get(i.ref_id)
      if (child) out.push(...pileLines(child, depth + 1, seen))
    }
    return out
  }

  // ── the box, by kind of thing, each in the order it was added
  const of = (type: DiscussionItem['ref_type']) => data.items.filter((i) => !i.deleted && i.ref_type === type)
  const boxPapers = of('paper').map((i) => paperById.get(i.ref_id)).filter((p): p is Paper => !!p)
  const boxCards = of('card').map((i) => cardById.get(i.ref_id)).filter((c): c is Card => !!c)
  const boxDays = of('day').map((i) => i.ref_id)
  const boxPiles = of('pile').map((i) => pileById.get(i.ref_id)).filter((p): p is Pile => !!p)

  const body: string[] = []

  if (boxPapers.length > 0) {
    body.push('## 论文', '')
    for (const p of boxPapers) body.push(...paperLines(p))
  }

  if (boxCards.length > 0) {
    body.push('## 研究卡片', '')
    const byRecord = new Map<string, Card[]>()
    for (const c of boxCards) byRecord.set(c.record_id, [...(byRecord.get(c.record_id) ?? []), c])
    for (const [recordId, list] of byRecord) {
      const r = recordById.get(recordId)
      body.push(`### ${list[0].date} · ${r?.title || '（没有标题）'}`, '')
      for (const c of list) body.push(...cardLines(c))
    }
    // lines drawn between two of the chosen cards
    const chosen = new Set(boxCards.map((c) => `card:${c.id}`))
    const endKey = (key: string) => {
      if (key.startsWith('card:')) return key
      const item = itemById.get(key.replace(/^item:/, ''))
      return item?.ref_type === 'card' ? `card:${item.ref_id}` : ''
    }
    const links: string[] = []
    for (const date of [...new Set(boxCards.map((c) => c.date))].sort()) {
      if (boxDays.includes(date)) continue // listed with the whole board below
      links.push(...connectorLines(`day:${date}`, (c) => chosen.has(endKey(c.from)) && chosen.has(endKey(c.to))))
    }
    if (links.length > 0) body.push('连线：', ...links, '')
  }

  for (const date of boxDays) {
    const dayRecords = recordsOfDay(date)
    body.push(`## 画板：${date}`, '')
    if (dayRecords.length === 0) body.push('（这一天没有研究记录）', '')
    for (const r of dayRecords) body.push(...recordLines(r, '###'))
    const links = connectorLines(`day:${date}`)
    if (links.length > 0) body.push('连线：', ...links, '')
    const extras = extrasOf(`day:${date}`, date)
    if (extras.length > 0) body.push(...extras, '')
  }

  const seenPiles = new Set<string>()
  for (const pile of boxPiles) body.push(...pileLines(pile, 2, seenPiles))

  const mentioned = [...cited.values()].filter((p) => !listed.has(p.id)).sort((a, b) => (paperName(a) < paperName(b) ? -1 : 1))
  if (mentioned.length > 0) {
    body.push('## 上面提到的论文', '')
    for (const p of mentioned) {
      const who = [p.authors[0] ? p.authors[0] + (p.authors.length > 1 ? ' 等' : '') : '', p.year ?? ''].filter(Boolean).join(', ')
      body.push(`- **${paperName(p)}**${who ? `（${who}）` : ''}${p.one_liner ? `：${p.one_liner}` : ''}`)
    }
    body.push('')
  }

  return [
    chooseIntro(data.items.filter((i) => !i.deleted)),
    '',
    `# ${data.box.name}`,
    '',
    ...body,
    '---',
    '',
    '讨论完之后，请按下面的模板整理，方便我放回研究笔记本。',
    '',
    '## 研究记录的模板',
    '',
    '````markdown',
    RESEARCH_PROMPT.trim(),
    '````',
    '',
    '## 论文的模板',
    '',
    '````markdown',
    PAPER_PROMPT.trim(),
    '````',
    '',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}
