// "导出给 AI": turns a discussion box into one Markdown text for the clipboard.
// Pure: the same box and the same notebook always give the same text.

import { candidatesFor, findCitations, matchCitation } from './citations'
import { homeBoardId, recordBoardId } from './migrate'
import { PAPER_PROMPT, RESEARCH_PROMPT } from './templates'
import type {
  Board,
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
  boards: Board[]
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

/** Everything the converter reads, minus the discussion box itself. */
export type NotebookData = Omit<ExportData, 'box' | 'items'>

/** Restricts a board's export to chosen things (for "导出选中的"). Keys are as on the canvas: `card:<id>`, `cover:<id>`, `paper:<id>`, `item:<board item id>`, `stroke:<id>`. */
export type Only = ReadonlySet<string>

/**
 * The shared converter. Papers written out in full and papers merely referred
 * to are tracked across everything one export contains, so each appears once.
 */
function makeWriter(data: NotebookData) {
  const papers = live(data.papers)
  const paperById = new Map(papers.map((p) => [p.id, p]))
  const records = live(data.records)
  const recordById = new Map(records.map((r) => [r.id, r]))
  const cards = live(data.cards)
  const cardById = new Map(cards.map((c) => [c.id, c]))
  const pileById = new Map(live(data.piles).map((p) => [p.id, p]))
  const boardById = new Map(live(data.boards).map((b) => [b.id, b]))
  const typeById = new Map(live(data.types).map((t) => [t.id, t]))
  const boardItems = live(data.boardItems)
  const itemById = new Map(boardItems.map((i) => [i.id, i]))
  const importedAt = new Map(data.imports.map((e) => [e.id, e.imported_at]))

  const listed = new Set<string>() // papers written out in full
  const cited = new Map<string, Paper>() // papers only referred to

  const paperName = (p: Paper) => p.title || p.doi || p.url || '（没有标题）'
  const kindOf = (c: Card) => (c.kind === '其他' ? c.heading || '其他' : c.kind)

  /** The wording as it reads on the card's own board now. */
  const cardText = (c: Card) => {
    const home = homeBoardId(c)
    const edited = boardItems.find((i) => i.board_id === home && i.ref_type === 'card' && i.ref_id === c.id && i.text_override !== undefined)
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

  /** 【类型】日期 · 来自哪份记录, then the text. */
  const cardLines = (c: Card, from?: string): string[] => {
    const text = cardText(c)
    noteCitations(c, text)
    const record = recordById.get(c.record_id)
    const source = from ?? (record ? record.title || '（没有标题）' : '我写的')
    return [`【${kindOf(c)}】${c.date} · ${source}`, text, '']
  }

  /** By the card's date; within a day, in the order of import, then as written. */
  const byDate = (list: Card[]) =>
    [...list].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      const ra = recordById.get(a.record_id)
      const rb = recordById.get(b.record_id)
      const x = ra ? importedAt.get(ra.import_id) ?? '' : '~'
      const y = rb ? importedAt.get(rb.import_id) ?? '' : '~'
      if (x !== y) return x < y ? -1 : 1
      return a.order - b.order || (a.id < b.id ? -1 : 1)
    })

  /** A connector end → the canvas key of what it touches, and a short description. */
  const end = (key: string): { key: string; text: string } | null => {
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
      return c ? { key: `card:${id}`, text: `【${kindOf(c)}】${oneLine(cardText(c))}` } : null
    }
    if (type === 'cover') {
      const r = recordById.get(id)
      return r ? { key: `cover:${id}`, text: `【记录】${r.title}` } : null
    }
    if (type === 'paper') {
      const p = paperById.get(id)
      return p ? { key: `paper:${id}`, text: `【论文】${paperName(p)}` } : null
    }
    if (type === 'pile') {
      const p = pileById.get(id)
      return p ? { key: `pile:${id}`, text: `【堆】${p.name}` } : null
    }
    if (!item) return null
    if (type === 'text') return item.text_override ? { key: `item:${item.id}`, text: `【文字】${oneLine(item.text_override)}` } : null
    if (type === 'image') return { key: `item:${item.id}`, text: '[贴图]' }
    return null
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

  /**
   * One board: its name, the records behind it, its cards by date, lines as
   * text, placeholders for pictures and ink, and the papers shown on it.
   * With `only`, just the chosen things, and only lines whose two ends are both chosen.
   */
  const boardLines = (boardId: string, heading: string, only?: Only): string[] => {
    const board = boardById.get(boardId)
    const name = board?.name ?? '（没有名字的画板）'
    const out = [`${heading} 画板：${name}`, '']
    const has = (key: string) => !only || only.has(key)
    const onBoard = boardItems.filter((i) => i.board_id === boardId).sort((a, b) => (a.id < b.id ? -1 : 1))

    const ownRecords = records
      .filter((r) => recordBoardId(r) === boardId && has(`cover:${r.id}`))
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (importedAt.get(a.import_id) ?? '') < (importedAt.get(b.import_id) ?? '') ? -1 : 1))
    // when exporting everything, every record is named; when exporting a choice, only the chosen covers
    const namedRecords = only ? ownRecords : records.filter((r) => recordBoardId(r) === boardId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    if (namedRecords.length > 0) {
      out.push('研究记录：')
      for (const r of namedRecords) out.push(`- ${r.date} · ${r.title || '（没有标题）'}${r.summary ? `：${r.summary}` : ''}`)
      out.push('')
    }

    const own = cards.filter((c) => homeBoardId(c) === boardId && has(`card:${c.id}`))
    // cards and records from other boards that are shown here
    const guests = onBoard
      .filter((i) => i.ref_type === 'card' && has(`card:${i.ref_id}`))
      .map((i) => cardById.get(i.ref_id))
      .filter((c): c is Card => !!c && homeBoardId(c) !== boardId)
    const guestRecords = onBoard
      .filter((i) => i.ref_type === 'cover' && has(`cover:${i.ref_id}`))
      .map((i) => recordById.get(i.ref_id))
      .filter((r): r is ResearchRecord => !!r && recordBoardId(r) !== boardId)
    for (const r of guestRecords) guests.push(...cards.filter((c) => c.record_id === r.id && !guests.includes(c)))

    for (const c of byDate([...own, ...guests])) {
      const guest = homeBoardId(c) !== boardId
      const record = recordById.get(c.record_id)
      const where = guest ? `来自画板「${boardById.get(homeBoardId(c))?.name ?? '另一块'}」` : undefined
      out.push(...cardLines(c, where ? `${record ? record.title || '（没有标题）' : '我写的'}，${where}` : undefined))
    }

    const shownPapers = onBoard
      .filter((i) => i.ref_type === 'paper' && has(`paper:${i.ref_id}`))
      .map((i) => paperById.get(i.ref_id))
      .filter((p): p is Paper => !!p)
    if (shownPapers.length > 0) {
      out.push('画板上的论文：')
      for (const p of shownPapers) {
        out.push(`- ${paperName(p)}`)
        if (!listed.has(p.id)) cited.set(p.id, p)
      }
      out.push('')
    }

    for (const i of onBoard) {
      if (i.ref_type === 'pile') {
        const pile = pileById.get(i.ref_id)
        if (pile && !only) out.push(`（另见堆：${pile.name}）`, '')
      }
    }

    const links: string[] = []
    for (const c of live(data.connectors).filter((x) => x.board_id === boardId).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const from = end(c.from)
      const to = end(c.to)
      if (!from || !to || !has(from.key) || !has(to.key)) continue
      links.push(`- ${from.text} ${c.arrow ? '→' : '—'} ${to.text}`)
    }
    if (links.length > 0) out.push('连线：', ...links, '')

    const when = board ? board.created_at.slice(0, 10) : ''
    const extras: string[] = []
    for (const i of onBoard) if (i.ref_type === 'text' && i.text_override?.trim() && has(`item:${i.id}`)) extras.push(`【文字】${i.text_override.trim()}`)
    for (const i of onBoard) if (i.ref_type === 'image' && has(`item:${i.id}`)) extras.push(`[贴图：${when}]`)
    const ink = live(data.strokes).filter((x) => x.board_id === boardId && has(`stroke:${x.id}`))
    if (ink.length > 0) extras.push(`[手绘图片：${when}]`)
    if (extras.length > 0) out.push(...extras, '')

    if (out.length === 2) out.push('（这块画板是空的）', '')
    return out
  }

  /** A pile: each of its boards in turn, oldest first. */
  const pileLines = (pile: Pile, heading: string): string[] => {
    const out = [`${heading} 堆：${pile.name}`, '']
    const inside = live(data.boards)
      .filter((b) => b.pile_id === pile.id)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
    if (inside.length === 0) out.push('（这个堆是空的）', '')
    for (const b of inside) out.push(...boardLines(b.id, `${heading}#`))
    return out
  }

  /** Papers referred to along the way and not written out in full: title, authors, year, one line. Each once. */
  const mentionedLines = (): string[] => {
    const mentioned = [...cited.values()].filter((p) => !listed.has(p.id)).sort((a, b) => (paperName(a) < paperName(b) ? -1 : 1))
    if (mentioned.length === 0) return []
    const out = ['## 上面提到的论文', '']
    for (const p of mentioned) {
      const who = [p.authors[0] ? p.authors[0] + (p.authors.length > 1 ? ' 等' : '') : '', p.year ?? ''].filter(Boolean).join(', ')
      out.push(`- **${paperName(p)}**${who ? `（${who}）` : ''}${p.one_liner ? `：${p.one_liner}` : ''}`)
    }
    out.push('')
    return out
  }

  return { paperById, cardById, pileById, boardById, recordById, itemById, cardLines, byDate, end, paperLines, boardLines, pileLines, mentionedLines }
}

const TEMPLATES = [
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

const finish = (lines: string[]) => lines.join('\n').replace(/\n{3,}/g, '\n\n')

/** "导出给 AI" for a discussion box. */
export function buildExport(data: ExportData): string {
  const w = makeWriter(data)
  const of = (type: DiscussionItem['ref_type']) => data.items.filter((i) => !i.deleted && i.ref_type === type)
  const boxPapers = of('paper').map((i) => w.paperById.get(i.ref_id)).filter((p): p is Paper => !!p)
  const boxCards = of('card').map((i) => w.cardById.get(i.ref_id)).filter((c): c is Card => !!c)
  // a "day" entry is the board that day became
  const boxBoards = data.items
    .filter((i) => !i.deleted && (i.ref_type === 'day' || i.ref_type === 'board'))
    .map((i) => (i.ref_type === 'day' ? `day:${i.ref_id}` : i.ref_id))
    .filter((id, n, all) => w.boardById.has(id) && all.indexOf(id) === n)
  const boxPiles = of('pile').map((i) => w.pileById.get(i.ref_id)).filter((p): p is Pile => !!p)

  const body: string[] = []
  if (boxPapers.length > 0) {
    body.push('## 论文', '')
    for (const p of boxPapers) body.push(...w.paperLines(p))
  }

  if (boxCards.length > 0) {
    body.push('## 研究卡片', '')
    for (const c of w.byDate(boxCards)) body.push(...w.cardLines(c))
    // lines drawn between two of the chosen cards, unless their whole board is listed below anyway
    const chosen = new Set(boxCards.map((c) => `card:${c.id}`))
    const links: string[] = []
    for (const boardId of [...new Set(boxCards.map((c) => homeBoardId(c)))].sort()) {
      if (boxBoards.includes(boardId)) continue
      for (const c of live(data.connectors).filter((x) => x.board_id === boardId).sort((a, b) => (a.id < b.id ? -1 : 1))) {
        const from = w.end(c.from)
        const to = w.end(c.to)
        if (from && to && chosen.has(from.key) && chosen.has(to.key)) links.push(`- ${from.text} ${c.arrow ? '→' : '—'} ${to.text}`)
      }
    }
    if (links.length > 0) body.push('连线：', ...links, '')
  }

  for (const id of boxBoards) body.push(...w.boardLines(id, '##'))
  for (const pile of boxPiles) body.push(...w.pileLines(pile, '##'))
  body.push(...w.mentionedLines())

  return finish([chooseIntro(data.items.filter((i) => !i.deleted)), '', `# ${data.box.name}`, '', ...body, ...TEMPLATES])
}

/** A whole board, or (with `only`) just the chosen things on it. */
export function exportBoard(boardId: string, data: NotebookData, only?: Only): string {
  const w = makeWriter(data)
  const name = w.boardById.get(boardId)?.name ?? '画板'
  const lines = w.boardLines(boardId, '##', only)
  return finish([INTRO_RESEARCH, '', `# ${name}${only ? '（选中的部分）' : ''}`, '', ...lines.slice(2), ...w.mentionedLines(), ...TEMPLATES])
}

/** A whole pile: each board in turn under its name, the papers they refer to once at the end. */
export function exportPile(pileId: string, data: NotebookData): string {
  const w = makeWriter(data)
  const pile = w.pileById.get(pileId)
  if (!pile) return ''
  const lines = w.pileLines(pile, '#')
  return finish([INTRO_RESEARCH, '', ...lines, ...w.mentionedLines(), ...TEMPLATES])
}
