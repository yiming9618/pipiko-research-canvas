// Walks the library and paper page in a headless browser at phone and iPad sizes.
// Usage: node scripts/smoke-library.mjs <url> <screenshot-dir>
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'

const PAPER_A = `---
type: paper
title: Living Media Interfaces
authors: Jane Smith, 李明
year: 2024
venue: CHI
doi: 10.1145/aaa
category: Living media
keywords: 活体
date: 2026-11-01
---

## 一句话总结
用活的材料做界面，人会照顾它。

## 基础
1. 在什么领域：Bio-HCI
2. 发现了什么 gap（简单描述路径）：缺少长期观察

## 重点：研究方法
做了六周的家庭部署（p.4），每周访谈一次。

## 重点：研究结果/发现
- 人会给它起名字
- 忘记浇水会内疚

## 重点：伦理
需要知情同意。

## 我的理解
和"共在"有关。
`

const PAPER_A_AGAIN = `---
type: paper
title: Living Media Interfaces
doi: 10.1145/aaa
date: 2026-12-03
---

## 重点：讨论 & 局限
样本只有六户。

## 我的理解
重读后觉得"照顾"才是重点。
`

const PAPER_B = `---
type: paper
title: Mold as Material
authors: K. Tanaka
year: 2023
venue: DIS
doi: 10.1145/bbb
category: 霉菌
date: 2026-11-04
---

## 一句话总结
把霉菌当成设计材料。

## 重点：研究方法
培养皿实验。
`

const RESEARCH = `---
type: research
date: 2026-11-10
title: 引用测试
papers: 10.1145/aaa
---

## 发现
照顾关系 (Smith, 2024)。
`

// 1×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true },
  { name: 'ipad', width: 1366, height: 1024, isMobile: false },
]

const browser = await chromium.launch()
let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}

for (const size of sizes) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: size.isMobile,
    hasTouch: true,
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('dialog', (d) => d.accept())
  const tag = `[${size.name}]`

  const smallTargets = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('button, a, summary, select, input:not([type=file])')]
        .filter((el) => !el.classList.contains('sr-only') && !el.closest('.md'))
        .map((el) => ({ t: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 14), r: el.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44))
        .map((x) => `${x.t} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`),
    )
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

  // ── a "想看" entry that the import should pick up
  await page.goto(`${url}#/library`)
  await page.getByRole('button', { name: /想看/ }).click()
  await page.getByPlaceholder('想看的论文标题').fill('mold as material')
  await page.getByPlaceholder('链接（可以不填）').fill('https://example.org/mold')
  await page.getByRole('button', { name: '加进想看' }).click()
  await page.getByRole('button', { name: '想看 · 1' }).waitFor()
  check(`${tag} 加进想看`, true)

  // ── imports
  await page.goto(url)
  for (const [md, expect] of [
    [PAPER_A, /1 篇论文放进论文库/],
    [PAPER_A_AGAIN, /1 篇论文已合并/],
    [PAPER_B, /从"想看"移到"已读"/],
    [RESEARCH, /生成了 1 张卡片/],
  ]) {
    await page.locator('.md-input').fill(md)
    await page.getByRole('button', { name: '放进去' }).click()
    await page.getByText(expect).waitFor()
  }
  check(`${tag} 导入：新论文、合并、想看转已读`, true)

  // ── library list
  await page.getByRole('link', { name: '论文库' }).click()
  await page.getByRole('button', { name: '已读 · 2' }).click()
  await page.getByRole('button', { name: '想看 · 0' }).waitFor()
  await page.getByRole('button', { name: /Living media/ }).waitFor()
  await page.getByRole('button', { name: /霉菌/ }).waitFor()
  check(`${tag} 已读 2 / 想看 0，按 category 分组`, true)

  const dots = await page.locator('.paper-row', { hasText: 'Living Media Interfaces' }).locator('.dot').count()
  check(`${tag} 色点按类型只显示一个`, dots === 4, `${dots} 个色点`)
  check(`${tag} 读过 2 次`, await page.getByText(/读过 2 次/).first().isVisible())
  await page.screenshot({ path: `${out}/${size.name}-lib-1-list.png`, fullPage: size.isMobile })

  // filter by a type only paper A has
  await page.getByRole('button', { name: '研究结果/发现' }).click()
  check(`${tag} 点颜色筛选`, (await page.locator('.paper-row').count()) === 1)
  await page.getByRole('button', { name: '研究结果/发现' }).click()

  // collapse a group
  await page.getByRole('button', { name: /霉菌/ }).click()
  check(`${tag} 分组可以折叠`, (await page.locator('.paper-row').count()) === 1)
  await page.getByRole('button', { name: /霉菌/ }).click()

  check(`${tag} 列表：可点元素 ≥ 44px`, (await smallTargets()).length === 0, (await smallTargets()).join(', '))
  check(`${tag} 列表：没有横向滚动`, await noSideScroll())

  // ── paper page
  await page.locator('.paper-row', { hasText: 'Living Media Interfaces' }).click()
  await page.getByRole('heading', { name: 'Living Media Interfaces', level: 1 }).waitFor()
  check(`${tag} 基础默认折叠`, !(await page.locator('.basics').evaluate((el) => el.open)))
  check(`${tag} 重点区块 4 个（含未知类型）`, (await page.locator('section.block').count()) === 4)
  check(`${tag} 理解栏 2 条 AI 整理`, (await page.locator('.source[data-source=ai]').count()) === 2)
  check(`${tag} 被引用于 11/10（可点）`, await page.locator('.cited a', { hasText: '11/10' }).isVisible())
  check(`${tag} 读过 2 次：11/1、12/3`, await page.getByText('读过 2 次：11/1、12/3').isVisible())

  // layout: rail beside on wide, below on phone
  const pos = await page.evaluate(() => {
    const main = document.querySelector('.paper-main').getBoundingClientRect()
    const rail = document.querySelector('.rail').getBoundingClientRect()
    return { beside: rail.left >= main.right - 1, below: rail.top >= main.bottom - 1 }
  })
  check(`${tag} 理解栏位置`, size.isMobile ? pos.below : pos.beside, size.isMobile ? '在正文下方' : '在右侧')
  if (!size.isMobile) check(`${tag} 左边仍显示论文库列表`, await page.locator('.liblist').isVisible())

  // edit a block
  await page.locator('section.block', { hasText: '研究方法' }).locator('.editable').click()
  await page.getByLabel('「研究方法」这一块').fill('做了六周的家庭部署，我补充：每周访谈。')
  await page.getByRole('button', { name: '保存' }).click()
  await page.getByText('我补充：每周访谈。').waitFor()
  check(`${tag} 编辑区块，标出"改过"`, await page.locator('.block-edited').isVisible())

  // add a block by hand
  await page.getByRole('button', { name: '加一个重点' }).click()
  await page.locator('.add-form select').selectOption({ label: '写作结构' })
  await page.locator('.add-form textarea').fill('先讲故事再讲方法。')
  await page.locator('.add-form').getByRole('button', { name: '保存' }).click()
  await page.locator('section.block', { hasText: '先讲故事再讲方法。' }).waitFor()
  check(`${tag} 手动新增重点区块`, true)

  // delete a block
  await page.locator('section.block', { hasText: '需要知情同意' }).locator('.editable').click()
  await page.getByRole('button', { name: '删除' }).click()
  await page.locator('section.block', { hasText: '需要知情同意' }).waitFor({ state: 'detached' })
  check(`${tag} 删除区块`, true)

  // comments
  await page.getByPlaceholder('写一条理解…').fill('我自己的想法。')
  await page.getByRole('button', { name: '加上' }).click()
  await page.locator('.source[data-source=me]').waitFor()
  await page.locator('.rail input[type=file]').setInputFiles({ name: 'sketch.png', mimeType: 'image/png', buffer: PNG })
  await page.locator('.comment-image img').waitFor()
  check(`${tag} 加评论 + 上传图片（我写的 / 手绘）`, (await page.locator('.source[data-source=drawing]').count()) === 1)

  await page.locator('.basics summary').click()
  await page.locator('.basics').getByText('Bio-HCI').waitFor()
  await page.getByText('查看原始 Markdown').click()
  check(`${tag} 原始 Markdown 两份都在`, (await page.locator('.raw-box .raw').count()) === 2)

  check(`${tag} 论文页：可点元素 ≥ 44px`, (await smallTargets()).length === 0, (await smallTargets()).join(', '))
  check(`${tag} 论文页：没有横向滚动`, await noSideScroll())
  await page.screenshot({ path: `${out}/${size.name}-lib-2-paper.png`, fullPage: true })

  // ── rename + recolour the unknown type (it is still in the list even though its block was deleted)
  await page.goto(`${url}#/settings`)
  const row = page.locator('.type-row', { has: page.locator('input') })
  await row.locator('input').fill('研究伦理')
  await row.locator('input').blur()
  await row.locator('select').selectOption('yellow')
  await page.locator('.type-row[data-color=yellow]').waitFor()
  check(`${tag} 设置里改类型名称和颜色`, true)
  await page.screenshot({ path: `${out}/${size.name}-lib-3-settings.png`, fullPage: true })

  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
