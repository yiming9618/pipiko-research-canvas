import { describe, expect, it } from 'vitest'
import { extractDoi, fillFromLookup, parseCrossref } from './crossref'
import type { Paper } from './types'

const paper = (over: Partial<Paper> = {}): Paper => ({
  id: 'p1', title: '', authors: [], year: null, venue: '', doi: '10.1/x', category: '', keywords: [],
  status: 'want', url: '', one_liner: '', basics_md: '', created_at: 't', updated_at: 't', ...over,
})

describe('Crossref 文献信息', () => {
  it('读出标题、作者、年份、期刊', () => {
    const info = parseCrossref({
      message: {
        title: ['Guidelines for Human-AI Interaction'],
        author: [{ given: 'Saleema', family: 'Amershi' }, { name: 'Some Consortium' }],
        issued: { 'date-parts': [[2019, 5, 2]] },
        'container-title': ['Proceedings of CHI 2019'],
      },
    })
    expect(info).toEqual({
      title: 'Guidelines for Human-AI Interaction',
      authors: ['Saleema Amershi', 'Some Consortium'],
      year: 2019,
      venue: 'Proceedings of CHI 2019',
    })
  })

  it('标题里的标记和转义符号会清掉', () => {
    const info = parseCrossref({ message: { title: ['Mold &amp; <i>Matter</i>\n  in  HCI'] } })
    expect(info?.title).toBe('Mold & Matter in HCI')
  })

  it('没有 issued 时用别的日期；没有期刊时用出版方', () => {
    const info = parseCrossref({ message: { title: ['T'], published: { 'date-parts': [[2021]] }, publisher: 'ACM' } })
    expect(info?.year).toBe(2021)
    expect(info?.venue).toBe('ACM')
  })

  it('不是文献记录时返回空', () => {
    expect(parseCrossref(null)).toBeNull()
    expect(parseCrossref({ status: 'ok' })).toBeNull()
    expect(parseCrossref({ message: {} })).toBeNull()
  })

  it('只填空着的，已经写了的不覆盖', () => {
    const filled = fillFromLookup(paper({ title: '我自己写的标题', year: 2020 }), {
      title: '官方标题', authors: ['A B'], year: 2019, venue: 'CHI',
    })
    expect(filled.title).toBe('我自己写的标题')
    expect(filled.year).toBe(2020)
    expect(filled.authors).toEqual(['A B'])
    expect(filled.venue).toBe('CHI')
  })

  it('从各种写法里认出 DOI', () => {
    expect(extractDoi('10.1145/3290605.3300233')).toBe('10.1145/3290605.3300233')
    expect(extractDoi('doi: 10.1145/ABC.Def')).toBe('10.1145/abc.def')
    expect(extractDoi('https://doi.org/10.1145/3290605.3300233')).toBe('10.1145/3290605.3300233')
    expect(extractDoi('https://dl.acm.org/doi/10.1145/3290605.3300233.')).toBe('10.1145/3290605.3300233')
    expect(extractDoi('（见 10.1000/xyz123）')).toBe('10.1000/xyz123')
    expect(extractDoi('https://example.com/paper.pdf')).toBe('')
    expect(extractDoi('一篇论文的标题')).toBe('')
  })
})
