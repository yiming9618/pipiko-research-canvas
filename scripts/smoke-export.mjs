// Exporting: a whole board, a whole pile, a paper as Markdown and as a printed PDF.
// Usage: node scripts/smoke-export.mjs <url> <screenshot-dir>     (ONLY=ipad|phone|mac)
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
const research = (title, board, body) => `---\ntype: research\ndate: 2026-11-10\ntitle: ${title}\nboard: ${board}\npapers: 10.0000/sample-1\n---\n## 问题\n${body}，见 (作者甲, 2024)\n`

for (const size of sizes.filter((x) => !process.env.ONLY || process.env.ONLY === x.name)) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: size.isMobile,
    hasTouch: size.isMobile,
    deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(m.text()))
  const tag = `[${size.name}]`
  const clip = () => page.evaluate(() => navigator.clipboard.readText())
  const toast = (t) => page.locator('.toast', { hasText: t }).waitFor()

  await page.goto(`${url}#/settings`)
  await page.getByRole('button', { name: '放入示例内容' }).click()
  await page.locator('.import-msg', { hasText: '生成了 6 张卡片' }).waitFor()
  // two more boards, in one pile
  await page.goto(url)
  for (const [md, board] of [[research('研究的记录', '霉菌研究', '研究里的问题'), '霉菌研究'], [research('实验的记录', '霉菌实验记录', '实验里的问题'), '霉菌实验记录']]) {
    await page.locator('.md-input').fill(md)
    await page.getByRole('button', { name: '放进去' }).click()
    await page.getByRole('button', { name: `新建「${board}」` }).click()
    await page.getByText(`放进新画板「${board}」`).waitFor()
  }

  // ════ a whole board ════
  await page.goto(`${url}#/boards`)
  await page.locator('.board-tile-main', { hasText: '未命名画板' }).click()
  await page.locator('.node.card').first().waitFor()
  const exportBtn = page.getByRole('button', { name: '导出这块画板（Markdown）' })
  check(`${tag} 画板右上角有“导出”`, await exportBtn.isVisible())
  const box = await exportBtn.boundingBox()
  check(`${tag} 导出按钮 ≥ 44px`, box.width >= 44 && box.height >= 44)
  await exportBtn.click()
  await toast('已复制画板「未命名画板」')
  let md = await clip()
  const need = ['# 未命名画板', '研究记录：', '【发现】2026-', '【问题】', '## 上面提到的论文', '示例论文标题一', '## 研究记录的模板']
  check(`${tag} 画板导出：名称、记录、卡片（类型和日期）、引用到的论文、模板`, need.every((t) => md.includes(t)), need.filter((t) => !md.includes(t)).join(' / '))
  const dates = [...md.matchAll(/^【[^】]+】(\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1])
  check(`${tag} 卡片按日期排列`, dates.length === 9 && dates.join() === [...dates].sort().join(), dates.join(' '))
  check(`${tag} 同一篇论文只列一次`, md.split('**示例论文标题一**').length - 1 === 1)

  // ════ a whole pile ════
  await page.goto(`${url}#/boards`)
  await page.getByRole('button', { name: '新建堆' }).click()
  await page.getByLabel('堆的名字').fill('霉菌')
  await page.getByRole('button', { name: '建好' }).click()
  for (const name of ['霉菌研究', '霉菌实验记录']) {
    await page.locator('.board-tile', { hasText: name }).locator('select').selectOption({ label: '霉菌' })
    await toast(`「${name}」已放进堆「霉菌」`)
  }
  await page.locator('.pile-tile', { hasText: '霉菌' }).click()
  await page.getByRole('heading', { name: '霉菌', level: 1 }).waitFor()
  await page.getByRole('button', { name: '导出整个堆（Markdown）' }).click()
  await toast('已复制堆「霉菌」的 2 块画板')
  md = await clip()
  check(`${tag} 堆导出：依次列出每块画板，前面写画板名称`, md.includes('# 堆：霉菌') && md.includes('## 画板：霉菌研究') && md.includes('## 画板：霉菌实验记录') && md.includes('研究里的问题') && md.includes('实验里的问题'))
  check(`${tag} 堆导出：不在堆里的画板不出现`, !md.includes('未命名画板'))
  check(`${tag} 堆导出：引用到的论文统一放在最后，只出现一次`, md.split('**示例论文标题一**').length - 1 === 1 && md.indexOf('## 上面提到的论文') > md.indexOf('实验里的问题'))

  // ════ a paper ════
  await page.goto(`${url}#/library`)
  await page.locator('.paper-row:visible', { hasText: '示例论文标题一' }).first().click()
  await page.getByRole('heading', { name: '示例论文标题一', level: 1 }).waitFor()
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.getByRole('heading', { name: '导出这篇论文' }).waitFor()
  const choices = await page.locator('.export-choice').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).every((r) => r.height >= 44))
  check(`${tag} 论文导出：可选 Markdown 或 PDF，按钮 ≥ 44px`, (await page.locator('.export-choice').count()) === 2 && choices)
  await page.screenshot({ path: `${out}/${size.name}-export-1-paper-dialog.png` })
  await page.locator('.export-choice', { hasText: 'Markdown' }).click()
  await toast('已复制这篇论文')
  md = await clip()
  const parts = ['# 示例论文标题一', '- 作者：', '- 年份：2024', '- 期刊/会议：', '- DOI：', '- 领域：示例分类一', '## 一句话总结', '## 基础', '## 重点', '### 研究', '## 我的理解', '· AI 整理']
  check(`${tag} 论文 Markdown：基本信息、一句话总结、基础、重点（带类型）、我的理解（带日期和来源）`, parts.every((t) => md.includes(t)), parts.filter((t) => !md.includes(t)).join(' / '))
  check(`${tag} 论文 Markdown 不带模板（不是给 AI 整理用的）`, !md.includes('研究记录的模板'))

  // PDF: the system's print dialog is stood in for; the page it would print is checked and turned into a real PDF
  await page.evaluate(() => {
    window.__printed = 0
    window.print = () => {
      window.__printed++
    }
  })
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.locator('.export-choice', { hasText: 'PDF' }).click()
  await page.waitForFunction(() => window.__printed === 1)
  check(`${tag} 选 PDF：打开系统的打印（可存为 PDF）`, true)
  check(`${tag} 打印用的页面平时看不见`, !(await page.locator('.print-sheet').isVisible()))
  await page.emulateMedia({ media: 'print' })
  const shown = await page.evaluate(() => [...document.body.children].filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.className))
  check(`${tag} 打印时只印论文本身，不印导航和按钮`, shown.length === 1 && shown[0] === 'print-sheet', shown.join(', '))
  const sheet = page.locator('.print-sheet')
  check(`${tag} 打印页：标题、信息、一句话总结、重点（带类型和颜色）、我的理解`, (await sheet.locator('h1').innerText()) === '示例论文标题一' && (await sheet.locator('.print-info dt').allInnerTexts()).includes('领域') && (await sheet.locator('.print-block').count()) >= 1 && (await sheet.locator('h2', { hasText: '我的理解' }).count()) === 1)
  if (size.name === 'mac') {
    await page.pdf({ path: `${out}/paper-export.pdf`, format: 'A4', printBackground: true, preferCSSPageSize: true })
    check(`${tag} 生成了一份 A4 的 PDF`, true)
  }
  await page.emulateMedia({ media: 'screen' })

  check(`${tag} 没有报错`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
