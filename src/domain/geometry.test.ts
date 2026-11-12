import { describe, expect, it } from 'vitest'
import { moveStroke, pointInPolygon, rectInLasso, strokeBounds, strokeInLasso, strokeTouched } from './geometry'

const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
// an L-shaped loop: the notch at the top right is outside
const ell = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
const line = (...xy: number[]) => xy.flatMap((v, i) => (i % 2 === 1 ? [v, 0.5] : [v]))

describe('套索', () => {
  it('点在圈里还是圈外', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true)
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false)
    expect(pointInPolygon({ x: 75, y: 25 }, ell)).toBe(false)
    expect(pointInPolygon({ x: 25, y: 25 }, ell)).toBe(true)
  })

  it('卡片：中心在圈里就算选中', () => {
    expect(rectInLasso({ x: 20, y: 20, w: 40, h: 40 }, square)).toBe(true)
    expect(rectInLasso({ x: 80, y: 20, w: 100, h: 40 }, square)).toBe(false)
    expect(rectInLasso({ x: 20, y: 20, w: 40, h: 40 }, square.slice(0, 2))).toBe(false)
  })

  it('笔迹：大半在圈里才算选中', () => {
    expect(strokeInLasso(line(10, 10, 50, 50, 90, 90), square)).toBe(true)
    expect(strokeInLasso(line(90, 90, 150, 150, 200, 200), square)).toBe(false)
    expect(strokeInLasso([], square)).toBe(false)
  })
})

describe('对象橡皮', () => {
  const stroke = line(0, 0, 100, 0)
  it('擦到笔迹的任何一段就算碰到（不只是端点）', () => {
    expect(strokeTouched(stroke, { x: 50, y: 4 }, 8)).toBe(true)
    expect(strokeTouched(stroke, { x: 50, y: 20 }, 8)).toBe(false)
    expect(strokeTouched(stroke, { x: 104, y: 0 }, 8)).toBe(true)
    expect(strokeTouched(stroke, { x: 120, y: 0 }, 8)).toBe(false)
  })
  it('只有一个点的笔迹也能擦到', () => {
    expect(strokeTouched(line(10, 10), { x: 12, y: 12 }, 8)).toBe(true)
  })
})

describe('移动笔迹', () => {
  it('整笔平移，笔压不变', () => {
    expect(moveStroke([0, 0, 0.3, 10, 5, 0.9], 5, -2)).toEqual([5, -2, 0.3, 15, 3, 0.9])
    expect(strokeBounds([0, 0, 0.3, 10, 5, 0.9])).toEqual({ x: 0, y: 0, w: 10, h: 5 })
  })
})
