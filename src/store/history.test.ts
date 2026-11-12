import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BoardItem, Card, Stroke } from '../domain/types'
import { applyChanges, db } from './db'
import { historyState, redoLast, startHistory, undoLast } from './history'

const T = '2026-11-10T10:00:00.000Z'
const item = (id: string, x: number): BoardItem => ({ id, board_id: 'b1', ref_type: 'text', ref_id: '', x, y: 0, w: 260, h: 0, z: 1, text_override: 't', updated_at: T })
const ink = (id: string): Stroke => ({ id, board_id: 'b1', points: [0, 0, 0.5, 10, 10, 0.5], color: '#000', size: 5, updated_at: T })
const card = (id: string, body: string): Card => ({ id, record_id: '', date: '2026-11-10', kind: '问题', heading: '问题', body_md: body, order: 1, board_id: 'b1', updated_at: T })
const live = async <T extends { deleted?: boolean }>(rows: Promise<T[]>) => (await rows).filter((r) => !r.deleted)

let stop: () => void
beforeEach(async () => {
  await db.delete()
  await db.open()
  stop = startHistory()
})
afterEach(() => stop())

describe('撤回和重做', () => {
  it('新建的东西撤回后消失，重做后回来', async () => {
    await applyChanges({ strokes: [ink('s1')] })
    expect(historyState()).toEqual({ canUndo: true, canRedo: false })
    await undoLast()
    expect(await live(db.strokes.toArray())).toHaveLength(0)
    expect(historyState()).toEqual({ canUndo: false, canRedo: true })
    await redoLast()
    expect(await live(db.strokes.toArray())).toHaveLength(1)
  })

  it('移动撤回后回到原来的位置', async () => {
    await applyChanges({ boardItems: [item('a', 10)] })
    await applyChanges({ boardItems: [{ ...item('a', 300), updated_at: '2026-11-10T11:00:00.000Z' }] })
    await undoLast()
    expect((await db.boardItems.get('a'))?.x).toBe(10)
    await redoLast()
    expect((await db.boardItems.get('a'))?.x).toBe(300)
  })

  it('删除撤回后回来', async () => {
    await applyChanges({ cards: [card('c', '手写的')] })
    await applyChanges({ cards: [{ ...card('c', '手写的'), deleted: true, updated_at: '2026-11-10T11:00:00.000Z' }] })
    expect(await live(db.cards.toArray())).toHaveLength(0)
    await undoLast()
    const back = await db.cards.get('c')
    expect(back?.deleted).toBeUndefined()
    expect(back?.body_md).toBe('手写的')
  })

  it('一次操作改了好几样（一起移动、一次擦掉几笔）：撤回一次全部还原', async () => {
    await applyChanges({ boardItems: [item('a', 0), item('b', 100)], strokes: [ink('s1'), ink('s2')] })
    await applyChanges({
      boardItems: [{ ...item('a', 50), updated_at: T }, { ...item('b', 150), updated_at: T }],
      strokes: [{ ...ink('s1'), deleted: true }, { ...ink('s2'), deleted: true }],
    })
    await undoLast()
    expect((await db.boardItems.get('a'))?.x).toBe(0)
    expect((await db.boardItems.get('b'))?.x).toBe(100)
    expect(await live(db.strokes.toArray())).toHaveLength(2)
  })

  it('按做的顺序一步步撤回；撤回之后做了新操作，就不能再重做', async () => {
    await applyChanges({ strokes: [ink('s1')] })
    await applyChanges({ strokes: [ink('s2')] })
    await applyChanges({ strokes: [ink('s3')] })
    await undoLast()
    await undoLast()
    expect((await live(db.strokes.toArray())).map((s) => s.id)).toEqual(['s1'])
    await applyChanges({ boardItems: [item('n', 0)] })
    expect(historyState().canRedo).toBe(false)
    expect(await redoLast()).toBe(false)
  })

  it('撤回是一次新的修改：时间更新、会同步出去', async () => {
    await applyChanges({ boardItems: [item('a', 10)] })
    await db.dirty.clear()
    await applyChanges({ boardItems: [{ ...item('a', 300), updated_at: '2026-11-10T11:00:00.000Z' }] })
    await db.dirty.clear()
    await undoLast()
    const row = await db.boardItems.get('a')
    expect(row!.updated_at > '2026-11-10T11:00:00.000Z').toBe(true)
    expect(await db.dirty.count()).toBe(1)
  })

  it('画板以外的改动不进撤回记录（讨论框、最近使用、论文）', async () => {
    await applyChanges({ boardUse: [{ id: 'b1', last_used_at: T, updated_at: T }] })
    await applyChanges({ discussions: [{ id: 'd', name: '讨论', created_at: T, updated_at: T }] })
    expect(historyState().canUndo).toBe(false)
  })

  it('关上画板后记录清空', async () => {
    await applyChanges({ strokes: [ink('s1')] })
    stop()
    expect(historyState()).toEqual({ canUndo: false, canRedo: false })
    expect(await undoLast()).toBe(false)
    stop = startHistory()
  })
})
