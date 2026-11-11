// Walks piles in a headless browser at phone and iPad sizes, starting from the sample content.
// Usage: node scripts/smoke-piles.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac to run one size)
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
  page.on('dialog', (d) => d.accept())
  const tag = `[${size.name}]`
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

  // ── sample content
  await page.goto(`${url}#/settings`)
  await page.getByRole('button', { name: '放入示例内容' }).click()
  await page.locator('.import-msg', { hasText: '生成了 6 张卡片' }).waitFor()
  check(`${tag} 一键放入示例内容（2 篇论文 + 2 份记录）`, (await page.locator('.import-item').count()) === 4)
  await page.getByRole('button', { name: '放入示例内容' }).click()
  await page.locator('.status-line', { hasText: '已经导入过' }).waitFor()
  check(`${tag} 再点一次不会重复放入`, (await page.locator('.import-item').count()) === 4)

  // ── shelf: create two piles
  await page.goto(`${url}#/board`)
  await page.getByRole('heading', { name: '我的堆' }).waitFor()
  for (const name of ['共在', 'Bio-HCI']) {
    await page.getByRole('button', { name: '新建堆' }).click()
    await page.getByLabel('堆的名字').fill(name)
    await page.getByRole('button', { name: '建好' }).click()
    await page.locator('.pile-tile', { hasText: name }).waitFor()
  }
  check(`${tag} 新建两个堆`, (await page.locator('.shelf .pile-tile').count()) === 2)

  // ── a paper into a pile, from the paper page
  await page.goto(`${url}#/library`)
  await page.locator('.paper-row', { hasText: '示例论文标题一' }).click()
  await page.getByRole('heading', { name: '示例论文标题一', level: 1 }).waitFor()
  await page.locator('.paper-foot .add-to-pile select').selectOption({ label: '共在' })
  await page.getByText('已放进「共在」').waitFor()
  await page.locator('.paper-foot .add-to-pile select').selectOption({ label: '共在' })
  await page.getByText('「共在」里已经有它了').waitFor()
  check(`${tag} 论文页"放进堆"，重复放会提示`, true)

  if (!size.isMobile) {
    // ── cards into a pile, from the day board
    await page.goto(`${url}#/board/${today}`)
    await page.locator('.node.card').first().waitFor()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: '编排' }).click()
    const card = page.locator('.node.card', { hasText: '问题一' })
    await card.click()
    await page.locator('.dock').waitFor()
    await page.locator('.dock').getByRole('button', { name: '共在' }).click()
    await page.getByText('已放进「共在」').waitFor()
    check(`${tag} 选中卡片 → 点堆的名字 → 放进去`, true)

    // drag a card onto a pile chip: it lands in the pile and returns to its place
    const second = page.locator('.node.card', { hasText: '思考：' })
    const b0 = await second.boundingBox()
    const chip = await page.locator('.dock').getByRole('button', { name: 'Bio-HCI' }).boundingBox()
    await page.mouse.move(b0.x + 40, b0.y + 20)
    await page.mouse.down()
    await page.mouse.move(b0.x + 80, b0.y - 40, { steps: 4 })
    await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2, { steps: 8 })
    const lit = await page.locator('.dock .chip.is-over').count()
    await page.mouse.up()
    await page.getByText('已放进「Bio-HCI」').waitFor()
    await page.waitForTimeout(300)
    const b1 = await second.boundingBox()
    check(`${tag} 把卡片拖到堆上 → 放进去，拖的时候堆会亮`, lit === 1)
    check(`${tag} 卡片本身留在原位（放进去的是引用）`, Math.abs(b1.x - b0.x) < 2 && Math.abs(b1.y - b0.y) < 2)
    await page.screenshot({ path: `${out}/${size.name}-pile-1-dock.png` })

    // new pile straight from the dock
    await page.locator('.dock').getByRole('button', { name: '新的堆' }).click()
    await page.getByText('已放进「新的堆」').waitFor()
    check(`${tag} 直接放进一个新的堆`, true)
    await page.getByRole('button', { name: '完成' }).click()
  }

  // ── the pile itself
  await page.goto(`${url}#/board`)
  const tile = page.locator('.shelf .pile-tile', { hasText: '共在' })
  await tile.waitFor()
  const expected = size.isMobile ? '1 张' : '2 张'
  check(`${tag} 堆上显示数量`, await tile.getByText(expected, { exact: true }).isVisible(), expected)
  await page.screenshot({ path: `${out}/${size.name}-pile-2-shelf.png`, fullPage: size.isMobile })
  await tile.click()
  await page.getByRole('heading', { name: '共在', level: 1 }).waitFor()
  await page.locator('.node.papercard').waitFor()
  await page.waitForTimeout(400)
  check(`${tag} 打开堆：里面是论文卡${size.isMobile ? '' : '和研究卡'}`, (await page.locator('.node.card').count()) === (size.isMobile ? 0 : 1))
  if (!size.isMobile) {
    check(`${tag} 研究卡标出来自哪一天，可以点回去`, await page.locator('.node.card .card-source').isVisible())
  }

  if (size.isMobile) {
    check(`${tag} 手机上堆也是只看不编辑`, (await page.getByRole('button', { name: '编排' }).count()) === 0)
    await page.locator('.node.papercard a').click()
    await page.getByRole('heading', { name: '示例论文标题一', level: 1 }).waitFor()
    check(`${tag} 点堆里的论文卡进论文页`, true)
  } else {
    // drag a paper in from the side list
    await page.locator('.board-side .paper-row', { hasText: '示例论文标题二' }).dragTo(page.locator('.canvas'), {
      targetPosition: { x: 500, y: 500 },
    })
    await page.locator('.node.papercard', { hasText: '示例论文标题二' }).waitFor()
    check(`${tag} 从左边把论文拖进堆`, true)

    // a pile inside a pile, and no circles
    await page.getByRole('button', { name: '编排' }).click()
    await page.locator('.pile-tools select').selectOption({ label: 'Bio-HCI' })
    await page.getByText('已放进「Bio-HCI」').waitFor()
    await page.goto(`${url}#/board`)
    await page.locator('.shelf .pile-tile', { hasText: 'Bio-HCI' }).click()
    await page.getByRole('heading', { name: 'Bio-HCI', level: 1 }).waitFor()
    await page.locator('.node.subpile', { hasText: '共在' }).waitFor()
    const nested = await page.locator('.board-state', { hasText: '1 张 · 1 个子堆' }).waitFor({ timeout: 5000 }).then(() => true, () => false)
    check(`${tag} 堆里再放堆`, nested, nested ? '' : await page.locator('.board-state').textContent())
    await page.getByRole('button', { name: '编排' }).click()
    await page.locator('.pile-tools select').selectOption({ label: '共在' })
    await page.getByText(/会绕成一圈/).waitFor()
    check(`${tag} 不能绕成一圈（共在已在 Bio-HCI 里，Bio-HCI 不能再放进共在）`, true)
    await page.screenshot({ path: `${out}/${size.name}-pile-3-nested.png` })
    await page.getByRole('button', { name: '完成' }).click()
    await page.locator('.node.subpile a').click()
    await page.getByRole('heading', { name: '共在', level: 1 }).waitFor()
    check(`${tag} 点子堆进入它`, true)
    await page.locator('.node.card').waitFor()
    await page.waitForTimeout(400)

    // arrange inside the pile, then take a card out: the original stays
    await page.getByRole('button', { name: '编排' }).click()
    const inPile = page.locator('.node.card')
    const p0 = await inPile.boundingBox()
    await page.mouse.move(p0.x + 30, p0.y + 16)
    await page.mouse.down()
    await page.mouse.move(p0.x + 110, p0.y + 136, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const p1 = await inPile.boundingBox()
    check(`${tag} 堆里可以自由拖动`, Math.abs(p1.x - p0.x - 80) < 3 && Math.abs(p1.y - p0.y - 120) < 3)
    await page.getByRole('button', { name: '移出这个堆' }).click()
    await page.locator('.node.card').waitFor({ state: 'detached' })
    await page.goto(`${url}#/board/${today}`)
    await page.locator('.node.card', { hasText: '问题一' }).waitFor()
    check(`${tag} 从堆里移出，原来那天的卡片还在`, true)

    // rename, then delete the pile: the paper stays in the library
    await page.goto(`${url}#/board`)
    await page.locator('.shelf .pile-tile', { hasText: '共在' }).click()
    await page.getByRole('button', { name: '改名：共在' }).click()
    await page.getByLabel('堆的名字').fill('共在与在场')
    await page.getByLabel('堆的名字').press('Enter')
    await page.getByRole('heading', { name: '共在与在场', level: 1 }).waitFor()
    check(`${tag} 点名字改名`, true)
    await page.getByRole('button', { name: '编排' }).click()
    await page.getByRole('button', { name: '删除这个堆' }).click()
    await page.getByRole('heading', { name: '我的堆' }).waitFor()
    check(`${tag} 删除堆后回到画板，架子上少一个`, (await page.locator('.shelf .pile-tile', { hasText: '共在' }).count()) === 0)
    await page.locator('.shelf .pile-tile', { hasText: 'Bio-HCI' }).click()
    await page.locator('.node.card').waitFor()
    check(`${tag} 别的堆里不再留着被删的子堆`, (await page.locator('.node.subpile').count()) === 0 && (await page.locator('.node.ghost').count()) === 0)
    await page.goto(`${url}#/library`)
    await page.locator('.paper-row').first().waitFor()
    check(`${tag} 论文库里的论文不受影响`, (await page.locator('.paper-row').count()) === 2)
  }

  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.shelf a, .shelf button, .dock button, .board-head a, .board-head button, .add-to-pile select')]
      .map((el) => ({ t: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 10), r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44))
      .map((x) => `${x.t} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`),
  )
  check(`${tag} 可点元素 ≥ 44px`, small.length === 0, small.join(', '))
  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
