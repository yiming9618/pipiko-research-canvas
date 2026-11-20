// One library: no 想看/已读 tabs; 全部/已编辑/未编辑 worked out from the notes; papers the AI named are
// hidden until asked for, but found by search; sorting with a direction; the discussion export by
// 已编辑/未编辑. And pictures in notes: 基础, highlight cards and 我的理解, by the picture button (every
// device), paste and drop (Mac); "[图片]" in Markdown, the pictures themselves in the PDF.
// Usage: node scripts/smoke-onelib.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac)
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'
const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true },
  { name: 'ipad', width: 1366, height: 1024, isMobile: false, touch: true },
  { name: 'mac', width: 1728, height: 1000, isMobile: false },
]
const A = `---\ntype: paper\ntitle: 有笔记的论文\nyear: 2022\ndoi: 10.1/noted\ncategory: 合一测试\ndate: 2026-11-10\n---\n## 一句话总结\n一句话\n## 基础\n1. 在什么领域：xxxxxxx\n## 重点：研究方法\n方法卡片\n`
const R = `---\ntype: research\ndate: 2026-11-12\ntitle: 一份记录\npapers: 10.9/aimention\n---\n## 发现\n提到了一篇论文 (某人, 2020)\n`
const settled = (page) =>
  page.evaluate(() =>
    Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))).then(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    ),
  )
// a small PNG, made in the page
const pngIn = (page) =>
  page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 160
    c.height = 100
    const g = c.getContext('2d')
    g.fillStyle = '#3a7'
    g.fillRect(0, 0, 160, 100)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
const browser = await chromium.launch()
let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}

for (const size of sizes.filter((x) => !process.env.ONLY || process.env.ONLY === x.name)) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.isMobile, hasTouch: size.isMobile || !!size.touch, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage()
  // no Crossref here: the AI-named paper keeps only its DOI
  await page.route('https://api.crossref.org/**', (r) => r.abort())
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(m.text()))
  page.on('dialog', (d) => void d.accept())
  const tag = `[${size.name}]`
  const big = async (loc) => {
    await settled(page)
    const b = await loc.boundingBox()
    return !!b && b.height >= 44
  }
  const importText = async (text) => {
    await page.goto(url)
    await page.locator('.md-input').fill(text)
    await page.getByRole('button', { name: '放进去' }).click()
    await page.locator('.result-text').first().waitFor()
  }
  const library = async () => {
    await page.goto(`${url}#/library`)
    await page.locator('.liblist').waitFor()
    await page.waitForTimeout(300)
  }
  const titles = async () => (await page.locator('.paper-row:visible .paper-row-title').allInnerTexts()).map((t) => t.trim())
  const row = (name) => page.locator('.paper-row:visible', { hasText: name })
  await page.goto(url)
  const png = Buffer.from(await pngIn(page))

  // ════ 1. one library ════
  await importText(A)
  await importText(R)
  await library()
  await page.getByRole('button', { name: '添加论文' }).click()
  check(`${tag} 添加论文时不再选“想看/已读”`, (await page.locator('.paper-form').getByRole('button', { name: '想看' }).count()) === 0)
  await page.getByLabel('标题').fill('只记了信息的论文')
  await page.getByLabel(/为什么想看/).fill('导师推荐，以后读')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(300)
  await row('只记了信息的论文').first().click()
  await page.getByRole('heading', { name: '只记了信息的论文', level: 1 }).waitFor()
  await page.locator('.field-picker select').selectOption({ label: '合一测试' })
  await page.waitForTimeout(200)
  await library()
  check(`${tag} 没有“想看/已读”两个分区，全在一个论文库里`, (await page.getByRole('button', { name: /^想看/ }).count()) === 0 && (await page.getByRole('button', { name: /^已读/ }).count()) === 0)
  const t0 = await titles()
  check(`${tag} 有笔记的、只记了信息的都在列表里；AI 提到的默认不显示`, t0.includes('有笔记的论文') && t0.includes('只记了信息的论文') && t0.length === 2, t0.join(','))
  check(`${tag} “为什么想看”显示在行上`, (await row('只记了信息的论文').innerText()).includes('导师推荐，以后读'))
  const progress = (name) => page.locator('.lib-filter').getByRole('button', { name, exact: true })
  check(`${tag} 筛选按钮 ≥ 44px`, await big(progress('已编辑')))
  await progress('已编辑').click()
  check(`${tag} 已编辑：只有有笔记的`, (await titles()).join(',') === '有笔记的论文')
  await progress('未编辑').click()
  check(`${tag} 未编辑：只记了信息的（“为什么想看”不算笔记）`, (await titles()).join(',') === '只记了信息的论文')
  await progress('全部').click()
  const aiChip = page.getByRole('button', { name: /显示 AI 提到的（1）/ })
  check(`${tag} 筛选里可以选择显示 AI 提到的（1 篇）`, (await aiChip.count()) === 1)
  await aiChip.click()
  await page.waitForTimeout(200)
  const aiRow = page.locator('.paper-row:visible', { has: page.locator('.ai-tag') })
  check(`${tag} 显示后：AI 提到的论文带小标记`, (await aiRow.count()) === 1 && (await aiRow.innerText()).includes('AI 提到'))
  await aiChip.click()
  // search still finds it
  await page.getByRole('button', { name: '搜索' }).first().click()
  await page.locator('.search-panel input').fill('10.9/aimention')
  await page.waitForTimeout(400)
  const hit = page.locator('.search-item', { hasText: 'AI 提到' })
  check(`${tag} 隐藏的 AI 提到的论文在全局搜索里能搜到，带“AI 提到”标签`, (await hit.count()) >= 1)
  await page.keyboard.press('Escape')

  // ════ 2. sorting ════
  await library()
  const sel = page.locator('.sort-pick select')
  check(`${tag} 排序只有三种：最近阅读、发表时间、收藏时间`, (await sel.locator('option').allInnerTexts()).join(',') === '按最近阅读,按发表时间,按收藏时间')
  // nothing 在读, so the order shows (an import puts a paper 在读: switch it off)
  await row('有笔记的论文').first().click()
  await page.getByRole('heading', { name: '有笔记的论文', level: 1 }).waitFor()
  if ((await page.locator('.reading-switch').getAttribute('aria-pressed')) === 'true') await page.locator('.reading-switch').click()
  await library()
  await sel.selectOption('published')
  await page.waitForTimeout(150)
  const dir = page.locator('.sort-dir')
  check(`${tag} 方向按钮 ≥ 44px`, await big(dir))
  const desc = await titles()
  await dir.click()
  await page.waitForTimeout(150)
  const asc = await titles()
  check(`${tag} 发表时间：没有年份的都在最后，换方向也一样`, desc.at(-1) === '只记了信息的论文' && asc.at(-1) === '只记了信息的论文', `${desc.join(',')} | ${asc.join(',')}`)
  await sel.selectOption('added')
  await page.waitForTimeout(150)
  const addedAsc = await titles()
  await dir.click()
  await page.waitForTimeout(150)
  const addedDesc = await titles()
  check(`${tag} 收藏时间：升序和降序正好相反`, addedAsc.join(',') === [...addedDesc].reverse().join(',') && addedAsc[0] === '有笔记的论文', `${addedAsc.join(',')} | ${addedDesc.join(',')}`)
  await page.reload()
  await page.locator('.liblist').waitFor()
  check(`${tag} 记住排序方式和方向`, (await sel.inputValue()) === 'added' && (await dir.innerText()).includes('新的在前'))

  // ════ 3. an unedited paper opens its page and can be written in ════
  await row('只记了信息的论文').first().click()
  await page.getByRole('heading', { name: '只记了信息的论文', level: 1 }).waitFor()
  check(`${tag} 只记了信息的论文也打开自己的论文页，有一个空的第 1 次阅读`, (await page.locator('.reading-toggle').count()) === 1)
  // a picture into a new highlight, with the picture button (every device)
  await page.getByRole('button', { name: '加一个重点' }).click()
  await page.locator('.add-form textarea').fill('读之后写的重点')
  const pickBtn = page.locator('.add-form .note-image-btn')
  check(`${tag} 写重点时有插图按钮，≥ 44px`, await big(pickBtn))
  await page.locator('.add-form input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png })
  await page.waitForFunction(() => document.querySelector('.add-form textarea')?.value.includes('asset:'))
  check(`${tag} 选了图片：插到文字里（单独一行）`, /读之后写的重点\n!\[图片\]\(asset:asset_\w+\)/.test(await page.locator('.add-form textarea').inputValue()))
  await page.locator('.add-form').getByRole('button', { name: '保存' }).click()
  await page.locator('section.block .note-img').first().waitFor()
  check(`${tag} 重点卡片里显示图片`, (await page.locator('section.block .note-img').count()) === 1)
  await library()
  await progress('已编辑').click()
  check(`${tag} 写了重点：变成“已编辑”`, (await titles()).includes('只记了信息的论文'))
  await progress('全部').click()

  // ════ 4. pictures in 基础 (paste) and in notes ════
  await row('有笔记的论文').first().click()
  await page.getByRole('heading', { name: '有笔记的论文', level: 1 }).waitFor()
  await page.locator('.basics summary').click()
  await page.locator('.basics .editable').click()
  const basics = page.locator('.basics textarea')
  await basics.waitFor()
  await basics.evaluate((el, bytes) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], 'shot.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  }, [...png])
  await page.waitForFunction(() => document.querySelector('.basics textarea')?.value.includes('asset:'))
  check(`${tag} 基础：粘贴截图，插到文字里`, (await basics.inputValue()).includes('![图片](asset:'))
  await page.locator('.basics').getByRole('button', { name: '保存' }).click()
  await page.locator('.basics .note-img').waitFor()
  check(`${tag} 基础里显示图片`, (await page.locator('.basics .note-img').count()) === 1)
  // a note: text + a dropped picture → 我写的 with the picture; only a picture → 手绘
  const rail = page.locator('.rail')
  await rail.locator('textarea').fill('写下的理解')
  await rail.locator('textarea').evaluate((el, bytes) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], 'drop.png', { type: 'image/png' }))
    for (const type of ['dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  }, [...png])
  await page.waitForFunction(() => document.querySelector('.rail textarea')?.value.includes('asset:'))
  await rail.getByRole('button', { name: '加上' }).click()
  await rail.locator('.comment .note-img').first().waitFor()
  check(`${tag} 理解：拖进图片，和文字一起保存（我写的）`, (await rail.locator('.comment', { hasText: '写下的理解' }).locator('.source').innerText()) === '我写的' && (await rail.locator('.comment', { hasText: '写下的理解' }).locator('.note-img').count()) === 1)
  await rail.locator('input[type=file]').setInputFiles({ name: 'sketch.png', mimeType: 'image/png', buffer: png })
  await page.waitForFunction(() => document.querySelector('.rail textarea')?.value.includes('asset:'))
  await rail.getByRole('button', { name: '加上' }).click()
  await page.waitForTimeout(300)
  check(`${tag} 理解：只放一张图、不写字，仍是一条“手绘”`, (await rail.locator('.source[data-source=drawing]').count()) === 1)
  // a non-picture is refused
  await rail.locator('textarea').evaluate((el) => {
    const dt = new DataTransfer()
    dt.items.add(new File(['x'], 'a.pdf', { type: 'application/pdf' }))
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  })
  await page.waitForTimeout(200)
  check(`${tag} 拖进非图片：不插入，提示一句`, (await rail.getByText('只能插入图片').count()) === 1 && !(await rail.locator('textarea').inputValue()).includes('asset:'))
  // editing a highlight keeps working with pictures (the editor of an existing card)
  const card = page.locator('section.block', { hasText: '方法卡片' })
  await card.locator('.editable p').first().dblclick()
  await card.locator('textarea').waitFor()
  check(`${tag} 改已有的重点时也有插图按钮`, (await card.locator('.note-image-btn').count()) === 1)
  await card.getByRole('button', { name: '取消' }).click()
  await page.screenshot({ path: `${out}/${size.name}-onelib-paper.png`, fullPage: size.isMobile })

  // ════ 5. exports ════
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.locator('.export-choice', { hasText: 'Markdown' }).click()
  await page.waitForTimeout(300)
  const md = await page.evaluate(() => navigator.clipboard.readText())
  check(`${tag} Markdown 导出：图片写成“[图片]”`, md.includes('[图片]') && !md.includes('asset:'))
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    window.__printed = 0
    window.print = () => {
      window.__printed++
    }
  })
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.locator('.export-choice', { hasText: 'PDF' }).click()
  await page.waitForFunction(() => window.__printed === 1)
  check(`${tag} PDF：图片正常显示在对应的笔记里`, (await page.locator('.print-sheet .note-img').count()) === 2, `${await page.locator('.print-sheet .note-img').count()} 张`)
  if (size.name === 'mac') {
    await page.emulateMedia({ media: 'print' })
    await page.pdf({ path: `${out}/onelib.pdf`, format: 'A4', printBackground: true })
    await page.emulateMedia({ media: 'screen' })
  }
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))

  // discussion export: by 已编辑 / 未编辑
  await library()
  await page.locator('.lib-tools').getByRole('button', { name: '选择' }).click()
  await page.locator('.lib-filter').getByRole('button', { name: /显示 AI 提到的/ }).click()
  await row('有笔记的论文').first().click()
  // the AI-named paper has nothing written: 未编辑
  await page.locator('.paper-row:visible', { has: page.locator('.ai-tag') }).first().click()
  await page.locator('.pick-bar').getByRole('button', { name: /放进讨论框/ }).click()
  await page.locator('dialog.picker').getByPlaceholder(/例如/).fill('合一测试框')
  await page.locator('dialog.picker').getByRole('button', { name: '新建并放入' }).click()
  await page.waitForTimeout(300)
  await page.goto(`${url}#/discussions`)
  await page.locator('.box-row', { hasText: '合一测试框' }).first().click()
  await page.getByRole('button', { name: /导出给 AI/ }).first().click()
  await page.waitForTimeout(300)
  const exported = await page.evaluate(() => navigator.clipboard.readText())
  await page.locator('.lib-filter').getByRole('button', { name: /显示 AI 提到的/ }).click().catch(() => undefined)
  check(`${tag} 讨论框导出：按“已编辑/未编辑”写状态，已编辑的带上笔记`, exported.includes('- 状态：已编辑（有阅读笔记）') && exported.includes('一句话总结：一句话') && exported.includes('- 状态：未编辑（还没有阅读笔记）') && exported.includes('- DOI：10.9/aimention'))
  check(`${tag} 讨论框导出里的图片写成“[图片]”`, !exported.includes('asset:'))

  await library()
  await page.screenshot({ path: `${out}/${size.name}-onelib-library.png`, fullPage: size.isMobile })
  check(`${tag} 没有横向滚动`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
