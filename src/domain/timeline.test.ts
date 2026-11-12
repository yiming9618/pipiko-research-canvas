import { describe, expect, it } from 'vitest'
import { neighbours, shownMonths, shownYears } from './timeline'

describe('时间视图显示哪些年份、月份和日子', () => {
  const days = ['2026-11-10', '2026-11-12', '2027-03-02', '2025-06-30']

  it('只有有内容的月份，没有内容的直接跳过', () => {
    expect(shownMonths(days)).toEqual(['2025-06', '2026-11', '2027-03'])
    expect(neighbours(shownMonths(days), '2026-11')).toEqual({ prev: '2025-06', next: '2027-03' })
  })

  it('没有内容的年份不显示', () => {
    expect(shownYears(days)).toEqual(['2025', '2026', '2027'])
    expect(shownYears([])).toEqual([])
  })

  it('日子同理：前后只在有内容的日子之间走', () => {
    expect(neighbours([...days].sort(), '2026-11-12')).toEqual({ prev: '2026-11-10', next: '2027-03-02' })
    expect(neighbours(['2026-11-10'], '2026-11-10')).toEqual({ prev: undefined, next: undefined })
  })
})
