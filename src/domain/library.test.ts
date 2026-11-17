import { describe, expect, it } from 'vitest'
import { boxesByRef } from './discussions'
import { lastRead, sortPapers } from './library'
import type { Discussion, DiscussionItem, ImportEntry, Paper, PaperUse } from './types'

const T = '2026-11-01T00:00:00.000Z'
const paper = (id: string, over: Partial<Paper> = {}): Paper => ({
  id, title: id, authors: [], year: null, venue: '', doi: '', category: '', keywords: [], status: 'read', url: '', one_liner: '', basics_md: '', created_at: T, updated_at: T, ...over,
})
const use = (id: string, over: Partial<PaperUse>): PaperUse => ({ id, updated_at: T, ...over })
const ids = (list: Paper[]) => list.map((p) => p.id)

describe('论文的顺序', () => {
  const papers = [
    paper('old', { year: 2019, created_at: '2026-11-02T00:00:00.000Z' }),
    paper('new2024a', { year: 2024, created_at: '2026-11-03T00:00:00.000Z' }),
    paper('new2024b', { year: 2024, created_at: '2026-11-05T00:00:00.000Z' }),
    paper('noyear', { created_at: '2026-11-09T00:00:00.000Z' }),
    paper('reading1', { year: 2010, created_at: '2026-10-01T00:00:00.000Z' }),
    paper('reading2', { year: 2011, created_at: '2026-10-02T00:00:00.000Z' }),
  ]
  const uses = new Map([
    ['reading1', use('reading1', { reading_since: '2026-11-10T09:00:00.000Z', worked_at: '2026-11-10T09:00:00.000Z' })],
    ['reading2', use('reading2', { reading_since: '2026-11-12T09:00:00.000Z' })],
    ['old', use('old', { worked_at: '2026-11-15T09:00:00.000Z' })],
  ])
  const readAt = (p: Paper) => uses.get(p.id)?.worked_at ?? ''

  it('在读的永远在前，按置顶/编辑时间新的在前', () => {
    for (const s of ['read', 'published', 'added'] as const) expect(ids(sortPapers(papers, s, uses, readAt)).slice(0, 2)).toEqual(['reading2', 'reading1'])
  })
  it('发表时间：年份新的在前；同一年按加入时间新的在前；没有年份的最后', () => {
    expect(ids(sortPapers(papers, 'published', uses, readAt)).slice(2)).toEqual(['new2024b', 'new2024a', 'old', 'noyear'])
  })
  it('收藏时间：加入论文库的时间新的在前', () => {
    expect(ids(sortPapers(papers, 'added', uses, readAt)).slice(2)).toEqual(['noyear', 'new2024b', 'new2024a', 'old'])
  })
  it('最近阅读：最后一次实际编辑新的在前；从没读过的按加入时间', () => {
    expect(ids(sortPapers(papers, 'read', uses, readAt)).slice(2)).toEqual(['old', 'noyear', 'new2024b', 'new2024a'])
  })
  it('手动关掉在读：回到普通位置', () => {
    const off = new Map(uses)
    off.set('reading2', use('reading2', {}))
    expect(ids(sortPapers(papers, 'added', off, readAt))[0]).toBe('reading1')
  })
  it('最近阅读的时间：记录下来的编辑时间、导入时间、阅读日期取最新的', () => {
    const p = paper('p')
    const imp = { id: 'i', kind: 'paper', paper_id: 'p', imported_at: '2026-11-08T10:00:00.000Z', date: '2026-11-08' } as ImportEntry
    expect(lastRead(p, undefined, [imp])).toBe('2026-11-08T10:00:00.000Z')
    expect(lastRead(p, use('p', { worked_at: '2026-11-09T00:00:00.000Z' }), [imp])).toBe('2026-11-09T00:00:00.000Z')
    expect(lastRead(p, undefined, [{ ...imp, undone: true }], ['2026-11-03'])).toBe('2026-11-03')
  })
})

describe('讨论框标记：直接从讨论框的内容读出', () => {
  const box = (id: string, name: string, over: Partial<Discussion> = {}): Discussion => ({ id, name, created_at: T, updated_at: T, ...over })
  const item = (box: string, type: DiscussionItem['ref_type'], id: string, over: Partial<DiscussionItem> = {}): DiscussionItem => ({ id: `${box}-${id}`, discussion_id: box, ref_type: type, ref_id: id, added_at: T, updated_at: T, ...over })
  const map = boxesByRef(
    [item('a', 'paper', 'p1'), item('b', 'paper', 'p1'), item('a', 'card', 'c1'), item('old', 'paper', 'p2'), item('a', 'paper', 'p3', { deleted: true })],
    [box('a', '霉菌实验'), box('b', '写作'), box('old', '收起来的', { archived_at: T })],
  )
  it('在哪些讨论框里（名字）', () => {
    expect(map.get('paper:p1')).toEqual(['霉菌实验', '写作'])
    expect(map.get('card:c1')).toEqual(['霉菌实验'])
  })
  it('收起来的讨论框、移出了的不算', () => {
    expect(map.has('paper:p2')).toBe(false)
    expect(map.has('paper:p3')).toBe(false)
  })
})
