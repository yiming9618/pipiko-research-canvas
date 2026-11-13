// The time view: every card on every board by its own date; year / month / day, zooming and breadcrumbs.
// Usage: node scripts/smoke-time.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac)
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'
const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true },
  { name: 'ipad', width: 1366, height: 1024, isMobile: false },
  { name: 'mac', width: 1728, height: 1000, isMobile: false },
]
const settled = async (page) => {
  await page.waitForFunction(() => {
    const stage = document.querySelector('.stage')
    return !stage || getComputedStyle(stage).visibility === 'visible'
  })
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() =>
      Promise.all(
        document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined)),
      ).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))),
    )
  }
}
const research = (date, title, board, body) => `---\ntype: research\ndate: ${date}\ntitle: ${title}\nboard: ${board}\n---\n## 发现\n${body}的发现\n## 问题\n${body}的问题\n`
const PAPER = `---\ntype: paper\ntitle: 时间视图里的论文\ndoi: 10.1/time\ndate: 2026-11-10\n---\n## 一句话总结\n总结\n`

const browser = await chromium.launch()
let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}

for (const size of sizes.filter((x) => !process.env.ONLY || process.env.ONLY === x.name)) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.isMobile, hasTouch: size.isMobile, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(m.text()))
  const tag = `[${size.name}]`
  const small = async (sel) => {
    await settled(page)
    return page.evaluate((s) =>
      [...document.querySelectorAll(s)]
        .map((el) => ({ t: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 12), r: el.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44))
        .map((x) => `${x.t} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`), sel)
  }

  // nothing yet
  await page.goto(`${url}#/time`)
  await page.getByText('还没有卡片').waitFor()
  check(`${tag} 还没有内容时，时间视图说明怎么开始`, true)

  // two boards, cards on several dates across three years, and a paper read on one of the days
  await page.goto(url)
  for (const [md, board] of [
    [research('2026-11-10', '十号的记录', '霉菌研究', '十号'), '霉菌研究'],
    [research('2026-11-10', '同一天另一块画板的', '共在', '共在十号'), '共在'],
    [research('2026-11-12', '十二号的记录', '霉菌研究', '十二号'), '霉菌研究'],
    [research('2027-03-02', '明年三月的', '霉菌研究', '三月'), '霉菌研究'],
    [research('2024-06-30', '前年六月的', '共在', '六月'), '共在'],
    // three more boards on 11/12, so that day has four
    [research('2026-11-12', '十二号甲', '画板甲', '甲'), '画板甲'],
    [research('2026-11-12', '十二号乙', '画板乙', '乙'), '画板乙'],
    [research('2026-11-12', '十二号丙', '画板丙', '丙'), '画板丙'],
  ]) {
    await page.locator('.md-input').fill(md)
    await page.getByRole('button', { name: '放进去' }).click()
    const ask = page.getByRole('button', { name: `新建「${board}」` })
    const done = page.getByText(new RegExp(`放进(新)?画板「${board}」`))
    await Promise.race([ask.waitFor(), done.waitFor()])
    if (await ask.isVisible()) await ask.click()
    await done.waitFor()
    await page.waitForFunction(() => document.querySelector('.md-input').value === '')
  }
  await page.locator('.md-input').fill(PAPER)
  await page.getByRole('button', { name: '放进去' }).click()
  await page.getByText(/1 篇论文放进论文库/).waitFor()

  // ── month
  // Timeline is reached from 画板, beside the sort buttons
  check(`${tag} 一级导航只有主页、画板、论文库`, (await page.locator('.topnav-links a').allInnerTexts()).join(' ') === '主页 画板 论文库')
  await page.getByRole('link', { name: '画板', exact: true }).click()
  await page.getByRole('heading', { name: '画板', level: 1 }).waitFor()
  const tl = page.getByRole('link', { name: 'Timeline', exact: true })
  check(`${tag} 画板总览：Timeline 按钮在排序按钮旁边，单独一个，≥ 44px`, (await tl.boundingBox()).height >= 44 && (await page.locator('.boards-head .seg').getByRole('link').count()) === 0 && (await page.locator('.boards-head .seg button').count()) === 2)
  check(`${tag} 画板总览原有的新建画板、新建堆仍在`, (await page.getByRole('button', { name: '新建画板' }).isVisible()) && (await page.getByRole('button', { name: '新建堆' }).isVisible()))
  await tl.click()
  await page.getByRole('heading', { name: '3 月', level: 1 }).waitFor()
  check(`${tag} 打开时间视图，落在最近有内容的月份（2027 年 3 月）`, (await page.evaluate(() => location.hash)) === '#/time/2027-03')
  check(`${tag} Timeline 里导航高亮的是“画板”，顶部有“← 画板”`, (await page.locator('.topnav-links a[aria-current=page]').innerText()) === '画板' && (await page.locator('.timeline-bar a', { hasText: '画板' }).isVisible()))
  await page.getByRole('link', { name: '往前：2026 年 11 月' }).click()
  await page.getByRole('heading', { name: '11 月', level: 1 }).waitFor()
  check(`${tag} 月份往前：3 月之前直接是 2026 年 11 月`, true)
  const tiles = await page.locator('.day-tile b').allInnerTexts()
  check(`${tag} 月份里只有有内容的日子，没有的不显示`, tiles.join(' ') === '11/10 11/12', tiles.join(' '))
  check(`${tag} 没有上中下旬`, (await page.locator('.period, .period-label, .blank-day').count()) === 0)
  const tile = page.locator('.day-tile[data-zoom="2026-11-10"]')
  check(`${tag} 日期块：两块画板上那天的卡片都算（4 张）`, (await tile.locator('.thumb span').count()) === 4)
  const boardLines = (await tile.locator('.tile-board').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
  check(`${tag} 日期块写出各画板的名字和张数`, boardLines.length === 2 && boardLines.includes('霉菌研究 2 张') && boardLines.includes('共在 2 张'), boardLines.join(' | '))
  const busy = (await page.locator('.day-tile[data-zoom="2026-11-12"] .tile-board').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
  check(`${tag} 一天有 4 块画板：只列 2 块，其余写“另有 2 个画板”`, busy.length === 3 && busy[2] === '另有 2 个画板', busy.join(' | '))
  check(`${tag} 日期块上有“读了 [论文]”`, await tile.getByText('读了 时间视图里的论文').isVisible())
  await settled(page)
  await page.screenshot({ path: `${out}/${size.name}-time-1-month.png` })

  // ── day
  await tile.click()
  await page.getByRole('heading', { name: '11/10', level: 1 }).waitFor()
  await page.locator('.day-card').first().waitFor()
  const groups = await page.locator('.day-board h2 a').allInnerTexts()
  check(`${tag} 这一天：来自两块画板的卡片，按画板分组`, groups.length === 2 && groups.includes('霉菌研究') && groups.includes('共在') && (await page.locator('.day-card').count()) === 4, groups.join('、'))
  const counts = (await page.locator('.day-board-count').allInnerTexts()).join(' / ')
  check(`${tag} 每块画板标题旁有卡片类型统计`, counts === '发现 1 · 问题 1 / 发现 1 · 问题 1', counts)
  check(`${tag} 每张卡片标出所属画板`, (await page.locator('.day-card .day-card-board').allInnerTexts()).filter((t) => t === '在「霉菌研究」').length === 2)
  check(`${tag} 这一天读的论文也在`, await page.getByRole('link', { name: '读了 时间视图里的论文' }).isVisible())
  check(`${tag} 日视图：可点元素 ≥ 44px`, (await small('.timeview a, .timeview button')).length === 0, (await small('.timeview a, .timeview button')).join(', '))
  check(`${tag} 没有横向滚动`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.screenshot({ path: `${out}/${size.name}-time-2-day.png`, fullPage: size.isMobile })
  await page.getByRole('link', { name: '往后：11/12' }).click()
  await page.getByRole('heading', { name: '11/12', level: 1 }).waitFor()
  check(`${tag} 日子往后：直接到下一个有内容的日子`, true)
  await page.goBack()
  await page.getByRole('heading', { name: '11/10', level: 1 }).waitFor()

  // ── card → its board, in view and highlighted
  await page.locator('.day-card', { hasText: '共在十号的问题' }).click()
  await page.getByRole('heading', { name: '共在', level: 1 }).waitFor()
  const focus = page.locator('.node.card.is-focus')
  await focus.waitFor()
  await page.waitForTimeout(500)
  const inView = await focus.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const c = document.querySelector('.canvas').getBoundingClientRect()
    return r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom
  })
  check(`${tag} 点卡片 → 打开它所在的画板，那张卡片在视野里并高亮`, (await focus.innerText()).includes('共在十号的问题') && inView)
  await page.screenshot({ path: `${out}/${size.name}-time-3-focus.png` })

  // ── year
  await page.goto(`${url}#/time/2026-11`)
  await page.getByRole('link', { name: '2026', exact: true }).click()
  await page.getByRole('heading', { name: '2026', level: 1 }).waitFor()
  check(`${tag} 年视图只显示有内容的月份`, (await page.locator('.month-tile b').allInnerTexts()).join() === '11 月')
  await page.getByRole('link', { name: '往前：2024 年' }).click()
  await page.getByRole('heading', { name: '2024', level: 1 }).waitFor()
  check(`${tag} 年份往前：没有内容的 2025 年不显示`, (await page.locator('.month-tile b').allInnerTexts()).join() === '6 月')
  await page.locator('.month-tile').click()
  await page.getByRole('heading', { name: '6 月', level: 1 }).waitFor()
  check(`${tag} 年视图里点月份 → 进入那个月`, true)
  check(`${tag} 面包屑和日期块 ≥ 44px`, (await small('.board-head a, .day-tile, .month-tile')).length === 0, (await small('.board-head a, .day-tile, .month-tile')).join(', '))

  // ── zoom between the three levels, both ways, twice
  await page.goto(`${url}#/time/2026-11`)
  await page.getByRole('heading', { name: '11 月', level: 1 }).waitFor()
  const vp = page.viewportSize()
  const pinch = async (cx, cy, from, to) => {
    const client = await ctx.newCDPSession(page)
    const pts = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }]
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) })
    for (let i = 1; i <= 4; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / 4) })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const zoom = async (dir) => {
    const [cx, cy] = [vp.width / 2, vp.height / 2]
    if (size.isMobile) return pinch(cx, cy, dir === 'in' ? 30 : 90, dir === 'in' ? 90 : 20)
    await page.mouse.move(cx, cy)
    await page.keyboard.down('Control')
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, dir === 'in' ? -12 : 30)
    await page.keyboard.up('Control')
  }
  let ok = true
  const step = async (dir, heading) => {
    await page.waitForTimeout(650)
    await zoom(dir)
    const reached = await page.getByRole('heading', { name: heading, level: 1 }).waitFor({ timeout: 5000 }).then(() => true, () => false)
    if (!reached) {
      ok = false
      console.log(`     (${dir} → ${heading} 没有到达)`)
    }
  }
  for (let round = 0; round < 2; round++) {
    await step('out', '2026') // month → year
    await step('in', '11 月') // year → month, from the middle of the screen, not aimed at a tile
    await step('in', /^11\/1[02]$/) // month → day
    await step('out', '11 月') // day → month
  }
  check(`${tag} ${size.isMobile ? '双指' : '触控板'}缩放：月 → 年 → 月 → 日 → 月，来回两轮`, ok)

  // breadcrumbs both ways
  await page.goto(`${url}#/time/2026-11-10`)
  await page.getByRole('link', { name: '11 月', exact: true }).click()
  await page.getByRole('heading', { name: '11 月', level: 1 }).waitFor()
  await page.getByRole('link', { name: '2026', exact: true }).click()
  await page.getByRole('heading', { name: '2026', level: 1 }).waitFor()
  await page.locator('.month-tile').click()
  await page.locator('.day-tile[data-zoom="2026-11-10"]').click()
  await page.getByRole('heading', { name: '11/10', level: 1 }).waitFor()
  check(`${tag} 面包屑和点击：日 → 月 → 年 → 月 → 日`, true)

  // addresses from before
  await page.goto(`${url}#/board/2026-11`)
  await page.getByRole('heading', { name: '11 月', level: 1 }).waitFor()
  check(`${tag} 以前按月份的网址现在打开时间视图`, (await page.evaluate(() => location.hash)) === '#/time/2026-11')

  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
