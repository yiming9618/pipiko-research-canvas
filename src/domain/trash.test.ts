import { describe, expect, it } from 'vitest'
import { matchCitation, findCitations, candidatesFor } from './citations'
import type { NotebookData } from './exportMarkdown'
import { exportBoard } from './exportMarkdown'
import { builtinTypes, findPaper, planImport } from './importer'
import { mergeEntries } from '../store/merge'
import { hasTwin, inTrash, inUse, showRestoredMark, withoutTrash } from './trash'
import type { Board, BoardItem, Card, Comment, Paper, PaperBlock, ResearchRecord } from './types'

const T = '2026-11-14T10:00:00.000Z'
const paper = (id: string, over: Partial<Paper> = {}): Paper => ({
  id, title: '论文标题', authors: ['Jane Smith'], year: 2024, venue: '', doi: '10.1/x', category: '', keywords: [], status: 'read', url: '',
  one_liner: '', basics_md: '', created_at: T, updated_at: T, ...over,
})
const board = (id: string, name: string, over: Partial<Board> = {}): Board => ({ id, name, created_at: T, updated_at: T, ...over })
const card = (id: string, boardId: string, body: string): Card => ({ id, record_id: 'r', date: '2026-11-13', kind: '发现', heading: '发现', body_md: body, order: 0, board_id: boardId, import_id: 'i', updated_at: T })

describe('垃圾桶：移动，不复制、不销毁', () => {
  it('正常区域只看到不在垃圾桶里的；垃圾桶只看到移进去的；同一个对象只在一边', () => {
    const rows = [paper('a'), paper('b', { trashed_at: T }), paper('c', { deleted: true, trashed_at: T })]
    expect(inUse(rows).map((p) => p.id)).toEqual(['a'])
    expect(inTrash(rows).map((p) => p.id)).toEqual(['b'])
  })

  it('画板移进垃圾桶：它的卡片、记录、位置、笔迹、连线一起离开正常区域；别处的论文原件不动', () => {
    const data = {
      papers: [paper('p')],
      blocks: [] as PaperBlock[],
      types: [],
      records: [{ id: 'r', date: '2026-11-13', title: '记录', summary: '', activities: [], keywords: [], paper_dois: [], preamble_md: '', import_id: 'i', board_id: 'gone', updated_at: T } as ResearchRecord],
      cards: [card('c1', 'gone', '垃圾桶里的卡片'), card('c2', 'kept', '留下的卡片')],
      boardItems: [
        { id: 'pos', board_id: 'gone', ref_type: 'card', ref_id: 'c1', x: 1, y: 2, w: 340, h: 0, z: 1, updated_at: T },
        { id: 'pp', board_id: 'gone', ref_type: 'paper', ref_id: 'p', x: 0, y: 0, w: 340, h: 0, z: 1, updated_at: T },
        // a card of the trashed board shown on another board goes too
        { id: 'guest', board_id: 'kept', ref_type: 'card', ref_id: 'c1', x: 0, y: 0, w: 340, h: 0, z: 1, updated_at: T },
      ] as BoardItem[],
      connectors: [{ id: 'k', board_id: 'gone', from: 'card:c1', to: 'pp', arrow: true, updated_at: T }],
      strokes: [{ id: 's', board_id: 'gone', points: [0, 0, 1], color: '#000', size: 5, updated_at: T }],
      piles: [],
      boards: [board('gone', '霉菌研究', { trashed_at: T }), board('kept', '共在')],
      imports: [],
    } satisfies NotebookData
    const seen = withoutTrash(data)
    expect(seen.boards.map((b) => b.id)).toEqual(['kept'])
    expect(seen.cards.map((c) => c.id)).toEqual(['c2'])
    expect(seen.records).toEqual([])
    expect(seen.boardItems).toEqual([])
    expect(seen.connectors).toEqual([])
    expect(seen.strokes).toEqual([])
    expect(seen.papers.map((p) => p.id)).toEqual(['p'])
    // nothing in the stored data changed: restoring only clears the board's marker
    expect(data.cards).toHaveLength(2)
    const back = withoutTrash({ ...data, boards: [board('gone', '霉菌研究'), board('kept', '共在')] })
    expect(back.cards).toHaveLength(2)
    expect(back.boardItems).toHaveLength(3)
    expect(exportBoard('kept', seen)).not.toContain('垃圾桶里的卡片')
  })

  it('论文移进垃圾桶：它的重点区块和画板上的论文卡片一起离开；它的理解跟着论文（挂在论文下）', () => {
    const data = {
      papers: [paper('p', { trashed_at: T })],
      blocks: [{ id: 'b', paper_id: 'p', type_id: null, heading: '附录', body_md: 'x', order: 0, updated_at: T }],
      types: [], records: [], cards: [],
      boardItems: [{ id: 'pp', board_id: 'kept', ref_type: 'paper', ref_id: 'p', x: 0, y: 0, w: 340, h: 0, z: 1, updated_at: T }] as BoardItem[],
      connectors: [], strokes: [], piles: [], boards: [board('kept', '共在')], imports: [],
    } satisfies NotebookData
    const seen = withoutTrash(data)
    expect(seen.papers).toEqual([])
    expect(seen.blocks).toEqual([])
    expect(seen.boardItems).toEqual([])
    expect(seen.boards).toHaveLength(1)
  })

  it('移进去和恢复都只改一条记录；两台设备一个移进去一个恢复，以后做的为准，不会出现两份', () => {
    const base = board('b', '霉菌研究')
    const trashed = { ...base, trashed_at: '2026-11-14T10:00:00.000Z', updated_at: '2026-11-14T10:00:00.000Z' }
    const restored = { ...base, updated_at: '2026-11-14T11:00:00.000Z' }
    const merged = mergeEntries([trashed], [restored]).merged
    expect(merged).toHaveLength(1)
    expect(merged[0].trashed_at).toBeUndefined()
  })
})

describe('重新导入垃圾桶里已有的论文', () => {
  const md = '---\ntype: paper\ntitle: 论文标题\nauthors: Jane Smith\nyear: 2024\ndoi: 10.1/x\ndate: 2026-11-14\n---\n## 一句话总结\n新的总结\n'
  const ctx = (papers: Paper[]) => {
    let n = 0
    return { papers, types: builtinTypes(), blocks: [], imports: [], today: '2026-11-14', now: T, kindHint: 'paper' as const, newId: (p: string) => `${p}_${++n}` }
  }

  it('同一个 DOI：建一条新的独立记录，垃圾桶里的旧论文一点不动', () => {
    const old = paper('old', { trashed_at: T, one_liner: '旧的总结' })
    const out = planImport(md, ctx([old]))
    expect(out.changes.papers).toHaveLength(1)
    expect(out.changes.papers![0].id).not.toBe('old')
    expect(out.changes.papers![0]).toMatchObject({ doi: '10.1/x', one_liner: '新的总结' })
    expect(out.message).toContain('1 篇论文放进论文库')
    expect(findPaper([old], '10.1/x', '论文标题')).toBeUndefined()
  })

  it('同标题、没有 DOI：同样建新记录', () => {
    const old = paper('old', { doi: '', trashed_at: T })
    const out = planImport(md.replace('doi: 10.1/x\n', ''), ctx([old]))
    expect(out.changes.papers![0].id).not.toBe('old')
  })

  it('研究记录提到这个 DOI：垃圾桶里的不算，照常加进想看', () => {
    const old = paper('old', { trashed_at: T })
    const research = '---\ntype: research\ndate: 2026-11-14\ntitle: 记录\npapers: 10.1/x\n---\n## 发现\na\n'
    const out = planImport(research, { ...ctx([old]), kindHint: 'research', boards: [board('b', '画板')], target: { id: 'b' } })
    expect(out.changes.papers?.map((p) => p.status)).toEqual(['want'])
  })
})

describe('以后恢复旧论文：两份共存，不合并', () => {
  const kept = paper('new')
  const back = paper('old', { restored_at: T })

  it('恢复的那份在有同 DOI 的论文时显示【恢复】标记；没有另一份时不显示', () => {
    expect(hasTwin(back, [kept, back])).toBe(true)
    expect(showRestoredMark(back, [kept, back])).toBe(true)
    expect(showRestoredMark(kept, [kept, back])).toBe(false)
    expect(showRestoredMark(back, [back])).toBe(false)
    expect(showRestoredMark(paper('other', { doi: '10.1/y', restored_at: T }), [kept])).toBe(false)
  })

  it('卡片里的引用：两份同一篇时，链接到没被恢复过的那份', () => {
    const cite = findCitations('见 (Smith, 2024)')[0]
    expect(matchCitation(cite, candidatesFor(['10.1/x'], [kept, back]))?.id).toBe('new')
    // a paper still in the trash is never linked
    expect(matchCitation(cite, candidatesFor(['10.1/x'], [paper('t', { trashed_at: T })]))).toBeNull()
    // two different papers by the same author and year stay unlinked, as before
    expect(matchCitation(cite, [paper('a', { doi: '10.1/a' }), paper('b', { doi: '10.1/b' })])).toBeNull()
  })

  it('两份的理解各自挂在自己的论文下，互不影响', () => {
    const notes: Comment[] = [
      { id: 'n1', paper_id: 'old', date: '2026-11-01', source: 'me', text: '旧的理解', updated_at: T },
      { id: 'n2', paper_id: 'new', date: '2026-11-14', source: 'me', text: '新的理解', updated_at: T },
    ]
    expect(notes.filter((c) => c.paper_id === 'old').map((c) => c.text)).toEqual(['旧的理解'])
  })
})

describe('Markdown 指定了垃圾桶里的画板', () => {
  const md = '---\ntype: research\ndate: 2026-11-14\ntitle: 记录\nboard: 霉菌研究\n---\n## 发现\na\n'
  const run = (boards: Board[]) => {
    let n = 0
    return planImport(md, { papers: [], types: builtinTypes(), blocks: [], imports: [], boards, target: { id: 'other' }, today: '2026-11-14', now: T, kindHint: 'research', newId: (p) => `${p}_${++n}` })
  }

  it('不放进去、不恢复：说明它在垃圾桶里，什么都不存', () => {
    const out = run([board('t', '霉菌研究', { trashed_at: T }), board('other', '共在')])
    expect(out.stored).toBe(false)
    expect(out.changes).toEqual({})
    expect(out.needsBoard).toEqual({ name: '霉菌研究', similar: [], inTrash: true })
    expect(out.message).toContain('在垃圾桶里')
  })

  it('正常区域里另有同名的画板：放进那块', () => {
    const out = run([board('t', '霉菌研究', { trashed_at: T }), board('live', '霉菌研究')])
    expect(out.stored).toBe(true)
    expect(out.board?.id).toBe('live')
  })

  it('面板上选的画板如果在垃圾桶里，不往里放（改为新建）', () => {
    let n = 0
    const out = planImport(md.replace('board: 霉菌研究\n', ''), { papers: [], types: builtinTypes(), blocks: [], imports: [], boards: [board('t', '霉菌研究', { trashed_at: T })], target: { id: 't' }, today: '2026-11-14', now: T, kindHint: 'research', newId: (p) => `${p}_${++n}` })
    expect(out.board?.id).not.toBe('t')
    expect(out.board?.created).toBe(true)
  })
})
