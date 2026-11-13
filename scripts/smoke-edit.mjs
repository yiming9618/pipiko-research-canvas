// Editing a board: the library sidebar, dragging a paper in, the phone's edit switch, pens, eraser,
// undo / redo, the select tool with its lasso and action bar, and writing cards with the keyboard.
// Usage: node scripts/smoke-edit.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac)
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'
const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true },
  { name: 'ipad', width: 1366, height: 1024, isMobile: false },
  { name: 'mac', width: 1728, height: 1000, isMobile: false },
]
const settled = (page) =>
  page.evaluate(() =>
    Promise.all(
      document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined)),
    ).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))),
  )

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
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(m.text()))
  const tag = `[${size.name}]`
  const touch = size.isMobile
  const client = touch ? await ctx.newCDPSession(page) : null
  const small = async (sel) => {
    await settled(page)
    return page.evaluate((s) =>
      [...document.querySelectorAll(s)]
        .map((el) => ({ t: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 12), r: el.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44))
        .map((x) => `${x.t} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`), sel)
  }
  /** A drag with one pointer: the mouse, or one finger. `path` is a list of [x, y]. */
  const drag = async (path, hold = 0) => {
    const [first, ...rest] = path
    if (touch) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: first[0], y: first[1], id: 1 }] })
      if (hold) await page.waitForTimeout(hold)
      for (const [x, y] of rest) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] })
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      await page.mouse.move(first[0], first[1])
      await page.mouse.down()
      for (const [x, y] of rest) await page.mouse.move(x, y)
      await page.mouse.up()
    }
    await page.waitForTimeout(250)
  }
  const line = (x0, y0, x1, y1, steps = 8) => Array.from({ length: steps + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps])
  const strokes = () => page.locator('.ink path[data-stroke]').count()
  const placeOf = (loc) => loc.evaluate((el) => el.style.transform)
  const tool = (name) => page.locator('.toolbar').getByRole('button', { name, exact: true })

  // content: two sample papers (and a board we will not use), then a fresh board to work on
  await page.goto(`${url}#/settings`)
  await page.getByRole('button', { name: '放入示例内容' }).click()
  await page.locator('.status-line', { hasText: '生成了 6 张卡片' }).waitFor()
  await page.goto(`${url}#/boards`)
  await page.getByRole('button', { name: '新建画板' }).click()
  await page.getByLabel(/画板的名字/).fill('编辑测试')
  await page.getByRole('button', { name: '建好' }).click()
  await page.getByRole('heading', { name: '编辑测试', level: 1 }).waitFor()
  const canvas = await page.locator('.canvas').boundingBox()
  const mid = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 }

  // ════ the library sidebar ════
  check(`${tag} 论文库默认收起成一个图标`, (await page.locator('.board-side').count()) === 0)
  await page.getByRole('button', { name: '打开论文库' }).click()
  await page.locator('.board-side .paper-row', { hasText: '示例论文标题一' }).waitFor()
  check(`${tag} 点图标展开论文库`, true)
  check(`${tag} 边栏里可点元素 ≥ 44px`, (await small('.board-side a, .board-side button')).length === 0, (await small('.board-side a, .board-side button')).join(', '))
  await page.screenshot({ path: `${out}/${size.name}-edit-1-side.png` })
  if (!touch) {
    const w0 = (await page.locator('.board-side').boundingBox()).width
    const grip = await page.locator('.side-grip').boundingBox()
    await drag(line(grip.x + 7, grip.y + 300, grip.x + 127, grip.y + 300, 6))
    const w1 = (await page.locator('.board-side').boundingBox()).width
    check(`${tag} 拖边栏的边缘可以调宽度`, Math.abs(w1 - w0 - 120) < 4, `${Math.round(w0)} → ${Math.round(w1)}`)
    await page.reload()
    await page.getByRole('heading', { name: '编辑测试', level: 1 }).waitFor()
    check(`${tag} 重新打开时仍是收起的`, (await page.locator('.board-side').count()) === 0)
    await page.getByRole('button', { name: '打开论文库' }).click()
    await page.locator('.board-side .paper-row').first().waitFor()
    const w2 = (await page.locator('.board-side').boundingBox()).width
    check(`${tag} 记住上次调好的宽度`, Math.abs(w2 - w1) < 2, `${Math.round(w2)}`)
  }

  // ════ dragging a paper onto the board ════
  await settled(page) // the list slides in: measure once it has stopped
  const row = await page.locator('.board-side .paper-row', { hasText: '示例论文标题一' }).boundingBox()
  // a finger pulls by the grip (any direction); the mouse can pull the row anywhere
  const grip = await page.locator('.board-side .paper-row', { hasText: '示例论文标题一' }).locator('.row-grip').boundingBox()
  const from = touch ? [grip.x + grip.width / 2, grip.y + grip.height / 2] : [row.x + Math.min(120, row.width / 2), row.y + row.height / 2]
  const c2 = await page.locator('.canvas').boundingBox()
  const to = [c2.x + c2.width - 120, c2.y + 320]
  await drag([from, ...line(from[0], from[1], to[0], to[1], 10)])
  await page.locator('.node.papercard', { hasText: '示例论文标题一' }).waitFor()
  check(`${tag} 从论文库把论文${touch ? '用手指按着把手斜着' : ''}拖到画板上，生成论文卡片`, true)
  check(`${tag} 拖完之后没有误打开论文页`, (await page.evaluate(() => location.hash)).startsWith('#/board/'))
  if (touch) check(`${tag} 手机上拖动时论文库让开，放下后收起`, (await page.locator('.board-side').count()) === 0)
  else {
    const again = await page.locator('.board-side .paper-row', { hasText: '示例论文标题一' }).boundingBox()
    await drag([[again.x + 100, again.y + 20], ...line(again.x + 112, again.y + 20, to[0], to[1] + 200, 10)])
    await page.getByText('这块画板上已经有它了').waitFor()
    check(`${tag} 同一篇论文不会放两次`, (await page.locator('.node.papercard').count()) === 1)
    await page.getByRole('button', { name: '收起论文库' }).click()
  }
  await page.screenshot({ path: `${out}/${size.name}-edit-2-paper.png` })

  // ════ writing cards with the keyboard ════
  await page.getByRole('button', { name: '加卡片' }).click()
  await page.locator('.card-dialog').getByRole('button', { name: '问题', exact: true }).click()
  await page.getByLabel('卡片内容').fill('第一行')
  await page.getByLabel('卡片内容').press('Shift+Enter')
  await page.getByLabel('卡片内容').pressSequentially('第二行')
  check(`${tag} Shift + 回车是换行`, (await page.getByLabel('卡片内容').inputValue()) === '第一行\n第二行')
  await page.getByLabel('卡片内容').press('Enter')
  await page.locator('.node.card', { hasText: '第一行' }).waitFor()
  check(`${tag} 回车：这张放好，对话框留着写下一张，类型不变`, (await page.getByLabel('卡片内容').inputValue()) === '' && (await page.locator('.card-dialog .chip[aria-pressed=true]').innerText()).trim() === '问题')
  await page.getByLabel('卡片内容').fill('连着写的第二张')
  await page.getByLabel('卡片内容').press('Enter')
  await page.getByLabel('卡片内容').fill('连着写的第三张')
  await page.getByRole('button', { name: '放到画板上' }).click()
  await page.locator('.node.card', { hasText: '连着写的第三张' }).waitFor()
  check(`${tag} 连着写了三张，都是“问题”`, (await page.locator('.node.card[data-color=pink]').count()) === 3 && (await page.locator('.card-dialog').count()) === 0)

  // ════ the edit switch ════
  await page.getByRole('button', { name: touch ? '编辑' : '编排', exact: true }).click()
  await page.locator('.toolbar').waitFor()
  const names = await page.locator('.toolbar .tool span').allInnerTexts()
  check(`${tag} 工具栏：选择、连线、画笔、马克笔、橡皮、撤回、重做、卡片、文字、贴图、完成`, names.join(' ') === '选择 连线 画笔 马克笔 橡皮 撤回 重做 卡片 文字 贴图 完成', names.join(' '))
  check(`${tag} 工具按钮 ≥ 44px`, (await small('.toolbar .tool')).length === 0, (await small('.toolbar .tool')).join(', '))
  const fits = await page.locator('.toolbar').evaluate((el) => {
    const r = el.getBoundingClientRect()
    return r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight
  })
  check(`${tag} 工具栏完整地在屏幕里`, fits)
  check(`${tag} 还没做任何事时，撤回和重做是灰的`, (await tool('重做').isDisabled()))
  await page.screenshot({ path: `${out}/${size.name}-edit-3-toolbar.png` })

  // one pointer on a card now moves the card (a card that is in view: the newest one)
  const NAME = '连着写的第三张'
  const moving = page.locator('.node.card', { hasText: NAME })
  const p0 = await placeOf(moving)
  const fb = await moving.boundingBox()
  await drag(line(fb.x + 30, fb.y + 14, fb.x + 30, fb.y - 106, 6))
  check(`${tag} ${touch ? '打开编辑后，单指拖动 = 移动卡片' : '拖动卡片'}`, (await placeOf(moving)) !== p0)
  const samePlace = ([name, p]) => [...document.querySelectorAll('.node.card')].some((n) => n.textContent.includes(name) && n.style.transform === p)
  await tool('撤回').click()
  await page.waitForFunction(samePlace, [NAME, p0])
  check(`${tag} 撤回：卡片回到原来的位置`, true)
  await tool('重做').click()
  await page.waitForFunction(([name, p]) => [...document.querySelectorAll('.node.card')].some((n) => n.textContent.includes(name) && n.style.transform !== p), [NAME, p0])
  check(`${tag} 重做：又移过去`, true)

  // ════ pens ════
  // an empty area: on a phone near the top (clear of the library button), on a wide screen at the top right
  const c3 = await page.locator('.canvas').boundingBox()
  const sky = touch ? { x: c3.x + 120, y: c3.y + 130 } : { x: c3.x + c3.width - 380, y: c3.y + 130 }
  await tool('画笔').click()
  await page.locator('.ink-colors').waitFor()
  check(`${tag} 画笔的颜色：红黄蓝绿 + 自己选`, (await page.locator('.ink-colors .ink-color').count()) === 5)
  check(`${tag} 颜色按钮 ≥ 44px`, (await small('.ink-colors .ink-color')).length === 0)
  await page.getByRole('button', { name: '蓝', exact: true }).click()
  await drag(line(sky.x, sky.y, sky.x + 110, sky.y + 10, 10))
  const ink = (sel) => page.locator(`.ink path[data-stroke]${sel}`)
  check(`${tag} 画笔：画出一笔，是选的蓝色`, (await strokes()) === 1 && (await ink('[fill="#3b82c4"]').count()) === 1)
  await tool('马克笔').click()
  await page.getByRole('button', { name: '黄', exact: true }).click()
  await drag(line(sky.x, sky.y + 70, sky.x + 110, sky.y + 74, 10))
  const marker = ink('[fill="#e0a100"]')
  check(`${tag} 马克笔：半透明`, (await strokes()) === 2 && Number(await marker.getAttribute('fill-opacity')) < 0.6)
  const thick = (loc) => loc.evaluate((el) => el.getBBox().height)
  check(`${tag} 马克笔比画笔粗`, (await thick(marker)) > (await thick(ink('[fill="#3b82c4"]'))) * 1.5, `${Math.round(await thick(marker))} vs ${Math.round(await thick(ink('[fill="#3b82c4"]')))}`)
  check(`${tag} 后画的在上面`, await page.locator('.ink path[data-stroke]').last().evaluate((el) => el.getAttribute('fill') === '#e0a100'))
  await page.locator('.ink-custom input').fill('#7a3fa0')
  await drag(line(sky.x, sky.y + 140, sky.x + 110, sky.y + 144, 10))
  check(`${tag} 色盘里自己选的颜色`, (await strokes()) === 3 && (await ink('[fill="#7a3fa0"]').count()) === 1)
  check(`${tag} 用过的自选颜色记在旁边`, await page.getByRole('button', { name: '最近用过的颜色 #7a3fa0' }).isVisible())
  await page.screenshot({ path: `${out}/${size.name}-edit-4-pens.png` })

  // ════ undo / redo ════
  await tool('撤回').click()
  await page.waitForFunction(() => document.querySelectorAll('.ink path[data-stroke]').length === 2)
  await tool('重做').click()
  await page.waitForFunction(() => document.querySelectorAll('.ink path[data-stroke]').length === 3)
  check(`${tag} 撤回、重做一笔`, true)
  if (!touch) {
    await page.keyboard.press('Meta+z')
    await page.waitForFunction(() => document.querySelectorAll('.ink path[data-stroke]').length === 2)
    await page.keyboard.press('Shift+Meta+z')
    await page.waitForFunction(() => document.querySelectorAll('.ink path[data-stroke]').length === 3)
    check(`${tag} Cmd+Z 撤回，Shift+Cmd+Z 重做`, true)
  } else {
    // two fingers down and up together
    const two = [{ x: mid.x - 40, y: mid.y, id: 1 }, { x: mid.x + 40, y: mid.y, id: 2 }]
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: two })
    await page.waitForTimeout(60)
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const undone = await page.waitForFunction(() => document.querySelectorAll('.ink path[data-stroke]').length === 2, null, { timeout: 4000 }).then(() => true, () => false)
    check(`${tag} 双指点一下 = 撤回`, undone)
    await tool('重做').click()
    await page.waitForFunction(() => document.querySelectorAll('.ink path[data-stroke]').length === 3)
  }

  // ════ eraser ════
  await tool('橡皮').click()
  const target = await ink('[fill="#3b82c4"]').boundingBox()
  // straight down through the blue stroke only (the next stroke is well below)
  await drag(line(target.x + target.width / 2, target.y - 16, target.x + target.width / 2, target.y + target.height + 10, 8))
  await page.waitForFunction(() => document.querySelectorAll('.ink path[data-stroke]').length === 2)
  check(`${tag} 对象橡皮：划过哪一笔，整笔擦掉；别的笔迹不受影响`, true)
  await tool('撤回').click()
  await page.waitForFunction(() => document.querySelectorAll('.ink path[data-stroke]').length === 3)
  check(`${tag} 擦掉的也能撤回`, true)

  // ════ the select tool ════
  await tool('选择').click()
  // lasso: a loop around the three strokes
  const inkBox = await page.locator('.ink').evaluate((svg) => {
    const rs = [...svg.querySelectorAll('path[data-stroke]')].map((p) => p.getBoundingClientRect())
    return { l: Math.min(...rs.map((r) => r.left)), t: Math.min(...rs.map((r) => r.top)), r: Math.max(...rs.map((r) => r.right)), b: Math.max(...rs.map((r) => r.bottom)) }
  })
  const pad = 14
  const loop = [
    ...line(inkBox.l - pad, inkBox.t - pad, inkBox.r + pad, inkBox.t - pad, 5),
    ...line(inkBox.r + pad, inkBox.t - pad, inkBox.r + pad, inkBox.b + pad, 5),
    ...line(inkBox.r + pad, inkBox.b + pad, inkBox.l - pad, inkBox.b + pad, 5),
    ...line(inkBox.l - pad, inkBox.b + pad, inkBox.l - pad, inkBox.t - pad + 4, 5),
  ]
  await drag(loop)
  await page.getByText(/已选 \d+ 样/).waitFor()
  check(`${tag} 套索：圈一圈，选中圈里的三笔（圈里的卡片也一起）`, (await page.locator('.ink path.is-selected').count()) === 3)
  const bar = page.locator('.sel-bar')
  check(`${tag} 选中后浮出操作栏：导出、删除`, (await bar.getByRole('button', { name: '导出' }).isVisible()) && (await bar.getByRole('button', { name: '删除' }).isVisible()))
  check(`${tag} 操作栏按钮 ≥ 44px，整条在屏幕里`, (await small('.sel-bar button')).length === 0 && (await bar.evaluate((el) => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= window.innerWidth)))
  await page.screenshot({ path: `${out}/${size.name}-edit-5-lasso.png` })

  // drag the selection: all three move together
  // by colour, not by position in the page: moving ink can change the order it is listed in
  const tops = () => page.locator('.ink path[data-stroke]').evaluateAll((els) => els.map((el) => [el.getAttribute('fill'), el.getBoundingClientRect().top]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((x) => x[1]))
  const before = await tops()
  const grabAt = await ink('[fill="#e0a100"]').boundingBox()
  await drag(line(grabAt.x + grabAt.width / 2, grabAt.y + grabAt.height / 2, grabAt.x + grabAt.width / 2, grabAt.y + grabAt.height / 2 + 70, 6))
  await page.waitForTimeout(300)
  const afterMove = await tops()
  check(`${tag} 拖动选中的东西：一起移动`, afterMove.every((t, i) => Math.abs(t - before[i] - 70) < 4), afterMove.map((t, i) => Math.round(t - before[i])).join(', '))
  await tool('撤回').click()
  await page.waitForTimeout(400)
  const backAgain = await tops()
  check(`${tag} 一起移动只算一步，撤回一次全部回去`, backAgain.every((t, i) => Math.abs(t - before[i]) < 4))

  // a tap on one card selects it; cards, a paper and ink can be selected together and exported
  const cards = page.locator('.node.card')
  // (the newest card: on the phone it is the one sure to be in view)
  await page.locator('.node.card', { hasText: NAME }).click({ position: { x: 24, y: 12 } })
  await bar.waitFor()
  check(`${tag} 点一下选中一张卡片，操作栏里有“放进讨论框”`, (await page.locator('.node.is-selected').count()) === 1 && (await bar.getByRole('button', { name: '放进讨论框' }).isVisible()))
  if (!touch) {
    await cards.nth(1).click({ modifiers: ['Shift'], position: { x: 24, y: 12 } })
    await page.locator('.node.papercard').click({ modifiers: ['Shift'], position: { x: 24, y: 12 } })
    await page.locator('.ink path[data-stroke]').first().click({ modifiers: ['Shift'], force: true })
    await page.getByText('已选 4 样').waitFor()
    check(`${tag} Shift 多选：卡片、论文卡片、笔迹可以一起选`, true)
    await bar.getByRole('button', { name: '导出' }).click()
    await page.getByText(/已复制选中的 4 样/).waitFor()
    const md = await page.evaluate(() => navigator.clipboard.readText())
    const lines = ['编辑测试（选中的部分）', '【问题】', '连着写的第三张', '连着写的第二张', '示例论文标题一', '[手绘图片：'].filter((t) => !md.includes(t))
    check(`${tag} 导出选中的：只有选中的内容`, lines.length === 0 && !md.includes('第一行'), lines.join(' / '))

    // delete with the keyboard; hand-written cards ask first
    let asked = ''
    page.once('dialog', (d) => {
      asked = d.message()
      void d.accept()
    })
    await page.keyboard.press('Delete')
    await page.waitForFunction(() => document.querySelectorAll('.node.card').length === 1)
    check(`${tag} Delete 键删除选中的；有手写卡片时先确认`, asked.includes('2 张是你写的卡片') && (await page.locator('.node.papercard').count()) === 0 && (await strokes()) === 2, asked)
    await page.keyboard.press('Meta+z')
    await page.waitForFunction(() => document.querySelectorAll('.node.card').length === 3)
    check(`${tag} 删除也能一次撤回`, (await page.locator('.node.papercard').count()) === 1 && (await strokes()) === 3)

    // right click
    await page.keyboard.press('Escape')
    await cards.nth(0).click({ button: 'right', position: { x: 24, y: 12 } })
    await bar.waitFor()
    check(`${tag} 右键：选中并弹出同一条操作栏`, (await page.locator('.node.is-selected').count()) === 1)
    await page.mouse.click(c2.x + c2.width - 30, c2.y + c2.height - 160)
    await page.waitForFunction(() => document.querySelectorAll('.node.is-selected').length === 0)
    check(`${tag} 点空白处取消选择`, (await bar.count()) === 0)
  } else {
    await bar.getByRole('button', { name: '导出' }).click()
    await page.getByText(/已复制选中的 1 样/).waitFor()
    check(`${tag} 手机上也能导出选中的`, (await page.evaluate(() => navigator.clipboard.readText())).includes(NAME))
    page.once('dialog', (d) => void d.accept())
    await bar.getByRole('button', { name: '删除' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.node.card').length === 2)
    check(`${tag} 手机上从操作栏删除`, true)
    await tool('撤回').click()
    await page.waitForFunction(() => document.querySelectorAll('.node.card').length === 3)
  }

  // a real pinch must still zoom (checked last, so the zoom does not disturb the steps above)
  if (touch) {
    const w0 = (await page.locator('.node.card').last().boundingBox()).width
    const pts = (d) => [{ x: mid.x - d, y: mid.y - 60, id: 1 }, { x: mid.x + d, y: mid.y - 60, id: 2 }]
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(40) })
    for (const d of [55, 70, 85]) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(200)
    const w1 = (await page.locator('.node.card').last().boundingBox()).width
    check(`${tag} 双指张开仍然是放大，不会被当成撤回`, w1 > w0 * 1.3 && (await strokes()) === 3, `宽 ${Math.round(w0)} → ${Math.round(w1)}，${await strokes()} 笔`)
  }

  // ════ leaving edit mode ════
  await tool('完成').click()
  check(`${tag} 完成后回到浏览：工具栏收起`, (await page.locator('.toolbar').count()) === 0)
  if (touch) {
    const seen = page.locator('.node.card', { hasText: NAME })
    const cover0 = await placeOf(seen)
    const b0 = await seen.boundingBox()
    // from the middle of the screen (after the zoom above, the card itself may reach past the edge)
    await drag(line(mid.x, mid.y, mid.x, mid.y + 80, 6))
    const b1 = await seen.boundingBox()
    check(`${tag} 关掉编辑后，单指拖动 = 平移画面，卡片不动`, (await placeOf(seen)) === cover0 && Math.abs(b1.y - b0.y - 80) < 6, `画面移动 ${Math.round(b1.y - b0.y)}px`)
  }
  await page.reload()
  await page.locator('.node.card').first().waitFor()
  check(`${tag} 刷新后都还在：3 张卡片、1 张论文卡片、3 笔`, (await page.locator('.node.card').count()) === 3 && (await page.locator('.node.papercard').count()) === 1 && (await strokes()) === 3)

  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
