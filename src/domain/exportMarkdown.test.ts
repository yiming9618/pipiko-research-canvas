import { describe, expect, it } from 'vitest'
import { buildExport, chooseIntro, exportBoard, exportPile, INTRO_ONE_PAPER, INTRO_PAPERS, INTRO_RESEARCH, type ExportData } from './exportMarkdown'
import type { Board, BoardItem, Card, Connector, DiscussionItem, Paper, PaperBlock, Pile, ResearchRecord, Stroke } from './types'

const T = '2026-11-10T10:00:00.000Z'
const paper = (id: string, over: Partial<Paper> = {}): Paper => ({
  id, title: `论文${id}`, authors: ['Jane Smith'], year: 2024, venue: 'CHI', doi: `10.1/${id}`, category: '', keywords: [],
  status: 'read', url: '', one_liner: `${id} 的一句话总结`, basics_md: '', created_at: T, updated_at: T, ...over,
})
const record = (id: string, date: string, over: Partial<ResearchRecord> = {}): ResearchRecord => ({
  id, date, title: `记录${id}`, summary: `${id} 的摘要`, activities: [], keywords: [], paper_dois: [], preamble_md: '', import_id: `imp_${id}`, updated_at: T, ...over,
})
const card = (id: string, recordId: string, date: string, kind: Card['kind'], body: string, order = 0): Card => ({
  id, record_id: recordId, date, kind, heading: kind, body_md: body, order, import_id: `imp_${recordId}`, updated_at: T,
})
const item = (id: string, type: DiscussionItem['ref_type'], ref: string, n = 0): DiscussionItem => ({
  id, discussion_id: 'd1', ref_type: type, ref_id: ref, added_at: `2026-11-11T00:00:0${n}.000Z`, updated_at: T,
})
const bi = (over: Partial<BoardItem>): BoardItem => ({
  id: 'bi', board_id: 'day:2026-11-10', ref_type: 'card', ref_id: '', x: 0, y: 0, w: 340, h: 0, z: 1, updated_at: T, ...over,
})

const base = (over: Partial<ExportData>): ExportData => ({
  box: { id: 'd1', name: '霉菌实验卡住了', created_at: T, updated_at: T },
  items: [], papers: [], blocks: [], types: [], records: [], cards: [], boardItems: [], connectors: [], strokes: [], piles: [], boards: [], imports: [],
  ...over,
})

const board = (id: string, name: string, over: Partial<Board> = {}): Board => ({ id, name, created_at: '2026-11-10T00:00:00.000Z', updated_at: T, ...over })
/** The board that 10 November became after the move to subject boards. */
const DAY = 'day:2026-11-10'
const dayBoard = board(DAY, '2026/11/10')
const manual = (id: string, kind: Card['kind'], body: string, order: number, over: Partial<Card> = {}): Card => ({
  id, record_id: '', date: '2026-11-10', kind, heading: kind, body_md: body, order, updated_at: T, ...over,
})

describe('导出给 AI', () => {
  it('开头说明按内容选择', () => {
    expect(chooseIntro([{ ref_type: 'paper' }])).toBe(INTRO_ONE_PAPER)
    expect(chooseIntro([{ ref_type: 'paper' }, { ref_type: 'paper' }])).toBe(INTRO_PAPERS)
    expect(chooseIntro([{ ref_type: 'paper' }, { ref_type: 'card' }])).toBe(INTRO_RESEARCH)
    expect(chooseIntro([{ ref_type: 'day' }])).toBe(INTRO_RESEARCH)
    expect(chooseIntro([{ ref_type: 'board' }])).toBe(INTRO_RESEARCH)
    expect(chooseIntro([{ ref_type: 'pile' }])).toBe(INTRO_RESEARCH)
  })

  it('一篇已读论文：信息、一句话总结、重点区块（用改过的文字）', () => {
    const blocks: PaperBlock[] = [
      { id: 'b1', paper_id: 'a', type_id: 't1', heading: '重点：研究方法', body_md: '原文', edited_md: '我改过的方法', order: 0, updated_at: T },
      { id: 'b2', paper_id: 'a', type_id: 't1', heading: '', body_md: '已删除', order: 1, updated_at: T, deleted: true },
    ]
    const md = buildExport(base({
      items: [item('i1', 'paper', 'a')],
      papers: [paper('a', { url: 'https://x.org', why: '导师推荐' })],
      blocks,
      types: [{ id: 't1', name: '研究方法', color: 'green', builtin: true, aliases: [], order: 0, updated_at: T }],
    }))
    expect(md.startsWith(INTRO_ONE_PAPER)).toBe(true)
    expect(md).toContain('# 霉菌实验卡住了')
    expect(md).toContain('### 论文a')
    expect(md).toContain('- 作者：Jane Smith')
    expect(md).toContain('- 年份：2024')
    expect(md).toContain('- 期刊/会议：CHI')
    expect(md).toContain('- DOI：10.1/a')
    expect(md).toContain('- 链接：https://x.org')
    expect(md).toContain('- 为什么想看：导师推荐')
    expect(md).toContain('一句话总结：a 的一句话总结')
    expect(md).toContain('**重点 · 研究方法**')
    expect(md).toContain('我改过的方法')
    expect(md).not.toContain('原文')
    expect(md).not.toContain('已删除')
  })

  it('想看的论文只有基本信息，没有总结；多篇论文换开头', () => {
    const md = buildExport(base({
      items: [item('i1', 'paper', 'a'), item('i2', 'paper', 'w', 1)],
      papers: [paper('a'), paper('w', { status: 'want', one_liner: '', authors: [], year: null, venue: '', why: '想了解方法' })],
    }))
    expect(md.startsWith(INTRO_PAPERS)).toBe(true)
    expect(md).toContain('- 状态：想看（还没读）')
    expect(md).toContain('- 为什么想看：想了解方法')
    expect(md.indexOf('### 论文a')).toBeLessThan(md.indexOf('### 论文w'))
  })

  it('单张卡片：类型、日期、来自哪份记录、内容；手动改过的用改后的文字', () => {
    const md = buildExport(base({
      items: [item('i1', 'card', 'c1'), item('i2', 'card', 'c2', 1), item('i3', 'card', 'm1', 2)],
      boards: [dayBoard],
      records: [record('r1', '2026-11-10')],
      cards: [card('c1', 'r1', '2026-11-10', '问题', '原来的问题'), card('c2', 'r1', '2026-11-10', '思考', '一个想法', 1), manual('m1', '发现', '手写的发现', 2)],
      boardItems: [bi({ id: 'x', ref_id: 'c1', text_override: '改过的问题' })],
    }))
    expect(md.startsWith(INTRO_RESEARCH)).toBe(true)
    expect(md).toContain('【问题】2026-11-10 · 记录r1\n改过的问题')
    expect(md).not.toContain('原来的问题')
    expect(md).toContain('【思考】2026-11-10 · 记录r1\n一个想法')
    expect(md).toContain('【发现】2026-11-10 · 我写的\n手写的发现')
  })

  it('选中的两张卡片之间的连线转成文字；连到没选的卡片的不写', () => {
    const connectors: Connector[] = [
      { id: 'k1', board_id: DAY, from: 'card:c1', to: 'card:c2', arrow: true, updated_at: T },
      { id: 'k2', board_id: DAY, from: 'card:c1', to: 'card:c3', arrow: true, updated_at: T },
    ]
    const md = buildExport(base({
      items: [item('i1', 'card', 'c1'), item('i2', 'card', 'c2', 1)],
      boards: [dayBoard],
      records: [record('r1', '2026-11-10')],
      cards: [card('c1', 'r1', '2026-11-10', '问题', '为什么长不出来'), card('c2', 'r1', '2026-11-10', '思考', '可能是湿度', 1), card('c3', 'r1', '2026-11-10', '发现', '没选的', 2)],
      connectors,
    }))
    expect(md).toContain('- 【问题】为什么长不出来 → 【思考】可能是湿度')
    expect(md).not.toContain('没选的')
  })

  const wholeBoard = () => {
    const strokes: Stroke[] = [{ id: 's1', board_id: 'b1', points: [0, 0, 1], color: '#000', size: 5, updated_at: T }]
    return base({
      boards: [board('b1', '霉菌研究'), board('b2', '别的画板')],
      papers: [paper('a'), paper('b', { authors: ['Bob Lee', 'Amy Wu'], year: 2020 })],
      records: [
        record('r2', '2026-11-12', { board_id: 'b1' }),
        record('r1', '2026-11-10', { board_id: 'b1', paper_dois: ['10.1/a'] }),
        record('other', '2026-11-09', { board_id: 'b2' }),
      ],
      cards: [
        card('c2', 'r2', '2026-11-12', '下一步', '后一天的下一步', 0),
        card('c1', 'r1', '2026-11-10', '发现', '前一天的发现，见 (Smith, 2024)', 0),
        { ...manual('m1', '思考', '中间那天手写的', 5), date: '2026-11-11', board_id: 'b1' },
        card('c9', 'other', '2026-11-09', '问题', '别的画板上的问题', 0),
      ].map((c) => (c.board_id ? c : { ...c, board_id: c.record_id === 'other' ? 'b2' : 'b1' })),
      boardItems: [
        bi({ id: 'img', board_id: 'b1', ref_type: 'image', ref_id: 'asset1' }),
        bi({ id: 'txt', board_id: 'b1', ref_type: 'text', ref_id: '', text_override: '画板上的一句话' }),
        bi({ id: 'moved', board_id: 'b1', ref_type: 'card', ref_id: 'c1', text_override: '改过的发现，见 (Smith, 2024)' }),
        bi({ id: 'guest', board_id: 'b1', ref_type: 'card', ref_id: 'c9' }),
        bi({ id: 'pp', board_id: 'b1', ref_type: 'paper', ref_id: 'b' }),
      ],
      connectors: [
        { id: 'k1', board_id: 'b1', from: 'moved', to: 'item:txt', arrow: false, updated_at: T },
        { id: 'k2', board_id: 'b1', from: 'card:c1', to: 'card:c2', arrow: true, updated_at: T },
      ],
      strokes,
    })
  }

  it('整块画板：名称、记录、卡片按日期排列并标出类型和日期、连线、占位、论文', () => {
    const md = exportBoard('b1', wholeBoard())
    expect(md.startsWith(INTRO_RESEARCH)).toBe(true)
    expect(md).toContain('# 霉菌研究')
    expect(md).toContain('- 2026-11-10 · 记录r1：r1 的摘要')
    // by date: 11/09 (shown here from another board), 11/10, 11/11, 11/12
    const order = ['别的画板上的问题', '改过的发现', '中间那天手写的', '后一天的下一步'].map((t) => md.indexOf(t))
    expect(order.every((n) => n > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(md).toContain('【发现】2026-11-10 · 记录r1\n改过的发现')
    expect(md).not.toContain('前一天的发现')
    expect(md).toContain('【思考】2026-11-11 · 我写的\n中间那天手写的')
    expect(md).toContain('【问题】2026-11-09 · 记录other，来自画板「别的画板」')
    expect(md).toContain('- 【发现】改过的发现，见 (Smith, 2024) — 【文字】画板上的一句话')
    expect(md).toContain('- 【发现】改过的发现，见 (Smith, 2024) → 【下一步】后一天的下一步')
    expect(md).toContain('【文字】画板上的一句话')
    expect(md).toContain('[贴图：2026-11-10]')
    expect(md).toContain('[手绘图片：2026-11-10]')
    // papers: the one shown on the board and the one a card cites, each once, with authors, year and one line
    expect(md).toContain('- **论文a**（Jane Smith, 2024）：a 的一句话总结')
    expect(md).toContain('- **论文b**（Bob Lee 等, 2020）：b 的一句话总结')
    expect(md.split('**论文a**').length - 1).toBe(1)
    expect(md).toContain('## 研究记录的模板')
  })

  it('只导出选中的：只有选中的东西，连线只留两端都选中的', () => {
    const md = exportBoard('b1', wholeBoard(), new Set(['card:c1', 'card:c2', 'item:img']))
    expect(md).toContain('# 霉菌研究（选中的部分）')
    expect(md).toContain('改过的发现')
    expect(md).toContain('后一天的下一步')
    expect(md).not.toContain('中间那天手写的')
    expect(md).not.toContain('别的画板上的问题')
    expect(md).toContain('→ 【下一步】后一天的下一步')
    expect(md).not.toContain('画板上的一句话')
    expect(md).toContain('[贴图：2026-11-10]')
    expect(md).not.toContain('[手绘图片')
    expect(md).not.toContain('论文b')
    expect(md).toContain('- **论文a**')
  })

  it('讨论框里的整块画板和画板导出是同一套格式；以前按“某一天”放进去的仍然有效', () => {
    const data = wholeBoard()
    const viaBox = buildExport({ ...data, items: [item('i1', 'board', 'b1')] })
    expect(viaBox).toContain('## 画板：霉菌研究')
    expect(viaBox).toContain('【思考】2026-11-11 · 我写的\n中间那天手写的')

    const legacy = buildExport(base({
      items: [item('i1', 'day', '2026-11-10')],
      boards: [dayBoard],
      records: [record('r1', '2026-11-10')],
      cards: [card('c1', 'r1', '2026-11-10', '发现', '那一天的发现'), manual('m1', '问题', '那一天手写的', 1)],
    }))
    expect(legacy).toContain('## 画板：2026/11/10')
    expect(legacy).toContain('那一天的发现')
    expect(legacy).toContain('【问题】2026-11-10 · 我写的\n那一天手写的')
  })

  it('整个堆：依次列出每块画板，前面写上名称；引用到的论文统一在最后，同一篇只出现一次', () => {
    const piles: Pile[] = [{ id: 'p1', name: '霉菌', created_at: T, updated_at: T }]
    const data = base({
      piles,
      boards: [
        board('b1', '霉菌研究', { pile_id: 'p1', created_at: '2026-11-02T00:00:00.000Z' }),
        board('b2', '霉菌实验记录', { pile_id: 'p1', created_at: '2026-11-05T00:00:00.000Z' }),
        board('b3', '不在堆里的'),
      ],
      papers: [paper('a')],
      records: [record('r1', '2026-11-10', { board_id: 'b1', paper_dois: ['10.1/a'] }), record('r2', '2026-11-11', { board_id: 'b2', paper_dois: ['10.1/a'] })],
      cards: [
        { ...card('c1', 'r1', '2026-11-10', '发现', '研究里的发现 (Smith, 2024)'), board_id: 'b1' },
        { ...card('c2', 'r2', '2026-11-11', '实验', '实验记录 (Smith, 2024)'), board_id: 'b2' },
        { ...manual('m3', '问题', '堆外的卡片', 0), board_id: 'b3' },
      ],
    })
    const md = exportPile('p1', data)
    expect(md).toContain('# 堆：霉菌')
    expect(md.indexOf('## 画板：霉菌研究')).toBeLessThan(md.indexOf('## 画板：霉菌实验记录'))
    expect(md).toContain('研究里的发现')
    expect(md).toContain('实验记录')
    expect(md).not.toContain('堆外的卡片')
    expect(md.split('**论文a**').length - 1).toBe(1)
    expect(md.indexOf('## 上面提到的论文')).toBeGreaterThan(md.indexOf('## 画板：霉菌实验记录'))

    // the same pile inside a discussion box
    const viaBox = buildExport({ ...data, items: [item('i1', 'pile', 'p1')] })
    expect(viaBox).toContain('## 堆：霉菌')
    expect(viaBox).toContain('### 画板：霉菌研究')
  })

  it('卡片里引用到的论文自动附上，同一篇只出现一次；已经完整列出的不再重复', () => {
    const md = buildExport(base({
      items: [item('i1', 'card', 'c1'), item('i2', 'card', 'c2', 1), item('i3', 'paper', 'b', 2)],
      boards: [dayBoard],
      papers: [paper('a'), paper('b', { authors: ['Bob Lee'], year: 2020 })],
      records: [record('r1', '2026-11-10', { paper_dois: ['10.1/a', '10.1/b'] })],
      cards: [
        card('c1', 'r1', '2026-11-10', '发现', '和 (Smith, 2024) 的结论一致'),
        card('c2', 'r1', '2026-11-10', '思考', '再看 (Smith, 2024)，还有 (Lee, 2020)', 1),
      ],
    }))
    expect(md).toContain('## 上面提到的论文')
    expect(md.split('**论文a**').length - 1).toBe(1)
    expect(md).toContain('- **论文a**（Jane Smith, 2024）：a 的一句话总结')
    expect(md.split('论文b').length - 1).toBe(1)
  })

  it('原件已经删除的项直接跳过；末尾附两套模板', () => {
    const md = buildExport(base({
      items: [item('i1', 'paper', 'gone'), item('i2', 'card', 'gone', 1), item('i3', 'paper', 'a', 2), item('i4', 'board', 'gone', 3)],
      papers: [paper('a'), paper('gone', { deleted: true })],
    }))
    expect(md).not.toContain('论文gone')
    expect(md).not.toContain('画板：')
    expect(md).toContain('### 论文a')
    expect(md).toContain('## 研究记录的模板')
    expect(md).toContain('type: research')
    expect(md).toContain('board:')
    expect(md).toContain('## 论文的模板')
    expect(md).toContain('type: paper')
  })

  it('同样的内容导出两次，文字完全一样', () => {
    const data = wholeBoard()
    expect(exportBoard('b1', data)).toBe(exportBoard('b1', data))
  })
})
