import { describe, expect, it } from 'vitest'
import { chineseNumber, parseQuery, runSearch, type Doc, type TypeNames } from './search'

const TYPES: TypeNames[] = [
  { id: 'type_method', names: ['研究方法'] },
  { id: 'type_result', names: ['研究结果/发现'] },
  { id: 'type_discussion', names: ['讨论 & 局限'] },
  { id: 'type_custom', names: ['研究伦理', '伦理'] },
]
const TODAY = '2026-11-11'
const parse = (s: string) => parseQuery(s, TYPES, TODAY)

describe('查询解析：日期', () => {
  it('各种写法', () => {
    expect(parse('2026-11-10').dates).toEqual([{ y: 2026, m: 11, d: 10 }])
    expect(parse('2026年11月10日').dates).toEqual([{ y: 2026, m: 11, d: 10 }])
    expect(parse('2026/11/10').dates).toEqual([{ y: 2026, m: 11, d: 10 }])
    expect(parse('2026-11').dates).toEqual([{ y: 2026, m: 11 }])
    expect(parse('2026年11月').dates).toEqual([{ y: 2026, m: 11 }])
    expect(parse('11月10日').dates).toEqual([{ m: 11, d: 10 }])
    expect(parse('11月10号').dates).toEqual([{ m: 11, d: 10 }])
    expect(parse('11/10').dates).toEqual([{ m: 11, d: 10 }])
    expect(parse('5月').dates).toEqual([{ m: 5 }])
    expect(parse('2025年').dates).toEqual([{ y: 2025 }])
    expect(parse('2025').dates).toEqual([{ y: 2025 }])
  })

  it('语音听写常见的中文数字', () => {
    expect(chineseNumber('十一')).toBe(11)
    expect(chineseNumber('二十')).toBe(20)
    expect(chineseNumber('三十一')).toBe(31)
    expect(chineseNumber('五')).toBe(5)
    expect(parse('十一月十日').dates).toEqual([{ m: 11, d: 10 }])
    expect(parse('五月').dates).toEqual([{ m: 5 }])
  })

  it('今天、昨天、这个月、上个月、今年', () => {
    expect(parse('今天').dates).toEqual([{ y: 2026, m: 11, d: 11 }])
    expect(parse('昨天').dates).toEqual([{ y: 2026, m: 11, d: 10 }])
    expect(parse('这个月').dates).toEqual([{ y: 2026, m: 11 }])
    expect(parse('上个月').dates).toEqual([{ y: 2026, m: 10 }])
    expect(parse('今年').dates).toEqual([{ y: 2026 }])
  })

  it('不像日期的数字留作关键词（DOI、13月、0/5）', () => {
    expect(parse('10.1145/3313831')).toEqual({ dates: [], kinds: [], terms: ['10.1145/3313831'] })
    expect(parse('13月').dates).toEqual([])
    expect(parse('版本 3').terms).toEqual(['版本', '3'])
  })
})

describe('查询解析：类型和关键词', () => {
  it('论文、五种卡片、重点类型名', () => {
    expect(parse('论文').kinds).toEqual([{ kind: 'paper' }])
    expect(parse('问题').kinds).toEqual([{ kind: 'card', card: '问题' }])
    expect(parse('下一步').kinds).toEqual([{ kind: 'card', card: '下一步' }])
    expect(parse('研究方法').kinds).toEqual([{ kind: 'block', typeId: 'type_method' }])
    expect(parse('讨论&局限').kinds).toEqual([{ kind: 'block', typeId: 'type_discussion' }])
    expect(parse('局限').kinds).toEqual([{ kind: 'block', typeId: 'type_discussion' }])
    expect(parse('伦理').kinds).toEqual([{ kind: 'block', typeId: 'type_custom' }]) // an old name still works
  })

  it('"发现"是卡片类型，不会被"研究结果/发现"抢走', () => {
    expect(parse('发现').kinds).toEqual([{ kind: 'card', card: '发现' }])
    expect(parse('研究结果').kinds).toEqual([{ kind: 'block', typeId: 'type_result' }])
  })

  it('三种条件组合，顺序随意，口语里的"的"不碍事', () => {
    const expected = { dates: [{ m: 11, d: 10 }], kinds: [{ kind: 'card', card: '问题' }], terms: ['霉菌'] }
    expect(parse('11月10日 问题 霉菌')).toEqual(expected)
    expect(parse('霉菌 问题 11/10')).toEqual(expected)
    expect(parse('11月10日的问题 霉菌')).toEqual(expected)
  })

  it('加引号就当普通关键词', () => {
    expect(parse('"问题" 意识')).toEqual({ dates: [], kinds: [], terms: ['问题', '意识'] })
  })

  it('英文不分大小写', () => {
    expect(parse('Bio-HCI Paper')).toEqual({ dates: [], kinds: [{ kind: 'paper' }], terms: ['bio-hci'] })
  })
})

const doc = (over: Partial<Doc> & Pick<Doc, 'key' | 'kind'>): Doc => ({
  dates: [],
  title: '',
  keywords: '',
  body: '',
  label: '',
  color: 'default',
  href: '#',
  ref: null,
  ...over,
})

const DOCS: Doc[] = [
  doc({ key: 'p1', kind: 'paper', dates: ['2026-11-01', '2026-12-03'], title: 'Living Media Interfaces', keywords: '活体, 共在', body: '用活的材料做界面', deep: '六周部署 访谈' }),
  doc({ key: 'b1', kind: 'block', typeId: 'type_method', dates: ['2026-11-01'], title: 'Living Media Interfaces', body: '六周的家庭部署，每周访谈一次' }),
  doc({ key: 'r1', kind: 'record', dates: ['2026-11-10'], title: '霉菌培养第二天', keywords: '霉菌, 琼脂' }),
  doc({ key: 'c1', kind: 'card', cardKind: '问题', dates: ['2026-11-10'], title: '霉菌培养第二天', keywords: '霉菌, 琼脂', body: '温度是不是太低？' }),
  doc({ key: 'c2', kind: 'card', cardKind: '发现', dates: ['2026-11-10'], title: '霉菌培养第二天', keywords: '霉菌, 琼脂', body: '白色菌丝出现了' }),
  doc({ key: 'c3', kind: 'card', cardKind: '问题', dates: ['2026-05-20'], title: '五月的记录', keywords: '共在', body: '在场感怎么测量？' }),
  doc({ key: 'pile1', kind: 'pile', title: '共在' }),
]
const find = (s: string) => runSearch(DOCS, parse(s)).map((h) => h.doc.key)

describe('搜索', () => {
  it('空的查询不返回东西', () => {
    expect(find('')).toEqual([])
    expect(find('   ')).toEqual([])
  })

  it('只按日期：那一天的所有东西', () => {
    expect(find('11月10日').sort()).toEqual(['c1', 'c2', 'r1'])
    expect(find('5月')).toEqual(['c3'])
  })

  it('只按类型', () => {
    expect(find('问题')).toEqual(['c1', 'c3']) // newest first
    expect(find('论文')).toEqual(['p1'])
    expect(find('研究方法')).toEqual(['b1'])
  })

  it('日期 + 类型 + 关键词', () => {
    expect(find('11月 问题 霉菌')).toEqual(['c1'])
    expect(find('5月 问题 霉菌')).toEqual([])
  })

  it('卡片可以靠它所在记录的关键词找到', () => {
    expect(find('琼脂 发现')).toEqual(['c2'])
  })

  it('论文读过几次，任何一次的日期都能找到它', () => {
    expect(find('12月 论文')).toEqual(['p1'])
    expect(find('2026-11-01')).toContain('p1')
  })

  it('搜"论文 + 关键词"时，重点区块里的内容也算', () => {
    expect(find('论文 访谈')).toEqual(['p1'])
    // without the type word, the block itself is the result
    expect(find('访谈')).toEqual(['b1'])
  })

  it('多个关键词都要出现', () => {
    expect(find('家庭 访谈')).toEqual(['b1'])
    expect(find('家庭 霉菌')).toEqual([])
  })

  it('标题里出现的排在前面，其次是关键词', () => {
    expect(find('共在')).toEqual(['pile1', 'p1', 'c3'])
  })

  it('给出带上下文的片段', () => {
    const [hit] = runSearch(DOCS, parse('访谈'))
    expect(hit.snippet).toEqual({ before: '六周的家庭部署，每周', match: '访谈', after: '一次' })
  })
})
