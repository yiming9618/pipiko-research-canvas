import { describe, expect, it } from 'vitest'
import { exportPaper, noteStamp } from './exportPaper'
import { legacyFieldId } from './migrate'
import type { Comment, Field, HighlightType, Paper, PaperBlock } from './types'

const T = '2026-11-10T10:00:00.000Z'
const paper = (over: Partial<Paper> = {}): Paper => ({
  id: 'p', title: '论文标题', authors: ['作者甲', '作者乙'], year: 2024, venue: '会议名称', doi: '10.1/x', category: '霉菌', keywords: [],
  status: 'read', url: 'https://example.org/p', one_liner: '一句话总结：xxxxxxx', basics_md: '1. 在什么领域：xxxxxxx', created_at: T, updated_at: T, ...over,
})
const types: HighlightType[] = [
  { id: 't1', name: '研究方法', color: 'green', builtin: true, aliases: [], order: 1, updated_at: T },
  { id: 't2', name: '研究主旨/贡献', color: 'red', builtin: true, aliases: [], order: 0, updated_at: T },
]
const block = (id: string, type: string | null, body: string, order: number, over: Partial<PaperBlock> = {}): PaperBlock => ({
  id, paper_id: 'p', type_id: type, heading: type ? '' : '附录', body_md: body, order, updated_at: T, ...over,
})
const comment = (id: string, date: string, source: Comment['source'], text: string, over: Partial<Comment> = {}): Comment => ({
  id, paper_id: 'p', date, source, text, updated_at: `${date}T10:00:00.000Z`, ...over,
})
const fields: Field[] = [{ id: legacyFieldId('霉菌'), name: '霉菌', created_at: T, updated_at: T }]

describe('论文导出 Markdown', () => {
  const md = exportPaper({
    paper: paper(),
    types,
    fields,
    blocks: [
      block('b1', 't1', '原文的方法', 1, { edited_md: '我改过的方法' }),
      block('b2', 't2', '主旨', 0),
      block('b3', null, '附录内容', 2),
      block('b4', 't1', '删掉的', 3, { deleted: true }),
    ],
    comments: [
      comment('c2', '2026-11-12', 'me', '后来的理解'),
      comment('c1', '2026-11-10', 'ai', '最初的理解'),
      comment('c3', '2026-11-11', 'drawing', '', { asset_id: 'a1' }),
      comment('c4', '2026-11-13', 'me', '删掉的理解', { deleted: true }),
    ],
  })

  it('基本信息：标题、作者、年份、期刊、DOI、链接、领域', () => {
    expect(md.startsWith('# 论文标题\n')).toBe(true)
    for (const line of ['- 作者：作者甲, 作者乙', '- 年份：2024', '- 期刊/会议：会议名称', '- DOI：10.1/x', '- 链接：https://example.org/p', '- 领域：霉菌']) {
      expect(md).toContain(line)
    }
  })

  it('一句话总结、基础', () => {
    expect(md).toContain('## 一句话总结\n\n一句话总结：xxxxxxx')
    expect(md).toContain('## 基础\n\n1. 在什么领域：xxxxxxx')
  })

  it('重点区块带类型名称，按顺序，用改过的文字，删掉的不出现', () => {
    expect(md).toContain('### 研究主旨/贡献\n\n主旨')
    expect(md).toContain('### 研究方法\n\n我改过的方法')
    expect(md.indexOf('### 研究主旨/贡献')).toBeLessThan(md.indexOf('### 研究方法'))
    expect(md).not.toContain('原文的方法')
    expect(md).not.toContain('删掉的')
    expect(md).toContain('## 附录\n\n附录内容')
  })

  it('我的理解：按日期从早到晚，标出来源；手绘用占位', () => {
    const at = (s: string) => md.indexOf(s)
    expect(md).toContain('### 2026-11-10 · AI 整理\n\n最初的理解')
    expect(md).toContain('### 2026-11-11 · 手绘\n\n[手绘图片：2026-11-11]')
    expect(md).toContain('### 2026-11-12 · 我写的\n\n后来的理解')
    expect(at('最初的理解')).toBeLessThan(at('[手绘图片'))
    expect(at('[手绘图片')).toBeLessThan(at('后来的理解'))
  })

  it('没有的部分不写空标题；没有领域写“未分类”', () => {
    const bare = exportPaper({ paper: paper({ one_liner: '', basics_md: '', category: '', url: '', doi: '', authors: [], year: null, venue: '' }), types, fields, blocks: [], comments: [] })
    expect(bare).toBe('# 论文标题\n\n- 领域：未分类\n')
  })

  it('想看的论文写明状态和理由', () => {
    const want = exportPaper({ paper: paper({ status: 'want', why: '导师推荐' }), types, fields, blocks: [], comments: [] })
    expect(want).toContain('- 状态：想看（还没读）')
    expect(want).toContain('- 为什么想看：导师推荐')
  })

  it('手动改过的领域以改的为准', () => {
    const own = exportPaper({ paper: paper({ field_id: 'f2' }), types, fields: [...fields, { id: 'f2', name: '交互设计', created_at: T, updated_at: T }], blocks: [], comments: [] })
    expect(own).toContain('- 领域：交互设计')
  })
})

describe('理解和重点卡片的对应、时间', () => {
  const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).toISOString()
  const data = (comments: Comment[], blocks: PaperBlock[]) => exportPaper({ paper: paper(), types, fields, blocks, comments })

  it('手写的理解显示到分钟；导入的、旧的只显示日期，不编造时间', () => {
    expect(noteStamp({ date: '2026-11-12', created_at: at(2026, 11, 12, 9, 5) })).toBe('2026-11-12 09:05')
    expect(noteStamp({ date: '2026-11-10' })).toBe('2026-11-10')
    expect(noteStamp({ date: '2026-11-10', created_at: 'not a time' })).toBe('2026-11-10')
  })

  it('关联到卡片的理解写明对应哪张重点；同一类型有几张时带编号', () => {
    const md = data(
      [
        comment('c1', '2026-11-12', 'me', '关于第二张方法', { block_id: 'm2', created_at: at(2026, 11, 12, 14, 30) }),
        comment('c2', '2026-11-12', 'me', '关于主旨', { block_id: 'g' }),
        comment('c3', '2026-11-12', 'me', '整篇的评价'),
      ],
      [block('g', 't2', '主旨', 0), block('m1', 't1', '方法一', 1), block('m2', 't1', '方法二', 2)],
    )
    expect(md).toContain('### 研究方法 1\n\n方法一')
    expect(md).toContain('### 研究方法 2\n\n方法二')
    expect(md).toContain('### 研究主旨/贡献\n\n主旨')
    expect(md).toContain('### 2026-11-12 14:30 · 我写的 · 对应重点：研究方法 2\n\n关于第二张方法')
    expect(md).toContain('· 对应重点：研究主旨/贡献\n\n关于主旨')
    expect(md).toContain('### 2026-11-12 · 我写的\n\n整篇的评价')
  })

  it('对应的卡片删掉了：这条理解照常导出，当作整篇的', () => {
    const md = data([comment('c1', '2026-11-12', 'me', '卡片删掉后的理解', { block_id: 'gone' })], [block('gone', 't1', '已删除', 0, { deleted: true })])
    expect(md).toContain('### 2026-11-12 · 我写的\n\n卡片删掉后的理解')
    expect(md).not.toContain('对应重点')
  })
})
