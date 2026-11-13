// The trash: papers and boards are moved there whole and moved back exactly; re-importing a paper
// that is in the trash makes a separate record; a Markdown `board:` naming a board in the trash is
// refused; the settings sections fold; the nav does not move between pages.
// Usage: node scripts/smoke-trash.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac)
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'
const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true },
  { name: 'ipad', width: 1366, height: 1024, isMobile: false },
  { name: 'mac', width: 1728, height: 1000, isMobile: false },
]
const PAPER = (one) => `---\ntype: paper\ntitle: 垃圾桶测试论文\nauthors: Jane Smith\nyear: 2024\ndoi: 10.1/trash\ncategory: 霉菌\ndate: 2026-11-10\n---\n## 一句话总结\n${one}\n## 重点：研究方法\n方法卡片\n`
const RESEARCH = (title, board, body) => `---\ntype: research\ndate: 2026-11-13\ntitle: ${title}\nboard: ${board}\npapers: 10.1/trash\n---\n## 发现\n${body}，见 (Smith, 2024)\n## 问题\n${body}的问题\n`

const browser = await chromium.launch()
let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}

for (const size of sizes.filter((x) => !process.env.ONLY || process.env.ONLY === x.name)) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.isMobile, hasTouch: size.isMobile, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(m.text()))
  page.on('dialog', (d) => void d.accept())
  const tag = `[${size.name}]`
  const wide = !size.isMobile
  const paste = async (md, kind = 'research') => {
    await page.goto(url)
    if (kind === 'paper') await page.locator('.panel .seg').getByRole('button', { name: '论文' }).click()
    await page.locator('.md-input').fill(md)
    await page.getByRole('button', { name: '放进去' }).click()
  }
  const answerNew = async (name) => {
    const ask = page.getByRole('button', { name: `新建「${name}」` })
    const done = page.getByText(new RegExp(`放进(新)?画板「${name}」`))
    await Promise.race([ask.waitFor(), done.waitFor()])
    if (await ask.isVisible()) await ask.click()
    await done.waitFor()
  }
  const toTrash = async () => {
    await page.goto(`${url}#/settings`)
    const head = page.getByRole('button', { name: /^垃圾桶/ })
    await head.waitFor()
    if ((await head.getAttribute('aria-expanded')) === 'false') await head.click()
  }
  const libraryTitles = async () => {
    await page.goto(`${url}#/library`)
    await page.getByRole('button', { name: /^已读/ }).first().click()
    await page.waitForTimeout(300)
    return page.locator('.paper-row-title').allInnerTexts()
  }

  // ── nav: the same place on every page
  const spots = new Set()
  for (const hash of ['#/', '#/boards', '#/time', '#/library', '#/settings', '#/discussions']) {
    await page.goto(`${url}${hash}`)
    await page.waitForTimeout(300)
    spots.add(await page.evaluate(() => [...document.querySelectorAll('.topnav-links a')].map((a) => Math.round(a.getBoundingClientRect().left)).join(',')))
  }
  check(`${tag} 切换页面时导航按钮位置不变`, spots.size === 1, [...spots].join(' | '))

  // ── settings folds
  await page.goto(`${url}#/settings`)
  const state = async (name) => page.getByRole('button', { name: new RegExp(`^${name}`) }).getAttribute('aria-expanded')
  check(`${tag} 设置：最近导入、重点类型、垃圾桶默认折叠；领域照常展开`, (await state('最近导入')) === 'false' && (await state('重点类型')) === 'false' && (await state('垃圾桶')) === 'false' && (await page.getByRole('heading', { name: '领域', level: 2 }).isVisible()))
  await page.getByRole('button', { name: '重点类型' }).click()
  check(`${tag} 点标题展开`, (await page.locator('.type-row').count()) === 8)

  // ── content: a paper, a board that shows it and cites it, a board in a pile
  await paste(PAPER('第一份的总结'), 'paper')
  await page.getByText(/1 篇论文放进论文库/).waitFor()
  await paste(RESEARCH('霉菌记录', '霉菌研究', '霉菌发现'))
  await answerNew('霉菌研究')
  await paste(RESEARCH('共在记录', '共在研究', '共在发现'))
  await answerNew('共在研究')
  await page.goto(`${url}#/boards`)
  await page.getByRole('button', { name: '新建堆' }).click()
  await page.getByLabel('堆的名字').fill('专题')
  await page.getByRole('button', { name: '建好' }).click()
  await page.locator('.board-tile', { hasText: '霉菌研究' }).locator('select').selectOption({ label: '专题' })
  await page.locator('.toast', { hasText: '已放进堆「专题」' }).waitFor()
  // the paper on the 共在 board as a paper card, and a note on the paper
  await page.goto(`${url}#/library`)
  await page.locator('.paper-row:visible', { hasText: '垃圾桶测试论文' }).first().click()
  await page.getByPlaceholder('对整篇论文写一条理解…').fill('第一份的理解')
  await page.getByRole('button', { name: '加上' }).click()
  await page.locator('.rail .comment', { hasText: '第一份的理解' }).waitFor()

  // remember 霉菌研究 exactly as it is
  await page.goto(`${url}#/pile/` + (await page.evaluate(async () => {
    const r = indexedDB.open('research-notebook')
    const db = await new Promise((res) => (r.onsuccess = () => res(r.result)))
    return await new Promise((res) => {
      const q = db.transaction('piles').objectStore('piles').getAll()
      q.onsuccess = () => res(q.result.find((p) => p.name === '专题').id)
    })
  })))
  await page.locator('.board-tile-main', { hasText: '霉菌研究' }).click()
  await page.locator('.node.card').first().waitFor()
  const boardHash = await page.evaluate(() => location.hash)
  const snapshot = () => page.locator('.node').evaluateAll((els) => els.map((el) => `${el.dataset.node}@${el.style.transform}`).sort().join(';'))
  const before = await snapshot()
  check(`${tag} 卡片里的引用链接到这篇论文`, (await page.locator('a.cite').count()) === 1)

  // ════ move the board to the trash ════
  if (wide) {
    await page.getByRole('button', { name: '编排' }).click()
    await page.getByRole('button', { name: '移到垃圾桶' }).click()
  } else {
    // the phone's board header offers it in edit mode too
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByRole('button', { name: '移到垃圾桶' }).click()
  }
  await page.getByRole('heading', { name: '画板', level: 1 }).waitFor()
  await page.waitForTimeout(300)
  check(`${tag} 画板移进垃圾桶：画板列表和堆里都没有了，空堆保留`, !(await page.locator('.board-tile-name').allInnerTexts()).includes('霉菌研究') && (await page.locator('.pile-tile', { hasText: '专题' }).innerText()).includes('0 块画板'))
  await page.goto(`${url}#/time/2026-11-13`)
  await page.locator('.day-board').first().waitFor()
  check(`${tag} Timeline 里也不再有它的卡片`, !(await page.locator('.day-board h2 a').allInnerTexts()).includes('霉菌研究'))
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('.search-panel input').fill('霉菌发现')
  await page.waitForTimeout(300)
  check(`${tag} 搜索搜不到它的卡片`, (await page.locator('.search-item').count()) === 0)
  await page.keyboard.press('Escape')
  await page.goto(`${url}${boardHash}`)
  await page.getByText('这块画板在垃圾桶里').waitFor()
  check(`${tag} 直接打开它的网址：说明它在垃圾桶里`, true)

  // ════ move the paper to the trash ════
  await page.goto(`${url}#/library`)
  await page.locator('.paper-row:visible', { hasText: '垃圾桶测试论文' }).first().click()
  await page.getByRole('heading', { name: '垃圾桶测试论文', level: 1 }).waitFor()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.waitForFunction(() => location.hash === '#/library')
  check(`${tag} 论文移进垃圾桶：论文库里没有了`, !(await libraryTitles()).some((t) => t.includes('垃圾桶测试论文')))
  await page.goto(`${url}#/boards`)
  await page.locator('.board-tile-main', { hasText: '共在研究' }).click()
  await page.locator('.node.card').first().waitFor()
  check(`${tag} 画板上的引用退回普通文字；研究卡片不受影响`, (await page.locator('a.cite').count()) === 0 && (await page.locator('.node.card', { hasText: '共在发现，见' }).count()) === 1)

  // ── the trash
  await toTrash()
  const items = await page.locator('.trash-item .trash-name').allInnerTexts()
  check(`${tag} 垃圾桶里：一块画板、一篇论文，标题上有件数`, items.includes('霉菌研究') && items.includes('垃圾桶测试论文') && (await page.getByRole('button', { name: /^垃圾桶/ }).innerText()).includes('2'))
  check(`${tag} 画板写着卡片数和原来的堆；论文写着理解数`, (await page.locator('.trash-item', { hasText: '霉菌研究' }).innerText()).includes('原在堆「专题」') && (await page.locator('.trash-item', { hasText: '垃圾桶测试论文' }).innerText()).includes('1 条理解'))
  check(`${tag} 只有“恢复”，没有永久删除`, (await page.locator('.trash-item button').allInnerTexts()).every((t) => t.trim() === '恢复'))
  await page.screenshot({ path: `${out}/${size.name}-trash.png`, fullPage: size.isMobile })

  // ════ re-import the same paper: a separate record; the one in the trash is untouched ════
  await paste(PAPER('第二份的总结'), 'paper')
  await page.getByText(/1 篇论文放进论文库/).waitFor()
  check(`${tag} 重新导入同一个 DOI：在论文库里建一条新的独立记录`, (await libraryTitles()).filter((t) => t.includes('垃圾桶测试论文')).length === 1)
  await toTrash()
  check(`${tag} 垃圾桶里的旧论文还在，原样`, (await page.locator('.trash-item', { hasText: '垃圾桶测试论文' }).innerText()).includes('1 条理解'))

  // ════ board: names a board in the trash ════
  await paste(RESEARCH('又一份', '霉菌研究', '想放进垃圾桶里的画板'))
  await page.getByText('Markdown 里写的画板「霉菌研究」在垃圾桶里，目前不能作为导入目标').waitFor()
  const choices = await page.locator('.trashed-board button').allInnerTexts()
  check(`${tag} board: 指向垃圾桶里的画板：只给“选择其他画板 / 新建画板 / 取消导入”，没有恢复`, choices.join(' ') === '放进选中的画板 新建画板 取消导入', choices.join(' '))
  check(`${tag} 回答之前什么都没存`, (await page.locator('.md-input').inputValue()).includes('想放进垃圾桶里的画板'))
  await page.locator('.trashed-board select').selectOption({ label: '共在研究' })
  await page.getByRole('button', { name: '放进选中的画板' }).click()
  await page.getByText('放进画板「共在研究」').waitFor()
  check(`${tag} 选其他画板后放进那块`, true)
  await toTrash()
  check(`${tag} 垃圾桶里的画板没有被恢复`, (await page.locator('.trash-name').allInnerTexts()).includes('霉菌研究'))

  // ════ restore ════
  await page.getByRole('button', { name: '恢复画板：霉菌研究' }).click()
  await page.getByRole('button', { name: '恢复论文：垃圾桶测试论文' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.trash-item').length === 0)
  await page.goto(`${url}#/boards`)
  await page.waitForTimeout(300)
  check(`${tag} 恢复后画板回到原来的堆`, (await page.locator('.pile-tile', { hasText: '专题' }).innerText()).includes('1 块画板') && !(await page.locator('.board-tile-name').allInnerTexts()).includes('霉菌研究'))
  await page.goto(`${url}${boardHash}`)
  await page.locator('.node.card').first().waitFor()
  await page.waitForTimeout(300)
  check(`${tag} 恢复后画板上的一切原样：卡片、位置都一样`, (await snapshot()) === before)

  const titles = await libraryTitles()
  const copies = titles.filter((t) => t.includes('垃圾桶测试论文'))
  check(`${tag} 两份同一篇论文共存，恢复的那份标【恢复】`, copies.length === 2 && copies.filter((t) => t.startsWith('【恢复】')).length === 1, copies.join(' | '))
  await page.locator('.paper-row:visible', { hasText: '【恢复】' }).first().click()
  await page.locator('.rail .comment', { hasText: '第一份的理解' }).waitFor()
  const lead = await page.locator('.oneliner').innerText()
  check(`${tag} 恢复的那份保留自己的理解和总结，没有被合并`, lead.includes('第一份的总结') && !lead.includes('第二份的总结'), lead)
  await page.goto(`${url}${boardHash}`)
  await page.locator('a.cite').first().waitFor()
  await page.locator('a.cite').first().click()
  await page.locator('.cite-pop').waitFor()
  check(`${tag} 两份共存时，引用链接到没被恢复过的那份`, await page.locator('.cite-pop').getByText('第二份的总结').isVisible())

  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
