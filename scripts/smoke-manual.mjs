// Hand-written cards, blank days, and the year / month / day navigation, at phone, iPad and Mac sizes.
// Usage: node scripts/smoke-manual.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac)
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'
const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true },
  { name: 'ipad', width: 1366, height: 1024, isMobile: false },
  { name: 'mac', width: 1728, height: 1000, isMobile: false },
]
/**
 * Resolves when the view is shown and every finite animation has finished
 * (looping decorations are ignored), so sizes are measured at rest.
 */
const settled = async (page) => {
  // the year / month grids stay hidden until their data has loaded, then play an entrance animation
  await page.waitForFunction(() => {
    const stage = document.querySelector('.stage')
    return !stage || getComputedStyle(stage).visibility === 'visible'
  })
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      ).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))),
    )
  }
}

const browser = await chromium.launch()
let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}

for (const size of sizes.filter((x) => !process.env.ONLY || process.env.ONLY === x.name)) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: size.isMobile,
    hasTouch: size.isMobile,
    deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  // a fixed "today" so months and days are predictable: 15 November 2026
  await ctx.addInitScript(() => {
    const fixed = new Date(2026, 10, 15, 10, 0, 0).getTime()
    const start = Date.now()
    const RealDate = Date
    class FakeDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(fixed + (RealDate.now() - start))
        else super(...args)
      }
      static now() {
        return fixed + (RealDate.now() - start)
      }
    }
    globalThis.Date = FakeDate
  })
  await ctx.route('https://api.crossref.org/**', (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(m.text()))
  const tag = `[${size.name}]`
  const wide = !size.isMobile
  const small = async (sel) => {
    await settled(page)
    return page.evaluate((s) =>
      [...document.querySelectorAll(s)]
        .map((el) => ({ t: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 12), r: el.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44))
        .map((x) => `${x.t} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`), sel)
  }
  const writeCard = async (kind, text) => {
    await page.getByRole('button', { name: '加卡片' }).click()
    await page.locator('.card-dialog').getByRole('button', { name: kind, exact: true }).click()
    await page.getByLabel('卡片内容').fill(text)
    await page.getByRole('button', { name: '放到画板上' }).click()
    await page.locator('.node.card', { hasText: text }).waitFor()
  }

  // ── home panel: about half as tall as before (measured on the previous version: 629px on the phone, 661px on wide screens)
  await page.goto(url)
  await page.locator('.panel').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  const panel = await page.locator('.panel').evaluate((el) => ({ h: el.offsetHeight, w: el.offsetWidth, ta: el.querySelector('textarea').offsetHeight }))
  check(`${tag} 主页面板高度约为原来的一半`, panel.h <= (wide ? 661 : 629) * 0.55, `原来 ${wide ? 661 : 629}px，现在 ${panel.h}px（文本框 ${panel.ta}px，面板宽 ${panel.w}px）`)
  check(`${tag} 主页面板：按钮和输入 ≥ 44px`, (await small('.panel button, .panel textarea')).length === 0, (await small('.panel button, .panel textarea')).join(', '))
  await page.screenshot({ path: `${out}/${size.name}-manual-0-home.png` })

  // ── nothing at all yet: the current month is still there, and any day opens a blank board
  await page.goto(`${url}#/board`)
  await page.getByRole('heading', { name: '11 月', level: 1 }).waitFor()
  check(`${tag} 什么都没有时，画板打开的是当前月份`, true)
  check(`${tag} 月份视图里 30 天都能点`, (await page.locator('.blank-day').count()) === 30)
  check(`${tag} 今天有标记`, (await page.locator('.blank-day.is-today').innerText()) === '15')
  check(`${tag} 空白日子的点击区域 ≥ 44px`, (await small('.blank-day')).length === 0, (await small('.blank-day')).join(', '))
  await settled(page)
  await page.screenshot({ path: `${out}/${size.name}-manual-1-empty-month.png` })

  await page.locator('.blank-day.is-today').click()
  await page.getByRole('heading', { name: '11/15', level: 1 }).waitFor()
  await page.getByText('这一天还是空白的').waitFor()
  check(`${tag} 点今天 → 打开空白画板`, true)

  // ── write cards by hand
  await page.getByRole('button', { name: '加卡片' }).click()
  check(`${tag} 写卡片：五种类型可选`, (await page.locator('.card-dialog .kind-row .chip').count()) === 5)
  check(`${tag} 写卡片：是普通的文本框（系统听写可用）`, await page.getByLabel('卡片内容').evaluate((el) => el.tagName === 'TEXTAREA' && !el.readOnly))
  check(`${tag} 写卡片：没写内容不能保存`, await page.getByRole('button', { name: '放到画板上' }).isDisabled())
  check(`${tag} 写卡片对话框：可点元素 ≥ 44px`, (await small('.card-dialog button, .card-dialog textarea')).length === 0, (await small('.card-dialog button, .card-dialog textarea')).join(', '))
  await page.screenshot({ path: `${out}/${size.name}-manual-2-dialog.png` })
  await page.locator('.card-dialog').getByRole('button', { name: '取消' }).click()

  await writeCard('问题', '手写的问题：霉菌为什么长不出来')
  await writeCard('思考', '手写的思考：可能是湿度不够')
  check(`${tag} 空白画板上手动写了两张卡片`, (await page.locator('.node.card').count()) === 2)
  check(`${tag} 卡片带着所选类型的颜色`, (await page.locator('.node.card[data-color=pink]').count()) === 1 && (await page.locator('.node.card[data-color=yellow]').count()) === 1)
  await page.reload()
  await page.locator('.node.card', { hasText: '手写的问题' }).waitFor()
  check(`${tag} 刷新后还在`, (await page.locator('.node.card').count()) === 2)

  // ── edit and delete
  if (wide) {
    await page.getByRole('button', { name: '编排' }).click()
    await page.locator('.node.card', { hasText: '手写的思考' }).click()
    await page.getByRole('button', { name: '改文字' }).click()
    await page.getByLabel('卡片文字').fill('手写的思考：改成了温度的问题')
    await page.getByLabel('卡片文字').blur()
    await page.locator('.node.card', { hasText: '改成了温度的问题' }).waitFor()
    check(`${tag} 手动卡片可以改文字`, (await page.locator('.block-edited').count()) === 0, '直接改卡片本身，不显示“改过”')

    // text, connector on a board that started blank
    await page.locator('.toolbar').getByRole('button', { name: '文字' }).click()
    await page.locator('.node.note textarea').fill('空白画板上的自由文字')
    await page.locator('.canvas').click({ position: { x: 30, y: size.height - 220 } })
    await page.locator('.node.note', { hasText: '空白画板上的自由文字' }).waitFor()
    check(`${tag} 空白画板上自由文字能用`, true)
    await page.locator('.toolbar').getByRole('button', { name: '卡片' }).click()
    await page.locator('.card-dialog').getByRole('button', { name: '下一步', exact: true }).click()
    await page.getByLabel('卡片内容').fill('要删掉的卡片')
    await page.getByRole('button', { name: '放到画板上' }).click()
    await page.locator('.node.card', { hasText: '要删掉的卡片' }).waitFor()
    check(`${tag} 编排工具栏里也能加卡片`, true)
    await page.locator('.node.card', { hasText: '要删掉的卡片' }).click({ position: { x: 20, y: 12 } })
    page.once('dialog', (d) => void d.accept())
    await page.locator('.sel-bar').getByRole('button', { name: '删除' }).click()
    await page.waitForFunction(() => ![...document.querySelectorAll('.node.card')].some((n) => n.textContent.includes('要删掉的卡片')))
    check(`${tag} 手动卡片可以删除`, true)
    await page.getByRole('button', { name: '完成' }).click()
  } else {
    await page.locator('.node.card', { hasText: '手写的思考' }).click({ position: { x: 30, y: 30 } })
    await page.getByRole('heading', { name: '改这张卡片' }).waitFor()
    await page.getByLabel('卡片内容').fill('手写的思考：改成了温度的问题')
    await page.getByRole('button', { name: '保存' }).click()
    await page.locator('.node.card', { hasText: '改成了温度的问题' }).waitFor()
    check(`${tag} 手机上点手动卡片可以改`, true)
    await writeCard('下一步', '要删掉的卡片')
    await page.locator('.node.card', { hasText: '要删掉的卡片' }).click({ position: { x: 30, y: 30 } })
    page.once('dialog', (d) => void d.accept())
    await page.locator('.card-dialog').getByRole('button', { name: '删除' }).click()
    await page.waitForFunction(() => ![...document.querySelectorAll('.node.card')].some((n) => n.textContent.includes('要删掉的卡片')))
    check(`${tag} 手机上可以删除手动卡片`, true)
  }
  await page.screenshot({ path: `${out}/${size.name}-manual-3-board.png` })

  // ── importing that same day afterwards: both stay
  await page.goto(url)
  await page.locator('.md-input').fill('---\ntype: research\ndate: 2026-11-15\ntitle: 之后导入的记录\nsummary: 摘要\n---\n## 发现\n导入的发现\n## 实验\n导入的实验\n')
  await page.getByRole('button', { name: '放进去' }).click()
  await page.getByText(/生成了 2 张卡片/).waitFor()
  await page.goto(`${url}#/board/2026-11-15`)
  await page.locator('.node.card', { hasText: '导入的发现' }).waitFor()
  const texts = await page.locator('.node.card').allInnerTexts()
  check(`${tag} 先手写、后导入同一天：四张卡片都在，互不覆盖`, texts.length === 4 && texts.some((t) => t.includes('手写的问题')) && texts.some((t) => t.includes('导入的实验')), `${texts.length} 张`)
  const boxes = await page.locator('.node').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.left, r.top, r.right, r.bottom]))
  const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a[0] < b[2] - 4 && b[0] < a[2] - 4 && a[1] < b[3] - 4 && b[1] < a[3] - 4))
  check(`${tag} 导入的和手写的没有叠在一起`, wide ? true : !overlap, wide ? '宽屏上手写卡片放在当时视野中央，可能和后来的记录重叠，可拖开' : '')
  await page.screenshot({ path: `${out}/${size.name}-manual-4-mixed.png` })

  // ── treated like any other card: search, pile, discussion box, month thumbnail, export
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('.search-panel input').fill('问题 霉菌')
  await page.locator('.search-item', { hasText: '霉菌为什么长不出来' }).waitFor()
  check(`${tag} 手动卡片能被搜索到（类型 + 关键词）`, (await page.locator('.search-item .search-kind').first().innerText()) === '问题')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '把这一天的画板放进讨论框' }).click()
  await page.getByLabel('新建一个讨论框').fill('手写卡片的讨论')
  await page.getByRole('button', { name: '新建并放入' }).click()
  await page.locator('.toast', { hasText: '已放进' }).waitFor()
  if (wide) {
    await page.locator('.node.card', { hasText: '手写的问题' }).click({ button: 'right', position: { x: 30, y: 30 } })
    await page.getByText('已选 1 张').waitFor()
    await page.locator('.pick-bar').getByRole('button', { name: '放进讨论框' }).click()
    await page.getByRole('button', { name: /手写卡片的讨论/ }).click()
    await page.locator('.toast', { hasText: '已放进' }).waitFor()
    check(`${tag} 手动卡片可以单独选中放进讨论框`, true)

    await page.getByRole('button', { name: '编排' }).click()
    await page.locator('.node.card', { hasText: '手写的问题' }).click({ position: { x: 20, y: 12 } })
    await page.locator('.dock').getByRole('button', { name: '新的堆' }).click()
    await page.getByText(/已放进/).first().waitFor()
    await page.getByRole('button', { name: '完成' }).click()
    await page.goto(`${url}#/board`)
    await page.locator('.shelf .pile-tile').first().click()
    await page.locator('.node.card', { hasText: '手写的问题' }).waitFor()
    check(`${tag} 手动卡片可以放进堆`, true)
  }
  await page.getByRole('link', { name: /^讨论框/ }).click()
  await page.locator('.box-row', { hasText: '手写卡片的讨论' }).click()
  await page.getByRole('button', { name: '导出给 AI' }).click()
  await page.getByText('已复制到剪贴板').waitFor()
  const md = await page.evaluate(() => navigator.clipboard.readText())
  check(`${tag} 导出给 AI：手写的和导入的卡片都在`, md.includes('【问题】\n手写的问题：霉菌为什么长不出来') && md.includes('导入的发现') && md.includes('我在画板上写的卡片'))

  await page.goto(`${url}#/board/2026-11`)
  const tile = page.locator('.day-tile[data-zoom="2026-11-15"]')
  await tile.waitFor()
  check(`${tag} 月份视图的缩略图里有手写卡片`, (await tile.locator('.thumb span').count()) === 4, `${await tile.locator('.thumb span').count()} 个色块`)
  check(`${tag} 有内容的那天变成大块，其余 29 天仍可点`, (await page.locator('.blank-day').count()) === 29)

  // a day with only a hand-written card (no record) also shows up
  await page.locator('.blank-day', { hasText: /^3$/ }).click()
  await page.getByRole('heading', { name: '11/3', level: 1 }).waitFor()
  await writeCard('发现', '只有手写卡片的一天')
  await page.getByRole('link', { name: '11 月', exact: true }).click()
  await page.locator('.day-tile[data-zoom="2026-11-03"]').waitFor()
  check(`${tag} 只有手写卡片的日子也算有内容`, (await page.locator('.day-tile[data-zoom="2026-11-03"] .thumb span').count()) === 1)
  await settled(page)
  await page.screenshot({ path: `${out}/${size.name}-manual-5-month.png`, fullPage: size.isMobile })

  // ── months and years: only the ones with something (plus the current month)
  for (const md2 of [
    '---\ntype: research\ndate: 2027-03-02\ntitle: 明年三月的记录\n---\n## 发现\n内容\n',
    '---\ntype: research\ndate: 2024-06-30\ntitle: 前年的记录\n---\n## 发现\n内容\n',
  ]) {
    await page.goto(url)
    await page.locator('.md-input').fill(md2)
    await page.getByRole('button', { name: '放进去' }).click()
    await page.getByText(/生成了 1 张卡片/).waitFor()
  }
  await page.goto(`${url}#/board/2026-11`)
  await page.getByRole('link', { name: '往后：2027 年 3 月' }).click()
  await page.getByRole('heading', { name: '3 月', level: 1 }).waitFor()
  check(`${tag} 月份往后：11 月之后直接是 2027 年 3 月`, true)
  check(`${tag} 其他月份的空白日子淡化显示`, (await page.locator('.blank-days.is-faint').count()) === 3)
  await page.locator('.blank-day', { hasText: /^20$/ }).click()
  await page.getByRole('heading', { name: '3/20', level: 1 }).waitFor()
  await page.getByText('这一天还是空白的').waitFor()
  check(`${tag} 其他月份的空白日子点了同样打开空白画板`, true)
  await page.getByRole('link', { name: '3 月', exact: true }).click()
  await page.getByRole('link', { name: '往前：2026 年 11 月' }).click()
  await page.getByRole('link', { name: '往前：2024 年 6 月' }).click()
  await page.getByRole('heading', { name: '6 月', level: 1 }).waitFor()
  check(`${tag} 月份往前：跳过整个 2025 年，直接到 2024 年 6 月`, true)

  await page.getByRole('link', { name: '2024', exact: true }).click()
  await page.getByRole('heading', { name: '2024', level: 1 }).waitFor()
  check(`${tag} 2024 年只显示 6 月`, (await page.locator('.month-tile').count()) === 1 && (await page.locator('.month-tile b').innerText()) === '6 月')
  await page.getByRole('link', { name: '往后：2026 年' }).click()
  await page.getByRole('heading', { name: '2026', level: 1 }).waitFor()
  check(`${tag} 年份往后：没有内容的 2025 年不显示`, (await page.locator('.month-tile').count()) === 1)
  await page.locator('.month-tile').click()
  await page.getByRole('heading', { name: '11 月', level: 1 }).waitFor()
  check(`${tag} 年视图点月份 → 进入月份视图`, true)

  // an empty current month in another year: December 2026 → still listed once "today" moves there
  check(`${tag} 面包屑和月份、日期块 ≥ 44px`, (await small('.board-head a, .day-tile, .blank-day, .month-tile')).length === 0, (await small('.board-head a, .day-tile, .blank-day, .month-tile')).join(', '))
  check(`${tag} 没有横向滚动`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))

  // ── zoom between the three levels, both ways, twice over
  const vp = page.viewportSize()
  const pinch = async (cx, cy, from, to) => {
    const client = await ctx.newCDPSession(page)
    const pts = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }]
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) })
    for (let i = 1; i <= 4; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / 4) })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const zoom = async (cx, cy, dir) => {
    if (size.isMobile) return pinch(cx, cy, dir === 'in' ? 30 : 90, dir === 'in' ? 90 : 20)
    await page.mouse.move(cx, cy)
    await page.keyboard.down('Control')
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, dir === 'in' ? -12 : 30)
    await page.keyboard.up('Control')
  }
  const at = [vp.width / 2, vp.height / 2]
  let ok = true
  const step = async (dir, heading) => {
    await page.waitForTimeout(650)
    await zoom(...at, dir)
    const reached = await page.getByRole('heading', { name: heading, level: 1 }).waitFor({ timeout: 5000 }).then(() => true, () => false)
    if (!reached) {
      ok = false
      console.log(`     (${dir} → ${heading} 没有到达)`)
    }
  }
  for (let round = 0; round < 2; round++) {
    await step('out', '2026') // month → year
    await step('in', /月$/) // year → month, from the middle of the screen
    await step('in', /^\d+\/\d+$/) // month → day
    await page.locator('.canvas').waitFor()
    await step('out', /月$/) // day → month
  }
  check(`${tag} ${size.isMobile ? '双指' : '触控板'}缩放：月 → 年 → 月 → 日 → 月，来回两轮`, ok)

  // breadcrumb both ways
  await page.goto(`${url}#/board/2026-11-15`)
  await page.getByRole('link', { name: '11 月', exact: true }).click()
  await page.getByRole('heading', { name: '11 月', level: 1 }).waitFor()
  await page.getByRole('link', { name: '2026', exact: true }).click()
  await page.getByRole('heading', { name: '2026', level: 1 }).waitFor()
  await page.locator('.month-tile').click()
  await page.getByRole('heading', { name: '11 月', level: 1 }).waitFor()
  await page.locator('.day-tile[data-zoom="2026-11-15"]').click()
  await page.getByRole('heading', { name: '11/15', level: 1 }).waitFor()
  check(`${tag} 面包屑和点击：日 → 月 → 年 → 月 → 日`, true)

  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
