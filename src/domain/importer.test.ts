import { describe, expect, it } from 'vitest'
import { builtinTypes, planImport, type ImportContext } from './importer'
import type { Changes, Paper, TableName } from './types'

/** A tiny in-memory store that applies the changes an import returns. */
function makeStore() {
  let n = 0
  const tables: Required<Changes> = {
    imports: [],
    papers: [],
    blocks: [],
    types: builtinTypes(),
    comments: [],
    records: [],
    cards: [],
    boardItems: [],
    connectors: [],
    strokes: [],
    piles: [],
    settings: [],
    assets: [],
    discussions: [],
    discussionItems: [],
    boards: [],
    boardUse: [],
    fields: [],
  }
  const ctx = (kindHint: 'paper' | 'research'): ImportContext => ({
    papers: tables.papers,
    types: tables.types,
    blocks: tables.blocks,
    imports: tables.imports,
    today: '2026-11-11',
    now: `2026-11-11T10:00:${String(n).padStart(2, '0')}.000Z`,
    kindHint,
    newId: (prefix) => `${prefix}_${++n}`,
  })
  const run = (md: string, kindHint: 'paper' | 'research' = 'research') => {
    const out = planImport(md, ctx(kindHint))
    for (const key of Object.keys(out.changes) as TableName[]) {
      const table = tables[key] as { id: string }[]
      for (const row of out.changes[key] as { id: string }[]) {
        const i = table.findIndex((r) => r.id === row.id)
        if (i >= 0) table[i] = row
        else table.push(row)
      }
    }
    return out
  }
  return { tables, run }
}

const paperMd = (extra = '', date = '2026-11-01') => `---
type: paper
title: Living Media Interfaces
authors: Jane Smith
year: 2024
venue: CHI
doi: 10.1145/AAA
category: Living media
keywords: 活体
date: ${date}
---

## 一句话总结
用活的材料做界面。

## 基础
1. 在什么领域：Bio-HCI

## 重点：研究方法
六周部署。
${extra}`

const researchMd = (title: string, date = '2026-11-10') => `---
type: research
date: ${date}
title: ${title}
summary: s
---

## 发现
a

## 问题
b

## 问题
c
`

describe('导入研究记录', () => {
  it('生成卡片并给出结果提示', () => {
    const { tables, run } = makeStore()
    const out = run(researchMd('第一份'))
    expect(out.message).toBe('生成了 3 张卡片，放进 11/10 的画板')
    expect(tables.records).toHaveLength(1)
    expect(tables.cards).toHaveLength(3)
    expect(tables.imports[0].raw_md).toBe(researchMd('第一份'))
    expect(tables.cards.every((c) => c.import_id === tables.imports[0].id)).toBe(true)
  })

  it('同一天导入多份：汇进同一天，各自保留封面', () => {
    const { tables, run } = makeStore()
    run(researchMd('上午'))
    run(researchMd('下午'))
    expect(tables.records.map((r) => [r.date, r.title])).toEqual([
      ['2026-11-10', '上午'],
      ['2026-11-10', '下午'],
    ])
    expect(tables.cards.filter((c) => c.date === '2026-11-10')).toHaveLength(6)
    expect(new Set(tables.cards.map((c) => c.record_id)).size).toBe(2)
  })

  it('完全相同的内容再粘贴一次不重复生成', () => {
    const { tables, run } = makeStore()
    run(researchMd('一份'))
    const again = run(researchMd('一份') + '\n\n')
    expect(again.stored).toBe(false)
    expect(again.message).toContain('已经导入过')
    expect(tables.records).toHaveLength(1)
  })

  it('没有卡片时只有封面', () => {
    const { tables, run } = makeStore()
    const out = run(`---\ntype: research\ndate: 2026-11-10\ntitle: 空的\n---\n`)
    expect(out.message).toBe('只有封面，放进 11/10 的画板')
    expect(tables.cards).toHaveLength(0)
  })
})

describe('导入论文', () => {
  it('新论文', () => {
    const { tables, run } = makeStore()
    const out = run(paperMd(), 'paper')
    expect(out.message).toBe('1 篇论文放进论文库；生成了 1 个重点区块')
    expect(tables.papers).toHaveLength(1)
    expect(tables.papers[0].status).toBe('read')
    expect(tables.blocks[0].type_id).toBe('type_method')
  })

  it('重复导入同一篇论文：不新建，追加区块和理解，基础不覆盖', () => {
    const { tables, run } = makeStore()
    run(paperMd(), 'paper')
    const second = `---
type: paper
title: 另一个写法的标题
doi: https://doi.org/10.1145/aaa
venue: 不该覆盖
date: 2026-12-03
---

## 一句话总结
不该覆盖的总结

## 基础
1. 在什么领域：不该覆盖

## 重点：讨论 & 局限
样本小。

## 我的理解
重读后的新感想。
`
    const out = run(second, 'paper')
    expect(tables.papers).toHaveLength(1)
    const p = tables.papers[0]
    expect(p.title).toBe('Living Media Interfaces')
    expect(p.venue).toBe('CHI')
    expect(p.one_liner).toBe('用活的材料做界面。')
    expect(p.basics_md).toContain('Bio-HCI')
    expect(tables.blocks.map((b) => [b.type_id, b.order])).toEqual([
      ['type_method', 0],
      ['type_discussion', 1],
    ])
    expect(tables.comments).toHaveLength(1)
    expect(tables.comments[0]).toMatchObject({ source: 'ai', date: '2026-12-03', paper_id: p.id })
    expect(out.message).toContain('1 篇论文已合并')
    expect(out.message).toContain('基础部分已有内容，没有覆盖')
    expect(out.entry?.effects?.paper_created).toBe(false)
  })

  it('没有 DOI 时用标题匹配', () => {
    const { tables, run } = makeStore()
    run(`---\ntype: paper\ntitle: A Study of Mold\n---\n## 重点：研究方法\nx\n`, 'paper')
    run(`---\ntype: paper\ntitle: a study of  mold!\n---\n## 重点：研究方法\ny\n`, 'paper')
    expect(tables.papers).toHaveLength(1)
    expect(tables.blocks).toHaveLength(2)
  })

  it('标题相同但 DOI 不同是两篇论文', () => {
    const { tables, run } = makeStore()
    run(`---\ntype: paper\ntitle: Same\ndoi: 10.1/a\n---\n`, 'paper')
    run(`---\ntype: paper\ntitle: Same\ndoi: 10.1/b\n---\n`, 'paper')
    expect(tables.papers).toHaveLength(2)
  })

  it('已有论文缺的字段会被补上', () => {
    const { tables, run } = makeStore()
    run(`---\ntype: paper\ntitle: Living Media Interfaces\ndoi: 10.1145/aaa\n---\n`, 'paper')
    const out = run(paperMd(), 'paper')
    expect(tables.papers[0].venue).toBe('CHI')
    expect(tables.papers[0].basics_md).toContain('Bio-HCI')
    expect(out.entry?.effects?.filled).toEqual(
      expect.arrayContaining(['authors', 'year', 'venue', 'category', 'one_liner', 'basics_md']),
    )
  })

  it('未知重点类型：保存原文、默认颜色、加进类型清单，再次出现不重复加', () => {
    const { tables, run } = makeStore()
    const out = run(paperMd('\n## 重点：伦理\n需要知情同意。\n'), 'paper')
    const added = tables.types.filter((t) => !t.builtin)
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ name: '伦理', color: 'default' })
    expect(tables.blocks.find((b) => b.type_id === added[0].id)?.body_md).toBe('需要知情同意。')
    expect(out.message).toContain('新的重点类型：伦理')

    run(paperMd('\n## 重点： 伦理\n另一条。\n', '2026-11-02'), 'paper')
    expect(tables.types.filter((t) => !t.builtin)).toHaveLength(1)
  })

  it('类型名不受空格和全半角影响', () => {
    const { tables, run } = makeStore()
    run(paperMd('\n## 重点：研究动机&RQ\nx\n'), 'paper')
    expect(tables.types.filter((t) => !t.builtin)).toHaveLength(0)
    expect(tables.blocks.some((b) => b.type_id === 'type_motivation')).toBe(true)
  })

  it('在"想看"里的论文，导入后自动移到"已读"', () => {
    const { tables, run } = makeStore()
    const want: Paper = {
      id: 'paper_want',
      title: 'living media interfaces',
      authors: [],
      year: null,
      venue: '',
      doi: '',
      category: '',
      keywords: [],
      status: 'want',
      url: 'https://example.org/p',
      one_liner: '',
      basics_md: '',
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    }
    tables.papers.push(want)
    const out = run(paperMd(), 'paper')
    expect(tables.papers).toHaveLength(1)
    expect(tables.papers[0]).toMatchObject({
      id: 'paper_want',
      status: 'read',
      title: 'Living Media Interfaces',
      doi: '10.1145/aaa',
      url: 'https://example.org/p',
    })
    expect(out.message).toContain('从"想看"移到"已读"')
    expect(out.entry?.effects?.want_before).toEqual({
      title: 'living media interfaces',
      url: 'https://example.org/p',
    })
  })
})

describe('研究记录提到的论文、相似标题', () => {
  const research = (dois: string, date = '2026-11-10') =>
    `---\ntype: research\ndate: ${date}\ntitle: 记录\npapers: ${dois}\n---\n## 发现\na\n`
  const want = (over: Partial<Paper>): Paper => ({
    id: 'w1', title: '', authors: [], year: null, venue: '', doi: '', category: '', keywords: [],
    status: 'want', url: '', one_liner: '', basics_md: '', created_at: 't', updated_at: 't', ...over,
  })

  it('papers 里库里没有的 DOI 自动加进想看，标记为 AI 提到的，记下来源', () => {
    const { tables, run } = makeStore()
    run(paperMd(), 'paper') // 10.1145/aaa is in the library
    const out = run(research('10.1145/AAA, 10.1145/new1, 10.1145/new1, 10.1145/new2'))
    const wants = tables.papers.filter((p) => p.status === 'want')
    expect(wants.map((p) => p.doi)).toEqual(['10.1145/new1', '10.1145/new2'])
    expect(wants[0]).toMatchObject({ added_by: 'ai', lookup: 'pending', title: '' })
    expect(wants[0].mentioned_in).toEqual([{ date: '2026-11-10', record_id: tables.records[0].id }])
    expect(out.entry?.wants_created).toHaveLength(2)
    expect(out.message).toContain('提到的 2 篇论文库里没有，已加进"想看"')
  })

  it('第二份记录又提到同一篇：不重复添加，只多记一个来源', () => {
    const { tables, run } = makeStore()
    run(research('10.1145/new1', '2026-11-08'))
    const out = run(research('10.1145/new1', '2026-11-10'))
    const wants = tables.papers.filter((p) => p.status === 'want')
    expect(wants).toHaveLength(1)
    expect(wants[0].mentioned_in?.map((m) => m.date)).toEqual(['2026-11-08', '2026-11-10'])
    expect(out.entry?.wants_created).toBeUndefined()
    expect(out.entry?.mentions_added).toEqual([wants[0].id])
  })

  it('我自己加的想看被记录提到：不改动它', () => {
    const { tables, run } = makeStore()
    tables.papers.push(want({ doi: '10.1145/mine', added_by: 'me', title: '我加的' }))
    run(research('10.1145/mine'))
    expect(tables.papers).toHaveLength(1)
    expect(tables.papers[0].mentioned_in).toBeUndefined()
  })

  it('AI 提到的想看，之后导入这篇论文：按 DOI 对上，转为已读', () => {
    const { tables, run } = makeStore()
    run(research('10.1145/aaa'))
    const out = run(paperMd(), 'paper')
    expect(tables.papers).toHaveLength(1)
    expect(tables.papers[0]).toMatchObject({ status: 'read', title: 'Living Media Interfaces' })
    expect(out.similar).toBeUndefined()
  })

  it('DOI 和标题都没对上，但想看里有相似标题：只是问，不自动合并', () => {
    const { tables, run } = makeStore()
    tables.papers.push(want({ title: 'living media interfaces paper' }))
    const out = run(paperMd(), 'paper')
    expect(tables.papers).toHaveLength(2)
    expect(tables.papers[0].status).toBe('want')
    expect(out.similar).toEqual({ paper_id: tables.papers[1].id, want_id: 'w1', want_title: 'living media interfaces paper' })
  })

  it('相似但两边 DOI 不同：不问', () => {
    const { tables, run } = makeStore()
    tables.papers.push(want({ title: 'living media interfaces paper', doi: '10.9/other' }))
    expect(run(paperMd(), 'paper').similar).toBeUndefined()
    expect(tables.papers).toHaveLength(2)
  })
})
