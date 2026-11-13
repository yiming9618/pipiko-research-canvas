import { describe, expect, it } from 'vitest'
import { builtinTypes, planImport, type ImportContext } from './importer'
import type { Board, Changes, Paper, TableName } from './types'

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
    fields: tables.fields,
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
    expect(out.message).toBe('生成了 3 张卡片，放进新画板「未命名画板」')
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
    expect(out.message).toBe('只有封面，放进新画板「未命名画板」')
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

describe('研究记录放进哪块画板', () => {
  const md = (board = '', date = '2026-11-10') =>
    `---\ntype: research\ndate: ${date}\ntitle: 记录\n${board ? `board: ${board}\n` : ''}---\n## 发现\na\n## 问题\nb\n`
  const board = (id: string, name: string, created = '2026-11-01T00:00:00.000Z'): Board => ({ id, name, created_at: created, updated_at: created })
  const plan = (text: string, extra: Partial<ImportContext> = {}) => {
    let n = 0
    return planImport(text, {
      papers: [], types: builtinTypes(), blocks: [], imports: [], today: '2026-11-11', now: '2026-11-11T10:00:00.000Z',
      kindHint: 'research', newId: (p) => `${p}_${++n}`, ...extra,
    })
  }
  const boards = [board('b1', '霉菌研究'), board('b2', '霉菌实验记录'), board('b3', '共在的理论框架')]

  it('没写 board：放进面板上选的那块，记录和每张卡片都记下所属画板', () => {
    const out = plan(md(), { boards, target: { id: 'b2' }, placeOn: () => ({ x: 780, y: 0 }) })
    expect(out.stored).toBe(true)
    expect(out.board).toEqual({ id: 'b2', name: '霉菌实验记录', created: false })
    expect(out.changes.records![0]).toMatchObject({ board_id: 'b2', origin: { x: 780, y: 0 } })
    expect(out.changes.cards!.every((c) => c.board_id === 'b2' && c.date === '2026-11-10')).toBe(true)
    expect(out.changes.boards).toBeUndefined()
    expect(out.changes.boardUse).toEqual([{ id: 'b2', last_used_at: '2026-11-11T10:00:00.000Z', updated_at: '2026-11-11T10:00:00.000Z' }])
    expect(out.message).toBe('生成了 2 张卡片，放进画板「霉菌实验记录」')
  })

  it('面板上选了“新建”：建好画板再放进去', () => {
    const out = plan(md(), { boards, target: { newName: '新的主题' } })
    expect(out.changes.boards).toHaveLength(1)
    expect(out.changes.boards![0]).toMatchObject({ name: '新的主题' })
    expect(out.changes.records![0].board_id).toBe(out.changes.boards![0].id)
    expect(out.board?.created).toBe(true)
    expect(out.message).toContain('新画板「新的主题」')
  })

  it('写了 board 而且名称对上：以它为准，优先于面板上的选择（不看大小写、空格、标点）', () => {
    const out = plan(md('霉菌研究'), { boards, target: { id: 'b3' }, placeOn: () => ({ x: 0, y: 0 }) })
    expect(out.board?.id).toBe('b1')
    expect(plan(md(' 霉菌 研究。'), { boards, target: { id: 'b3' } }).board?.id).toBe('b1')
  })

  it('写了 board 但对不上：什么都不存，问我是新建还是放进相近的，不自动猜', () => {
    const out = plan(md('霉菌实验'), { boards, target: { id: 'b3' } })
    expect(out.stored).toBe(false)
    expect(out.changes).toEqual({})
    expect(out.needsBoard?.name).toBe('霉菌实验')
    // 「霉菌研究」只有“霉菌”两个字相同，不算相近
    expect(out.needsBoard?.similar.map((b) => b.name)).toEqual(['霉菌实验记录'])
  })

  it('没有相近的画板：只问要不要新建', () => {
    expect(plan(md('完全不同的名字'), { boards }).needsBoard).toEqual({ name: '完全不同的名字', similar: [] })
  })

  it('我回答之后：按我的回答放，不再问', () => {
    const chosen = plan(md('霉菌实验'), { boards, target: { id: 'b2' }, decided: true })
    expect(chosen.stored).toBe(true)
    expect(chosen.board?.id).toBe('b2')
    const created = plan(md('霉菌实验'), { boards, target: { newName: '霉菌实验' }, decided: true })
    expect(created.changes.boards![0].name).toBe('霉菌实验')
  })

  it('模板里没改的那行 board 不算画板名', () => {
    const out = plan(md('画板名称（可选，不确定就删掉这一行）'), { boards, target: { id: 'b1' } })
    expect(out.stored).toBe(true)
    expect(out.board?.id).toBe('b1')
  })

  it('同一份内容再粘贴一次仍然提示已导入，不会再问画板', () => {
    const first = plan(md('霉菌研究'), { boards, target: { id: 'b1' } })
    const again = plan(md('霉菌研究'), { boards, target: { id: 'b1' }, imports: [first.entry!] })
    expect(again.stored).toBe(false)
    expect(again.message).toContain('已经导入过了')
  })

  it('论文导入和画板无关', () => {
    const out = plan('---\ntype: paper\ntitle: 一篇论文\ndate: 2026-11-10\n---\n## 一句话总结\n总结\n', { boards, kindHint: 'paper' })
    expect(out.stored).toBe(true)
    expect(out.board).toBeUndefined()
    expect(out.changes.boards).toBeUndefined()
  })
})

describe('论文领域', () => {
  const md = (title: string, category: string, doi = '') =>
    `---\ntype: paper\ntitle: ${title}\n${doi ? `doi: ${doi}\n` : ''}${category ? `category: ${category}\n` : ''}date: 2026-11-10\n---\n## 一句话总结\n总结\n`

  it('category 对不上已有领域：新建一个领域，论文归入', () => {
    const { tables, run } = makeStore()
    const out = run(md('论文一', 'Living media'), 'paper')
    expect(tables.fields).toHaveLength(1)
    expect(tables.fields[0].name).toBe('Living media')
    expect(tables.papers[0].field_id).toBe(tables.fields[0].id)
    expect(out.entry?.effects?.fields_created).toEqual([tables.fields[0].id])
  })

  it('category 对上已有领域（不看大小写和空格）：归入，不新建', () => {
    const { tables, run } = makeStore()
    run(md('论文一', 'Living media'), 'paper')
    run(md('论文二', ' living  MEDIA '), 'paper')
    expect(tables.fields).toHaveLength(1)
    expect(tables.papers.map((p) => p.field_id)).toEqual([tables.fields[0].id, tables.fields[0].id])
  })

  it('没写 category：未分类，不建领域', () => {
    const { tables, run } = makeStore()
    run(md('论文一', ''), 'paper')
    expect(tables.fields).toHaveLength(0)
    expect(tables.papers[0].field_id).toBeUndefined()
  })

  it('再次导入同一篇：已有的领域不被覆盖，包括我特意设成的未分类', () => {
    const { tables, run } = makeStore()
    run(md('论文一', '霉菌', '10.1/a'), 'paper')
    const first = tables.papers[0].field_id
    run(md('论文一', '别的领域', '10.1/a'), 'paper')
    expect(tables.papers[0].field_id).toBe(first)
    expect(tables.fields).toHaveLength(1)
    tables.papers[0] = { ...tables.papers[0], field_id: '' }
    run(md('论文一', '又一个领域', '10.1/a') + '\n', 'paper')
    expect(tables.papers[0].field_id).toBe('')
  })

  it('想看的论文没有领域，导入后得到 Markdown 里的领域', () => {
    const { tables, run } = makeStore()
    tables.papers.push({ id: 'w', title: '论文一', authors: [], year: null, venue: '', doi: '', category: '', keywords: [], status: 'want', url: '', one_liner: '', basics_md: '', created_at: 't', updated_at: 't' } as Paper)
    const out = run(md('论文一', '霉菌'), 'paper')
    expect(tables.papers[0].field_id).toBe(tables.fields[0].id)
    expect(out.entry?.effects?.field_set).toBe(true)
  })
})
