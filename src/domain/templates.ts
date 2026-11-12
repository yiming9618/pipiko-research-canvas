// The two Markdown templates the "复制模板" buttons hand to the AI.
// The parser also reads the placeholder lines from here, so a section that
// still contains only the template's hint text counts as empty.

import { BUILTIN_TYPES } from './types'

export const PAPER_TEMPLATE = `---
type: paper
title: 论文完整标题
authors: 作者1, 作者2
year: 2024
venue: CHI
doi: 10.xxxx/xxxxx
category: Living media
keywords: 关键词1, 关键词2, 同义词
date: 2026-11-11
---

## 一句话总结

## 基础
1. 在什么领域：
2. 发现了什么 gap（简单描述路径）：
3. 用了什么方法，从什么角度切入：
4. 解决了什么痛点：
5. 可行吗？成功了吗？为什么：
6. 相关研究（可选）：

## 重点：研究方法
（作者具体怎么做的、这个做法有什么值得参考的特点，必要时附页码或图号）

## 我的理解
（可选。导入后挂到右侧理解栏，标记为"AI 整理"，日期 = date）
`

export const RESEARCH_TEMPLATE = `---
type: research
date: 2026-11-11
title: 一个短标题
summary: 一句话概括
activities: 阅读, 实验, 讨论
keywords: 关键词1, 关键词2, 同义词
papers: 10.xxxx/aaaa, 10.xxxx/bbbb
board: 画板名称（可选，不确定就删掉这一行）
---

## 发现
（新知道的东西：论文知识、观察、方法、信息）

## 实验
（材料、操作、状态、结果）

## 问题
（还没解决的疑问或具体困难）

## 思考
（理解的变化、假设、判断、暂时的结论）

## 下一步
（下次准备继续的事情）
`

const PAPER_RULES = `请把我们刚才关于这篇论文的讨论，整理成下面这个固定格式的 Markdown，只输出 Markdown 本身。

规则：
- date 写内容发生的日期（今天），格式 YYYY-MM-DD。
- "## 重点：" 后面写类型名，可以有多块，同一类型也可以出现多次。类型名从这里选：${BUILTIN_TYPES.map((t) => t.name).join('、')}。
- 没有内容的标题整块删掉，不要写"暂无"。
- 引用其他论文时写成 (作者, 年份)。
- 不要改动标题文字和 frontmatter 的字段名。

`

const RESEARCH_RULES = `请把我们刚才的讨论，整理成下面这个固定格式的 Markdown，只输出 Markdown 本身。

规则：
- date 写内容发生的日期，格式 YYYY-MM-DD。
- 五种标题（发现、实验、问题、思考、下一步）都是可选的，没有内容的整块删掉，不要写"暂无"。
- 同一种标题可以出现多次，每次是一张独立的卡片。
- 提到论文时写成 (作者, 年份)，并把它的 DOI 写进 papers。
- activities 从这里选：阅读、实验、讨论、导师、制作。
- board 是可选的：写我想把这份记录放进的画板的名称，要和我说的名称一字不差；我没说就删掉这一行。
- 不要改动标题文字和 frontmatter 的字段名。

`

/** What the copy buttons put on the clipboard: short rules for the AI + the template. */
export const PAPER_PROMPT = PAPER_RULES + PAPER_TEMPLATE
export const RESEARCH_PROMPT = RESEARCH_RULES + RESEARCH_TEMPLATE

function hintLines(template: string): Set<string> {
  const body = template.split(/^---\s*$/m).slice(2).join('---')
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('##'))
  return new Set(lines)
}

/** Lines that are template hints or unanswered prompts, not real content. */
export const PLACEHOLDER_LINES: ReadonlySet<string> = new Set([
  ...hintLines(PAPER_TEMPLATE),
  ...hintLines(RESEARCH_TEMPLATE),
])
