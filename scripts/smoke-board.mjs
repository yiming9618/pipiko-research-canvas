// Walks the daily board in a headless browser at phone and iPad sizes.
// Usage: node scripts/smoke-board.mjs <url> <screenshot-dir>
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'

const PAPER = `---
type: paper
title: Living Media Interfaces
authors: Jane Smith
year: 2024
venue: CHI
doi: 10.1145/aaa
category: Living media
date: 2026-11-10
---

## 一句话总结
用活的材料做界面，人会照顾它。

## 重点：研究方法
六周部署。
`

const RESEARCH_1 = `---
type: research
date: 2026-11-10
title: 笔记本结构定下来
summary: 主页、论文库、画板区三部分
activities: 阅读, 讨论
keywords: 共在, 笔记本, 档案学
papers: 10.1145/aaa
---

## 发现
时间线是原件不动，堆是编排随便动。参考照顾关系 (Smith, 2024)，另见 (Nobody, 1999)。

## 问题
研究卡片要分成哪几种？

## 思考
- 原件层只读
- 编排层自由

## 下一步
定 Markdown 模板。
`

const RESEARCH_2 = `---
type: research
date: 2026-11-10
title: 下午的实验
summary: 琼脂培养第二天
activities: 实验
---

## 实验
培养皿 A 出现白色菌丝。

## 问题
温度是不是太低？
`

const RESEARCH_OTHER_DAY = `---
type: research
date: 2026-11-04
title: 和老师讨论方向
---

## 思考
回到最初的共在。
`

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
    hasTouch: size.isMobile,
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const tag = `[${size.name}]`

  await page.goto(url)
  for (const md of [PAPER, RESEARCH_OTHER_DAY, RESEARCH_1, RESEARCH_2]) {
    await page.locator('.md-input').fill(md)
    await page.getByRole('button', { name: '放进去' }).click()
    await page.locator('.result').waitFor()
    await page.waitForFunction(() => document.querySelector('.md-input').value === '')
  }

  // ── open the board: lands on the latest day
  await page.getByRole('link', { name: '画板' }).click()
  await page.getByRole('heading', { name: '11/10', level: 1 }).waitFor()
  await page.locator('.node.card').first().waitFor()
  await page.waitForTimeout(300)
  check(`${tag} 打开画板，落在最近有记录的一天`, true)

  const box = (sel) => page.locator(sel).first().boundingBox()
  check(`${tag} 同一天两份：2 个封面、6 张卡片`, (await page.locator('.node.cover').count()) === 2 && (await page.locator('.node.card').count()) === 6)
  check(`${tag} 没有"暂无"之类的空卡片`, (await page.getByText('暂无').count()) === 0)

  const overlaps = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('.node')].map((n) => n.getBoundingClientRect())
    let n = 0
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j]
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) n++
      }
    return n
  })
  check(`${tag} 默认布局里卡片互不重叠`, overlaps === 0, `${overlaps} 处重叠`)
  await page.screenshot({ path: `${out}/${size.name}-board-1-view.png` })

  check(`${tag} 活动标签在封面上`, await page.locator('.node.cover .key-tag', { hasText: '讨论' }).isVisible())
  check(`${tag} 读了 [论文] 的标记`, await page.getByRole('link', { name: '读了 Living Media Interfaces' }).isVisible())

  // ── citation: matched one is a tag, unmatched stays as text
  check(`${tag} 匹配到的引用变成标签`, (await page.locator('a.cite').count()) === 1)
  check(`${tag} 匹配不到的引用保留原文`, await page.getByText('(Nobody, 1999)').isVisible())
  await page.locator('a.cite').click()
  await page.locator('.cite-pop').waitFor()
  check(`${tag} 点引用弹出预览（一句话总结）`, await page.locator('.cite-pop').getByText('用活的材料做界面').isVisible())
  await page.screenshot({ path: `${out}/${size.name}-board-2-cite.png` })
  await page.locator('.cite-pop').getByRole('link', { name: '打开论文页' }).click()
  await page.getByRole('heading', { name: 'Living Media Interfaces', level: 1 }).waitFor()
  check(`${tag} 从预览跳到论文页`, true)
  await page.locator('.cited a', { hasText: '11/10' }).click()
  await page.getByRole('heading', { name: '11/10', level: 1 }).waitFor()
  check(`${tag} 论文页"被引用于"跳回画板`, true)
  await page.locator('.node.card').first().waitFor()

  // ── previous day
  await page.getByRole('link', { name: /前一天有记录的日子：11\/4/ }).click()
  await page.getByRole('heading', { name: '11/4', level: 1 }).waitFor()
  await page.getByText('回到最初的共在。').waitFor()
  check(`${tag} 切到前一个有记录的日子`, true)
  await page.goBack()
  await page.locator('.node.card').first().waitFor()
  await page.waitForTimeout(300)

  // ── pan by dragging the background (view mode)
  const before = await box('.node.cover')
  const vp = await box('.canvas')
  const startX = vp.x + vp.width - 30
  const startY = vp.y + vp.height / 2
  if (size.isMobile) {
    const client = await ctx.newCDPSession(page)
    const touch = (type, x, y) =>
      client.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
    await touch('touchStart', startX, startY)
    await touch('touchMove', startX - 20, startY - 60)
    await touch('touchMove', startX - 40, startY - 120)
    await touch('touchEnd', 0, 0)
  } else {
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX - 40, startY - 120, { steps: 5 })
    await page.mouse.up()
  }
  const after = await box('.node.cover')
  check(`${tag} 拖背景可以平移`, Math.abs(after.y - before.y + 120) < 3, `移动了 ${Math.round(after.y - before.y)}px`)

  // ── zoom
  await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2)
  const w0 = (await box('.node.cover')).width
  if (size.isMobile) {
    const client = await ctx.newCDPSession(page)
    const cx = vp.x + vp.width / 2
    const cy = vp.y + vp.height / 2
    const pts = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }]
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(40) })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(60) })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(80) })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else {
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -40)
    await page.keyboard.up('Control')
  }
  await page.waitForTimeout(100)
  const w1 = (await box('.node.cover')).width
  check(`${tag} ${size.isMobile ? '双指' : '触控板'}缩放`, w1 > w0 * 1.2, `${Math.round(w0)} → ${Math.round(w1)}`)

  if (size.isMobile) {
    check(`${tag} 手机上只看不编辑（没有"编排"按钮）`, (await page.getByRole('button', { name: '编排' }).count()) === 0)
    check(`${tag} 手机上未编辑的画板是单列`, before.width < 380)
  } else {
    // ── edit mode
    await page.reload()
    await page.locator('.node.card').first().waitFor()
    await page.waitForTimeout(300)
    check(`${tag} 未编辑时显示"模板布局 · 未编辑"`, await page.getByText('模板布局 · 未编辑').isVisible())
    check(`${tag} 左侧是论文库边栏`, await page.locator('.board-side .liblist').isVisible())
    await page.getByRole('button', { name: '编排' }).click()

    const card = page.locator('.node.card', { hasText: '研究卡片要分成哪几种' })
    const c0 = await card.boundingBox()
    await page.mouse.move(c0.x + 40, c0.y + 20)
    await page.mouse.down()
    await page.mouse.move(c0.x + 80, c0.y + 100, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const c1 = await card.boundingBox()
    check(`${tag} 拖动卡片`, Math.abs(c1.x - c0.x - 40) < 3 && Math.abs(c1.y - c0.y - 80) < 3, `移动 ${Math.round(c1.x - c0.x)}, ${Math.round(c1.y - c0.y)}`)
    check(`${tag} 状态变成"已编排"`, await page.getByText('已编排').isVisible())

    // resize by the handle
    const handle = await page.locator('.handle').boundingBox()
    await page.mouse.move(handle.x + 11, handle.y + 11)
    await page.mouse.down()
    await page.mouse.move(handle.x + 35, handle.y + 11, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const c2 = await card.boundingBox()
    check(`${tag} 调整大小`, Math.abs(c2.width - c1.width - 24) < 3, `宽度 ${Math.round(c1.width)} → ${Math.round(c2.width)}`)

    // edit wording
    await page.getByRole('button', { name: '改文字' }).click()
    await page.getByLabel('卡片文字').fill('研究卡片分五种就够了。')
    await page.locator('.canvas').click({ position: { x: 20, y: 500 } })
    await page.locator('.node.card', { hasText: '研究卡片分五种就够了。' }).waitFor()
    check(`${tag} 改卡片文字，标出"改过"`, await page.locator('.node.card .block-edited').isVisible())

    // connector
    await page.getByRole('button', { name: '连线' }).click()
    const from = await page.locator('.node.card', { hasText: '时间线是原件' }).boundingBox()
    const to = await page.locator('.node.card', { hasText: '定 Markdown 模板' }).boundingBox()
    await page.mouse.move(from.x + 30, from.y + 20)
    await page.mouse.down()
    await page.mouse.move(to.x + 40, to.y + 20, { steps: 8 })
    await page.mouse.up()
    await page.locator('.links .link-line').waitFor({ state: 'attached' })
    check(`${tag} 连线（带箭头）`, (await page.locator('.links .link-line[marker-end]').count()) === 1)

    // ink
    await page.getByRole('button', { name: '画笔' }).click()
    const empty = { x: vp.x + vp.width - 160, y: vp.y + 260 }
    await page.mouse.move(empty.x, empty.y)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(empty.x + i * 8, empty.y + Math.sin(i / 2) * 30)
    await page.mouse.up()
    await page.waitForTimeout(300)
    check(`${tag} 手绘涂鸦`, (await page.locator('.ink path[data-id]').count()) === 1)

    // text
    await page.getByRole('button', { name: '文字' }).click()
    await page.getByLabel('文字', { exact: true }).fill('这里是自由文字')
    await page.locator('.canvas').click({ position: { x: 20, y: 500 } })
    await page.locator('.node.note', { hasText: '这里是自由文字' }).waitFor()
    check(`${tag} 自由文字`, true)

    // image
    await page.locator('.toolbar input[type=file]').setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: PNG })
    await page.locator('.node.photo img').waitFor()
    check(`${tag} 上传贴图`, true)

    const small = await page.evaluate(() =>
      [...document.querySelectorAll('.toolbar button, .sel-bar button, .board-head a, .markers a, .topnav a')]
        .map((el) => ({ t: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12), r: el.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44))
        .map((x) => `${x.t} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`),
    )
    check(`${tag} 工具栏等可点元素 ≥ 44px`, small.length === 0, small.join(', '))
    await page.screenshot({ path: `${out}/${size.name}-board-3-edit.png` })

    // everything survives a reload; the original Markdown is untouched
    await page.getByRole('button', { name: '完成' }).click()
    await page.reload()
    await page.locator('.node.card').first().waitFor()
    await page.waitForTimeout(400)
    const kept =
      (await page.locator('.links .link-line').count()) === 1 &&
      (await page.locator('.ink path[data-id]').count()) === 1 &&
      (await page.locator('.node.note').count()) === 1 &&
      (await page.locator('.node.photo').count()) === 1 &&
      (await page.locator('.node.card', { hasText: '研究卡片分五种就够了。' }).count()) === 1
    check(`${tag} 刷新后编辑都还在`, kept)
    await page.locator('.node.cover').first().getByRole('button', { name: '原文' }).click()
    const rawOk = await page
      .locator('dialog .raw', { hasText: '研究卡片要分成哪几种？' })
      .waitFor({ timeout: 5000 })
      .then(() => true, () => false)
    check(`${tag} 原始 Markdown 没被改动`, rawOk, rawOk ? '' : ((await page.locator('dialog .raw').textContent()) ?? '').slice(0, 80))
    await page.getByRole('button', { name: '关闭' }).click()

    // restore a card, delete the connector
    await page.getByRole('button', { name: '编排' }).click()
    await page.locator('.node.card', { hasText: '研究卡片分五种就够了。' }).click()
    await page.getByRole('button', { name: '恢复原样' }).click()
    await page.locator('.node.card', { hasText: '研究卡片要分成哪几种？' }).waitFor()
    await page.waitForTimeout(300)
    const c3 = await page.locator('.node.card', { hasText: '研究卡片要分成哪几种？' }).boundingBox()
    check(`${tag} "恢复原样"回到模板位置和原文`, Math.abs(c3.width - c0.width) < 3)
    await page.screenshot({ path: `${out}/${size.name}-board-4-final.png` })
  }

  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
