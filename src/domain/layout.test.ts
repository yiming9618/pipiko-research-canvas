import { describe, expect, it } from 'vitest'
import { BLOCK_W, RECORD_GAP, boardLayout, cardKey, coverKey, nextOrigin } from './layout'

const h = () => 100

describe('画板上的落点', () => {
  it('空画板：第一份导入放在左上角', () => {
    expect(nextOrigin({ hasStacked: false, origins: [], items: [] })).toEqual({ x: 0, y: 0 })
  })

  it('新导入放在现有内容的右侧，和顶部对齐', () => {
    expect(nextOrigin({ hasStacked: true, origins: [], items: [] })).toEqual({ x: BLOCK_W + RECORD_GAP, y: 0 })
    expect(nextOrigin({ hasStacked: false, origins: [{ x: 0, y: 0 }, { x: 780, y: 0 }], items: [] }).x).toBe(780 + BLOCK_W + RECORD_GAP)
  })

  it('我摆到更右边的东西、画到更右边的笔迹也算在内', () => {
    expect(nextOrigin({ hasStacked: true, origins: [], items: [{ x: 2000, w: 340 }] }).x).toBe(2340 + RECORD_GAP)
    expect(nextOrigin({ hasStacked: true, origins: [], items: [], ink: { minX: -50, maxX: 3000.4 } }).x).toBe(3001 + RECORD_GAP)
  })

  it('再导入一份：之前所有东西的位置一个都不变', () => {
    const stacked = [{ id: 'old', cardIds: ['a', 'b', 'c'] }]
    const first = { id: 'r1', cardIds: ['d', 'e'], origin: { x: 780, y: 0 } }
    const before = boardLayout({ stacked, loose: ['m'], placed: [first], heightOf: h, columns: 2 })
    const origin = nextOrigin({ hasStacked: true, origins: [first.origin], items: [] })
    const after = boardLayout({ stacked, loose: ['m'], placed: [first, { id: 'r2', cardIds: ['f'], origin }], heightOf: h, columns: 2 })
    for (const [key, at] of before) expect(after.get(key), key).toEqual(at)
    expect(after.get(coverKey('r2'))).toEqual({ x: origin.x, y: 0, w: BLOCK_W })
    expect(after.get(cardKey('f'))!.x).toBe(origin.x)
  })

  it('各份导入左右排开，互不重叠（不管卡片有多高）', () => {
    const tall = () => 5000
    const o1 = nextOrigin({ hasStacked: true, origins: [], items: [] })
    const o2 = nextOrigin({ hasStacked: true, origins: [o1], items: [] })
    const lay = boardLayout({
      stacked: [{ id: 'old', cardIds: ['a'] }],
      loose: [],
      placed: [{ id: 'r1', cardIds: ['b'], origin: o1 }, { id: 'r2', cardIds: ['c'], origin: o2 }],
      heightOf: tall,
      columns: 2,
    })
    const span = (id: string) => [lay.get(coverKey(id))!.x, lay.get(coverKey(id))!.x + BLOCK_W]
    expect(span('old')[1]).toBeLessThan(span('r1')[0])
    expect(span('r1')[1]).toBeLessThan(span('r2')[0])
  })
})
