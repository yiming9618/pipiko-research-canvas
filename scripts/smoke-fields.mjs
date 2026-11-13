// Fields (领域): created from category on import, the library grouped by field, picking a field on
// the paper page, pulling a paper onto a field's heading, and managing fields in the settings.
// Usage: node scripts/smoke-fields.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac)
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
    Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))).then(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    ),
  )
const paper = (title, category, doi) => `---\ntype: paper\ntitle: ${title}\nauthors: 作者\nyear: 2024\ndoi: ${doi}\n${category ? `category: ${category}\n` : ''}date: 2026-11-10\n---\n## 一句话总结\n${title}的总结\n## 重点：研究方法\n方法\n`

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
  const touch = size.isMobile
  const client = touch ? await ctx.newCDPSession(page) : null
  const groups = async () => {
    await settled(page)
    // 未分类 last; the rest in the Chinese collation (Chinese names before Latin ones), compared here as a set
    const all = await page.locator('.liblist .group-head').evaluateAll((els) => els.map((el) => `${el.children[0].textContent}:${el.children[1].textContent}`))
    const last = all.at(-1)?.startsWith('未分类') ? [all.pop()] : []
    return [...all.sort(), ...last]
  }
  const toLibrary = async () => {
    await page.goto(`${url}#/library`)
    await page.getByRole('button', { name: /^已读/ }).first().click()
    await page.locator('.liblist .group-head').first().waitFor()
  }

  // ── import: category becomes a field; the same name (any case or spacing) is the same field
  await page.goto(url)
  for (const [md, expect] of [
    [paper('论文甲', 'Living media', '10.1/a'), /1 篇论文放进论文库/],
    [paper('论文乙', ' living  MEDIA ', '10.1/b'), /1 篇论文放进论文库/],
    [paper('论文丙', '霉菌', '10.1/c'), /1 篇论文放进论文库/],
    [paper('论文丁', '', '10.1/d'), /1 篇论文放进论文库/],
  ]) {
    await page.locator('.md-input').fill(md)
    await page.getByRole('button', { name: '放进去' }).click()
    await page.getByText(expect).first().waitFor()
    await page.waitForFunction(() => document.querySelector('.md-input').value === '')
  }
  await toLibrary()
  check(`${tag} 导入时 category 变成领域；大小写和空格不同算同一个；没写的是未分类`, (await groups()).join(' | ') === 'Living media:2 | 霉菌:1 | 未分类:1', (await groups()).join(' | '))
  await page.screenshot({ path: `${out}/${size.name}-fields-1-library.png`, fullPage: touch })

  // ── paper page: pick a field, or make one on the spot
  await page.locator('.paper-row:visible', { hasText: '论文丁' }).first().click()
  await page.getByRole('heading', { name: '论文丁', level: 1 }).waitFor()
  const picker = page.locator('.field-picker select')
  check(`${tag} 论文页显示领域，没有的写“未分类”`, (await picker.locator('option:checked').innerText()) === '未分类')
  await picker.selectOption({ label: '霉菌' })
  await page.waitForFunction(() => document.querySelector('.field-picker select').selectedOptions[0].textContent === '霉菌')
  await picker.selectOption({ label: '＋ 新建领域…' })
  await page.getByLabel('新领域的名字').fill('交互设计')
  await page.getByRole('button', { name: '建好' }).click()
  await page.waitForFunction(() => document.querySelector('.field-picker select').selectedOptions[0].textContent === '交互设计')
  check(`${tag} 论文页上换领域、当场新建领域`, true)
  check(`${tag} 领域选择 ≥ 44px`, (await picker.boundingBox()).height >= 44)
  await toLibrary()
  check(`${tag} 论文库跟着变`, (await groups()).join(' | ') === 'Living media:2 | 交互设计:1 | 霉菌:1', (await groups()).join(' | '))

  // ── pull a paper onto a field's heading (finger: by the grip; mouse: anywhere on the row)
  const row = page.locator('.paper-row:visible', { hasText: '论文丙' }).first()
  await row.scrollIntoViewIfNeeded()
  await settled(page)
  const from = touch ? await row.locator('.row-grip').boundingBox() : await row.boundingBox()
  const head = await page.locator('.group-head', { hasText: 'Living media' }).boundingBox()
  const a = [from.x + (touch ? from.width / 2 : 80), from.y + from.height / 2]
  const b = [head.x + 60, head.y + head.height / 2]
  const steps = Array.from({ length: 11 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 10, a[1] + ((b[1] - a[1]) * i) / 10])
  if (touch) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a[0], y: a[1], id: 1 }] })
    for (const [x, y] of steps) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] })
    check(`${tag} 拖到领域标题上时，标题亮起`, (await page.locator('.group-head.is-over').count()) === 1)
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else {
    await page.mouse.move(a[0], a[1])
    await page.mouse.down()
    for (const [x, y] of steps) await page.mouse.move(x, y)
    check(`${tag} 拖到领域标题上时，标题亮起`, (await page.locator('.group-head.is-over').count()) === 1)
    await page.mouse.up()
  }
  await page.locator('.toast', { hasText: '「论文丙」已放进领域「Living media」' }).waitFor()
  check(`${tag} 把论文拖到领域标题上，换到那个领域`, (await groups()).join(' | ') === 'Living media:3 | 交互设计:1 | 霉菌:0', (await groups()).join(' | '))
  check(`${tag} 拖完没有误打开论文页`, (await page.evaluate(() => location.hash)) === '#/library')
  check(`${tag} 空了的领域仍然列出（可以拖进去）`, (await page.locator('.group-head', { hasText: '霉菌' }).count()) === 1)

  // ── manage: rename, refuse a duplicate, delete
  await page.getByRole('link', { name: '管理领域' }).click()
  await page.getByRole('heading', { name: '领域', level: 2 }).waitFor()
  await settled(page)
  check(`${tag} “管理领域”直接跳到设置里的领域`, await page.getByRole('heading', { name: '领域', level: 2 }).evaluate((h) => h.getBoundingClientRect().top < window.innerHeight / 2))
  const inputs = page.getByRole('textbox', { name: '领域名称' })
  // by name, not by position: the list is in Chinese collation order
  const field = async (name) => inputs.nth(await inputs.evaluateAll((els, n) => els.findIndex((el) => el.value === n), name))
  check(`${tag} 每个领域写着论文数`, (await page.locator('.field-row').allInnerTexts()).map((t) => t.trim()).join(' ').includes('3 篇'))
  const lm = await field('Living media')
  await lm.fill('活体媒介')
  await lm.press('Enter')
  await page.waitForFunction(() => [...document.querySelectorAll('.field-row input')].some((el) => el.value === '活体媒介'))
  const other = await field('交互设计')
  await other.fill('活体媒介')
  await other.press('Enter')
  await page.getByText('已经有叫「活体媒介」的领域了').waitFor()
  check(`${tag} 领域改名；不能和别的领域重名`, (await inputs.evaluateAll((els) => els.map((el) => el.value))).includes('交互设计'))
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: '删除领域：活体媒介' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.field-row').length === 2)
  await page.getByRole('textbox', { name: '新领域的名字' }).fill('新领域')
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.field-row').length === 3)
  check(`${tag} 删除和新建领域`, true)
  await page.screenshot({ path: `${out}/${size.name}-fields-2-settings.png`, fullPage: touch })
  await toLibrary()
  check(`${tag} 删除领域后，里面的论文变回未分类`, (await groups()).join(' | ') === '交互设计:1 | 新领域:0 | 霉菌:0 | 未分类:3', (await groups()).join(' | '))

  // ── search and export follow the field
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('.search-panel input').fill('论文 交互设计')
  await page.locator('.search-item', { hasText: '论文丁' }).waitFor()
  check(`${tag} 按领域名能搜到论文`, (await page.locator('.search-item').count()) === 1)

  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
