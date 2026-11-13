// Pinching inside a board only zooms the board (it never leaves it), and immersive mode.
// Usage: node scripts/smoke-immersive.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac)
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'
const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true, touch: true },
  { name: 'ipad', width: 1366, height: 1024, isMobile: false, touch: true },
  { name: 'mac', width: 1728, height: 1000, isMobile: false, touch: false },
]
const browser = await chromium.launch()
let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}

for (const size of sizes.filter((x) => !process.env.ONLY || process.env.ONLY === x.name)) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.isMobile, hasTouch: size.touch, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(m.text()))
  const tag = `[${size.name}]`
  const client = size.touch ? await ctx.newCDPSession(page) : null
  const visible = (sel) => page.locator(sel).first().isVisible()
  const strokes = () => page.locator('.ink path[data-stroke]').count()

  await page.goto(`${url}#/settings`)
  await page.getByRole('button', { name: '放入示例内容' }).click()
  await page.locator('.import-msg', { hasText: '生成了 6 张卡片' }).waitFor()
  await page.goto(`${url}#/boards`)
  await page.locator('.board-tile-main').first().click()
  await page.locator('.node.card').first().waitFor()
  await page.waitForTimeout(500)
  const hash = await page.evaluate(() => location.hash)
  const title = await page.locator('.board-head h1').innerText()
  const canvas = await page.locator('.canvas').boundingBox()
  const mid = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 }
  const cardWidth = () => page.locator('.node.card').first().evaluate((el) => el.getBoundingClientRect().width)

  const pinch = async (from, to) => {
    if (size.touch) {
      const pts = (d) => [{ x: mid.x - d, y: mid.y, id: 1 }, { x: mid.x + d, y: mid.y, id: 2 }]
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) })
      for (let i = 1; i <= 6; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / 6) })
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      await page.mouse.move(mid.x, mid.y)
      await page.keyboard.down('Control')
      for (let i = 0; i < 14; i++) await page.mouse.wheel(0, from > to ? 40 : -15)
      await page.keyboard.up('Control')
    }
    await page.waitForTimeout(300)
  }

  // ════ 1. pinching inside a board ════
  const w0 = await cardWidth()
  await pinch(140, 30)
  const w1 = await cardWidth()
  check(`${tag} ${size.touch ? '双指捏合' : '触控板捏合'}：画板缩小`, w1 < w0 * 0.8, `${Math.round(w0)} → ${Math.round(w1)}`)
  for (let i = 0; i < 4; i++) await pinch(140, 20)
  const floor = await cardWidth()
  await pinch(140, 20)
  check(`${tag} 一直捏下去：停在最小比例，不再变小`, Math.abs((await cardWidth()) - floor) < 1, `${Math.round(floor)}px`)
  check(`${tag} 缩到最小后继续捏：仍在这块画板，不会退回画板库`, (await page.evaluate(() => location.hash)) === hash && (await page.locator('.board-head h1').innerText()) === title)
  await pinch(30, 150)
  check(`${tag} 再张开：画板放大`, (await cardWidth()) > floor * 1.3)

  // panning and the pen still work
  const before = await page.locator('.node.card').first().boundingBox()
  if (size.touch) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mid.x, y: mid.y, id: 1 }] })
    for (let i = 1; i <= 5; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mid.x, y: mid.y + i * 16, id: 1 }] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else {
    await page.mouse.move(mid.x, mid.y)
    await page.mouse.down()
    await page.mouse.move(mid.x, mid.y + 80, { steps: 5 })
    await page.mouse.up()
  }
  await page.waitForTimeout(200)
  check(`${tag} 单指（鼠标）拖动仍然是平移`, Math.abs((await page.locator('.node.card').first().boundingBox()).y - before.y - 80) < 4)

  const draw = async (y) => {
    const pts = Array.from({ length: 10 }, (_, i) => [canvas.x + 40 + i * 12, y + (i % 2) * 6])
    if (size.touch) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1], id: 1 }] })
      for (const [x, yy] of pts.slice(1)) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: yy, id: 1 }] })
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      await page.mouse.move(pts[0][0], pts[0][1])
      await page.mouse.down()
      for (const [x, yy] of pts.slice(1)) await page.mouse.move(x, yy)
      await page.mouse.up()
    }
    await page.waitForTimeout(300)
  }
  await page.getByRole('button', { name: size.isMobile ? '编辑' : '编排', exact: true }).click()
  await page.locator('.toolbar').getByRole('button', { name: '画笔', exact: true }).click()
  await draw(canvas.y + canvas.height - 260)
  check(`${tag} 画笔仍然能写`, (await strokes()) === 1)

  // ════ 2. immersive mode ════
  const toggle = page.getByRole('button', { name: '隐藏界面' })
  const tb = await toggle.boundingBox()
  check(`${tag} 有“隐藏界面”按钮，≥ 44px`, tb.width >= 44 && tb.height >= 44)
  const canvasH = canvas.height
  await toggle.click()
  await page.waitForTimeout(200)
  const hidden = await Promise.all(['.topnav', '.board-head', '.toolbar', '.ink-colors', '.side-open'].map(async (s) => !(await visible(s))))
  check(`${tag} 隐藏后：导航、画板标题栏、工具栏、颜色、论文库按钮都不见`, hidden.every(Boolean), hidden.join(','))
  const full = await page.locator('.canvas').boundingBox()
  check(`${tag} 画板占满屏幕`, full.height > canvasH + 40 && full.y < 2, `${Math.round(canvasH)} → ${Math.round(full.height)}`)
  check(`${tag} 只留一个“显示界面”按钮`, await page.getByRole('button', { name: '显示界面' }).isVisible())
  await page.screenshot({ path: `${out}/${size.name}-immersive.png` })

  const c2 = await page.locator('.canvas').boundingBox()
  canvas.y = c2.y
  canvas.height = c2.height
  await draw(c2.y + c2.height - 200)
  check(`${tag} 隐藏界面时继续用原来的笔写`, (await strokes()) === 2)
  await pinch(140, 20)
  check(`${tag} 隐藏界面时捏合也不会离开画板`, (await page.evaluate(() => location.hash)) === hash)

  if (size.touch) {
    await page.getByRole('button', { name: '显示界面' }).click()
  } else {
    await page.keyboard.press('Escape')
  }
  await page.waitForTimeout(200)
  const back = await Promise.all(['.topnav', '.board-head', '.toolbar', '.ink-colors'].map((s) => visible(s)))
  check(`${tag} ${size.touch ? '点一下' : '按 Esc'}恢复：导航、标题栏、工具栏、颜色都回来`, back.every(Boolean), back.join(','))
  check(`${tag} 恢复后还是画笔`, (await page.locator('.toolbar .tool[aria-pressed=true] span').innerText()) === '画笔')

  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
