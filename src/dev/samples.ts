// Placeholder content for trying things out. Only reachable from the local
// test build (see Settings); it goes through the normal import, so every
// piece can be undone from "最近导入".

import type { ImportKind } from '../domain/types'

function shift(today: string, days: number): string {
  const d = new Date(`${today}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function sampleImports(today: string): { kind: ImportKind; md: string }[] {
  const earlier = shift(today, -3)
  return [
    {
      kind: 'paper',
      md: `---
type: paper
title: 示例论文标题一
authors: 作者甲, 作者乙
year: 2024
venue: 会议名称
doi: 10.0000/sample-1
category: 示例分类一
keywords: 关键词1, 关键词2
date: ${earlier}
---

## 一句话总结
一句话总结：xxxxxxx

## 基础
1. 在什么领域：xxxxxxx
2. 发现了什么 gap（简单描述路径）：xxxxxxx
3. 用了什么方法，从什么角度切入：xxxxxxx
4. 解决了什么痛点：xxxxxxx
5. 可行吗？成功了吗？为什么：xxxxxxx
6. 相关研究（可选）：xxxxxxx

## 重点：研究主旨/贡献
研究主旨：xxxxxxx

## 重点：研究方法
研究方法：xxxxxxx（p.4，图 2）

## 重点：研究结果/发现
研究结果：xxxxxxx

## 我的理解
我的理解：xxxxxxx
`,
    },
    {
      kind: 'paper',
      md: `---
type: paper
title: 示例论文标题二
authors: 作者丙
year: 2023
venue: 期刊名称
doi: 10.0000/sample-2
category: 示例分类二
keywords: 关键词3, 关键词4
date: ${today}
---

## 一句话总结
一句话总结：xxxxxxx

## 基础
1. 在什么领域：xxxxxxx
2. 发现了什么 gap（简单描述路径）：xxxxxxx
3. 用了什么方法，从什么角度切入：xxxxxxx
4. 解决了什么痛点：xxxxxxx
5. 可行吗？成功了吗？为什么：xxxxxxx

## 重点：研究动机 & RQ
研究动机：xxxxxxx

## 重点：系统设计/实现
系统设计：xxxxxxx

## 重点：讨论 & 局限
讨论与局限：xxxxxxx

## 重点：写作结构
写作结构：xxxxxxx

## 我的理解
我的理解：xxxxxxx
`,
    },
    {
      kind: 'research',
      md: `---
type: research
date: ${earlier}
title: 示例研究记录一
summary: 一句话概括：xxxxxxx
activities: 阅读, 讨论
keywords: 关键词1, 关键词5
papers: 10.0000/sample-1
---

## 发现
发现：xxxxxxx，参考 (作者甲, 2024)。

## 问题
问题：xxxxxxx

## 下一步
下一步：xxxxxxx
`,
    },
    {
      kind: 'research',
      md: `---
type: research
date: ${today}
title: 示例研究记录二
summary: 一句话概括：xxxxxxx
activities: 实验, 制作
keywords: 关键词2, 关键词6
papers: 10.0000/sample-1, 10.0000/sample-2
---

## 发现
发现：xxxxxxx，参考 (作者丙, 2023)。

## 实验
实验：材料 xxxxxxx；操作 xxxxxxx；结果 xxxxxxx

## 问题
问题一：xxxxxxx

## 问题
问题二：xxxxxxx

## 思考
思考：xxxxxxx，对比 (作者甲, 2024)。

## 下一步
下一步：xxxxxxx
`,
    },
  ]
}
