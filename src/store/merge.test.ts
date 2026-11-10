import { describe, expect, it } from 'vitest'
import { mergeEntries } from './merge'

interface Row {
  id: string
  updated_at: string
  deleted?: boolean
  v: string
}
const row = (id: string, t: number, v: string, deleted?: boolean): Row => ({
  id,
  updated_at: `2026-11-10T10:00:${String(t).padStart(2, '0')}.000Z`,
  v,
  ...(deleted ? { deleted } : {}),
})
const byId = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.id, r.v + (r.deleted ? ' (deleted)' : '')]))

describe('按条目合并（同一个文件两台设备都改了）', () => {
  it('手机新增一份记录，同时 iPad 编辑了同一天的卡片：两边都保留', () => {
    // data/days/2026-11-10.json as each device sees it
    const base = [row('card_1', 1, '原文'), row('card_2', 1, '原文')]
    const ipad = [row('card_1', 5, 'iPad 改过'), base[1]]
    const phoneRemote = [...base, row('rec_new', 4, '手机新导入'), row('card_3', 4, '手机新卡片')]

    const { merged, toLocal, remoteChanged } = mergeEntries(ipad, phoneRemote)
    expect(byId(merged)).toEqual({
      card_1: 'iPad 改过',
      card_2: '原文',
      card_3: '手机新卡片',
      rec_new: '手机新导入',
    })
    expect(toLocal.map((r) => r.id).sort()).toEqual(['card_3', 'rec_new'])
    expect(remoteChanged).toBe(true)
  })

  it('同一条两边都改了：取较新的', () => {
    const { merged, toLocal } = mergeEntries([row('a', 3, '本地旧')], [row('a', 7, '远端新')])
    expect(byId(merged)).toEqual({ a: '远端新' })
    expect(toLocal).toHaveLength(1)

    const other = mergeEntries([row('a', 9, '本地新')], [row('a', 7, '远端旧')])
    expect(byId(other.merged)).toEqual({ a: '本地新' })
    expect(other.toLocal).toHaveLength(0)
    expect(other.remoteChanged).toBe(true)
  })

  it('一边删除、另一边没动：保持删除，不会被旧数据复活', () => {
    const { merged, remoteChanged } = mergeEntries([row('a', 5, 'x', true)], [row('a', 1, 'x')])
    expect(byId(merged)).toEqual({ a: 'x (deleted)' })
    expect(remoteChanged).toBe(true)

    const reverse = mergeEntries([row('a', 1, 'x')], [row('a', 5, 'x', true)])
    expect(byId(reverse.merged)).toEqual({ a: 'x (deleted)' })
    expect(reverse.toLocal).toHaveLength(1)
  })

  it('删除之后又在另一台设备上改了（更晚）：较新的修改保留', () => {
    const { merged } = mergeEntries([row('a', 2, 'x', true)], [row('a', 8, '之后改的')])
    expect(byId(merged)).toEqual({ a: '之后改的' })
  })

  it('时间完全相同时删除优先', () => {
    const { merged } = mergeEntries([row('a', 5, 'x', true)], [row('a', 5, 'x')])
    expect(merged[0].deleted).toBe(true)
  })

  it('piles.json：两台设备各建了一个堆，都在', () => {
    const { merged } = mergeEntries(
      [row('pile_1', 1, '共在'), row('pile_ipad', 6, 'iPad 新建')],
      [row('pile_1', 1, '共在'), row('pile_phone', 5, '手机新建')],
    )
    expect(Object.keys(byId(merged)).sort()).toEqual(['pile_1', 'pile_ipad', 'pile_phone'])
  })

  it('settings.json：一台改了"现在在想的问题"，另一台改了类型颜色，互不覆盖', () => {
    const { merged } = mergeEntries(
      [row('current_question', 9, '新的问题'), row('type_x', 1, 'default')],
      [row('current_question', 1, '旧的问题'), row('type_x', 8, 'green')],
    )
    expect(byId(merged)).toEqual({ current_question: '新的问题', type_x: 'green' })
  })

  it('两边一样时什么都不用做', () => {
    const rows = [row('a', 1, 'x'), row('b', 2, 'y')]
    const { toLocal, remoteChanged } = mergeEntries(rows, [...rows])
    expect(toLocal).toEqual([])
    expect(remoteChanged).toBe(false)
  })
})
