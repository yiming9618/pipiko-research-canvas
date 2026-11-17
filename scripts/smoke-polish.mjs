// Three small things: the "我的理解" column (follows the room, its width dragged and remembered,
// notes folded by day); pictures dropped from Finder or pasted with ⌘V onto a board; size and bold
// for a free text box (saved, undone, redone). Also: does **bold** in a card come out bold?
// Usage: node scripts/smoke-polish.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac)
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'
const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true },
  { name: 'ipad', width: 1366, height: 1024, isMobile: false, touch: true },
  { name: 'mac', width: 1728, height: 1000, isMobile: false },
]
const PAPER = (date, note) => `---\ntype: paper\ntitle: 理解栏测试论文\ndoi: 10.1/rail\ndate: ${date}\n---\n## 重点：研究方法\n方法 ${date}\n## 我的理解\n${note}\n`
const settled = (page) =>
  page.evaluate(() =>
    Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))).then(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    ),
  )
const browser = await chromium.launch()
let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}

for (const size of sizes.filter((x) => !process.env.ONLY || process.env.ONLY === x.name)) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.isMobile, hasTouch: size.isMobile || !!size.touch, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(m.text()))
  page.on('dialog', (d) => void d.accept())
  const tag = `[${size.name}]`
  const wide = size.width >= 1100
  const importText = async (text) => {
    await page.goto(url)
    await page.locator('.md-input').fill(text)
    await page.getByRole('button', { name: '放进去' }).click()
    await page.locator('.result-text').first().waitFor()
  }

  // ════ 1. "我的理解" ════
  // three days of notes: two imports (11-05, 11-12, added to the same reading) and one written today
  await importText(PAPER('2026-11-05', '第一天的 AI 理解'))
  await importText(PAPER('2026-11-12', '第二天的 AI 理解'))
  await page.locator('.reading-choice select').selectOption({ index: 1 })
  await page.waitForTimeout(200)
  await page.goto(`${url}#/library`)
  await page.locator('.paper-row:visible', { hasText: '理解栏测试论文' }).first().click()
  await page.getByRole('heading', { name: '理解栏测试论文', level: 1 }).waitFor()
  const rail = page.locator('.rail')
  await rail.locator('textarea').fill('今天写的理解')
  await rail.getByRole('button', { name: '加上' }).click()
  await page.waitForTimeout(200)
  const days = rail.locator('.rail-day-head')
  const dayTexts = (await days.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
  check(`${tag} 理解按日期分组，最近的在上，带条数`, dayTexts.length === 3 && dayTexts[1].startsWith('2026-11-12') && dayTexts[2].startsWith('2026-11-05') && dayTexts.every((t) => t.includes('1 条')), dayTexts.join(' / '))
  const expanded = await days.evaluateAll((els) => els.map((e) => e.getAttribute('aria-expanded')))
  check(`${tag} 默认只展开最近的一个日期`, expanded.join(',') === 'true,false,false', expanded.join(','))
  check(`${tag} 折起来的日期里的理解看不到`, (await rail.getByText('第一天的 AI 理解').count()) === 0 && (await rail.getByText('今天写的理解').count()) === 1)
  await days.nth(2).click()
  check(`${tag} 点日期展开`, (await rail.getByText('第一天的 AI 理解').count()) === 1)
  check(`${tag} 日期标题 ≥ 44px`, ((await days.first().boundingBox()).height) >= 44)

  if (size.isMobile) {
    const main = await page.locator('.paper-main').boundingBox()
    const r = await rail.boundingBox()
    check(`${tag} 手机：理解栏仍在正文下方`, r.y >= main.y + main.height - 1)
    check(`${tag} 手机：没有可拖的分隔线`, !(await page.locator('.rail-grip').isVisible()))
  } else {
    const paperBox = async () => {
      await settled(page)
      const p = await page.locator('.paper').boundingBox()
      const r = await rail.boundingBox()
      return { p, r, gapRight: p.x + p.width - (r.x + r.width) }
    }
    // the column follows the room: folding the library list moves it to the new right edge
    const a = await paperBox()
    check(`${tag} 理解栏靠着页面右边（不卡在中间）`, a.gapRight >= 0 && a.gapRight <= 40 && Math.abs(page.viewportSize().width - (a.r.x + a.r.width)) < 60, `离页面右边 ${Math.round(page.viewportSize().width - (a.r.x + a.r.width))}px`)
    if (wide) {
      await page.getByRole('button', { name: '收起论文库' }).click()
      const b = await paperBox()
      check(`${tag} 收起论文库：理解栏跟着移到新的右边，正文变宽`, Math.abs(page.viewportSize().width - (b.r.x + b.r.width)) < 60 && (await page.locator('.paper-main').boundingBox()).width > 600, `理解栏右边 ${Math.round(b.r.x + b.r.width)} / 视口 ${page.viewportSize().width}`)
      await page.getByRole('button', { name: '展开论文库' }).click()
      await settled(page)
    }
    // drag the line between the paper and the column
    const grip = page.locator('.rail-grip')
    const w0 = (await rail.boundingBox()).width
    const g = await grip.boundingBox()
    check(`${tag} 分隔线在正文和理解栏中间`, g && g.x + g.width / 2 < (await rail.boundingBox()).x && g.x + g.width / 2 > (await page.locator('.paper-main').boundingBox()).x + (await page.locator('.paper-main').boundingBox()).width)
    const gy = g.y + Math.min(300, g.height / 2)
    await page.mouse.move(g.x + 7, gy)
    await page.mouse.down()
    await page.mouse.move(g.x - 93, gy, { steps: 6 })
    await page.mouse.up()
    const w1 = (await rail.boundingBox()).width
    check(`${tag} 拖分隔线：理解栏变宽`, Math.abs(w1 - w0 - 100) < 4, `${Math.round(w0)} → ${Math.round(w1)}`)
    await page.reload()
    await page.getByRole('heading', { name: '理解栏测试论文', level: 1 }).waitFor()
    await settled(page)
    check(`${tag} 记住上次的宽度`, Math.abs((await rail.boundingBox()).width - w1) < 2, `${Math.round((await rail.boundingBox()).width)}`)
    // a narrower window: the column gives way, the paper keeps room
    await page.setViewportSize({ width: 900, height: size.height })
    await settled(page)
    const narrow = await paperBox()
    check(`${tag} 窗口变窄：理解栏跟着收窄，不挤掉正文，仍靠右`, narrow.r.width < w1 && (await page.locator('.paper-main').boundingBox()).width >= 300 && narrow.r.x + narrow.r.width <= 900, `理解栏 ${Math.round(narrow.r.width)}，正文 ${Math.round((await page.locator('.paper-main').boundingBox()).width)}`)
    await page.setViewportSize({ width: size.width, height: size.height })
    await settled(page)
    check(`${tag} 窗口变回来：恢复记住的宽度`, Math.abs((await rail.boundingBox()).width - w1) < 2)
  }
  await page.screenshot({ path: `${out}/${size.name}-polish-1-rail.png`, fullPage: size.isMobile })

  // ════ 2. pictures onto a board ════
  await page.goto(`${url}#/boards`)
  await page.getByRole('button', { name: '新建画板' }).click()
  await page.getByLabel(/画板的名字/).fill('图片测试')
  await page.getByRole('button', { name: '建好' }).click()
  await page.getByRole('heading', { name: '图片测试', level: 1 }).waitFor()
  const box = await page.locator('.canvas').boundingBox()
  const at = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.55 }
  // files as Finder hands them over: two pictures and a PDF
  const dropFiles = (kinds, point) =>
    page.evaluate(
      async ({ kinds, point }) => {
        const png = async (color) => {
          const c = document.createElement('canvas')
          c.width = 200
          c.height = 120
          const g = c.getContext('2d')
          g.fillStyle = color
          g.fillRect(0, 0, 200, 120)
          return new File([await new Promise((r) => c.toBlob(r, 'image/png'))], `${color}.png`, { type: 'image/png' })
        }
        const dt = new DataTransfer()
        for (const k of kinds) dt.items.add(k === 'pdf' ? new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' }) : await png(k))
        const target = document.elementFromPoint(point.x, point.y)
        for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, dataTransfer: dt }))
      },
      { kinds, point },
    )
  const photos = page.locator('.node.photo')
  await dropFiles(['red', 'blue', 'pdf'], at)
  await photos.nth(1).waitFor()
  await page.waitForTimeout(300)
  const toast1 = (await page.locator('[role=status], .toast').allInnerTexts()).join(' ')
  check(`${tag} 拖进两张图片和一个 PDF：两张放上去，PDF 忽略并提示`, (await photos.count()) === 2 && toast1.includes('放进了 2 张图片') && toast1.includes('1 个不是图片'), toast1.replace(/\s+/g, ' ').slice(0, 100))
  const [p1, p2] = [await photos.nth(0).boundingBox(), await photos.nth(1).boundingBox()]
  const firstMid = { x: Math.min(p1.x, p2.x) + Math.min(p1.width, p2.width) / 2, y: Math.min(p1.y, p2.y) + Math.min(p1.height, p2.height) / 2 }
  check(`${tag} 放在松开的位置`, Math.hypot(firstMid.x - at.x, firstMid.y - at.y) < 30, `差 ${Math.round(Math.hypot(firstMid.x - at.x, firstMid.y - at.y))}px`)
  check(`${tag} 多张稍微错开`, Math.abs(p1.x - p2.x) > 5 && Math.abs(p1.y - p2.y) > 5)
  await dropFiles(['pdf'], at)
  await page.waitForTimeout(300)
  check(`${tag} 只拖进非图片文件：什么都不加，提示一句`, (await photos.count()) === 2 && (await page.getByText('只能放图片').count()) >= 1)
  // ⌘V with a screenshot on the clipboard
  await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 300
    c.height = 200
    c.getContext('2d').fillRect(0, 0, 300, 200)
    const dt = new DataTransfer()
    dt.items.add(new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'shot.png', { type: 'image/png' }))
    document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  })
  await photos.nth(2).waitFor()
  const pasted = await photos.nth(2).boundingBox()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  check(`${tag} ⌘V 粘贴截图：放在画面中央`, Math.hypot(pasted.x + pasted.width / 2 - centre.x, pasted.y + pasted.height / 2 - centre.y) < 80, `差 ${Math.round(Math.hypot(pasted.x + pasted.width / 2 - centre.x, pasted.y + pasted.height / 2 - centre.y))}px`)
  await page.reload()
  await page.getByRole('heading', { name: '图片测试', level: 1 }).waitFor()
  await page.waitForTimeout(500)
  check(`${tag} 刷新后三张图片都在（存进了本机，等同步）`, (await photos.count()) === 3)

  // ════ 3. a free text box: size and bold ════
  const touch = size.isMobile
  await page.getByRole('button', { name: touch ? '编辑' : '编排', exact: true }).click()
  await page.locator('.toolbar').getByRole('button', { name: '文字', exact: true }).click()
  await page.locator('.node.note textarea').fill('一段自由文字')
  await page.locator('.node.note textarea').evaluate((el) => el.blur())
  await page.waitForTimeout(250)
  const note = page.locator('.node.note', { hasText: '一段自由文字' })
  check(`${tag} 新文字框默认“中、不加粗”`, (await note.getAttribute('class')).includes('note-m') && !(await note.getAttribute('class')).includes('is-bold'))
  const nb = await note.boundingBox()
  await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2)
  const bar = page.locator('.sel-bar')
  await bar.waitFor()
  check(`${tag} 选中文字框：操作栏有 小 / 中 / 大 和 加粗`, (await bar.getByRole('button', { name: '字号：大' }).count()) === 1 && (await bar.getByRole('button', { name: '加粗' }).count()) === 1 && (await bar.getByRole('button', { name: '字号：中' }).getAttribute('aria-pressed')) === 'true')
  const small = await bar.locator('button').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).length)
  check(`${tag} 操作栏按钮 ≥ 44px`, small === 0, `${small} 个太小`)
  const fs = () => note.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  const fw = () => note.locator('p').first().evaluate((el) => getComputedStyle(el).fontWeight)
  const f0 = await fs()
  await bar.getByRole('button', { name: '字号：大' }).click()
  await page.waitForTimeout(150)
  await bar.getByRole('button', { name: '加粗' }).click()
  await page.waitForTimeout(150)
  check(`${tag} 改成“大”并加粗：整个文字框变大、变粗`, (await fs()) > f0 + 4 && (await fw()) === '700', `${f0} → ${await fs()}，粗细 ${await fw()}`)
  check(`${tag} 按钮显示当前状态`, (await bar.getByRole('button', { name: '字号：大' }).getAttribute('aria-pressed')) === 'true' && (await bar.getByRole('button', { name: '加粗' }).getAttribute('aria-pressed')) === 'true')
  await bar.getByRole('button', { name: '字号：小' }).click()
  await page.waitForTimeout(150)
  check(`${tag} 改成“小”`, (await fs()) < f0)
  const undo = page.locator('.toolbar').getByRole('button', { name: '撤回', exact: true })
  const redo = page.locator('.toolbar').getByRole('button', { name: '重做', exact: true })
  await undo.click()
  await page.waitForTimeout(150)
  check(`${tag} 撤回一次：回到“大、加粗”`, (await fs()) > f0 + 4 && (await fw()) === '700')
  await undo.click()
  await page.waitForTimeout(150)
  check(`${tag} 再撤回：取消加粗`, (await fw()) !== '700' && (await fs()) > f0 + 4)
  await redo.click()
  await page.waitForTimeout(150)
  check(`${tag} 重做：又加粗了`, (await fw()) === '700')
  await page.reload()
  await page.getByRole('heading', { name: '图片测试', level: 1 }).waitFor()
  await page.waitForTimeout(400)
  check(`${tag} 刷新后样式还在（存下来了，会同步）`, (await note.getAttribute('class')).includes('note-l') && (await note.getAttribute('class')).includes('is-bold'))
  await page.screenshot({ path: `${out}/${size.name}-polish-2-board.png` })

  // ════ 4. **bold** written in a card ════
  await page.getByRole('button', { name: '加卡片' }).click()
  await page.getByLabel('卡片内容').fill('普通文字**粗体文字**普通文字\n\n**写法：**冒号在星号里面')
  await page.getByRole('button', { name: '放到画板上' }).click()
  const card = page.locator('.node.card', { hasText: '普通文字' })
  await card.waitFor()
  const strong = card.locator('strong', { hasText: '粗体文字' })
  check(`${tag} 卡片里的 **粗体** 显示成粗体`, (await strong.count()) === 1 && (await strong.evaluate((el) => getComputedStyle(el).fontWeight)) === '700')
  const literal = await card.innerText()
  console.log(`     ${tag} 参考：“**写法：**冒号在星号里面”显示为 → ${literal.split('\n').filter((l) => l.includes('冒号')).join('')}`)

  check(`${tag} 没有横向滚动`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
