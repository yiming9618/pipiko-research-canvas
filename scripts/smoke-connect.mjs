// Connecting what is there: 在读 (on by itself after a real edit, a switch on the paper's page),
// sorting the library, 参考价值 (chosen in 编辑信息, filter, export), several papers into a
// discussion box at once with the mark showing where things are, and 定位重点 on a paper's page.
// Usage: node scripts/smoke-connect.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac)
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'
const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true },
  { name: 'ipad', width: 1366, height: 1024, isMobile: false, touch: true },
  { name: 'mac', width: 1728, height: 1000, isMobile: false },
]
const paper = (title, doi, year, date, body) => `---\ntype: paper\ntitle: ${title}\nyear: ${year}\ndoi: ${doi}\ncategory: 测试领域\ndate: ${date}\n---\n${body}`
const A1 = paper('甲论文', '10.1/a', 2021, '2026-11-01', '## 重点：研究方法\n甲的第一个方法\n## 重点：研究结果/发现\n甲的结果\n')
const A2 = paper('甲论文', '10.1/a', 2021, '2026-11-08', '## 重点：研究方法\n甲的第二个方法\n')
const B = paper('乙论文', '10.1/b', 2024, '2026-11-02', '## 重点：相关研究\n乙的相关研究\n')
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
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.isMobile, hasTouch: size.isMobile || !!size.touch, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage()
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
    await page.locator('.paper-row:visible').first().waitFor()
    await page.waitForTimeout(250)
  }
  const order = async () => (await page.locator('.paper-row:visible .paper-row-title').allInnerTexts()).map((t) => t.trim())
  const row = (name) => page.locator('.paper-row:visible', { hasText: name })
  const openPaper = async (name) => {
    await library()
    await row(name).first().click()
    await page.getByRole('heading', { name, level: 1 }).waitFor()
    await page.waitForTimeout(200)
  }
  const isOn = () => page.locator('.reading-switch').getAttribute('aria-pressed')

  // content: 甲 imported twice, 乙 once, 丙 added by hand (never worked on)
  await importText(A1)
  await importText(A2)
  await importText(B)
  await library()
  await page.getByRole('button', { name: '添加论文' }).click()
  await page.getByLabel('标题').fill('丙论文')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(300)
  // into the same field, so all three are in one group (在读 comes first within a group)
  await row('丙论文').first().click()
  await page.getByRole('heading', { name: '丙论文', level: 1 }).waitFor()
  await page.locator('.field-picker select').selectOption({ label: '测试领域' })
  await page.waitForTimeout(200)

  // ════ 在读 ════
  await library()
  check(`${tag} 导入过的论文自动“在读”，行上有绿色标签`, (await row('甲论文').locator('.reading-tag').count()) === 1 && (await row('乙论文').locator('.reading-tag').count()) === 1 && (await row('丙论文').locator('.reading-tag').count()) === 0)
  check(`${tag} 在读的排在组内最前面，最近的在前；论文留在原来的领域组里`, (await order()).join(',') === '乙论文,甲论文,丙论文' && (await page.locator('.group-head', { hasText: '测试领域' }).count()) === 1, (await order()).join(','))
  const tagColor = await row('乙论文').locator('.reading-tag').evaluate((el) => getComputedStyle(el).color)
  check(`${tag} 标签是绿色`, /rgb\(31, 107, 58\)/.test(tagColor), tagColor)

  await openPaper('丙论文')
  check(`${tag} 只打开、查看论文：不会变成在读`, (await isOn()) === 'false')
  check(`${tag} 论文页标题下的“在读”开关 ≥ 44px`, await big(page.locator('.reading-switch')))
  await page.locator('.reading-switch').click()
  await page.waitForTimeout(200)
  check(`${tag} 点“在读”手动开启`, (await isOn()) === 'true')
  await library()
  check(`${tag} 手动开启后排到最前`, (await order())[0] === '丙论文', (await order()).join(','))

  await openPaper('甲论文')
  await page.locator('.reading-switch').click()
  await page.waitForTimeout(200)
  check(`${tag} 点“在读”手动关闭`, (await isOn()) === 'false')
  await library()
  check(`${tag} 关闭后不再置顶，标签消失`, (await row('甲论文').locator('.reading-tag').count()) === 0 && (await order()).at(-1) === '甲论文', (await order()).join(','))
  // a real edit puts it back
  await openPaper('甲论文')
  await page.locator('.rail textarea').fill('又写了一条理解')
  await page.locator('.rail').getByRole('button', { name: '加上' }).click()
  await page.waitForTimeout(300)
  check(`${tag} 关闭后再实际编辑（写一条理解）：自动重新在读`, (await isOn()) === 'true')
  await library()
  check(`${tag} 重新置顶，在最前`, (await order())[0] === '甲论文', (await order()).join(','))

  // ════ sorting ════
  const pickSort = async (label) => {
    await page.locator('.sort-pick select').selectOption({ label: `按${label}` })
    await page.waitForTimeout(150)
  }
  // only 甲 stays 在读, so the order of the others shows
  for (const name of ['乙论文', '丙论文']) {
    await openPaper(name)
    if ((await isOn()) === 'true') await page.locator('.reading-switch').click()
    await page.waitForTimeout(150)
  }
  await library()
  await pickSort('发表时间')
  check(`${tag} 发表时间：在读的仍在最前；其余年份新的在前，没有年份的最后`, (await order()).join(',') === '甲论文,乙论文,丙论文', (await order()).join(','))
  await pickSort('收藏时间')
  check(`${tag} 收藏时间：加入论文库新的在前（在读的仍在最前）`, (await order()).join(',') === '甲论文,丙论文,乙论文', (await order()).join(','))
  await pickSort('最近阅读')
  check(`${tag} 最近阅读：最后一次实际编辑新的在前（在读的仍在最前）`, (await order()).join(',') === '甲论文,乙论文,丙论文', (await order()).join(','))
  check(`${tag} 排序选择 ≥ 44px`, await big(page.locator('.sort-pick select')))
  await page.reload()
  await page.locator('.paper-row:visible').first().waitFor()
  check(`${tag} 记住选的排序`, (await page.locator('.sort-pick select').inputValue()) === 'read')

  // ════ 参考价值 ════
  check(`${tag} 旧论文没有参考价值：行上没有色点，也没有筛选按钮`, (await page.locator('.paper-row:visible .dot').count()) === 0 && (await page.locator('.chips[aria-label="按参考价值筛选"]').count()) === 0)
  await openPaper('甲论文')
  await page.getByRole('button', { name: '编辑信息' }).click()
  const pick = page.locator('.value-pick')
  await pick.waitFor()
  const hint = (await pick.locator('.value-hint').innerText()).replace(/\s+/g, '')
  check(`${tag} 编辑信息里显示这篇论文已有的重点（只作参考，不自动选中）`, hint.includes('研究方法') && hint.includes('研究结果/发现') && (await pick.locator('.chip[aria-pressed=true]').count()) === 0, hint)
  await pick.getByRole('button', { name: '研究方法' }).click()
  await pick.getByRole('button', { name: /整篇都值得参考/ }).click()
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(250)
  check(`${tag} 论文页显示参考价值：研究方法 + Full`, (await page.locator('.paper-marks .dots').getAttribute('aria-label')) === '参考价值：研究方法、Full')
  check(`${tag} 改参考价值不算实际编辑（不改变在读）`, (await isOn()) === 'true')
  await library()
  const marks = row('甲论文').locator('.paper-row-marks')
  check(`${tag} 列表行：色点来自参考价值（一点）+ Full`, (await marks.locator('.dot').count()) === 1 && (await marks.locator('.full-tag').count()) === 1)
  await page.locator('.chips').getByRole('button', { name: '研究方法' }).click()
  check(`${tag} 按参考价值筛选`, (await order()).join(',') === '甲论文', (await order()).join(','))
  await page.locator('.chips').getByRole('button', { name: '研究方法' }).click()
  await page.locator('.chips').getByRole('button', { name: /整篇/ }).click()
  check(`${tag} 按 Full 筛选`, (await order()).join(',') === '甲论文')
  await page.locator('.chips').getByRole('button', { name: /整篇/ }).click()

  // ════ several papers into a discussion box at once ════
  await page.locator('.lib-tools').getByRole('button', { name: '选择' }).click()
  check(`${tag} 选择模式：行可以勾选，≥ 44px`, await big(row('乙论文').first()))
  await row('乙论文').first().click()
  await row('丙论文').first().click()
  check(`${tag} 勾了两篇，底部显示数量`, (await page.locator('.pick-bar .sel-count').innerText()).includes('已选 2 篇'))
  await page.locator('.pick-bar').getByRole('button', { name: /放进讨论框（2）/ }).click()
  const picker = page.locator('dialog.picker')
  await picker.getByPlaceholder(/例如/).fill('一起讨论')
  await picker.getByRole('button', { name: '新建并放入' }).click()
  await page.waitForTimeout(300)
  check(`${tag} 两篇一起放进新讨论框，选择模式结束`, (await page.locator('.pick-bar').count()) === 0 && (await page.getByText(/已放进「一起讨论」：2 项/).count()) >= 1)
  const mark = row('乙论文').locator('.box-mark')
  check(`${tag} 放进去的论文行上有讨论框标记（形状，不是色点），悬停显示讨论框名称`, (await mark.count()) === 1 && (await mark.getAttribute('title')) === '在讨论框：一起讨论' && (await row('甲论文').locator('.box-mark').count()) === 0)
  // again, with one that is already in: not added twice
  await page.locator('.lib-tools').getByRole('button', { name: '选择' }).click()
  await row('甲论文').first().click()
  await row('乙论文').first().click()
  await page.locator('.pick-bar').getByRole('button', { name: /放进讨论框（2）/ }).click()
  const boxRow = picker.locator('.picker-row', { hasText: '一起讨论' })
  check(`${tag} 讨论框选择界面显示已经在里面的：已有 1 / 2`, (await boxRow.innerText()).includes('已有 1 / 2'))
  await boxRow.click()
  await page.waitForTimeout(300)
  check(`${tag} 已经在的不重复加`, (await page.getByText(/已放进「一起讨论」：1 项（1 项之前就在）/).count()) >= 1)
  await openPaper('乙论文')
  check(`${tag} 论文页标题旁也有讨论框标记`, (await page.locator('.paper-marks .box-mark').count()) === 1)
  await page.locator('.paper-foot').getByRole('button', { name: '放进讨论框' }).click()
  check(`${tag} 单篇加入时，界面显示“已在”`, (await picker.locator('.picker-row', { hasText: '一起讨论' }).innerText()).includes('已在'))
  await picker.getByRole('button', { name: '取消' }).click()

  // ════ 定位重点 ════
  await openPaper('甲论文')
  // fold every reading first
  const heads = page.locator('.reading-toggle')
  for (let i = 0; i < (await heads.count()); i++) if ((await heads.nth(i).getAttribute('aria-expanded')) === 'true') await heads.nth(i).click()
  const locate = page.getByRole('button', { name: /定位重点/ })
  check(`${tag} “定位重点”按钮 ≥ 44px`, await big(locate))
  await locate.click()
  const menu = page.locator('dialog.locate')
  await menu.waitFor()
  const types = (await menu.locator('.locate-type-name').allInnerTexts()).join(',')
  check(`${tag} 菜单列出这篇论文实际有的重点类型`, types === '研究方法,研究结果/发现', types)
  check(`${tag} 同一类型有几张时，每张都列出在哪次阅读`, (await menu.locator('.locate-card').count()) === 2 && (await menu.locator('.locate-where').first().innerText()).includes('第 1 次阅读'))
  check(`${tag} 菜单里的按钮 ≥ 44px`, await big(menu.locator('.locate-card').first()))
  await page.screenshot({ path: `${out}/${size.name}-connect-locate.png` })
  await menu.locator('.locate-card', { hasText: '第 2 次阅读' }).click()
  await page.waitForTimeout(500)
  const target = page.locator('section.block', { hasText: '甲的第二个方法' })
  const inView = await target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= window.innerHeight
  })
  check(`${tag} 定位到第 2 次阅读里的那张：折叠的阅读自动展开，卡片选中并在屏幕里`, (await heads.nth(1).getAttribute('aria-expanded')) === 'true' && (await target.getAttribute('class')).includes('is-selected') && inView)
  await page.screenshot({ path: `${out}/${size.name}-connect-paper.png`, fullPage: size.isMobile })

  // ════ export ════
  await page.getByRole('button', { name: '导出' }).first().click()
  await page.getByRole('button', { name: /Markdown/ }).first().click()
  await page.waitForTimeout(300)
  const md = await page.evaluate(() => navigator.clipboard.readText())
  check(`${tag} 论文 Markdown 写上参考价值`, md.includes('- 参考价值：研究方法、Full'))
  await page.keyboard.press('Escape')

  await library()
  await page.screenshot({ path: `${out}/${size.name}-connect-library.png`, fullPage: size.isMobile })
  check(`${tag} 没有横向滚动`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
