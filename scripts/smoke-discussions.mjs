// Walks the discussion boxes at phone, iPad and Mac sizes, starting from the sample content.
// Usage: node scripts/smoke-discussions.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac)
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'
const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true },
  { name: 'ipad', width: 1366, height: 1024, isMobile: false, touch: true },
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
    hasTouch: size.isMobile || !!size.touch,
    deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  await ctx.route('https://api.crossref.org/**', (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(m.text()))
  const tag = `[${size.name}]`
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  // measured only after every entrance animation has finished
  const smallTargets = async (scope) => {
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      ).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))),
    )
    return measure(scope)
  }
  const measure = (scope) =>
    page.evaluate((sel) =>
      [...document.querySelectorAll(`${sel} a, ${sel} button, ${sel} input, ${sel} summary`)]
        .map((el) => ({ t: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 12), r: el.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44))
        .map((x) => `${x.t} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`), scope)
  const toastSays = (text) => page.locator('.toast', { hasText: text }).waitFor()

  await page.goto(`${url}#/settings`)
  await page.getByRole('button', { name: '放入示例内容' }).click()
  await page.locator('.status-line', { hasText: '生成了 6 张卡片' }).waitFor()

  // ── the entry in the top-right corner, on every page
  let everywhere = true
  for (const hash of ['#/', '#/boards', '#/time', '#/library', '#/settings']) {
    await page.goto(`${url}${hash}`)
    await page.waitForTimeout(200)
    if (!(await page.getByRole('link', { name: /^讨论框/ }).isVisible())) everywhere = false
  }
  check(`${tag} 每个页面右上角都有讨论框入口`, everywhere)

  // ── a read paper, with a box made on the spot
  await page.goto(`${url}#/library`)
  await page.locator('.paper-row:visible', { hasText: '示例论文标题一' }).first().click()
  await page.getByRole('heading', { name: '示例论文标题一', level: 1 }).waitFor()
  await page.getByRole('button', { name: '放进讨论框' }).click()
  await page.getByLabel('新建一个讨论框').fill('霉菌实验卡住了')
  await page.screenshot({ path: `${out}/${size.name}-disc-1-picker.png` })
  await page.getByRole('button', { name: '新建并放入' }).click()
  await toastSays('已放进「霉菌实验卡住了」')
  check(`${tag} 论文页：放进讨论框，当场新建一个`, true)
  check(`${tag} 入口上显示讨论框的数量`, (await page.locator('.box-badge').first().innerText()) === '1')

  await page.getByRole('button', { name: '放进讨论框' }).click()
  await page.getByRole('button', { name: /霉菌实验卡住了/ }).click()
  await toastSays('已经在「霉菌实验卡住了」里了')
  check(`${tag} 同一样东西在一个框里只出现一次`, true)

  // ── a "想看" paper
  await page.goto(`${url}#/library`)
  await page.getByRole('button', { name: /^想看/ }).first().click()
  await page.getByRole('button', { name: '添加论文' }).first().click()
  await page.getByLabel('标题', { exact: true }).fill('一篇想看的论文')
  await page.getByLabel('为什么想看（可以不填）').fill('想了解它的方法')
  await page.locator('.paper-form .seg').getByRole('button', { name: '想看', exact: true }).click()
  await page.getByRole('button', { name: '保存' }).click()
  await page.getByRole('button', { name: '放进讨论框：一篇想看的论文' }).first().click()
  await page.getByRole('button', { name: /霉菌实验卡住了/ }).click()
  await toastSays('已放进「霉菌实验卡住了」')
  check(`${tag} 想看的论文也能放进去`, true)

  // ── the box: only papers so far → the "papers" opening line
  await page.getByRole('link', { name: /^讨论框/ }).click()
  await page.locator('.box-row', { hasText: '霉菌实验卡住了' }).click()
  await page.getByRole('heading', { name: '霉菌实验卡住了', level: 1 }).waitFor()
  check(`${tag} 讨论框里列出 2 项`, (await page.locator('.box-item').count()) === 2)
  await page.getByRole('button', { name: '导出给 AI' }).click()
  await page.getByText('已复制到剪贴板').waitFor()
  let md = await page.evaluate(() => navigator.clipboard.readText())
  check(`${tag} 只有多篇论文：开头是“理清关系”`, md.startsWith('请先帮我理清这些论文之间的关系，再建议从哪篇开始读。'))
  check(`${tag} 导出里有想看的理由`, md.includes('- 为什么想看：想了解它的方法'))
  check(`${tag} 已读论文附上重点区块`, md.includes('**重点 · '))

  // ── a whole board (works on the phone too)
  await page.goto(`${url}#/boards`)
  await page.locator('.board-tile-main').first().click()
  await page.locator('.node.card').first().waitFor()
  await page.getByRole('button', { name: '把这块画板放进讨论框' }).click()
  await page.getByLabel('或者新建一个').fill('最近的进展')
  await page.getByRole('button', { name: '新建并放入' }).click()
  await toastSays('已放进「最近的进展」')
  check(`${tag} 整块画板放进一个新的讨论框`, true)

  // ── choosing several cards with the select tool
  {
    const cardsOnBoard = page.locator('.node.card')
    const first = await cardsOnBoard.first().boundingBox()
    const at = { x: first.x + first.width / 2, y: first.y + Math.min(first.height / 2, 40) }
    if (size.isMobile || size.touch) {
      // a finger held still on a card selects it and shows what can be done
      const client = await ctx.newCDPSession(page)
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y, id: 1 }] })
      await page.waitForTimeout(750)
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.locator('.sel-bar').waitFor()
      check(`${tag} 长按一张卡片：选中它并弹出操作栏`, (await page.locator('.node.is-selected').count()) === 1)
    } else {
      await page.mouse.click(at.x, at.y, { button: 'right' })
      await page.locator('.sel-bar').waitFor()
      check(`${tag} 右键一张卡片：选中它并弹出操作栏`, (await page.locator('.node.is-selected').count()) === 1)
    }
    const bar = page.locator('.sel-bar')
    check(`${tag} 操作栏里有：放进讨论框、导出、删除`, (await bar.getByRole('button', { name: '放进讨论框' }).isVisible()) && (await bar.getByRole('button', { name: '导出' }).isVisible()))
    if (!size.isMobile) {
      await cardsOnBoard.nth(1).click({ modifiers: ['Shift'], position: { x: 30, y: 30 } })
      await cardsOnBoard.nth(2).click({ modifiers: ['Shift'], position: { x: 30, y: 30 } })
      await page.getByText('已选 3 样').waitFor()
      await cardsOnBoard.nth(2).click({ modifiers: ['Shift'], position: { x: 30, y: 30 } })
      await page.getByText('已选 2 样').waitFor()
      check(`${tag} 按住 Shift 再点：加选、取消`, (await page.locator('.node.is-selected').count()) === 2)
      await page.screenshot({ path: `${out}/${size.name}-disc-2-pick.png` })
      await bar.getByRole('button', { name: '放进讨论框' }).click()
      await page.getByRole('button', { name: /霉菌实验卡住了/ }).click()
      await toastSays('已放进「霉菌实验卡住了」：2 项')
      check(`${tag} 选中的卡片一次放进讨论框`, true)
    } else {
      await bar.getByRole('button', { name: '放进讨论框' }).click()
      await page.getByRole('button', { name: /霉菌实验卡住了/ }).click()
      await toastSays('已放进「霉菌实验卡住了」')
      check(`${tag} 手机上也能把选中的卡片放进讨论框`, true)
    }
    await page.getByRole('button', { name: '完成' }).click()
  }

  // ── a whole pile
  await page.goto(`${url}#/boards`)
  await page.getByRole('button', { name: '新建堆' }).click()
  await page.getByLabel('堆的名字').fill('共在')
  await page.getByRole('button', { name: '建好' }).click()
  await page.locator('.pile-tile', { hasText: '共在' }).waitFor()
  await page.locator('.board-tile-move select').first().selectOption({ label: '共在' })
  await toastSays('已放进堆「共在」')
  await page.locator('.pile-tile', { hasText: '共在' }).click()
  await page.getByRole('heading', { name: '共在', level: 1 }).waitFor()
  await page.getByRole('button', { name: '整个堆放进讨论框' }).click()
  await page.getByRole('button', { name: /最近的进展/ }).click()
  await toastSays('已放进「最近的进展」')
  check(`${tag} 整个堆放进讨论框`, true)

  // ── the list, rename, remove one, export with research content
  await page.getByRole('link', { name: /^讨论框/ }).click()
  await page.locator('.box-row', { hasText: '1 块画板 · 1 个堆' }).waitFor()
  check(`${tag} 列表里有两个讨论框，各自写着里面有什么`, (await page.locator('.box-row').count()) === 2 && (await page.locator('.box-row', { hasText: '最近的进展' }).innerText()).includes('1 块画板 · 1 个堆'))
  check(`${tag} 列表：可点元素 ≥ 44px`, (await smallTargets('.page')).length === 0, (await smallTargets('.page')).join(', '))
  await page.screenshot({ path: `${out}/${size.name}-disc-3-list.png` })

  await page.locator('.box-row', { hasText: '最近的进展' }).click()
  await page.getByRole('button', { name: '改名：最近的进展' }).click()
  await page.getByLabel('讨论框的名字').fill('共在的理论框架')
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: '共在的理论框架', level: 1 }).waitFor()
  check(`${tag} 改名`, true)

  await page.getByRole('button', { name: '导出给 AI' }).click()
  await page.getByText('已复制到剪贴板').waitFor()
  md = await page.evaluate(() => navigator.clipboard.readText())
  check(`${tag} 含画板或堆：开头是“研究进展”`, md.startsWith('这是我最近的研究进展，请和我一起讨论。'))
  check(`${tag} 导出整块画板：名称、记录、卡片`, md.includes('## 画板：未命名画板') && md.includes('研究记录：') && md.includes('【问题】'))
  check(`${tag} 导出里有堆`, md.includes('## 堆：共在'))
  check(`${tag} 卡片里引用到的论文附在后面`, md.includes('## 上面提到的论文') && md.includes('示例论文标题'))
  check(`${tag} 末尾附两套模板`, md.includes('## 研究记录的模板') && md.includes('## 论文的模板'))
  check(`${tag} 详情：可点元素 ≥ 44px`, (await smallTargets('.page')).length === 0, (await smallTargets('.page')).join(', '))
  check(`${tag} 没有横向滚动`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.screenshot({ path: `${out}/${size.name}-disc-4-box.png`, fullPage: true })

  const before = await page.locator('.box-item').count()
  await page.getByRole('button', { name: /^移出讨论框：共在/ }).click()
  await page.waitForFunction((n) => document.querySelectorAll('.box-item').length === n - 1, before)
  check(`${tag} 移除单项`, true)

  // ── archive after exporting, and bring it back
  await page.getByRole('button', { name: '归档这个讨论框' }).click()
  await page.getByRole('heading', { name: '讨论框', level: 1 }).waitFor()
  check(`${tag} 归档后不在列表里，数量也减少`, (await page.locator('.box-row', { hasText: '共在的理论框架' }).count()) === 0 && (await page.locator('.box-badge').first().innerText()) === '1')
  await page.getByRole('button', { name: /已归档/ }).click()
  await page.getByRole('button', { name: '找回：共在的理论框架' }).click()
  await page.locator('.box-badge', { hasText: '2' }).first().waitFor()
  check(`${tag} 归档的可以找回`, (await page.locator('.box-list').first().locator('.box-row', { hasText: '共在的理论框架' }).count()) === 1)

  // ── the original is untouched by removing / deleting
  await page.locator('.box-row', { hasText: '霉菌实验卡住了' }).click()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: '删除这个讨论框' }).click()
  await page.getByRole('heading', { name: '讨论框', level: 1 }).waitFor()
  await page.goto(`${url}#/library`)
  await page.getByRole('button', { name: /^已读/ }).first().click()
  await page.locator('.paper-row:visible', { hasText: '示例论文标题一' }).first().waitFor()
  check(`${tag} 删除讨论框不影响原来的论文`, true)

  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
