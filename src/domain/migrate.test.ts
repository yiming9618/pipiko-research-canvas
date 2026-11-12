import { describe, expect, it } from 'vitest'
import { mergeEntries } from '../store/merge'
import { fileOf } from '../sync/files'
import {
  MIGRATION_AT,
  checkBoards,
  dayBoardName,
  fieldOfPaper,
  homeBoardId,
  legacyFieldId,
  planMigration,
  recordBoardId,
  type MigrationSnapshot,
} from './migrate'
import type { Board, BoardItem, Card, Changes, Connector, Field, Paper, Pile, ResearchRecord, Stroke } from './types'

const T = '2026-11-10T10:00:00.000Z'
const record = (id: string, date: string, over: Partial<ResearchRecord> = {}): ResearchRecord => ({
  id, date, title: id, summary: '', activities: [], keywords: [], paper_dois: [], preamble_md: '', import_id: `imp_${id}`, updated_at: T, ...over,
})
const card = (id: string, date: string, over: Partial<Card> = {}): Card => ({
  id, record_id: '', date, kind: '发现', heading: '发现', body_md: id, order: 0, updated_at: T, ...over,
})
const item = (id: string, board: string, over: Partial<BoardItem> = {}): BoardItem => ({
  id, board_id: board, ref_type: 'text', ref_id: '', x: 1, y: 2, w: 260, h: 0, z: 1, text_override: 't', updated_at: T, ...over,
})
const conn = (id: string, board: string): Connector => ({ id, board_id: board, from: 'a', to: 'b', arrow: true, updated_at: T })
const ink = (id: string, board: string): Stroke => ({ id, board_id: board, points: [0, 0, 1], color: '#000', size: 5, updated_at: T })
const pile = (id: string, name: string, over: Partial<Pile> = {}): Pile => ({ id, name, created_at: '2026-11-05T08:00:00.000Z', updated_at: T, ...over })
const paper = (id: string, category: string, over: Partial<Paper> = {}): Paper => ({
  id, title: id, authors: [], year: null, venue: '', doi: '', category, keywords: [], status: 'read', url: '', one_liner: '', basics_md: '', created_at: T, updated_at: T, ...over,
})

const snap = (over: Partial<MigrationSnapshot> = {}): MigrationSnapshot => ({
  boards: [], fields: [], piles: [], papers: [], records: [], cards: [], boardItems: [], connectors: [], strokes: [], ...over,
})
const apply = (s: MigrationSnapshot, c: Changes): MigrationSnapshot => ({
  ...s,
  boards: [...s.boards, ...(c.boards ?? [])],
  fields: [...s.fields, ...(c.fields ?? [])],
})

/** A notebook as it looks today: several days, edits on boards, piles with mixed contents, categories. */
const today = () =>
  snap({
    records: [record('r1', '2026-11-10'), record('r2', '2026-11-10'), record('r3', '2026-11-08'), record('gone', '2026-10-01', { deleted: true })],
    cards: [
      card('c1', '2026-11-10', { record_id: 'r1', import_id: 'imp_r1' }),
      card('c2', '2026-11-08', { record_id: 'r3', import_id: 'imp_r3' }),
      card('hand', '2026-11-12'), // written by hand on a day with nothing else
    ],
    boardItems: [
      item('moved', 'day:2026-11-10', { ref_type: 'card', ref_id: 'c1' }),
      item('note', 'day:2026-11-03'), // a day that only has a note on its board
      item('p-card', 'pile:p1', { ref_type: 'card', ref_id: 'c1' }),
      item('p-paper', 'pile:p1', { ref_type: 'paper', ref_id: 'a' }),
      item('p-sub', 'pile:p1', { ref_type: 'pile', ref_id: 'p2' }),
      item('p2-text', 'pile:p2'),
    ],
    connectors: [conn('k1', 'day:2026-11-10'), conn('k2', 'pile:p1')],
    strokes: [ink('s1', 'day:2026-11-06'), ink('s2', 'pile:p2')],
    piles: [pile('p1', '共在'), pile('p2', '子堆'), pile('empty', '空的堆')],
    papers: [paper('a', 'Living media'), paper('b', 'living  media'), paper('c', '霉菌'), paper('d', ''), paper('w', '', { status: 'want' })],
  })

describe('迁移到主题画板', () => {
  it('每个有内容的日子变成一块画板：名字是日期，创建时间是那一天，编号沿用原来的', () => {
    const boards = planMigration(today()).boards!
    const days = boards.filter((b) => b.id.startsWith('day:'))
    expect(days.map((b) => b.id)).toEqual(['day:2026-11-03', 'day:2026-11-06', 'day:2026-11-08', 'day:2026-11-10', 'day:2026-11-12'])
    expect(days[3]).toEqual({ id: 'day:2026-11-10', name: '2026/11/10', created_at: '2026-11-10T00:00:00.000Z', updated_at: MIGRATION_AT })
    expect(dayBoardName('2027-03-02')).toBe('2027/3/2')
    // a day whose only record was deleted (an undone import) gets no board
    expect(boards.some((b) => b.id === 'day:2026-10-01')).toBe(false)
  })

  it('只新增，不改写：结果里只有新的画板和领域，现有的条目一条都不在里面', () => {
    const before = today()
    const frozen = JSON.stringify(before)
    const changes = planMigration(before)
    expect(Object.keys(changes).sort()).toEqual(['boards', 'fields'])
    expect(JSON.stringify(before)).toBe(frozen)
  })

  it('旧卡片和记录不用写入所属画板，按日期就能找到；位置、连线、笔迹的编号本来就对得上', () => {
    const s = today()
    const after = apply(s, planMigration(s))
    expect(homeBoardId(s.cards[0])).toBe('day:2026-11-10')
    expect(recordBoardId(s.records[2])).toBe('day:2026-11-08')
    expect(checkBoards(after).total).toBe(0)
  })

  it('再跑一次什么都不做', () => {
    const s = today()
    const after = apply(s, planMigration(s))
    expect(planMigration(after)).toEqual({})
  })

  it('堆变成文件夹：原来堆里的东西成为一块同名画板，放在这个堆里；空的堆不生成画板', () => {
    const boards = planMigration(today()).boards!
    expect(boards.find((b) => b.id === 'pile:p1')).toEqual({
      id: 'pile:p1', name: '共在', created_at: '2026-11-05T08:00:00.000Z', pile_id: 'p1', updated_at: MIGRATION_AT,
    })
    expect(boards.find((b) => b.id === 'pile:p2')?.pile_id).toBe('p2')
    expect(boards.some((b) => b.id === 'pile:empty')).toBe(false)
  })

  it('堆里放着的子堆：那条引用原样留着，子堆自己成为一个文件夹', () => {
    const s = today()
    const after = apply(s, planMigration(s))
    expect(after.boardItems.find((i) => i.id === 'p-sub')).toEqual(s.boardItems.find((i) => i.id === 'p-sub'))
    expect(after.boards.filter((b) => b.pile_id === 'p2').map((b) => b.id)).toEqual(['pile:p2'])
  })

  it('两台设备各自迁移：同一天生成的是一模一样的条目，同步后只有一条', () => {
    const phone = snap({ records: [record('r1', '2026-11-10')], piles: [pile('p1', '共在')], boardItems: [item('x', 'pile:p1')] })
    const ipad = snap({ cards: [card('h', '2026-11-10')], strokes: [ink('s', 'day:2026-11-11')], piles: [pile('p1', '共在')], boardItems: [item('y', 'pile:p1')] })
    const a = planMigration(phone).boards!
    const b = planMigration(ipad).boards!
    expect(a.find((x) => x.id === 'day:2026-11-10')).toEqual(b.find((x) => x.id === 'day:2026-11-10'))
    expect(a.find((x) => x.id === 'pile:p1')).toEqual(b.find((x) => x.id === 'pile:p1'))
    const merged = mergeEntries(a, b)
    expect(merged.merged.map((x) => x.id)).toEqual(['day:2026-11-10', 'day:2026-11-11', 'pile:p1'])
    expect(new Set(merged.merged.map((x) => x.id)).size).toBe(merged.merged.length)
  })

  it('一台设备已经改了名，另一台才迁移：改名保留', () => {
    const late = planMigration(snap({ records: [record('r1', '2026-11-10')] })).boards!
    const renamed: Board = { ...late[0], name: '霉菌研究', updated_at: '2026-11-14T09:00:00.000Z' }
    expect(mergeEntries(late, [renamed]).merged[0].name).toBe('霉菌研究')
    expect(mergeEntries([renamed], late).merged[0].name).toBe('霉菌研究')
  })

  it('删掉的画板不会被重新建出来', () => {
    const s = today()
    const after = apply(s, planMigration(s))
    after.boards = after.boards.map((b) => (b.id === 'day:2026-11-03' ? { ...b, deleted: true, updated_at: '2026-11-20T00:00:00.000Z' } : b))
    expect(planMigration(after)).toEqual({})
    // …and what is still on it is reported rather than hidden
    expect(checkBoards(after)).toMatchObject({ boardItems: 1, total: 1 })
  })

  it('还没更新的设备后来又写了旧格式的内容：下次检查时补上那一天的画板', () => {
    const s = today()
    const after = apply(s, planMigration(s))
    after.records.push(record('late', '2026-11-20'))
    expect(planMigration(after).boards?.map((b) => b.id)).toEqual(['day:2026-11-20'])
  })

  it('已经在新画板上的卡片不会再生成每日画板', () => {
    const s = snap({
      boards: [{ id: 'board_1', name: '霉菌研究', created_at: T, updated_at: T }],
      cards: [card('n', '2026-12-01', { board_id: 'board_1' })],
      records: [record('nr', '2026-12-01', { board_id: 'board_1' })],
    })
    expect(planMigration(s)).toEqual({})
    expect(checkBoards(s).total).toBe(0)
  })

  it('旧卡片改了日期：仍在原来那块画板上，同步文件也不搬家', () => {
    const before = card('h', '2026-11-12')
    const after: Card = { ...before, date: '2026-11-20', home_date: '2026-11-12' }
    expect(homeBoardId(after)).toBe('day:2026-11-12')
    expect(fileOf('cards', after)).toBe(fileOf('cards', before))
    expect(fileOf('cards', before)).toBe('data/days/2026-11-12.json')
  })

  it('新画板上的卡片和记录按画板归档，改日期也不搬家', () => {
    const c = card('n', '2026-12-01', { board_id: 'board_1' })
    expect(fileOf('cards', c)).toBe('data/cards/board_1.json')
    expect(fileOf('cards', { ...c, date: '2026-12-09' } as Card)).toBe('data/cards/board_1.json')
    expect(fileOf('records', record('r', '2026-12-01', { board_id: 'day:2026-11-10' }))).toBe('data/cards/day-2026-11-10.json')
    expect(fileOf('boards', { id: 'board_1', updated_at: T })).toBe('data/board-list.json')
    expect(fileOf('boardUse', { id: 'board_1', updated_at: T })).toBe('data/board-list.json')
    expect(fileOf('fields', { id: 'f', updated_at: T })).toBe('data/fields.json')
  })
})

describe('论文领域', () => {
  it('每个用到的 category 变成一个领域；只是大小写或空格不同的算同一个', () => {
    const fields = planMigration(today()).fields!
    expect(fields.map((f) => f.name).sort()).toEqual(['Living media', '霉菌'])
    expect(fields.every((f) => f.updated_at === MIGRATION_AT)).toBe(true)
    expect(legacyFieldId('Living media')).toBe(legacyFieldId('living  media'))
  })

  it('论文不改写：按 category 找到领域；没有 category 的是未分类', () => {
    const s = today()
    const fields = planMigration(s).fields!
    expect(fieldOfPaper(s.papers[0], fields)?.name).toBe('Living media')
    expect(fieldOfPaper(s.papers[1], fields)?.name).toBe('Living media')
    expect(fieldOfPaper(s.papers[3], fields)).toBeNull()
  })

  it('领域改名：只改一条，所有论文跟着变', () => {
    const s = today()
    const fields = planMigration(s).fields!.map((f): Field => (f.name === '霉菌' ? { ...f, name: '真菌材料', updated_at: '2026-11-14T00:00:00.000Z' } : f))
    expect(fieldOfPaper(s.papers[2], fields)?.name).toBe('真菌材料')
    expect(planMigration({ ...s, fields })).toEqual({ boards: planMigration(s).boards })
  })

  it('领域删除：里面的论文变回未分类，也不会被重新建出来', () => {
    const s = today()
    const fields = planMigration(s).fields!.map((f): Field => (f.name === '霉菌' ? { ...f, deleted: true } : f))
    expect(fieldOfPaper(s.papers[2], fields)).toBeNull()
    expect(planMigration({ ...s, fields }).fields).toBeUndefined()
  })

  it('手动改过领域的论文以改的为准，包括改成未分类', () => {
    const fields: Field[] = [
      { id: legacyFieldId('霉菌'), name: '霉菌', created_at: T, updated_at: T },
      { id: 'field_new', name: '交互设计', created_at: T, updated_at: T },
    ]
    expect(fieldOfPaper(paper('x', '霉菌', { field_id: 'field_new' }), fields)?.name).toBe('交互设计')
    expect(fieldOfPaper(paper('y', '霉菌', { field_id: '' }), fields)).toBeNull()
  })
})
