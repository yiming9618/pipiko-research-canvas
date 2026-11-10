import { describe, expect, it } from 'vitest'
import { PAPER_TEMPLATE, RESEARCH_TEMPLATE } from '../domain/templates'
import { parseMarkdown, type ParsedPaper, type ParsedResearch } from './index'

const opts = { today: '2026-11-11', kindHint: 'research' as const }
const research = (md: string) => parseMarkdown(md, opts) as ParsedResearch
const paper = (md: string) => parseMarkdown(md, { ...opts, kindHint: 'paper' }) as ParsedPaper

const RESEARCH_MD = `---
type: research
date: 2026-11-10
title: 笔记本结构
summary: 定下三部分
activities: 阅读, 讨论
keywords: 共在, 档案学
papers: 10.1145/AAA, https://doi.org/10.1145/bbb
---

## 发现
时间线是原件 (Smith, 2024)。

## 问题
卡片分几种？

## 下一步
定模板。
`

const PAPER_MD = `---
type: paper
title: Living Media Interfaces
authors: Jane Smith, 李明
year: 2024
venue: CHI
doi: 10.1145/AAA
category: Living media
keywords: 活体, biology
date: 2026-11-10
---

## 一句话总结
用活的材料做界面。

## 基础
1. 在什么领域：Bio-HCI
2. 发现了什么 gap（简单描述路径）：缺少长期观察

## 重点：研究方法
做了六周的部署（p.4）。

## 重点：研究结果/发现
人会照顾它。

## 我的理解
和"共在"有关。
`

describe('研究记录', () => {
  it('正常输入', () => {
    const r = research(RESEARCH_MD)
    expect(r.kind).toBe('research')
    expect(r.date).toBe('2026-11-10')
    expect(r.title).toBe('笔记本结构')
    expect(r.summary).toBe('定下三部分')
    expect(r.activities).toEqual(['阅读', '讨论'])
    expect(r.keywords).toEqual(['共在', '档案学'])
    expect(r.paper_dois).toEqual(['10.1145/aaa', '10.1145/bbb'])
    expect(r.cards.map((c) => c.kind)).toEqual(['发现', '问题', '下一步'])
    expect(r.cards[0].body_md).toBe('时间线是原件 (Smith, 2024)。')
    expect(r.notices).toEqual([])
  })

  it('空标题不生成卡片', () => {
    const r = research(`---\ntype: research\ndate: 2026-11-10\ntitle: t\n---\n\n## 发现\n\n## 实验\n   \n## 问题\n有一个\n`)
    expect(r.cards).toHaveLength(1)
    expect(r.cards[0].kind).toBe('问题')
  })

  it('只有模板提示文字的标题算空', () => {
    const r = research(RESEARCH_TEMPLATE)
    expect(r.cards).toEqual([])
  })

  it('一张卡片都没有也合法', () => {
    const r = research(`---\ntype: research\ndate: 2026-11-10\ntitle: 只有封面\nsummary: 一句话\n---\n`)
    expect(r.cards).toEqual([])
    expect(r.title).toBe('只有封面')
  })

  it('重复标题生成多张同类卡片', () => {
    const r = research(`---\ntype: research\ndate: 2026-11-10\n---\n## 问题\n第一个\n## 发现\n中间\n## 问题\n第二个\n`)
    expect(r.cards.map((c) => [c.kind, c.body_md])).toEqual([
      ['问题', '第一个'],
      ['发现', '中间'],
      ['问题', '第二个'],
    ])
  })

  it('缺字段用默认值并提示', () => {
    const r = research(`## 思考\n没有 frontmatter\n`)
    expect(r.date).toBe('2026-11-11')
    expect(r.title).toBe('')
    expect(r.cards).toHaveLength(1)
    expect(r.notices.join()).toContain('用了今天')
  })

  it('看不懂的日期用今天并提示', () => {
    const r = research(`---\ntype: research\ndate: 上周三\n---\n## 思考\nx\n`)
    expect(r.date).toBe('2026-11-11')
    expect(r.notices.join()).toContain('上周三')
  })

  it('多种日期写法', () => {
    for (const d of ['2026/11/3', '2026.11.03', '2026年11月3日']) {
      expect(research(`---\ndate: ${d}\n---\n`).date).toBe('2026-11-03')
    }
  })

  it('不认识的标题保留为其他卡片，标题前的文字也保留', () => {
    const r = research(`---\ntype: research\ndate: 2026-11-10\n---\n开头的一段话\n\n## 灵感\n突然想到\n`)
    expect(r.preamble_md).toBe('开头的一段话')
    expect(r.cards).toEqual([{ kind: '其他', heading: '灵感', body_md: '突然想到' }])
  })

  it('三级标题和代码块里的 ## 留在正文里', () => {
    const r = research(`---\ndate: 2026-11-10\n---\n## 实验\n### 材料\n琼脂\n\`\`\`\n## 不是标题\n\`\`\`\n`)
    expect(r.cards).toHaveLength(1)
    expect(r.cards[0].body_md).toContain('### 材料')
    expect(r.cards[0].body_md).toContain('## 不是标题')
  })

  it('全角冒号、外层代码围栏、Windows 换行', () => {
    const md = '```markdown\r\n---\r\ntype：research\r\ndate：2026-11-10\r\ntitle：全角\r\nkeywords：甲，乙、丙\r\n---\r\n## 发现\r\n内容\r\n```\r\n'
    const r = research(md)
    expect(r.title).toBe('全角')
    expect(r.keywords).toEqual(['甲', '乙', '丙'])
    expect(r.cards).toHaveLength(1)
  })

  it('同样的输入永远得到同样的结果', () => {
    expect(research(RESEARCH_MD)).toEqual(research(RESEARCH_MD))
  })
})

describe('论文', () => {
  it('正常输入', () => {
    const p = paper(PAPER_MD)
    expect(p.kind).toBe('paper')
    expect(p.title).toBe('Living Media Interfaces')
    expect(p.authors).toEqual(['Jane Smith', '李明'])
    expect(p.year).toBe(2024)
    expect(p.venue).toBe('CHI')
    expect(p.doi).toBe('10.1145/aaa')
    expect(p.category).toBe('Living media')
    expect(p.one_liner).toBe('用活的材料做界面。')
    expect(p.basics_md).toContain('Bio-HCI')
    expect(p.blocks.map((b) => b.type_name)).toEqual(['研究方法', '研究结果/发现'])
    expect(p.understanding_md).toBe('和"共在"有关。')
    expect(p.notices).toEqual([])
  })

  it('内容里的 type 优先于按钮的选择', () => {
    const p = parseMarkdown(PAPER_MD, { today: '2026-11-11', kindHint: 'research' })
    expect(p.kind).toBe('paper')
    expect(p.notices.join()).toContain('论文')
  })

  it('没填的模板：没有区块、没有基础、没有理解', () => {
    const p = paper(PAPER_TEMPLATE)
    expect(p.one_liner).toBe('')
    expect(p.basics_md).toBe('')
    expect(p.blocks).toEqual([])
    expect(p.understanding_md).toBe('')
  })

  it('缺字段', () => {
    const p = paper(`---\ntype: paper\ntitle: 只有标题\n---\n`)
    expect(p.authors).toEqual([])
    expect(p.year).toBeNull()
    expect(p.doi).toBe('')
    expect(p.date).toBe('2026-11-11')
  })

  it('同一重点类型出现多次是多个独立区块', () => {
    const p = paper(`---\ntype: paper\ntitle: t\n---\n## 重点：研究方法\n第一块\n## 重点:研究方法\n第二块\n`)
    expect(p.blocks.map((b) => [b.type_name, b.body_md])).toEqual([
      ['研究方法', '第一块'],
      ['研究方法', '第二块'],
    ])
  })

  it('未知重点类型照样保存', () => {
    const p = paper(`---\ntype: paper\ntitle: t\n---\n## 重点：伦理\n需要知情同意\n`)
    expect(p.blocks).toEqual([{ type_name: '伦理', heading: '重点：伦理', body_md: '需要知情同意' }])
  })

  it('不认识的标题保留原文，不丢弃', () => {
    const p = paper(`---\ntype: paper\ntitle: t\n---\n## 引用格式\nSmith 2024\n`)
    expect(p.blocks).toEqual([{ type_name: null, heading: '引用格式', body_md: 'Smith 2024' }])
  })

  it('DOI 写成链接也能识别', () => {
    expect(paper(`---\ntype: paper\ntitle: t\ndoi: https://doi.org/10.1145/ABC.\n---\n`).doi).toBe('10.1145/abc')
  })
})
