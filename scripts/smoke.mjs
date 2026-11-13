// Walks the import flow in a headless browser at phone and iPad sizes.
// Usage: node scripts/smoke.mjs <url> <screenshot-dir>
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'

const RESEARCH = `---
type: research
date: 2026-11-10
title: 笔记本结构
summary: 定下三部分
activities: 阅读, 讨论
---

## 发现
时间线是原件。

## 问题
卡片分几种？

## 下一步
定模板。
`

const PAPER = `---
type: paper
title: Living Media Interfaces
authors: Jane Smith
year: 2024
doi: 10.1145/aaa
date: 2026-11-10
---

## 一句话总结
用活的材料做界面。

## 重点：研究方法
六周部署。

## 重点：伦理
知情同意。
`

const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'ipad', width: 1366, height: 1024, isMobile: false, hasTouch: true },
  { name: 'mac', width: 1728, height: 1000, isMobile: false, hasTouch: false },
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
    hasTouch: size.hasTouch,
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await page.goto(url)
  await page.getByRole('heading', { name: '欢迎回来' }).waitFor()
  await page.screenshot({ path: `${out}/${size.name}-1-hero.png` })

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  check(`[${size.name}] 没有横向滚动`, !overflow)

  // question
  await page.getByRole('button', { name: /现在在想的问题|点一下/ }).click()
  await page.locator('.question-input').fill('人如何感知它的在场？')
  await page.locator('.question-input').press('Enter')
  await page.getByRole('button', { name: '人如何感知它的在场？' }).waitFor()
  check(`[${size.name}] 问题可以编辑并保存`, true)

  // scroll to panel
  await page.getByRole('button', { name: /往下滑/ }).click()
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.panel')).opacity) > 0.98)
  await page.screenshot({ path: `${out}/${size.name}-2-panel.png` })

  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button, a, .panel select, .panel input')]
      .map((el) => ({ t: el.textContent.trim().slice(0, 12) || el.getAttribute('aria-label') || el.tagName, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44))
      .map((x) => `${x.t} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`),
  )
  check(`[${size.name}] 可点元素都 ≥ 44px`, small.length === 0, small.join(', '))

  // copy template
  await page.getByRole('button', { name: /复制「研究记录」模板/ }).click()
  const copied = await page.getByRole('button', { name: /已复制|没复制成功/ }).textContent()
  check(`[${size.name}] 复制模板有反馈`, true, copied.trim())

  // import research
  // no boards yet: the first import makes the first board
  check(`[${size.name}] 还没有画板时，面板让我给新画板起名字`, await page.getByLabel('新画板的名字').isVisible())
  await page.getByLabel('新画板的名字').fill('霉菌研究')
  await page.locator('.md-input').fill(RESEARCH)
  await page.getByRole('button', { name: '放进去' }).click()
  await page.getByText('生成了 3 张卡片，放进新画板「霉菌研究」').waitFor()
  check(`[${size.name}] 导入研究记录，放进新建的画板`, true)
  check(`[${size.name}] 结果里有去那块画板的入口`, (await page.getByRole('link', { name: '去看看' }).getAttribute('href')).startsWith('#/board/'))
  check(`[${size.name}] 之后默认选中最近使用的画板`, (await page.getByLabel('放到哪块画板').locator('option:checked').innerText()).includes('霉菌研究（最近使用）'))
  await page.screenshot({ path: `${out}/${size.name}-3-result.png` })

  // same text again
  await page.locator('.md-input').fill(RESEARCH)
  await page.getByRole('button', { name: '放进去' }).click()
  await page.getByText(/已经导入过/).waitFor()
  check(`[${size.name}] 重复粘贴不重复生成`, true)

  // paper (button left on 研究记录: frontmatter decides)
  await page.locator('.md-input').fill(PAPER)
  await page.getByRole('button', { name: '放进去' }).click()
  await page.getByText(/1 篇论文放进论文库/).waitFor()
  await page.getByText(/新的重点类型：伦理/).waitFor()
  check(`[${size.name}] 导入论文 + 未知重点类型`, true)

  // undo from the panel
  await page.getByRole('button', { name: '撤销' }).click()
  await page.getByText('已撤销这次导入').waitFor()
  check(`[${size.name}] 撤销`, true)

  // settings
  await page.goto(`${url}#/settings`)
  await page.getByRole('heading', { name: '最近导入' }).waitFor()
  // 最近导入 is folded when the page opens
  check(`[${size.name}] 设置页：“最近导入”默认折叠`, (await page.getByRole('button', { name: '最近导入' }).getAttribute('aria-expanded')) === 'false')
  await page.getByRole('button', { name: '最近导入' }).click()
  await page.getByText('已撤销').first().waitFor()
  await page.getByRole('button', { name: '查看原始 Markdown' }).first().click()
  await page.locator('.raw').waitFor()
  check(`[${size.name}] 设置页：最近导入 + 原文`, true)
  await page.screenshot({ path: `${out}/${size.name}-4-settings.png`, fullPage: true })

  // backup round trip
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出全部' }).click(),
  ])
  const file = `${out}/${size.name}-backup.json`
  await download.saveAs(file)
  await page.evaluate(() => indexedDB.deleteDatabase('research-notebook'))
  await page.reload()
  // 最近导入 is folded when the page opens: open it to see the list come back
  await page.getByRole('button', { name: '最近导入' }).click()
  await page.getByText('还没有导入过内容').waitFor()
  await page.locator('input[type=file]').setInputFiles(file)
  await page.getByText(/已导入：补上或更新了/).waitFor()
  const rows = await page.locator('.import-item').count()
  check(`[${size.name}] 备份导出 → 清空 → 导入`, rows === 2, `${rows} 条导入记录`)

  check(`[${size.name}] 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
