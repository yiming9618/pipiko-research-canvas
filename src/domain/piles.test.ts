import { describe, expect, it } from 'vitest'
import { checkAdd, countContents, descendantPiles, nextSlot, wouldCycle } from './piles'
import type { BoardItem, BoardRefType } from './types'

let n = 0
const put = (pile: string, type: BoardRefType, id: string, deleted = false): BoardItem => ({
  id: `bi_${++n}`,
  board_id: `pile:${pile}`,
  ref_type: type,
  ref_id: id,
  x: 0,
  y: 0,
  w: 340,
  h: 0,
  z: 0,
  updated_at: '',
  ...(deleted ? { deleted } : {}),
})

describe('堆', () => {
  it('堆里可以再放堆，能找到所有层级的子堆', () => {
    const items = [put('A', 'pile', 'B'), put('B', 'pile', 'C'), put('A', 'card', 'card_1')]
    expect([...descendantPiles('A', items)].sort()).toEqual(['B', 'C'])
    expect([...descendantPiles('C', items)]).toEqual([])
  })

  it('不能绕成一圈：A 里有 B，就不能把 A 放进 B；也不能把堆放进自己', () => {
    const items = [put('A', 'pile', 'B'), put('B', 'pile', 'C')]
    expect(wouldCycle('A', 'B', items)).toBe(true)
    expect(wouldCycle('A', 'C', items)).toBe(true)
    expect(wouldCycle('A', 'A', items)).toBe(true)
    expect(wouldCycle('C', 'A', items)).toBe(false)
    expect(checkAdd('C', { type: 'pile', id: 'A' }, items)).toBe('cycle')
    expect(checkAdd('A', { type: 'pile', id: 'D' }, items)).toBe('added')
  })

  it('同一个东西不重复放进同一个堆；可以放进不同的堆', () => {
    const items = [put('A', 'card', 'card_1')]
    expect(checkAdd('A', { type: 'card', id: 'card_1' }, items)).toBe('duplicate')
    expect(checkAdd('B', { type: 'card', id: 'card_1' }, items)).toBe('added')
    expect(checkAdd('A', { type: 'paper', id: 'card_1' }, items)).toBe('added')
  })

  it('从堆里移走的不算在内，可以重新放进去', () => {
    const items = [put('A', 'card', 'card_1', true), put('A', 'pile', 'B', true)]
    expect(checkAdd('A', { type: 'card', id: 'card_1' }, items)).toBe('added')
    expect(wouldCycle('B', 'A', items)).toBe(false)
    expect(countContents('A', items)).toEqual({ things: 0, piles: 0 })
  })

  it('数量：几张、几个子堆（贴图和文字不算）', () => {
    const items = [
      put('A', 'card', 'c1'),
      put('A', 'paper', 'p1'),
      put('A', 'cover', 'r1'),
      put('A', 'pile', 'B'),
      put('A', 'image', 'asset_1'),
      put('A', 'text', ''),
    ]
    expect(countContents('A', items)).toEqual({ things: 3, piles: 1 })
  })

  it('新放进去的东西按格子依次排开', () => {
    const items: BoardItem[] = []
    const slots = []
    for (let i = 0; i < 4; i++) {
      slots.push(nextSlot('A', items))
      items.push(put('A', 'card', `c${i}`))
    }
    expect(slots).toEqual([
      { x: 0, y: 0 },
      { x: 368, y: 0 },
      { x: 736, y: 0 },
      { x: 0, y: 240 },
    ])
  })
})
