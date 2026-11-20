import { describe, expect, it } from 'vitest'
import { mergeEntries } from '../store/merge'
import { fileOf, tablesIn } from '../sync/files'
import { exportPaper } from './exportPaper'
import { firstReadingId, paperReadings, readingIdOfImport, readingIsEmpty, readingLabel } from './readings'
import type { Comment, HighlightType, ImportEntry, Paper, PaperBlock, Reading } from './types'

const T = '2026-11-10T10:00:00.000Z'
const paper = (over: Partial<Paper> = {}): Paper => ({
  id: 'p', title: '论文标题', authors: [], year: null, venue: '', doi: '10.1/x', category: '', keywords: [],
  status: 'read', url: '', one_liner: '', basics_md: '', created_at: '2026-11-01T08:00:00.000Z', updated_at: T, ...over,
})
const imp = (id: string, date: string, over: Partial<ImportEntry> = {}): ImportEntry => ({
  id, kind: 'paper', raw_md: '', raw_hash: id, date, imported_at: `${date}T09:00:00.000Z`, notices: [], message: '', paper_id: 'p', updated_at: T, ...over,
})
const block = (id: string, over: Partial<PaperBlock> = {}): PaperBlock => ({
  id, paper_id: 'p', type_id: 't1', heading: '', body_md: `内容 ${id}`, order: 0, updated_at: T, ...over,
})
const note = (id: string, over: Partial<Comment> = {}): Comment => ({
  id, paper_id: 'p', date: '2026-11-10', source: 'me', text: `理解 ${id}`, updated_at: T, ...over,
})
const row = (id: string, over: Partial<Reading> = {}): Reading => ({ id, paper_id: 'p', date: '2026-11-10', title: '', created_at: T, updated_at: T, ...over })
const types: HighlightType[] = [{ id: 't1', name: '研究方法', color: 'green', builtin: true, aliases: [], order: 0, updated_at: T }]

describe('现有数据：每次导入各成一次阅读，什么都不用改写', () => {
  // imported out of date order on purpose: numbers follow the date
  const imports = [imp('i2', '2026-11-12'), imp('i1', '2026-11-05'), imp('i3', '2026-11-20', { undone: true })]
  const blocks = [block('b1', { import_id: 'i1' }), block('b2', { import_id: 'i2' }), block('hand')]
  const comments = [note('c1', { import_id: 'i1', source: 'ai' }), note('c2', { import_id: 'i2', source: 'ai' }), note('mine'), note('card', { block_id: 'b2' })]
  const pr = paperReadings({ paper: paper(), readings: [], imports, blocks, comments })

  it('过去每一次导入各自是一次阅读，按日期编号；撤销了的导入不算', () => {
    expect(pr.list.map((r) => [r.number, r.id, r.date])).toEqual([
      [1, readingIdOfImport('i1'), '2026-11-05'],
      [2, readingIdOfImport('i2'), '2026-11-12'],
    ])
  })

  it('导入来的重点和理解归到那次导入的阅读', () => {
    expect(pr.readingOf(blocks[0])).toBe('r-i1')
    expect(pr.readingOf(blocks[1])).toBe('r-i2')
    expect(pr.readingOf(comments[0])).toBe('r-i1')
    expect(pr.readingOf(comments[1])).toBe('r-i2')
  })

  it('手动加的重点和理解（包括关联到卡片的理解）归到第 1 次阅读', () => {
    expect(pr.readingOf(blocks[2])).toBe('r-i1')
    expect(pr.readingOf(comments[2])).toBe('r-i1')
    expect(pr.readingOf(comments[3])).toBe('r-i1')
  })

  it('同样的数据在任何设备上算出同样的编号（id 来自导入）', () => {
    const again = paperReadings({ paper: paper(), readings: [], imports: [...imports].reverse(), blocks, comments })
    expect(again.list.map((r) => r.id)).toEqual(pr.list.map((r) => r.id))
  })

  it('没有任何内容丢失：每一条都归到某一次阅读', () => {
    const ids = new Set(pr.list.map((r) => r.id))
    for (const x of [...blocks, ...comments]) expect(ids.has(pr.readingOf(x))).toBe(true)
  })
})

describe('小标题、手动新建、删除空的阅读', () => {
  it('reading_title 作为这次阅读的小标题；改过的小标题以存下来的为准', () => {
    const imports = [imp('i1', '2026-11-05', { reading_title: '原文精读' })]
    const before = paperReadings({ paper: paper(), readings: [], imports, blocks: [], comments: [] })
    expect(readingLabel(before.list[0])).toBe('第 1 次阅读｜原文精读｜2026-11-05')
    const after = paperReadings({ paper: paper(), readings: [row('r-i1', { title: '研究逻辑整理', date: '2026-11-05' })], imports, blocks: [], comments: [] })
    expect(readingLabel(after.list[0])).toBe('第 1 次阅读｜研究逻辑整理｜2026-11-05')
    expect(after.list).toHaveLength(1)
  })

  it('没有小标题时不显示多余的分隔', () => {
    expect(readingLabel({ number: 3, title: '  ', date: '2026-11-10' })).toBe('第 3 次阅读｜2026-11-10')
  })

  it('手动新建的阅读按日期排进去；放进去的重点和理解留在里面', () => {
    const pr = paperReadings({
      paper: paper(),
      readings: [row('reading_x', { date: '2026-11-08', created_at: '2026-11-08T12:00:00.000Z' })],
      imports: [imp('i1', '2026-11-05'), imp('i2', '2026-11-12')],
      blocks: [block('b', { reading_id: 'reading_x' })],
      comments: [note('c', { reading_id: 'reading_x' })],
    })
    expect(pr.list.map((r) => r.id)).toEqual(['r-i1', 'reading_x', 'r-i2'])
    expect(pr.readingOf({ reading_id: 'reading_x' })).toBe('reading_x')
  })

  it('同一天的两次阅读按建立先后排', () => {
    const pr = paperReadings({
      paper: paper(),
      readings: [row('reading_a', { date: '2026-11-05', created_at: '2026-11-05T20:00:00.000Z' })],
      imports: [imp('i1', '2026-11-05')],
      blocks: [],
      comments: [],
    })
    expect(pr.list.map((r) => r.id)).toEqual(['r-i1', 'reading_a'])
  })

  it('删除了的阅读不再出现；指向它的东西回到第 1 次（不会丢）', () => {
    const pr = paperReadings({
      paper: paper(),
      readings: [row('reading_x', { deleted: true })],
      imports: [imp('i1', '2026-11-05')],
      blocks: [block('b', { reading_id: 'reading_x' })],
      comments: [],
    })
    expect(pr.list.map((r) => r.id)).toEqual(['r-i1'])
    expect(pr.readingOf({ reading_id: 'reading_x' })).toBe('r-i1')
  })

  it('只有空的阅读算“空”', () => {
    const blocks = [block('b', { import_id: 'i1' }), block('gone', { import_id: 'i2', deleted: true })]
    const pr = paperReadings({ paper: paper(), readings: [], imports: [imp('i1', '2026-11-05'), imp('i2', '2026-11-06')], blocks, comments: [] })
    expect(readingIsEmpty('r-i1', pr.readingOf, blocks)).toBe(false)
    expect(readingIsEmpty('r-i2', pr.readingOf, blocks)).toBe(true)
  })
})

describe('导入：新的一次阅读，或添加到已有的某次', () => {
  it('添加到已有的阅读：这次导入不再单独成一次，内容跟过去', () => {
    const imports = [imp('i1', '2026-11-05'), imp('i2', '2026-11-12', { reading_id: 'r-i1' })]
    const pr = paperReadings({ paper: paper(), readings: [], imports, blocks: [block('b2', { import_id: 'i2' })], comments: [note('c2', { import_id: 'i2' })] })
    expect(pr.list.map((r) => r.id)).toEqual(['r-i1'])
    expect(pr.list[0].import_ids.sort()).toEqual(['i1', 'i2'])
    expect(pr.readingOf({ import_id: 'i2' })).toBe('r-i1')
  })

  it('它加入的那次阅读没了（比如被撤销），这次导入重新单独成一次', () => {
    const imports = [imp('i1', '2026-11-05', { undone: true }), imp('i2', '2026-11-12', { reading_id: 'r-i1' })]
    const pr = paperReadings({ paper: paper(), readings: [], imports, blocks: [block('b2', { import_id: 'i2' })], comments: [] })
    expect(pr.list.map((r) => r.id)).toEqual(['r-i2'])
    expect(pr.readingOf({ import_id: 'i2' })).toBe('r-i2')
  })
})

describe('没有导入过的论文', () => {
  it('已读但空的论文显示一个空的第 1 次阅读', () => {
    const pr = paperReadings({ paper: paper(), readings: [], imports: [], blocks: [], comments: [] })
    expect(pr.list.map((r) => [r.id, r.date])).toEqual([[firstReadingId('p'), '2026-11-01']])
  })

  it('只记了信息的论文（以前的“想看”）也有一个空的第 1 次阅读，可以直接写', () => {
    expect(paperReadings({ paper: paper({ status: 'want' }), readings: [], imports: [], blocks: [], comments: [] }).list.map((r) => r.id)).toEqual([firstReadingId('p')])
  })

  it('之后再导入：没内容的那个空阅读让位；有内容放进去的留下', () => {
    const imports = [imp('i1', '2026-11-12')]
    expect(paperReadings({ paper: paper(), readings: [], imports, blocks: [], comments: [] }).list.map((r) => r.id)).toEqual(['r-i1'])
    const kept = paperReadings({ paper: paper(), readings: [], imports, blocks: [block('b', { reading_id: firstReadingId('p') })], comments: [] })
    expect(kept.list.map((r) => r.id)).toEqual([firstReadingId('p'), 'r-i1'])
  })
})

describe('同步：多台设备不会产生重复的阅读', () => {
  it('两台设备给同一次过去的阅读写小标题：同一个 id，合并后只有一条，较新的小标题留下', () => {
    const a = row('r-i1', { title: '原文精读', updated_at: '2026-11-17T10:00:00.000Z' })
    const b = row('r-i1', { title: 'Paper Sharing 反馈', updated_at: '2026-11-17T11:00:00.000Z' })
    const { merged } = mergeEntries([a], [b])
    expect(merged).toHaveLength(1)
    expect(merged[0].title).toBe('Paper Sharing 反馈')
  })

  it('阅读存在自己的文件里（data/readings/<论文>.json），旧版应用改写论文文件时碰不到它', () => {
    expect(fileOf('readings', row('r-i1'))).toBe('data/readings/p.json')
    expect(tablesIn('data/readings/p.json')).toEqual(['readings'])
    expect(tablesIn('data/papers/p.json')).not.toContain('readings')
  })
})

describe('导出按阅读分组', () => {
  const md = exportPaper({
    paper: paper({ basics_md: '1. 在什么领域：xxxxxxx' }),
    types,
    fields: [],
    imports: [imp('i1', '2026-11-05', { reading_title: '原文精读' }), imp('i2', '2026-11-12')],
    readings: [],
    blocks: [block('b1', { import_id: 'i1', body_md: '第一次的方法' }), block('b2', { import_id: 'i2', body_md: '第二次的方法' })],
    comments: [note('c1', { import_id: 'i1', date: '2026-11-05', source: 'ai', text: '第一次的理解' }), note('c2', { import_id: 'i2', date: '2026-11-12', text: '关于方法', block_id: 'b2' })],
  })

  it('每组带编号、小标题、日期；基础在论文层面只出现一次', () => {
    expect(md).toContain('## 第 1 次阅读｜原文精读｜2026-11-05')
    expect(md).toContain('## 第 2 次阅读｜2026-11-12')
    expect(md.indexOf('## 基础')).toBeLessThan(md.indexOf('## 第 1 次阅读'))
    expect(md.match(/## 基础/g)).toHaveLength(1)
  })

  it('重点和理解在各自那一次里，来源和对应的卡片照样标出', () => {
    const one = md.slice(md.indexOf('## 第 1 次'), md.indexOf('## 第 2 次'))
    const two = md.slice(md.indexOf('## 第 2 次'))
    expect(one).toContain('第一次的方法')
    expect(one).toContain('#### 2026-11-05 · AI 整理\n\n第一次的理解')
    expect(two).toContain('第二次的方法')
    expect(two).toContain('#### 2026-11-12 · 我写的 · 对应重点：研究方法\n\n关于方法')
    expect(one).not.toContain('第二次')
  })
})
