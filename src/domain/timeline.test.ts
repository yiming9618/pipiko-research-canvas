import { describe, expect, it } from 'vitest'
import { datesOfMonth, isDate, neighbours, shownMonths, shownYears } from './timeline'

describe('时间导航显示哪些月份和年份', () => {
  const days = ['2026-11-10', '2026-11-12', '2027-03-02', '2025-06-30']

  it('只有有内容的月份，没有内容的直接跳过', () => {
    expect(shownMonths(days, '2026-11-20')).toEqual(['2025-06', '2026-11', '2027-03'])
    expect(neighbours(shownMonths(days, '2026-11-20'), '2026-11')).toEqual({ prev: '2025-06', next: '2027-03' })
  })

  it('当前月份始终显示，即使还是空的', () => {
    expect(shownMonths(days, '2026-12-01')).toEqual(['2025-06', '2026-11', '2026-12', '2027-03'])
    expect(shownMonths([], '2026-12-01')).toEqual(['2026-12'])
  })

  it('没有内容的年份不显示；当前年份在', () => {
    expect(shownYears(days, '2026-11-20')).toEqual(['2025', '2026', '2027'])
    expect(shownYears(['2024-01-01'], '2026-11-20')).toEqual(['2024', '2026'])
  })

  it('站在一个空月份里，前后仍然指向最近的有内容的月份', () => {
    expect(neighbours(['2025-06', '2026-11', '2027-03'], '2026-12')).toEqual({ prev: '2026-11', next: '2027-03' })
    expect(neighbours(['2026-11'], '2026-11')).toEqual({ prev: undefined, next: undefined })
  })

  it('一个月里的每一天', () => {
    expect(datesOfMonth('2026-11')).toHaveLength(30)
    expect(datesOfMonth('2026-02')).toHaveLength(28)
    expect(datesOfMonth('2028-02')).toHaveLength(29)
    expect(datesOfMonth('2026-12').at(-1)).toBe('2026-12-31')
    expect(isDate('2026-02-30')).toBe(false)
    expect(isDate('2026-02-28')).toBe(true)
  })
})
