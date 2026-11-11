// Checks that the built site opens with no network after one visit.
// Needs the BUILT site (npm run build && npx vite preview), not the dev server.
// Usage: node scripts/smoke-offline.mjs http://localhost:4173/
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:4173/'
const browser = await chromium.launch()
let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await page.goto(url)
await page.evaluate(() => navigator.serviceWorker.ready)
await page.waitForFunction(async () => (await caches.keys()).some((k) => k.includes('precache')))
await page.waitForTimeout(1500)

const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json())
check('有 manifest，名字和独立窗口模式正确', manifest.name === '研究笔记本' && manifest.display === 'standalone')
check('manifest 的图标都能取到', (await Promise.all(manifest.icons.map((i) => page.evaluate((s) => fetch(s).then((r) => r.ok), i.src)))).every(Boolean))
check('有主屏幕图标（apple-touch-icon）', await page.evaluate(() => fetch(document.querySelector('link[rel=apple-touch-icon]').href).then((r) => r.ok && r.headers.get('content-type').includes('png'))))

// something stored locally, to see it again offline
await page.goto(`${url}#/library`)
await page.getByRole('button', { name: /想看/ }).click()
await page.getByPlaceholder('想看的论文标题').fill('离线前记下的论文')
await page.getByRole('button', { name: '加进想看' }).click()
await page.getByText('离线前记下的论文').waitFor()

await ctx.setOffline(true)
await page.reload()
await page.getByText('离线前记下的论文').waitFor({ timeout: 8000 }).then(
  () => check('断网后刷新：页面能打开，本机内容还在', true),
  () => check('断网后刷新：页面能打开，本机内容还在', false),
)
for (const hash of ['#/', '#/board', '#/settings']) {
  await page.goto(`${url}${hash}`)
  await page.reload()
  const ok = await page.getByRole('navigation', { name: '主导航' }).first().waitFor({ timeout: 8000 }).then(() => true, () => false)
  check(`断网后打开 ${hash}`, ok)
}
const fresh = await ctx.newPage()
const opened = await fresh.goto(url).then(() => fresh.getByRole('navigation', { name: '主导航' }).first().waitFor({ timeout: 8000 })).then(() => true, () => false)
check('断网后从头打开（像从主屏幕点图标）', opened)

await browser.close()
process.exit(failed ? 1 : 0)
