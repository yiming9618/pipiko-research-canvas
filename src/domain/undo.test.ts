import { describe, expect, it } from 'vitest'
import { builtinTypes, planImport } from './importer'
import { planUndo, type UndoSnapshot } from './undo'
import { mergeWant } from './mergeWant'
import type { BoardItem, Changes, Comment, Connector, Paper, TableName } from './types'

function makeStore() {
  let n = 0
  const t: Required<Changes> = {
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
  const apply = (changes: Changes) => {
    for (const key of Object.keys(changes) as TableName[]) {
      const table = t[key] as { id: string }[]
      for (const row of changes[key] as { id: string }[]) {
        const i = table.findIndex((r) => r.id === row.id)
        if (i >= 0) table[i] = row
        else table.push(row)
      }
    }
  }
  const run = (md: string, kindHint: 'paper' | 'research') => {
    const out = planImport(md, {
      papers: t.papers,
      types: t.types,
      fields: t.fields,
      blocks: t.blocks,
      imports: t.imports,
      today: '2026-11-11',
      now: `2026-11-11T10:00:${String(n).padStart(2, '0')}.000Z`,
      kindHint,
      newId: (p) => `${p}_${++n}`,
    })
    apply(out.changes)
    return out.entry!
  }
  const undo = (entryId: string) => {
    const entry = t.imports.find((e) => e.id === entryId)!
    const plan = planUndo(entry, t as UndoSnapshot, '2026-11-12T00:00:00.000Z')
    return { plan, commit: () => apply(plan.changes) }
  }
  const live = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)
  return { t, run, undo, live }
}

const RESEARCH = `---\ntype: research\ndate: 2026-11-10\ntitle: 一份\n---\n## 发现\na\n## 问题\nb\n`
const PAPER = `---\ntype: paper\ntitle: Living Media\ndoi: 10.1/a\nvenue: CHI\ndate: 2026-11-01\n---\n## 一句话总结\n总结\n## 重点：研究方法\nm\n## 重点：伦理\ne\n## 我的理解\nu\n`

const item = (over: Partial<BoardItem>): BoardItem => ({
  id: 'bi_x',
  board_id: 'day:2026-11-10',
  ref_type: 'card',
  ref_id: '',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  z: 0,
  updated_at: '2026-11-11T11:00:00.000Z',
  ...over,
})

describe('撤销研究记录的导入', () => {
  it('没有后续改动：直接撤销，没有需要确认的影响', () => {
    const { t, run, undo, live } = makeStore()
    const entry = run(RESEARCH, 'research')
    const { plan, commit } = undo(entry.id)
    expect(plan.impacts).toEqual([])
    commit()
    expect(live(t.records)).toHaveLength(0)
    expect(live(t.cards)).toHaveLength(0)
    expect(t.imports[0].undone).toBe(true)
    expect(t.imports[0].raw_md).toBe(RESEARCH) // the original text is kept
  })

  it('卡片被编辑过、移动过、放进堆里、连过线：先列出影响', () => {
    const { t, run, undo, live } = makeStore()
    const entry = run(RESEARCH, 'research')
    const [c1, c2] = t.cards
    t.piles.push({ id: 'pile_1', name: '共在', created_at: '', updated_at: '' })
    t.boardItems.push(
      item({ id: 'bi_1', ref_id: c1.id, text_override: '我改过的字' }),
      item({ id: 'bi_2', ref_id: c2.id, x: 300 }),
      item({ id: 'bi_3', ref_id: c1.id, board_id: 'pile:pile_1' }),
      item({ id: 'bi_other', ref_id: 'card_from_another_import' }),
    )
    const conn: Connector = {
      id: 'conn_1',
      board_id: 'day:2026-11-10',
      from: 'bi_1',
      to: 'bi_other',
      arrow: true,
      updated_at: '',
    }
    t.connectors.push(conn)

    const { plan, commit } = undo(entry.id)
    expect(plan.impacts).toEqual([
      '1 张卡片改过文字',
      '1 张卡片在画板上移动或调整过',
      '1 张卡片在堆「共在」里',
      '1 条连线会消失',
    ])
    commit()
    expect(live(t.boardItems).map((i) => i.id)).toEqual(['bi_other'])
    expect(live(t.connectors)).toHaveLength(0)
  })

  it('撤销后同样的内容可以重新导入', () => {
    const { t, run, undo, live } = makeStore()
    const entry = run(RESEARCH, 'research')
    undo(entry.id).commit()
    run(RESEARCH, 'research')
    expect(live(t.records)).toHaveLength(1)
  })
})

describe('撤销论文的导入', () => {
  it('新建的论文：论文、区块、理解、新类型一起撤掉', () => {
    const { t, run, undo, live } = makeStore()
    const entry = run(PAPER, 'paper')
    expect(live(t.types).some((x) => x.name === '伦理')).toBe(true)
    const { plan, commit } = undo(entry.id)
    expect(plan.impacts).toEqual([])
    commit()
    expect(live(t.papers)).toHaveLength(0)
    expect(live(t.blocks)).toHaveLength(0)
    expect(live(t.comments)).toHaveLength(0)
    expect(live(t.types).some((x) => x.name === '伦理')).toBe(false)
    expect(live(t.types)).toHaveLength(8)
  })

  it('论文下有我写的评论、改过的区块：先列出影响', () => {
    const { t, run, undo } = makeStore()
    const entry = run(PAPER, 'paper')
    t.blocks[0] = { ...t.blocks[0], edited_md: '我改的' }
    const mine: Comment = {
      id: 'cmt_mine',
      paper_id: t.papers[0].id,
      date: '2026-11-05',
      source: 'me',
      text: '我的感想',
      updated_at: '',
    }
    t.comments.push(mine)
    const { plan } = undo(entry.id)
    expect(plan.impacts).toEqual(['1 个重点区块改过文字', '你写的 1 条评论会一起删除'])
  })

  it('合并进已有论文的那次导入：只撤掉它追加的部分，论文和之前的内容都在', () => {
    const { t, run, undo, live } = makeStore()
    run(PAPER, 'paper')
    const second = run(
      `---\ntype: paper\ntitle: Living Media\ndoi: 10.1/a\ncategory: Bio\nkeywords: 新词\ndate: 2026-12-03\n---\n## 重点：讨论 & 局限\nd\n## 我的理解\n重读\n`,
      'paper',
    )
    expect(t.papers[0].category).toBe('Bio')
    undo(second.id).commit()
    expect(live(t.papers)).toHaveLength(1)
    expect(t.papers[0]).toMatchObject({ category: '', keywords: [], venue: 'CHI', one_liner: '总结' })
    expect(live(t.blocks).map((b) => b.body_md)).toEqual(['m', 'e'])
    expect(live(t.comments).map((c) => c.text)).toEqual(['u'])
  })

  it('先撤销第一次导入：后面还有别的导入，论文保留', () => {
    const { t, run, undo, live } = makeStore()
    const first = run(PAPER, 'paper')
    run(`---\ntype: paper\ntitle: Living Media\ndoi: 10.1/a\ndate: 2026-12-03\n---\n## 重点：研究方法\n第二次\n`, 'paper')
    undo(first.id).commit()
    expect(live(t.papers)).toHaveLength(1)
    expect(live(t.blocks).map((b) => b.body_md)).toEqual(['第二次'])
  })

  it('从"想看"转过来的论文：撤销后回到"想看"', () => {
    const { t, run, undo } = makeStore()
    const want: Paper = {
      id: 'paper_want',
      title: 'living media',
      authors: [],
      year: null,
      venue: '',
      doi: '',
      category: '',
      keywords: [],
      status: 'want',
      url: 'https://example.org',
      one_liner: '',
      basics_md: '',
      created_at: '',
      updated_at: '',
    }
    t.papers.push(want)
    const entry = run(PAPER, 'paper')
    expect(t.papers[0].status).toBe('read')
    undo(entry.id).commit()
    expect(t.papers[0]).toMatchObject({
      status: 'want',
      title: 'living media',
      url: 'https://example.org',
      doi: '',
      venue: '',
      one_liner: '',
    })
    expect(t.papers[0].deleted).toBeUndefined()
  })
})

describe('撤销：AI 提到的想看、确认合并的想看', () => {
  const R = (date: string) => `---\ntype: research\ndate: ${date}\ntitle: 记录\npapers: 10.1/new\n---\n## 发现\na\n`

  it('没动过的 AI 想看条目随记录一起移除，不需要确认', () => {
    const s = makeStore()
    const e = s.run(R('2026-11-10'), 'research')
    expect(s.live(s.t.papers)).toHaveLength(1)
    const u = s.undo(e.id)
    expect(u.plan.impacts).toEqual([])
    u.commit()
    expect(s.live(s.t.papers)).toHaveLength(0)
  })

  it('编辑过的保留，并列在影响清单里', () => {
    const s = makeStore()
    const e = s.run(R('2026-11-10'), 'research')
    s.t.papers[0] = { ...s.t.papers[0], why: '想了解方法', touched: true }
    const u = s.undo(e.id)
    expect(u.plan.impacts.join()).toContain('会保留在想看里')
    u.commit()
    expect(s.live(s.t.papers)).toHaveLength(1)
    expect(s.t.papers[0].mentioned_in).toEqual([])
  })

  it('另一份记录也提到它：撤销其中一份只去掉那个来源', () => {
    const s = makeStore()
    const first = s.run(R('2026-11-08'), 'research')
    s.run(R('2026-11-10'), 'research')
    s.undo(first.id).commit()
    const left = s.live(s.t.papers)
    expect(left).toHaveLength(1)
    expect(left[0].mentioned_in?.map((m) => m.date)).toEqual(['2026-11-10'])
  })

  it('已经放进讨论框的不会被悄悄移除', () => {
    const s = makeStore()
    const e = s.run(R('2026-11-10'), 'research')
    const entry = s.t.imports.find((x) => x.id === e.id)!
    const plan = planUndo(entry, { ...(s.t as UndoSnapshot), keptPaperIds: new Set([s.t.papers[0].id]) }, '2026-11-12T00:00:00.000Z')
    expect(plan.impacts.join()).toContain('会保留在想看里')
    expect(plan.changes.papers?.[0].deleted).toBeUndefined()
  })

  it('确认合并后撤销导入：想看条目原样回来', () => {
    const s = makeStore()
    const want: Paper = {
      id: 'w1', title: 'living media draft', authors: [], year: null, venue: '', doi: '', category: '', keywords: [],
      status: 'want', url: 'https://example.org/x', one_liner: '', basics_md: '', created_at: 't', updated_at: 't', why: '导师推荐',
    }
    s.t.papers.push(want)
    const e = s.run(PAPER, 'paper')
    const paper = s.t.papers.find((p) => p.status === 'read')!
    const merged = mergeWant(s.t.imports.find((x) => x.id === e.id)!, paper, want, '2026-11-11T11:00:00.000Z')
    for (const key of ['papers', 'imports'] as const) {
      for (const row of merged[key]!) {
        const table = s.t[key] as { id: string }[]
        table[table.findIndex((r) => r.id === row.id)] = row
      }
    }
    const after = s.t.papers.find((p) => p.id === paper.id)!
    expect(after).toMatchObject({ url: 'https://example.org/x', why: '导师推荐' })
    expect(s.live(s.t.papers)).toHaveLength(1)

    s.undo(e.id).commit()
    const left = s.live(s.t.papers)
    expect(left).toHaveLength(1)
    expect(left[0]).toMatchObject({ id: 'w1', status: 'want', title: 'living media draft', why: '导师推荐' })
  })
})

describe('撤销论文导入时的领域', () => {
  const md = (title: string, category: string) => `---\ntype: paper\ntitle: ${title}\ncategory: ${category}\ndate: 2026-11-10\n---\n## 一句话总结\n总结\n`

  it('这次导入新建的领域随之删除', () => {
    const s = makeStore()
    const e = s.run(md('论文一', '霉菌'), 'paper')
    s.undo(e.id).commit()
    expect(s.live(s.t.fields)).toHaveLength(0)
  })

  it('之后又有论文放进了这个领域：领域保留', () => {
    const s = makeStore()
    const e = s.run(md('论文一', '霉菌'), 'paper')
    s.run(md('论文二', '霉菌'), 'paper')
    s.undo(e.id).commit()
    expect(s.live(s.t.fields).map((f) => f.name)).toEqual(['霉菌'])
  })
})
