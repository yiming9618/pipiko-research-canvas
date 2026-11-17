// Readings of a paper (第 N 次阅读): importing the same paper again, choosing where an import goes,
// folding, the notes rail per reading, a reading made by hand, its title, removing an empty one,
// the export grouped by reading; and making / renaming / removing highlight types in Settings.
// Usage: node scripts/smoke-readings.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac)
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'
const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true },
  { name: 'ipad', width: 1366, height: 1024, isMobile: false, touch: true },
  { name: 'mac', width: 1728, height: 1000, isMobile: false },
]
const paper = (date, extra, body) =>
  `---\ntype: paper\ntitle: 阅读次数测试论文\nauthors: 作者甲\nyear: 2024\ndoi: 10.1/times\ncategory: 霉菌\ndate: ${date}\n${extra}---\n${body}`
const FIRST = paper('2026-11-05', 'reading_title: 原文精读\n', '## 一句话总结\n总结\n## 基础\n1. 在什么领域：第一次写的基础\n## 重点：研究方法\n第一次的方法\n## 我的理解\n第一次的 AI 理解\n')
const SECOND = paper('2026-11-12', '', '## 基础\n1. 在什么领域：第二次写的基础\n## 重点：研究结果/发现\n第二次的结果\n## 我的理解\n第二次的 AI 理解\n')
const THIRD = paper('2026-11-15', '', '## 重点：研究动机 & RQ\n第三次补充的动机\n')

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
  const tap = async (loc) => (size.isMobile || size.touch ? loc.tap() : loc.click())
  const importText = async (text) => {
    await page.goto(url)
    await page.locator('.md-input').fill(text)
    await page.getByRole('button', { name: '放进去' }).click()
    await page.locator('.result-text').first().waitFor()
    return page.locator('.result-text').first().innerText()
  }
  const readings = page.locator('section.reading')
  const heads = page.locator('.reading-toggle')
  const openPaper = async () => {
    await page.goto(`${url}#/library`)
    await page.locator('.paper-row:visible', { hasText: '阅读次数测试论文' }).first().click()
    await page.getByRole('heading', { name: '阅读次数测试论文', level: 1 }).waitFor()
  }
  const count = async (loc, n) => {
    await page.waitForFunction(([sel, k]) => document.querySelectorAll(sel).length === k, ['.reading-toggle', n], { timeout: 3000 }).catch(() => undefined)
    return loc.count()
  }
  const big = async (loc) => {
    await settled(page)
    const b = await loc.boundingBox()
    return b && b.height >= 44
  }

  // ════ 1. first import: one reading, with the title from reading_title ════
  await importText(FIRST)
  check(`${tag} 第一次导入：结果里没有“放到哪次阅读”的选择（只有一次）`, (await page.locator('.reading-choice').count()) === 0)
  await openPaper()
  check(`${tag} 一次阅读：第 1 次阅读｜原文精读｜2026-11-05`, (await heads.count()) === 1 && (await heads.first().innerText()).replace(/\s/g, '') === '第1次阅读｜原文精读｜2026-11-05', await heads.first().innerText())

  // ════ 2. the same DOI again: a new reading by default; basics are not overwritten ════
  const msg2 = await importText(SECOND)
  check(`${tag} 同一个 DOI 再导入：合并到同一篇，基础已有就不覆盖`, msg2.includes('1 篇论文已合并') && msg2.includes('基础部分已有内容，没有覆盖'), msg2)
  const choice = page.locator('.reading-choice select')
  await choice.waitFor()
  check(`${tag} 结果里可以选放到哪里，默认“新的一次阅读”`, (await choice.inputValue()) === '' && (await choice.locator('option').allInnerTexts()).some((t) => t.includes('添加到 第 1 次阅读｜原文精读')))
  check(`${tag} 选择框 ≥ 44px`, await big(choice))
  await openPaper()
  check(`${tag} 两次阅读，按日期编号`, (await count(heads, 2)) === 2 && (await heads.nth(1).innerText()).includes('第 2 次阅读'))
  check(`${tag} 默认只展开最新的一次`, (await heads.nth(0).getAttribute('aria-expanded')) === 'false' && (await heads.nth(1).getAttribute('aria-expanded')) === 'true')
  check(`${tag} 基础还是第一次写的`, (await page.locator('.basics').textContent()).includes('第一次写的基础') && !(await page.locator('.basics').textContent()).includes('第二次'))
  check(`${tag} 折起来的那次显示有多少内容`, (await heads.nth(0).innerText()).includes('1 个重点'), await heads.nth(0).innerText())
  const rail = page.locator('.rail')
  const railText = await rail.innerText()
  check(`${tag} 右侧理解栏只显示当前这次（第 2 次）的理解`, railText.includes('第二次的 AI 理解') && !railText.includes('第一次的 AI 理解') && railText.includes('第 2 次阅读'), railText.replace(/\s+/g, ' ').slice(0, 120))

  // ════ 3. a third import, added to the first reading ════
  await importText(THIRD)
  await page.locator('.reading-choice select').selectOption({ label: '添加到 第 1 次阅读｜原文精读｜2026-11-05' })
  await page.waitForTimeout(300)
  check(`${tag} 改选“添加到第 1 次阅读”后，选择保持住`, (await page.locator('.reading-choice select').inputValue()) !== '')
  await openPaper()
  check(`${tag} 添加到已有的阅读：仍是两次`, (await count(heads, 2)) === 2, (await heads.allInnerTexts()).map((t) => t.replace(/\s+/g, '')).join(' / '))
  await tap(heads.nth(0))
  const r1 = readings.nth(0)
  check(`${tag} 第 1 次阅读里有原来的和后来补充的重点`, (await r1.innerText()).includes('第一次的方法') && (await r1.innerText()).includes('第三次补充的动机'))
  check(`${tag} 展开第 1 次后，理解栏换成第 1 次`, (await rail.locator('.rail-reading').innerText()).startsWith('第 1 次阅读') && (await rail.innerText()).includes('第一次的 AI 理解'))

  // ════ 4. a card in a reading: its notes; a new note goes to the card and the reading ════
  const card = r1.locator('section.block', { hasText: '第一次的方法' })
  await tap(card.locator('.editable p').first())
  await rail.locator('textarea').fill('关于第一次方法的理解')
  await rail.getByRole('button', { name: '加上' }).click()
  await page.waitForTimeout(200)
  check(`${tag} 选中卡片：理解栏只看这张卡片，新写的关联到它`, (await rail.innerText()).includes('只看「研究方法」') && (await rail.locator('.comment').count()) === 1)
  await rail.getByRole('button', { name: '看全部' }).click()
  const total = (await rail.locator('.rail-day-head .group-count').allInnerTexts()).reduce((n, t) => n + parseInt(t, 10), 0)
  check(`${tag} 不选卡片：显示这次阅读的全部理解（按日期分组）`, total === 2, `${total} 条`)

  // ════ 5. a reading made by hand, its title; what is added goes into it ════
  const addReading = page.getByRole('button', { name: '新的一次阅读' })
  check(`${tag} “+ 新的一次阅读”按钮 ≥ 44px`, await big(addReading))
  await tap(addReading)
  await page.waitForTimeout(200)
  check(`${tag} 新建了第 3 次阅读，展开，理解栏换到它`, (await heads.count()) === 3 && (await heads.nth(2).getAttribute('aria-expanded')) === 'true' && (await rail.locator('.rail-reading').innerText()).startsWith('第 3 次阅读'))
  const r3 = readings.nth(2)
  const nameBtn = r3.getByRole('button', { name: '加小标题' })
  check(`${tag} “加小标题” ≥ 44px`, await big(nameBtn))
  await tap(nameBtn)
  await r3.locator('input[name="title"]').fill('Paper Sharing 反馈')
  await r3.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(200)
  check(`${tag} 小标题显示在标题行`, (await heads.nth(2).innerText()).includes('｜Paper Sharing 反馈'))
  await r3.getByRole('button', { name: '加一个重点' }).click()
  await r3.locator('.add-form textarea').fill('分享时得到的反馈')
  await r3.getByRole('button', { name: '保存' }).click()
  await rail.locator('textarea').fill('分享后的理解')
  await rail.getByRole('button', { name: '加上' }).click()
  await page.waitForTimeout(200)
  check(`${tag} 手动加的重点和理解进了当前这次`, (await r3.innerText()).includes('分享时得到的反馈') && (await rail.innerText()).includes('分享后的理解') && (await rail.locator('.comment').count()) === 1)
  await page.screenshot({ path: `${out}/${size.name}-readings-1.png`, fullPage: true })

  await page.reload()
  await page.getByRole('heading', { name: '阅读次数测试论文', level: 1 }).waitFor()
  check(`${tag} 刷新后：三次阅读、小标题都在，展开最新的一次`, (await count(heads, 3)) === 3 && (await heads.nth(2).innerText()).includes('Paper Sharing 反馈') && (await heads.nth(2).getAttribute('aria-expanded')) === 'true')

  // ════ 6. an empty reading can be removed; one with content cannot ════
  await tap(addReading)
  await page.waitForTimeout(200)
  const del = readings.nth(3).getByRole('button', { name: '删除这次阅读' })
  check(`${tag} 空的阅读可以删除；有内容的没有删除按钮`, (await del.count()) === 1 && (await readings.nth(2).getByRole('button', { name: '删除这次阅读' }).count()) === 0)
  await del.click()
  await page.waitForTimeout(200)
  check(`${tag} 删掉空的阅读后剩三次`, (await heads.count()) === 3)

  // ════ 7. export grouped by reading ════
  await page.getByRole('button', { name: '导出' }).first().click()
  await page.getByRole('button', { name: /复制 Markdown|Markdown/ }).first().click()
  await page.waitForTimeout(300)
  const md = await page.evaluate(() => navigator.clipboard.readText())
  const order = ['## 基础', '## 第 1 次阅读｜原文精读｜2026-11-05', '第三次补充的动机', '关于第一次方法的理解', '## 第 2 次阅读｜2026-11-12', '第二次的结果', '## 第 3 次阅读｜Paper Sharing 反馈｜', '分享后的理解']
  check(`${tag} Markdown 按阅读次数分组，带编号、小标题、日期`, order.every((t, i) => md.includes(t) && (i === 0 || md.indexOf(t) > md.indexOf(order[i - 1]))), order.filter((t) => !md.includes(t)).join(' / '))
  await page.keyboard.press('Escape')

  // ════ 8. the library: one paper, colour dots from all readings ════
  await page.goto(`${url}#/library`)
  const row = page.locator('.paper-row:visible', { hasText: '阅读次数测试论文' })
  check(`${tag} 论文库里还是一篇`, (await row.count()) === 1)
  check(`${tag} 论文库写的“读过 N 次”和阅读次数一致`, (await row.first().innerText()).includes('读过 3 次'), await row.first().innerText())
  // the dots in the list are 参考价值 now (chosen by hand); what the readings hold is shown in 定位重点
  check(`${tag} 列表的色点不再由重点自动生成`, (await row.first().locator('.dot').count()) === 0)

  // ════ 9. Settings: highlight types ════
  await page.goto(`${url}#/settings`)
  await page.getByRole('button', { name: /重点类型/ }).click()
  await page.getByPlaceholder(/新类型的名字/).fill('理论框架')
  await page.locator('.type-new select').selectOption('blue')
  await page.locator('.type-new').getByRole('button', { name: '新建' }).click()
  await page.waitForTimeout(200)
  const newRow = page.locator('.type-row', { has: page.locator('input[value="理论框架"]') })
  check(`${tag} 设置里可以新建重点类型（名字、颜色）`, (await newRow.count()) === 1 && (await newRow.getAttribute('data-color')) === 'blue')
  await page.getByPlaceholder(/新类型的名字/).fill('研究方法')
  await page.locator('.type-new').getByRole('button', { name: '新建' }).click()
  await page.waitForTimeout(200)
  check(`${tag} 同名的类型不重复建`, (await page.locator('.type-row input[value="研究方法"]').count()) === 1 && (await page.getByText('已经有同名的类型了').count()) === 1, `${await page.locator('.type-row input[value="研究方法"]').count()} / ${await page.locator('#s-types ~ * .status-line, .fold .status-line').allInnerTexts()}`)
  const preset = page.locator('.type-row input[value="写作结构"]')
  await preset.fill('写作结构与表达')
  await preset.press('Enter')
  await page.waitForTimeout(200)
  check(`${tag} 预设类型也可以改名`, (await page.locator('.type-row input[value="写作结构与表达"]').count()) === 1)
  check(`${tag} 预设的、被用到的类型没有删除按钮；没用到的自建类型有`, (await page.getByRole('button', { name: '删除类型：研究方法' }).count()) === 0 && (await page.getByRole('button', { name: '删除类型：理论框架' }).count()) === 1)
  await openPaper()
  await readings.nth(2).getByRole('button', { name: '加一个重点' }).click()
  const opts = await readings.nth(2).locator('.add-form select option').allInnerTexts()
  check(`${tag} 论文页“加一个重点”里能选新类型和改过名的类型`, opts.includes('理论框架') && opts.includes('写作结构与表达'), opts.join(','))
  await page.goto(`${url}#/settings`)
  await page.getByRole('button', { name: /重点类型/ }).click()
  await page.getByRole('button', { name: '删除类型：理论框架' }).click()
  await page.waitForTimeout(200)
  check(`${tag} 删除没用到的自建类型`, (await page.locator('.type-row input[value="理论框架"]').count()) === 0)
  await page.screenshot({ path: `${out}/${size.name}-readings-types.png`, fullPage: true })

  // ════ 10. the backup before readings: a device that already had papers when this version first opened ════
  if (size.name === 'mac') {
    const readKey = () =>
      page.evaluate(
        () =>
          new Promise((ok) => {
            const r = indexedDB.open('research-notebook')
            r.onsuccess = () => {
              const q = r.result.transaction('device').objectStore('device').get('backup-before-readings')
              q.onsuccess = () => {
                r.result.close()
                ok(q.result)
              }
            }
          }),
      )
    check(`${tag} 一打开就记下了：开始时没有论文，不需要备份`, (await readKey())?.value === null)
    // stand in for a device that had papers before updating: forget the mark, open again
    await page.evaluate(
      () =>
        new Promise((ok) => {
          const r = indexedDB.open('research-notebook')
          r.onsuccess = () => {
            const tx = r.result.transaction('device', 'readwrite')
            tx.objectStore('device').delete('backup-before-readings')
            tx.oncomplete = () => {
              r.result.close()
              ok()
            }
          }
        }),
    )
    await page.reload()
    await page.waitForTimeout(800)
    const kept = await readKey()
    check(`${tag} 已有论文的设备第一次打开新版：自动存了一份全量备份（含论文和重点）`, !!kept?.value && JSON.stringify(kept.value).includes('阅读次数测试论文') && JSON.stringify(kept.value).includes('第三次补充的动机'))
    await page.goto(`${url}#/settings`)
    check(`${tag} 设置里可以下载这份备份`, await page.getByRole('button', { name: '下载这份备份' }).isVisible())
  }

  check(`${tag} 没有横向滚动`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
