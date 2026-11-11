// Walks global search in a headless browser at phone and iPad sizes, starting from the sample content.
// Usage: node scripts/smoke-search.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac to run one size)
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'

const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true },
  { name: 'ipad', width: 1366, height: 1024, isMobile: false },
  { name: 'mac', width: 1728, height: 1000, isMobile: false },
]

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
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const tag = `[${size.name}]`
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const month = Number(today.slice(5, 7))

  await page.goto(`${url}#/settings`)
  await page.getByRole('button', { name: '放入示例内容' }).click()
  await page.locator('.import-msg', { hasText: '生成了 6 张卡片' }).waitFor()

  // a pile, to check searching from inside one
  await page.goto(`${url}#/board`)
  await page.getByRole('button', { name: '新建堆' }).click()
  await page.getByLabel('堆的名字').fill('共在')
  await page.getByRole('button', { name: '建好' }).click()
  await page.locator('.pile-tile', { hasText: '共在' }).waitFor()

  // ── the search control is on every page
  const pages = ['#/', '#/board', `#/board/${today}`, `#/board/${today.slice(0, 4)}`, '#/library', '#/settings']
  let everywhere = true
  for (const hash of pages) {
    await page.goto(`${url}${hash}`)
    await page.waitForTimeout(250)
    if (!(await page.getByRole('button', { name: '搜索' }).isVisible())) everywhere = false
  }
  check(`${tag} 每个页面右上角都有搜索`, everywhere)

  const open = async () => {
    if (!(await page.locator('.search-panel').count())) await page.getByRole('button', { name: '搜索' }).click()
    await page.locator('.search-panel input').waitFor()
  }
  const search = async (text) => {
    await open()
    await page.locator('.search-panel input').fill(text)
    await page.waitForTimeout(250)
    return page.locator('.search-item').count()
  }
  const kinds = () => page.locator('.search-kind').allTextContents()

  await page.goto(`${url}#/board`)
  await open()
  check(`${tag} 打开后先看到怎么组合的说明`, await page.locator('.search-hint').isVisible())
  await page.screenshot({ path: `${out}/${size.name}-search-1-open.png` })

  check(`${tag} 只按类型：问题`, (await search('问题')) === 3 && (await kinds()).every((k) => k === '问题'))
  check(`${tag} 只按类型：论文`, (await search('论文')) === 2)
  check(`${tag} 重点类型名：研究方法`, (await search('研究方法')) === 1 && (await kinds())[0] === '研究方法')
  check(`${tag} 日期 + 类型：今天 问题`, (await search('今天 问题')) === 2)
  check(`${tag} 日期 + 类型：${month}月 论文`, (await search(`${month}月 论文`)) === 2)
  check(`${tag} 日期 + 类型 + 关键词`, (await search('今天 问题 问题二')) === 1)
  check(`${tag} 关键词能命中 keywords：关键词6`, (await search('关键词6 发现')) === 1)
  check(`${tag} 语音听写的说法：今天的问题`, (await search('今天的问题')) === 2)
  check(`${tag} 找不到时有说明`, (await search('不存在的词语')) === 0 && (await page.getByText(/没有找到/).isVisible()))

  check(`${tag} 关键词高亮片段`, (await search('材料')) === 1 && (await page.locator('.search-snippet mark').first().textContent()) === '材料')
  await page.screenshot({ path: `${out}/${size.name}-search-2-results.png` })

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  check(`${tag} 面板不超出屏幕`, !overflow)
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.search-panel a, .search-panel button, .search-panel input')]
      .map((el) => ({ t: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 10), r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44))
      .map((x) => `${x.t} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`),
  )
  check(`${tag} 搜索里可点元素 ≥ 44px`, small.length === 0, small.join(', '))

  // ── jump
  await search('今天 问题 问题二')
  await page.locator('.search-item a').click()
  await page.getByRole('heading', { name: `${month}/${Number(today.slice(8))}`, level: 1 }).waitFor()
  check(`${tag} 点结果跳到那一天的画板，面板自动关上`, (await page.locator('.search-panel').count()) === 0)

  await open()
  check(`${tag} 再打开还留着上次搜的内容`, (await page.locator('.search-panel input').inputValue()) === '今天 问题 问题二')
  await page.keyboard.press('Escape')
  check(`${tag} Esc 关上`, (await page.locator('.search-panel').count()) === 0)

  await search('论文 示例论文标题二')
  await page.locator('.search-item a').click()
  await page.getByRole('heading', { name: '示例论文标题二', level: 1 }).waitFor()
  check(`${tag} 点论文结果进论文页`, true)

  // ── into a pile
  await page.goto(`${url}#/board`)
  await page.locator('.shelf .pile-tile', { hasText: '共在' }).click()
  await page.getByRole('heading', { name: '共在', level: 1 }).waitFor()
  await search('论文 标题一')
  await page.getByRole('button', { name: /放进「共在」：示例论文标题一/ }).click()
  await page.getByText('已放进「共在」').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.node.papercard', { hasText: '示例论文标题一' }).waitFor()
  check(`${tag} 在堆里搜索，点 + 直接放进这个堆`, true)

  if (!size.isMobile) {
    await search('今天 思考')
    await page.locator('.search-item a').dragTo(page.locator('.canvas'), { targetPosition: { x: 300, y: 600 } })
    await page.locator('.node.card', { hasText: '思考：' }).waitFor()
    check(`${tag} 把搜索结果拖进堆`, true)
    await page.screenshot({ path: `${out}/${size.name}-search-3-pile.png` })
  }

  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
