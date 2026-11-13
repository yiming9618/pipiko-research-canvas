// Subject boards: the move from daily boards, the list and piles, choosing a board on import,
// hand-written cards. Phone, iPad and Mac sizes.
// Usage: node scripts/smoke-boards.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac)
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

// ── a notebook as it is before this update: daily boards, piles holding cards / papers / a pile
const T = '2026-11-10T10:00:00.000Z'
const rec = (id, date, title) => ({ id, date, title, summary: `${title}的摘要`, activities: ['讨论'], keywords: [], paper_dois: ['10.1/a'], preamble_md: '', import_id: `imp_${id}`, updated_at: T })
const card = (id, record, date, kind, body, order, extra = {}) => ({ id, record_id: record, date, kind, heading: kind, body_md: body, order, ...(record ? { import_id: `imp_${record}` } : {}), updated_at: T, ...extra })
const imp = (id, date) => ({ id: `imp_${id}`, kind: 'research', raw_md: `原文 ${id}`, raw_hash: `h${id}`, date, imported_at: `${date}T09:00:00.000Z`, notices: [], message: '', record_id: id, updated_at: T })
const bi = (id, board, extra) => ({ id, board_id: board, ref_type: 'text', ref_id: '', x: 0, y: 0, w: 260, h: 0, z: 1, updated_at: T, ...extra })
const LEGACY = {
  app: 'research-notebook',
  version: 1,
  exported_at: T,
  tables: {
    imports: [imp('r1', '2026-11-10'), imp('r2', '2026-11-10'), imp('r3', '2026-11-08')],
    papers: [{ id: 'pa', title: '旧论文', authors: ['Jane Smith'], year: 2024, venue: 'CHI', doi: '10.1/a', category: '霉菌', keywords: [], status: 'read', url: '', one_liner: '一句话', basics_md: '', created_at: T, updated_at: T }],
    blocks: [], types: [], comments: [],
    records: [rec('r1', '2026-11-10', '上午的记录'), rec('r2', '2026-11-10', '下午的记录'), rec('r3', '2026-11-08', '八号的记录')],
    cards: [
      card('c1', 'r1', '2026-11-10', '发现', '十号的发现', 0),
      card('c2', 'r1', '2026-11-10', '问题', '十号的问题', 1),
      card('c3', 'r2', '2026-11-10', '实验', '十号下午的实验', 0),
      card('c4', 'r3', '2026-11-08', '思考', '八号的思考', 0),
      card('h1', '', '2026-11-12', '下一步', '十二号手写的', 5),
    ],
    boardItems: [
      bi('moved', 'day:2026-11-10', { ref_type: 'card', ref_id: 'c1', x: 900, y: 420, w: 340, z: 3, text_override: '十号的发现（我改过）' }),
      bi('note', 'day:2026-11-10', { x: 900, y: 80, text_override: '画板上的自由文字' }),
      bi('pcard', 'pile:p1', { ref_type: 'card', ref_id: 'c2', x: 0, y: 0, w: 340 }),
      bi('ppaper', 'pile:p1', { ref_type: 'paper', ref_id: 'pa', x: 380, y: 0, w: 340 }),
      bi('psub', 'pile:p1', { ref_type: 'pile', ref_id: 'p2', x: 0, y: 260, w: 200 }),
      bi('p2text', 'pile:p2', { x: 0, y: 0, text_override: '子堆里的文字' }),
    ],
    connectors: [{ id: 'k1', board_id: 'day:2026-11-10', from: 'card:c2', to: 'card:c1', arrow: true, updated_at: T }],
    strokes: [{ id: 's1', board_id: 'day:2026-11-10', points: [900, 300, 0.5, 960, 320, 0.5, 1020, 300, 0.5], color: '#b4455c', size: 5, updated_at: T }],
    piles: [
      { id: 'p1', name: '共在', created_at: '2026-11-05T08:00:00.000Z', updated_at: T },
      { id: 'p2', name: '子堆', created_at: '2026-11-06T08:00:00.000Z', updated_at: T },
      { id: 'p3', name: '空的堆', created_at: '2026-11-07T08:00:00.000Z', updated_at: T },
    ],
    settings: [], assets: [], discussions: [], discussionItems: [],
  },
}
const research = (title, body, extra = '') => `---\ntype: research\ndate: 2026-11-20\ntitle: ${title}\n${extra}---\n## 发现\n${body}\n## 问题\n${body}的问题\n`

const browser = await chromium.launch()
let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}

for (const size of sizes.filter((x) => !process.env.ONLY || process.env.ONLY === x.name)) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.isMobile, hasTouch: size.isMobile, deviceScaleFactor: 2 })
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
  const toastSays = (text) => page.locator('.toast', { hasText: text }).waitFor()
  const names = () => page.locator('.board-tile-name').allInnerTexts()
  const openBoard = async (name) => {
    await page.goto(`${url}#/boards`)
    await page.locator('.board-tile-main', { hasText: name }).first().click()
    await page.getByRole('heading', { name, level: 1 }).waitFor()
  }
  /** Board positions of every node, read from the canvas (independent of zoom and pan). */
  const places = () =>
    page.locator('.node').evaluateAll((els) => Object.fromEntries(els.map((el) => [el.dataset.node, el.style.transform])))
  const paste = async (md, expect) => {
    await page.goto(url)
    await page.locator('.md-input').fill(md)
    return expect
  }

  // ════ 1. the move from daily boards ════
  await page.goto(`${url}#/settings`)
  await page.locator('input[type=file][accept*="json"]').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(LEGACY)) })
  await page.getByText(/已导入：补上或更新了/).waitFor()
  await page.getByRole('button', { name: '下载升级前的备份' }).waitFor()
  check(`${tag} 迁移前自动存了一份备份，设置里可以下载`, true)
  check(`${tag} 自检：没有找不到画板的内容`, (await page.getByText(/找不到所属的画板/).count()) === 0)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载升级前的备份' }).click()])
  const saved = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf-8'))
  check(`${tag} 备份里是迁移前的样子：5 张卡片、还没有画板`, saved.tables.cards.length === 5 && (saved.tables.boards ?? []).length === 0)

  await page.goto(`${url}#/boards`)
  await page.locator('.board-tile-main').first().waitFor()
  const outside = await names()
  check(`${tag} 每日画板变成主题画板，名字是日期`, ['2026/11/8', '2026/11/10', '2026/11/12'].every((n) => outside.includes(n)) && outside.length === 3, outside.join('、'))
  const pileTexts = await page.locator('.pile-tile').allInnerTexts()
  check(`${tag} 堆变成文件夹：共在 1 块、子堆 1 块、空的堆 0 块`, pileTexts.map((t) => t.replace(/\s+/g, ' ')).join(' | ') === '共在 1 块画板 | 子堆 1 块画板 | 空的堆 0 块画板', pileTexts.join('|'))
  check(`${tag} 画板列表：可点元素 ≥ 44px`, (await small('.page a, .page button, .page select')).length === 0, (await small('.page a, .page button, .page select')).join(', '))
  check(`${tag} 没有横向滚动`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.screenshot({ path: `${out}/${size.name}-boards-1-migrated.png`, fullPage: size.isMobile })

  await openBoard('2026/11/10')
  await page.locator('.node.card').first().waitFor()
  await page.waitForTimeout(400)
  check(`${tag} 十号的画板：两份记录、三张卡片都在`, (await page.locator('.node.cover').count()) === 2 && (await page.locator('.node.card').count()) === 3)
  const at = await places()
  check(`${tag} 我拖过的卡片还在原来的位置`, at['card:c1'] === 'translate(900px, 420px)', at['card:c1'])
  check(`${tag} 改过的文字还在，标着“改过”`, await page.locator('.node.card', { hasText: '十号的发现（我改过）' }).locator('.block-edited').isVisible())
  check(`${tag} 自由文字还在原位`, at['item:note'] === 'translate(900px, 80px)')
  check(`${tag} 连线和笔迹都还在`, (await page.locator('path.link-line').count()) === 1 && (await page.evaluate(() => document.querySelectorAll('.ink path, svg path[fill="#b4455c"]').length)) >= 1)
  check(`${tag} 卡片上显示自己的日期`, (await page.locator('.node.card .card-date').first().innerText()) === '11/10')
  await page.screenshot({ path: `${out}/${size.name}-boards-2-day-board.png` })

  await page.goto(`${url}#/boards`)
  await page.locator('.pile-tile', { hasText: '共在' }).click()
  await page.getByRole('heading', { name: '共在', level: 1 }).waitFor()
  check(`${tag} 堆里是一块同名的画板`, (await names()).join() === '共在')
  await page.locator('.board-tile-main').click()
  await page.locator('.node.card').waitFor()
  check(`${tag} 原来堆里的卡片是引用，写着来自哪块画板`, await page.locator('.node.card .card-source', { hasText: '2026/11/10' }).isVisible())
  check(`${tag} 原来堆里的论文还在`, await page.locator('.node.papercard', { hasText: '旧论文' }).isVisible())
  await page.locator('.node.subpile a').click()
  await page.getByRole('heading', { name: '子堆', level: 1 }).waitFor()
  check(`${tag} 原来堆里的子堆：留着一个链接，点了去那个堆`, (await names()).join() === '子堆')

  await page.reload()
  await page.goto(`${url}#/boards`)
  await page.locator('.board-tile-main').first().waitFor()
  check(`${tag} 再打开一次，不会多出重复的画板`, (await names()).length === 3 && (await page.locator('.pile-tile').count()) === 3)
  await page.goto(`${url}#/board/2026-11-10`)
  await page.getByRole('heading', { name: '2026/11/10', level: 1 }).waitFor()
  check(`${tag} 以前按日期的网址仍然能打开那块画板`, true)

  // ════ 2. the list: new, rename, sort, piles ════
  await page.goto(`${url}#/boards`)
  await page.getByRole('button', { name: '新建画板' }).click()
  await page.getByLabel(/画板的名字/).fill('霉菌研究')
  await page.getByRole('button', { name: '建好' }).click()
  await page.getByRole('heading', { name: '霉菌研究', level: 1 }).waitFor()
  await page.getByText('这块画板还是空白的').waitFor()
  check(`${tag} 新建画板并打开，是空白的`, true)

  await page.getByRole('button', { name: '改名：霉菌研究' }).click()
  await page.getByLabel('画板的名字').fill('霉菌实验记录')
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: '霉菌实验记录', level: 1 }).waitFor()
  check(`${tag} 画板改名`, true)

  await page.goto(`${url}#/boards`)
  await page.locator('.board-tile-main').first().waitFor()
  check(`${tag} 默认按最近使用排：刚用过的在最前`, (await names())[0] === '霉菌实验记录', (await names()).join('、'))
  await page.getByRole('button', { name: '创建日期' }).click()
  check(`${tag} 按创建日期排：新建的在前，其余按那天的日期`, (await names()).join('、') === '霉菌实验记录、2026/11/12、2026/11/10、2026/11/8', (await names()).join('、'))
  await page.reload()
  await page.locator('.board-tile-main').first().waitFor()
  check(`${tag} 记住上次的排序方式`, (await page.getByRole('button', { name: '创建日期' }).getAttribute('aria-pressed')) === 'true')
  await page.getByRole('button', { name: '最近使用' }).click()

  await page.getByRole('button', { name: '新建堆' }).click()
  await page.getByLabel('堆的名字').fill('霉菌')
  await page.getByRole('button', { name: '建好' }).click()
  await page.locator('.pile-tile', { hasText: '霉菌' }).waitFor()
  await page.locator('.board-tile', { hasText: '霉菌实验记录' }).locator('select').selectOption({ label: '霉菌' })
  await toastSays('已放进堆「霉菌」')
  check(`${tag} 用“放进堆…”把画板放进堆，它从外层消失`, !(await names()).includes('霉菌实验记录'))
  if (wide) {
    await page.locator('.board-tile-main', { hasText: '2026/11/8' }).dragTo(page.locator('.pile-tile', { hasText: '霉菌' }))
    await toastSays('「2026/11/8」已放进堆「霉菌」')
    check(`${tag} 把画板拖到堆上也可以`, !(await names()).includes('2026/11/8'))
  } else {
    await page.locator('.board-tile', { hasText: '2026/11/8' }).locator('select').selectOption({ label: '霉菌' })
    await toastSays('已放进堆「霉菌」')
  }
  await page.locator('.pile-tile', { hasText: /^霉菌/ }).click()
  await page.getByRole('heading', { name: '霉菌', level: 1 }).waitFor()
  check(`${tag} 堆里有两块画板`, (await names()).length === 2)
  check(`${tag} 堆页面：可点元素 ≥ 44px`, (await small('.page a, .page button, .page select')).length === 0, (await small('.page a, .page button, .page select')).join(', '))
  await page.screenshot({ path: `${out}/${size.name}-boards-3-pile.png` })

  await page.getByRole('button', { name: '改名：霉菌' }).click()
  await page.getByLabel('堆的名字').fill('霉菌相关')
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: '霉菌相关', level: 1 }).waitFor()
  check(`${tag} 堆改名`, true)
  await page.locator('.board-tile', { hasText: '2026/11/8' }).locator('select').selectOption('__out')
  await toastSays('已移出堆')
  check(`${tag} 把画板移出堆`, (await names()).join() === '霉菌实验记录')
  await page.locator('.board-tile-main', { hasText: '霉菌实验记录' }).click()
  await page.getByRole('link', { name: '回到画板列表' }).click()
  await page.getByRole('heading', { name: '霉菌相关', level: 1 }).waitFor()
  check(`${tag} 从堆里的画板返回，回到这个堆`, true)

  let confirmText = ''
  page.once('dialog', (d) => {
    confirmText = d.message()
    void d.accept()
  })
  await page.getByRole('button', { name: '删除这个堆' }).click()
  await page.getByRole('heading', { name: '画板', level: 1 }).waitFor()
  await page.locator('.board-tile-main').first().waitFor()
  check(`${tag} 删除堆前说明画板不会被删`, confirmText.includes('1 块画板不会被删除'), confirmText)
  check(`${tag} 删除堆后，里面的画板回到外层`, (await names()).includes('霉菌实验记录') && (await page.locator('.pile-tile', { hasText: '霉菌相关' }).count()) === 0)

  // ════ 3. importing onto a board ════
  await page.goto(url)
  const chooser = page.getByLabel('放到哪块画板')
  await page.waitForFunction(() => document.querySelector('.panel-board select')?.selectedOptions[0]?.textContent.includes('（最近使用）'))
  check(`${tag} 粘贴面板默认选最近使用的画板`, (await chooser.locator('option:checked').innerText()) === '霉菌实验记录（最近使用）', await chooser.locator('option:checked').innerText())
  await chooser.selectOption({ label: '2026/11/10' })
  await page.locator('.md-input').fill(research('放进十号画板的', '新导入的内容'))
  await page.getByRole('button', { name: '放进去' }).click()
  await page.getByText('生成了 2 张卡片，放进画板「2026/11/10」').waitFor()
  await page.getByRole('link', { name: '去看看' }).click()
  await page.locator('.node.cover', { hasText: '放进十号画板的' }).waitFor()
  await page.waitForTimeout(400)
  const after = await places()
  const unmoved = Object.keys(at).every((k) => after[k] === at[k])
  check(`${tag} 新内容进了选的画板，我摆好的东西一个都没动`, unmoved, Object.keys(at).filter((k) => after[k] !== at[k]).join(', '))
  const boxes = await page.locator('.node').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.left, r.top, r.right, r.bottom]))
  const overlaps = boxes.filter((a, i) => boxes.some((b, j) => j > i && a[0] < b[2] - 2 && b[0] < a[2] - 2 && a[1] < b[3] - 2 && b[1] < a[3] - 2)).length
  check(`${tag} 新内容放在现有内容右侧的空白处，没有压到任何东西`, overlaps === 0, `${overlaps} 处重叠`)
  check(`${tag} 新卡片带着 Markdown 里的日期`, (await page.locator('.node.card', { hasText: '新导入的内容的问题' }).locator('.card-date').innerText()) === '11/20')
  await page.screenshot({ path: `${out}/${size.name}-boards-4-imported.png` })

  await page.goto(url)
  await chooser.selectOption({ label: '2026/11/12' })
  await page.locator('.md-input').fill(research('写了 board 的', '写明画板的内容', 'board: 霉菌实验记录\n'))
  await page.getByRole('button', { name: '放进去' }).click()
  await page.getByText('放进画板「霉菌实验记录」').waitFor()
  check(`${tag} Markdown 里写了 board：以它为准，优先于面板上的选择`, true)

  await page.locator('.md-input').fill(research('对不上的', '名字对不上的内容', 'board: 霉菌实验\n'))
  await page.getByRole('button', { name: '放进去' }).click()
  await page.getByText('还没有叫「霉菌实验」的画板').waitFor()
  check(`${tag} board 对不上：先问我，列出相近的画板`, (await page.getByRole('button', { name: '放进「霉菌实验记录」' }).isVisible()) && (await page.getByRole('button', { name: '新建「霉菌实验」' }).isVisible()))
  check(`${tag} 回答之前什么都没存`, (await page.locator('.md-input').inputValue()).includes('名字对不上的内容'))
  check(`${tag} 询问里的按钮 ≥ 44px`, (await small('.result button')).length === 0, (await small('.result button')).join(', '))
  await page.screenshot({ path: `${out}/${size.name}-boards-5-ask.png` })
  await page.getByRole('button', { name: '放进「霉菌实验记录」' }).click()
  await page.getByText('生成了 2 张卡片，放进画板「霉菌实验记录」').waitFor()
  check(`${tag} 我选了相近的那块：放进去`, true)

  await page.locator('.md-input').fill(research('要新建的', '放进新建画板的内容', 'board: 共在的理论框架\n'))
  await page.getByRole('button', { name: '放进去' }).click()
  await page.getByRole('button', { name: '新建「共在的理论框架」' }).click()
  await page.getByText('放进新画板「共在的理论框架」').waitFor()
  check(`${tag} 我选了新建：建好并放进去`, true)

  await openBoard('霉菌实验记录')
  await page.locator('.node.cover').first().waitFor()
  await page.waitForTimeout(400)
  const b2 = await page.locator('.node').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.left, r.top, r.right, r.bottom]))
  const o2 = b2.filter((a, i) => b2.some((b, j) => j > i && a[0] < b[2] - 2 && b[0] < a[2] - 2 && a[1] < b[3] - 2 && b[1] < a[3] - 2)).length
  check(`${tag} 同一块画板先后导入两份：左右排开，不重叠`, (await page.locator('.node.cover').count()) === 2 && o2 === 0, `${o2} 处重叠`)

  // ════ 4. hand-written cards on a subject board ════
  await page.getByRole('button', { name: '加卡片' }).click()
  await page.locator('.card-dialog').getByRole('button', { name: '思考', exact: true }).click()
  await page.getByLabel('卡片内容').fill('手写的思考')
  check(`${tag} 手写卡片的日期默认是今天，可以改`, (await page.getByLabel('日期').inputValue()).length === 10)
  await page.getByLabel('日期').fill('2026-10-05')
  await page.getByRole('button', { name: '放到画板上' }).click()
  const mine = page.locator('.node.card', { hasText: '手写的思考' })
  await mine.waitFor()
  check(`${tag} 手写卡片显示我填的日期`, (await mine.locator('.card-date').innerText()) === '10/5')

  if (wide) {
    await page.getByRole('button', { name: '编排' }).click()
    await mine.click({ position: { x: 20, y: 12 } })
    await page.getByRole('button', { name: '日期和类型' }).click()
  } else {
    await mine.click({ position: { x: 30, y: 30 } })
  }
  await page.getByRole('heading', { name: '改这张卡片' }).waitFor()
  await page.getByLabel('日期').fill('2026-10-06')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.node.card')].some((n) => n.textContent.includes('手写的思考') && n.textContent.includes('10/6')))
  check(`${tag} 之后还能改手写卡片的日期`, true)
  if (wide) await page.getByRole('button', { name: '完成' }).click()

  // an older hand-written card keeps its board when its date changes
  await openBoard('2026/11/12')
  const old = page.locator('.node.card', { hasText: '十二号手写的' })
  await old.waitFor()
  if (wide) {
    await page.getByRole('button', { name: '编排' }).click()
    await old.click({ position: { x: 20, y: 12 } })
    await page.getByRole('button', { name: '日期和类型' }).click()
  } else {
    await old.click({ position: { x: 30, y: 30 } })
  }
  await page.getByLabel('日期').fill('2026-12-25')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.node.card')].some((n) => n.textContent.includes('十二号手写的') && n.textContent.includes('12/25')))
  await page.reload()
  await page.locator('.node.card', { hasText: '十二号手写的' }).waitFor()
  check(`${tag} 迁移来的手写卡片改了日期，仍在原来那块画板上`, true)

  // ════ 5. deleting a board ════
  await openBoard('共在的理论框架')
  await page.locator('.node.card').first().waitFor()
  if (wide) {
    await page.getByRole('button', { name: '编排' }).click()
    let msg = ''
    page.once('dialog', (d) => {
      msg = d.message()
      void d.accept()
    })
    await page.getByRole('button', { name: '移到垃圾桶' }).click()
    await page.getByRole('heading', { name: '画板', level: 1 }).waitFor()
    await page.locator('.board-tile-main').first().waitFor()
    check(`${tag} 删除画板前确认，并说明会一起删掉什么`, msg.includes('2 张卡片') && msg.includes('论文库里的论文不受影响'), msg)
    check(`${tag} 画板删除后不在列表里`, !(await names()).includes('共在的理论框架'))
    await page.goto(`${url}#/time/2026-11-20`)
    await page.locator('.day-card').first().waitFor()
    check(`${tag} 它的卡片也从时间视图里消失`, (await page.locator('.day-card', { hasText: '放进新建画板的内容' }).count()) === 0)
  }

  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
