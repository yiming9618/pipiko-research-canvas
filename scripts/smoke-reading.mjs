// Reading a paper: folding the library list away and dragging its width, selecting a highlight card
// without editing it, editing on purpose, notes tied to a card, and when each note was written.
// Usage: node scripts/smoke-reading.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac)
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'
const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true },
  { name: 'ipad', width: 1366, height: 1024, isMobile: false, touch: true },
  { name: 'mac', width: 1728, height: 1000, isMobile: false },
]
const PAPER = `---\ntype: paper\ntitle: 阅读测试论文\nauthors: 作者甲\nyear: 2024\ndoi: 10.1/read\ncategory: 霉菌\ndate: 2026-11-10\n---\n## 一句话总结\n总结\n## 重点：研究方法\n第一张方法卡片\n## 重点：研究方法\n第二张方法卡片\n## 重点：研究结果/发现\n结果卡片\n## 我的理解\nAI 整理的理解\n`
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
  const wide = size.width >= 1100
  const tap = async (loc) => (size.isMobile || size.touch ? loc.tap() : loc.click())

  await page.goto(url)
  await page.locator('.md-input').fill(PAPER)
  await page.getByRole('button', { name: '放进去' }).click()
  await page.getByText(/1 篇论文放进论文库/).waitFor()
  await page.goto(`${url}#/library`)
  await page.locator('.paper-row:visible', { hasText: '阅读测试论文' }).first().click()
  await page.getByRole('heading', { name: '阅读测试论文', level: 1 }).waitFor()
  const cards = page.locator('section.block')
  const m1 = cards.filter({ hasText: '第一张方法卡片' })
  const m2 = cards.filter({ hasText: '第二张方法卡片' })

  // ════ 1. folding the list, dragging its width (wide screens) ════
  if (wide) {
    const main0 = (await page.locator('.paper-main').boundingBox()).width
    const side0 = (await page.locator('.lib-side').boundingBox()).width
    const grip = await page.locator('.lib-grip').boundingBox()
    await page.mouse.move(grip.x + 7, grip.y + 300)
    await page.mouse.down()
    await page.mouse.move(grip.x + 107, grip.y + 300, { steps: 5 })
    await page.mouse.up()
    const side1 = (await page.locator('.lib-side').boundingBox()).width
    check(`${tag} 拖分隔线调宽论文库`, Math.abs(side1 - side0 - 100) < 4, `${Math.round(side0)} → ${Math.round(side1)}`)
    await page.getByRole('button', { name: '收起论文库' }).click()
    await settled(page)
    const side2 = (await page.locator('.lib-side').boundingBox()).width
    const main2 = (await page.locator('.paper-main').boundingBox()).width
    check(`${tag} 收起后只剩一条窄边，正文变宽`, side2 <= 60 && main2 > main0 + 150, `边栏 ${Math.round(side2)}，正文 ${Math.round(main0)} → ${Math.round(main2)}`)
    check(`${tag} 收起后有展开入口，≥ 44px`, ((await page.getByRole('button', { name: '展开论文库' }).boundingBox()).height) >= 44)
    await page.screenshot({ path: `${out}/${size.name}-reading-1-folded.png` })
    await page.reload()
    await page.getByRole('heading', { name: '阅读测试论文', level: 1 }).waitFor()
    check(`${tag} 记住折叠状态`, await page.getByRole('button', { name: '展开论文库' }).isVisible())
    await page.getByRole('button', { name: '展开论文库' }).click()
    await settled(page)
    check(`${tag} 展开后恢复上次的宽度，分类和列表都在`, Math.abs((await page.locator('.lib-side').boundingBox()).width - side1) < 2 && (await page.locator('.liblist .group-head').count()) >= 1)
  }

  // ════ 2. a tap selects; editing is on purpose ════
  await tap(m1.locator('.editable p').first())
  check(`${tag} 单击：选中卡片，保持只读`, (await m1.getAttribute('class')).includes('is-selected') && (await m1.locator('textarea').count()) === 0)
  const editBtn = m1.locator('.block-edit')
  const eb = await editBtn.boundingBox()
  check(`${tag} 选中的卡片角上出现“编辑”，≥ 44px`, eb.height >= 44 && eb.width >= 44, `${Math.round(eb.width)}×${Math.round(eb.height)}`)
  check(`${tag} 没选中的卡片上看不到“编辑”（只留给键盘）`, ((await m2.locator('.block-edit').boundingBox())?.width ?? 0) <= 1)
  if (size.isMobile || size.touch) {
    await editBtn.tap()
  } else {
    await m1.locator('.editable p').first().dblclick()
  }
  await m1.locator('textarea').waitFor()
  check(`${tag} ${size.isMobile || size.touch ? '点“编辑”' : '双击'}进入编辑`, true)
  const order = await m1.locator('.edit-actions button').allInnerTexts()
  check(`${tag} 按钮：删除在左，取消、保存在右，保存最右`, order[0] === '删除' && order.at(-1) === '保存' && order.at(-2) === '取消', order.join(' '))
  const pos = await m1.locator('.edit-actions').evaluate((el) => {
    const r = (t) => [...el.querySelectorAll('button')].find((b) => b.textContent === t).getBoundingClientRect()
    return { del: r('删除').left, save: r('保存').right, box: el.getBoundingClientRect() }
  })
  check(`${tag} 删除靠左边，保存靠右边`, pos.del - pos.box.left < 20 && pos.box.right - pos.save < 20)
  await m1.locator('textarea').fill('第一张方法卡片（改过）')
  await m1.getByRole('button', { name: '保存' }).click()
  await m1.getByText('第一张方法卡片（改过）').waitFor()
  check(`${tag} 保存照旧，标“改过”`, await m1.locator('.block-edited').isVisible())

  // ════ 3. notes follow the selected card ════
  await tap(m2.locator('.editable p').first())
  await page.getByText('只看「研究方法 2」').waitFor()
  check(`${tag} 选中第二张方法卡片：右侧只看它的理解（空状态）`, (await page.locator('.rail .comment').count()) === 0 && (await page.getByText('这张重点卡片还没有理解').isVisible()))
  await page.getByPlaceholder('关于「研究方法 2」写一条理解…').fill('关于第二张方法的想法')
  await page.getByRole('button', { name: '加上' }).click()
  await page.locator('.rail .comment', { hasText: '关于第二张方法的想法' }).waitFor()
  check(`${tag} 直接为这张卡片加理解`, (await page.locator('.rail .comment').count()) === 1)
  const stamp = await page.locator('.rail .comment time').first().innerText()
  check(`${tag} 手写的理解显示日期和时刻 YYYY-MM-DD HH:mm`, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(stamp), stamp)

  await tap(m1.locator('.editable p').first())
  await page.getByText('只看「研究方法 1」').waitFor()
  check(`${tag} 换选另一张同类卡片：按卡片区分，不按类别`, (await page.locator('.rail .comment').count()) === 0)

  // blank space: back to everything
  await page.mouse.click(size.width - 8, size.height - 8)
  await page.waitForFunction(() => !document.querySelector('.block.is-selected'))
  const all = page.locator('.rail .comment')
  check(`${tag} 点空白处取消选中：右侧恢复全部理解`, (await all.count()) === 2 && !(await page.getByText(/只看「/).isVisible()))
  const ai = all.filter({ hasText: 'AI 整理的理解' })
  check(`${tag} 导入的理解只显示日期，不编造时刻`, (await ai.locator('time').innerText()) === '2026-11-10')
  const tagBtn = page.getByRole('button', { name: /对应重点：研究方法 2/ })
  check(`${tag} 全部视图里，关联卡片的理解前有“· 研究方法 2”标签`, (await tagBtn.innerText()).trim() === '· 研究方法 2')
  const tb = await tagBtn.boundingBox()
  check(`${tag} 标签的点击区域 ≥ 44px 高`, tb.height >= 44)
  await tagBtn.click()
  await page.getByText('只看「研究方法 2」').waitFor()
  check(`${tag} 点标签选中对应的卡片`, (await m2.getAttribute('class')).includes('is-selected'))
  await page.getByRole('button', { name: '看全部' }).click()
  await page.waitForFunction(() => !document.querySelector('.block.is-selected'))
  await page.getByPlaceholder('对整篇论文写一条理解…').fill('整篇论文的评价')
  await page.getByRole('button', { name: '加上' }).click()
  await page.locator('.rail .comment', { hasText: '整篇论文的评价' }).waitFor()
  check(`${tag} 没选卡片时写的是整篇论文的理解（没有标签）`, (await page.locator('.rail .comment', { hasText: '整篇论文的评价' }).locator('.comment-card').count()) === 0)
  await page.screenshot({ path: `${out}/${size.name}-reading-2-rail.png`, fullPage: size.isMobile })

  // export shows which card a note is about
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.locator('.export-choice', { hasText: 'Markdown' }).click()
  await page.locator('.toast', { hasText: '已复制这篇论文' }).waitFor()
  const md = await page.evaluate(() => navigator.clipboard.readText())
  check(`${tag} 导出里写明这条理解对应哪张重点`, /### \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 我写的 · 对应重点：研究方法 2\n\n关于第二张方法的想法/.test(md) && md.includes('### 研究方法 2\n\n第二张方法卡片'))

  // deleting the card keeps the note, now about the whole paper
  await tap(m2.locator('.editable p').first())
  await m2.locator('.block-edit').click()
  await m2.getByRole('button', { name: '删除' }).click()
  await m2.waitFor({ state: 'detached' })
  await page.mouse.click(size.width - 8, size.height - 8)
  const kept = page.locator('.rail .comment', { hasText: '关于第二张方法的想法' })
  await kept.waitFor()
  check(`${tag} 删除卡片后，它的理解还在，变回整篇论文的（没有标签）`, (await kept.locator('.comment-card').count()) === 0)

  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
