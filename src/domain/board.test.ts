import { describe, expect, it } from 'vitest'
import { candidatesFor, findCitations, linkCitations, matchCitation } from './citations'
import { CARD_W, GAP, RECORD_GAP, defaultLayout } from './layout'
import type { Paper } from './types'

const paper = (id: string, authors: string[], year: number, doi: string): Paper => ({
  id,
  title: id,
  authors,
  year,
  venue: '',
  doi,
  category: '',
  keywords: [],
  status: 'read',
  url: '',
  one_liner: '',
  basics_md: '',
  created_at: '',
  updated_at: '',
})

const smith = paper('p_smith', ['Jane Smith', '李明'], 2024, '10.1/a')
const lee = paper('p_lee', ['Lee, K.'], 2023, '10.1/b')
const smith2 = paper('p_smith2', ['Adam Smith'], 2024, '10.1/c')

describe('引用识别', () => {
  it('找到 (作者, 年份)，全角半角括号和逗号都行', () => {
    const found = findCitations('参考 (Smith, 2024)，以及（李明，2024）。普通括号（不是引用）不算。')
    expect(found.map((c) => [c.author, c.year, c.text])).toEqual([
      ['Smith', 2024, '(Smith, 2024)'],
      ['李明', 2024, '（李明，2024）'],
    ])
  })

  it('一个括号里多篇用分号隔开', () => {
    const found = findCitations('见 (Smith et al., 2024; Lee, 2023a)')
    expect(found.map((c) => [c.author, c.year, c.text])).toEqual([
      ['Smith et al.', 2024, 'Smith et al., 2024'],
      ['Lee', 2023, 'Lee, 2023a'],
    ])
  })
})

describe('引用匹配', () => {
  it('年份和作者都对上，且只有一篇，才算匹配', () => {
    const c = findCitations('(Smith, 2024)')[0]
    expect(matchCitation(c, [smith, lee])?.id).toBe('p_smith')
    expect(matchCitation(c, [smith, smith2])).toBeNull() // two candidates: do not guess
    expect(matchCitation(c, [lee])).toBeNull()
    expect(matchCitation(findCitations('(Smith, 2019)')[0], [smith])).toBeNull()
  })

  it('et al.、等、& 这类写法也能对上；不按半个单词匹配', () => {
    const m = (t: string) => matchCitation(findCitations(t)[0], [smith, lee])?.id
    expect(m('(Smith et al., 2024)')).toBe('p_smith')
    expect(m('(Smith & Jones, 2024)')).toBe('p_smith')
    expect(m('(李明等, 2024)')).toBe('p_smith')
    expect(m('(Lee, 2023)')).toBe('p_lee')
    expect(m('(Smi, 2024)')).toBeUndefined()
  })

  it('只在记录自己列出的 DOI 里找', () => {
    expect(candidatesFor(['10.1/a'], [smith, lee]).map((p) => p.id)).toEqual(['p_smith'])
    expect(candidatesFor([], [smith, lee])).toEqual([])
  })

  it('匹配到的变成链接，匹配不到的保留原文', () => {
    const text = '时间线是原件 (Smith, 2024)，另见 (Nobody, 1999)。'
    expect(linkCitations(text, [smith])).toBe(
      '时间线是原件 [(Smith, 2024)](#cite:p_smith)，另见 (Nobody, 1999)。',
    )
    expect(linkCitations(text, [])).toBe(text)
  })

  it('分号隔开的多篇各自成链接', () => {
    expect(linkCitations('(Smith, 2024; Lee, 2023)', [smith, lee])).toBe(
      '([Smith, 2024](#cite:p_smith); [Lee, 2023](#cite:p_lee))',
    )
  })
})

describe('默认模板布局', () => {
  const heights: Record<string, number> = {
    'cover:r1': 100,
    'card:a': 200,
    'card:b': 80,
    'card:c': 50,
    'cover:r2': 60,
    'card:d': 90,
  }
  const h = (k: string) => heights[k]
  const records = [
    { id: 'r1', cardIds: ['a', 'b', 'c'] },
    { id: 'r2', cardIds: ['d'] },
  ]

  it('封面在上，卡片两列，每张放进较短的那一列', () => {
    const l = defaultLayout(records, h)
    expect(l.get('cover:r1')).toEqual({ x: 0, y: 0, w: CARD_W * 2 + GAP })
    expect(l.get('card:a')).toEqual({ x: 0, y: 100 + GAP, w: CARD_W })
    expect(l.get('card:b')).toEqual({ x: CARD_W + GAP, y: 100 + GAP, w: CARD_W })
    // column 2 is shorter after b, so c goes under b
    expect(l.get('card:c')).toEqual({ x: CARD_W + GAP, y: 100 + GAP + 80 + GAP, w: CARD_W })
  })

  it('同一天多份：第二份在第一份下面，各自带封面', () => {
    const l = defaultLayout(records, h)
    const firstBottom = 100 + GAP + 200
    expect(l.get('cover:r2')).toEqual({ x: 0, y: firstBottom + RECORD_GAP, w: CARD_W * 2 + GAP })
    expect(l.get('card:d')!.y).toBe(firstBottom + RECORD_GAP + 60 + GAP)
  })

  it('没有卡片的记录只有封面', () => {
    const l = defaultLayout([{ id: 'r2', cardIds: [] }], h)
    expect([...l.keys()]).toEqual(['cover:r2'])
  })

  it('手机上单列', () => {
    const l = defaultLayout(records, h, 1)
    expect(l.get('cover:r1')!.w).toBe(CARD_W)
    expect(l.get('card:b')).toEqual({ x: 0, y: 100 + GAP + 200 + GAP, w: CARD_W })
  })

  it('同样的输入永远同样的布局', () => {
    expect([...defaultLayout(records, h)]).toEqual([...defaultLayout(records, h)])
  })
})
