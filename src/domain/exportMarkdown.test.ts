import { describe, expect, it } from 'vitest'
import { buildExport, chooseIntro, INTRO_ONE_PAPER, INTRO_PAPERS, INTRO_RESEARCH, type ExportData } from './exportMarkdown'
import type { BoardItem, Card, Connector, DiscussionItem, Paper, PaperBlock, Pile, ResearchRecord, Stroke } from './types'

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
  items: [], papers: [], blocks: [], types: [], records: [], cards: [], boardItems: [], connectors: [], strokes: [], piles: [], imports: [],
  ...over,
})

describe('导出给 AI', () => {
  it('开头说明按内容选择', () => {
    expect(chooseIntro([{ ref_type: 'paper' }])).toBe(INTRO_ONE_PAPER)
    expect(chooseIntro([{ ref_type: 'paper' }, { ref_type: 'paper' }])).toBe(INTRO_PAPERS)
    expect(chooseIntro([{ ref_type: 'paper' }, { ref_type: 'card' }])).toBe(INTRO_RESEARCH)
    expect(chooseIntro([{ ref_type: 'day' }])).toBe(INTRO_RESEARCH)
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

  it('单张卡片：日期、记录标题、类型、内容；手动改过的用改后的文字', () => {
    const md = buildExport(base({
      items: [item('i1', 'card', 'c1'), item('i2', 'card', 'c2', 1)],
      records: [record('r1', '2026-11-10')],
      cards: [card('c1', 'r1', '2026-11-10', '问题', '原来的问题'), card('c2', 'r1', '2026-11-10', '思考', '一个想法', 1)],
      boardItems: [bi({ id: 'x', ref_id: 'c1', text_override: '改过的问题' })],
    }))
    expect(md.startsWith(INTRO_RESEARCH)).toBe(true)
    expect(md).toContain('### 2026-11-10 · 记录r1')
    expect(md).toContain('【问题】\n改过的问题')
    expect(md).not.toContain('原来的问题')
    expect(md).toContain('【思考】\n一个想法')
  })

  it('选中的两张卡片之间的连线转成文字；连到没选的卡片的不写', () => {
    const connectors: Connector[] = [
      { id: 'k1', board_id: 'day:2026-11-10', from: 'card:c1', to: 'card:c2', arrow: true, updated_at: T },
      { id: 'k2', board_id: 'day:2026-11-10', from: 'card:c1', to: 'card:c3', arrow: true, updated_at: T },
    ]
    const md = buildExport(base({
      items: [item('i1', 'card', 'c1'), item('i2', 'card', 'c2', 1)],
      records: [record('r1', '2026-11-10')],
      cards: [card('c1', 'r1', '2026-11-10', '问题', '为什么长不出来'), card('c2', 'r1', '2026-11-10', '思考', '可能是湿度', 1), card('c3', 'r1', '2026-11-10', '发现', '没选的', 2)],
      connectors,
    }))
    expect(md).toContain('- 【问题】为什么长不出来 → 【思考】可能是湿度')
    expect(md).not.toContain('没选的')
  })

  it('整块画板：每份记录的标题、摘要、全部卡片、连线、手绘和贴图占位', () => {
    const strokes: Stroke[] = [{ id: 's1', board_id: 'day:2026-11-10', points: [0, 0, 1], color: '#000', size: 5, updated_at: T }]
    const md = buildExport(base({
      items: [item('i1', 'day', '2026-11-10')],
      records: [record('r1', '2026-11-10'), record('r2', '2026-11-10'), record('other', '2026-11-09')],
      cards: [card('c1', 'r1', '2026-11-10', '发现', '发现一'), card('c2', 'r2', '2026-11-10', '下一步', '下一步一'), card('c9', 'other', '2026-11-09', '发现', '别的一天')],
      imports: [
        { id: 'imp_r1', imported_at: '2026-11-10T09:00:00.000Z' },
        { id: 'imp_r2', imported_at: '2026-11-10T08:00:00.000Z' },
      ] as ExportData['imports'],
      boardItems: [
        bi({ id: 'img', ref_type: 'image', ref_id: 'asset1' }),
        bi({ id: 'txt', ref_type: 'text', ref_id: '', text_override: '画板上的一句话' }),
        bi({ id: 'moved', ref_type: 'card', ref_id: 'c1' }),
      ],
      connectors: [{ id: 'k', board_id: 'day:2026-11-10', from: 'moved', to: 'item:txt', arrow: false, updated_at: T }],
      strokes,
    }))
    expect(md).toContain('## 画板：2026-11-10')
    expect(md.indexOf('### 记录r2')).toBeLessThan(md.indexOf('### 记录r1')) // import order
    expect(md).toContain('摘要：r1 的摘要')
    expect(md).toContain('【发现】\n发现一')
    expect(md).toContain('【下一步】\n下一步一')
    expect(md).not.toContain('别的一天')
    expect(md).toContain('- 【发现】发现一 — 【文字】画板上的一句话')
    expect(md).toContain('【文字】画板上的一句话')
    expect(md).toContain('[贴图：2026-11-10]')
    expect(md).toContain('[手绘图片：2026-11-10]')
  })

  it('卡片里引用到的论文自动附上标题和一句话总结，同一篇只出现一次', () => {
    const md = buildExport(base({
      items: [item('i1', 'card', 'c1'), item('i2', 'card', 'c2', 1), item('i3', 'paper', 'b', 2)],
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
    // 论文b is in the box itself, so it is written out in full once and not repeated
    expect(md.split('论文b').length - 1).toBe(1)
  })

  it('整个堆：里面的卡片、整份记录、论文、套着的堆；互相套着也不会绕圈', () => {
    const piles: Pile[] = [
      { id: 'p1', name: '共在', created_at: T, updated_at: T },
      { id: 'p2', name: '子堆', created_at: T, updated_at: T },
    ]
    const md = buildExport(base({
      items: [item('i1', 'pile', 'p1')],
      piles,
      papers: [paper('a')],
      records: [record('r1', '2026-11-10')],
      cards: [card('c1', 'r1', '2026-11-10', '问题', '堆里的问题'), card('c2', 'r1', '2026-11-10', '发现', '整份记录里的发现', 1)],
      boardItems: [
        bi({ id: '1', board_id: 'pile:p1', ref_type: 'card', ref_id: 'c1' }),
        bi({ id: '2', board_id: 'pile:p1', ref_type: 'paper', ref_id: 'a' }),
        bi({ id: '3', board_id: 'pile:p1', ref_type: 'pile', ref_id: 'p2' }),
        bi({ id: '4', board_id: 'pile:p2', ref_type: 'cover', ref_id: 'r1' }),
        bi({ id: '5', board_id: 'pile:p2', ref_type: 'pile', ref_id: 'p1' }),
      ],
      strokes: [{ id: 's', board_id: 'pile:p1', points: [], color: '', size: 1, updated_at: T }],
    }))
    expect(md).toContain('## 堆：共在')
    expect(md).toContain('【问题】\n堆里的问题')
    expect(md).toContain('- 论文a')
    expect(md).toContain('### 堆：子堆')
    expect(md).toContain('整份记录里的发现')
    expect(md).toContain('（这个堆在上面已经列过）')
    expect(md).toContain('[手绘图片：共在]')
    expect(md).toContain('- **论文a**（Jane Smith, 2024）：a 的一句话总结')
  })

  it('原件已经删除的项直接跳过；末尾附两套模板', () => {
    const md = buildExport(base({
      items: [item('i1', 'paper', 'gone'), item('i2', 'card', 'gone', 1), item('i3', 'paper', 'a', 2)],
      papers: [paper('a'), paper('gone', { deleted: true })],
    }))
    expect(md).not.toContain('论文gone')
    expect(md).toContain('### 论文a')
    expect(md).toContain('## 研究记录的模板')
    expect(md).toContain('type: research')
    expect(md).toContain('## 论文的模板')
    expect(md).toContain('type: paper')
  })

  it('手动写的卡片：单张、整块画板里都会导出，和导入的一视同仁', () => {
    const manual = (id: string, kind: Card['kind'], body: string, order: number): Card => ({
      id, record_id: '', date: '2026-11-10', kind, heading: kind, body_md: body, order, updated_at: T,
    })
    const cards = [card('c1', 'r1', '2026-11-10', '发现', '导入的发现'), manual('m1', '问题', '手写的问题', 1), manual('m2', '下一步', '手写的下一步', 2)]
    const whole = buildExport(base({ items: [item('i1', 'day', '2026-11-10')], records: [record('r1', '2026-11-10')], cards }))
    expect(whole).toContain('导入的发现')
    expect(whole).toContain('### 我在画板上写的卡片')
    expect(whole).toContain('【问题】\n手写的问题')
    expect(whole).toContain('【下一步】\n手写的下一步')

    const onlyManualDay = buildExport(base({ items: [item('i1', 'day', '2026-11-10')], cards: [manual('m1', '思考', '空白日子上写的', 1)] }))
    expect(onlyManualDay).toContain('【思考】\n空白日子上写的')
    expect(onlyManualDay).not.toContain('这一天没有研究卡片')

    const single = buildExport(base({ items: [item('i1', 'card', 'm1')], cards }))
    expect(single).toContain('### 2026-11-10 · 我在画板上写的')
    expect(single).toContain('【问题】\n手写的问题')
  })

  it('同样的内容导出两次，文字完全一样', () => {
    const data = base({ items: [item('i1', 'paper', 'a')], papers: [paper('a')] })
    expect(buildExport(data)).toBe(buildExport(data))
  })
})
