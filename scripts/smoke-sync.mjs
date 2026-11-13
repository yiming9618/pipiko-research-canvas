// Two "devices" (browser contexts) syncing through a stand-in for the GitHub API.
// Nothing here talks to the real GitHub. Usage: node scripts/smoke-sync.mjs <url> <screenshot-dir>
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.'

// ── a tiny in-memory git host that follows the same rules as the real API
const git = { head: null, commits: new Map(), trees: new Map(), blobs: new Map(), n: 0 }
const sha = (s) => createHash('sha1').update(s).digest('hex')
const putBlob = (base64) => {
  const id = sha('blob' + base64)
  git.blobs.set(id, base64)
  return id
}
const putTree = (files) => {
  const id = sha('tree' + JSON.stringify([...files].sort()))
  git.trees.set(id, files)
  return id
}
const putCommit = (tree, parent) => {
  const id = sha(`commit${tree}${parent}${git.n++}`)
  git.commits.set(id, { tree, parent })
  return id
}
const b64 = (text) => Buffer.from(text, 'utf-8').toString('base64')
let requests = 0

async function handle(route) {
  const req = route.request()
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  const send = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
  requests++
  const auth = req.headers()['authorization'] ?? ''
  if (auth !== 'Bearer good-token') return send(401, { message: 'Bad credentials' })
  const path = new URL(req.url()).pathname.replace('/repos/me/notes', '')
  const body = req.postData() ? JSON.parse(req.postData()) : null
  const m = req.method()
  if (!new URL(req.url()).pathname.startsWith('/repos/me/notes')) return send(404, {})
  if (m === 'GET' && path === '') return send(200, { name: 'notes' })
  if (m === 'GET' && path === '/git/ref/heads/main') return git.head ? send(200, { object: { sha: git.head } }) : send(409, { message: 'Git Repository is empty.' })
  if (m === 'GET' && path.startsWith('/git/commits/')) return send(200, { tree: { sha: git.commits.get(path.slice(13)).tree } })
  if (m === 'GET' && path.startsWith('/git/trees/')) {
    const files = git.trees.get(path.slice(11))
    return send(200, { truncated: false, tree: [...files].map(([p, s]) => ({ path: p, type: 'blob', sha: s })) })
  }
  if (m === 'GET' && path.startsWith('/git/blobs/')) return send(200, { content: git.blobs.get(path.slice(11)), encoding: 'base64' })
  if (m === 'POST' && path === '/git/blobs') return send(201, { sha: putBlob(body.encoding === 'base64' ? body.content : b64(body.content)) })
  if (m === 'POST' && path === '/git/trees') {
    const files = new Map(git.trees.get(body.base_tree))
    for (const t of body.tree) files.set(t.path, t.sha ?? putBlob(b64(t.content)))
    return send(201, { sha: putTree(files) })
  }
  if (m === 'POST' && path === '/git/commits') return send(201, { sha: putCommit(body.tree, body.parents[0]) })
  if (m === 'PATCH' && path === '/git/refs/heads/main') {
    if (git.commits.get(body.sha).parent !== git.head) return send(422, { message: 'Update is not a fast forward' })
    git.head = body.sha
    return send(200, {})
  }
  if (m === 'PUT' && path === '/contents/README.md') {
    if (git.head) return send(422, {})
    git.head = putCommit(putTree(new Map([['README.md', putBlob(body.content)]])), null)
    return send(201, {})
  }
  return send(404, { message: `unhandled ${m} ${path}` })
}

const browser = await chromium.launch()
let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}

const errors = []
async function device(name, width, height, isMobile) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile, hasTouch: isMobile, deviceScaleFactor: 2 })
  await ctx.route('https://api.github.com/**', handle)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  return page
}
const connect = async (page, token = 'good-token') => {
  await page.goto(`${url}#/settings`)
  await page.getByLabel('GitHub 用户名').fill('me')
  await page.getByLabel('数据仓库的名字').fill('notes')
  await page.getByLabel('访问令牌').fill(token)
  await page.getByRole('button', { name: '连接并同步' }).click()
}
const synced = (page) => page.locator('#s-sync ~ .status-line', { hasText: '已同步' }).waitFor()

// ── phone: has content from before connecting, then connects (the repo is completely empty)
const phone = await device('phone', 390, 844, true)
await phone.goto(`${url}#/settings`)
await phone.getByRole('button', { name: '放入示例内容' }).click()
await phone.locator('.status-line', { hasText: '生成了 6 张卡片' }).waitFor()
check('[phone] 没连接时说明令牌只存在这台设备', await phone.getByText('令牌只存在这台设备里').isVisible())
await phone.screenshot({ path: `${out}/phone-sync-1-form.png`, fullPage: true })
const small = await phone.evaluate(() =>
  [...document.querySelectorAll('.sync-form input, .sync-form button')]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.height < 44).length,
)
check('[phone] 同步表单的输入框和按钮 ≥ 44px', small === 0)
await connect(phone)
await synced(phone)
const paths = [...git.trees.get(git.commits.get(git.head).tree).keys()]
check('[phone] 空仓库也能连上，连接前的内容全部上传', paths.some((p) => p.startsWith('data/papers/')) && paths.some((p) => p.startsWith('data/cards/')) && paths.includes('data/board-list.json') && paths.some((p) => p.startsWith('raw/')), `${paths.length} 个文件`)
check('[phone] 令牌没有写进数据仓库', ![...git.blobs.values()].some((b) => Buffer.from(b, 'base64').toString().includes('good-token')))
await phone.screenshot({ path: `${out}/phone-sync-2-connected.png`, fullPage: true })

// ── ipad: empty device, connects, receives everything
const ipad = await device('ipad', 1366, 1024, false)
await connect(ipad)
await synced(ipad)
await ipad.goto(`${url}#/library`)
await ipad.getByText('示例论文标题一').first().waitFor()
check('[ipad] 连接后收到手机上的论文', true)
await ipad.goto(`${url}#/boards`)
await ipad.locator('.board-tile-main').first().waitFor()
await ipad.screenshot({ path: `${out}/ipad-sync-2b-board.png` })
check('[ipad] 收到手机上的画板，里面有卡片', (await ipad.locator('.board-tile-main .thumb span').count()) > 0)
await ipad.goto(`${url}#/time`)
await ipad.locator('.day-tile').first().waitFor()
check('[ipad] 时间视图里有手机导入的那些天', (await ipad.locator('.day-tile').count()) === 2)
await ipad.goto(`${url}#/boards`)

// ── ipad makes a pile; it reaches the phone without anyone pressing sync
const before = git.head
await ipad.getByRole('button', { name: '新建堆' }).click()
await ipad.getByLabel('堆的名字').fill('从 iPad 来')
await ipad.getByRole('button', { name: '建好' }).click()
await ipad.waitForTimeout(2500)
check('[ipad] 刚改完不会马上提交（先攒着）', git.head === before)
await ipad.goto(`${url}#/settings`)
await ipad.getByRole('button', { name: '现在同步' }).click()
await ipad.waitForFunction(() => true)
for (let i = 0; i < 40 && git.head === before; i++) await ipad.waitForTimeout(250)
check('[ipad] 改动提交到了仓库', git.head !== before)
await phone.getByRole('button', { name: '现在同步' }).click()
await phone.getByText(/收到 \d+ 条新内容/).waitFor()
await phone.goto(`${url}#/boards`)
await phone.locator('.pile-tile', { hasText: '从 iPad 来' }).waitFor()
check('[phone] 收到 iPad 上新建的堆', true)

// ── the token stops working
await ipad.getByRole('button', { name: '更换令牌' }).click()
await ipad.getByLabel('访问令牌').fill('expired-token')
await ipad.getByRole('button', { name: '保存并同步' }).click()
await ipad.locator('.sync-problem.is-urgent').waitFor()
const text = await ipad.locator('.sync-problem').innerText()
check('[ipad] 令牌失效：说明发生了什么、内容还在', text.includes('没有在同步') && text.includes('内容都还在'))
check('[ipad] 令牌失效：给出换令牌的步骤', (await ipad.locator('.sync-problem li').count()) >= 4)
await ipad.screenshot({ path: `${out}/ipad-sync-3-token.png`, fullPage: true })
await ipad.goto(`${url}#/library`)
await ipad.locator('.sync-banner').waitFor()
check('[ipad] 别的页面上也有明显的提示条', await ipad.locator('.sync-banner').isVisible())
check('[ipad] 设置图标上有提示点', await ipad.locator('.sync-dot').isVisible())
check('[ipad] 本机内容不受影响', await ipad.getByText('示例论文标题一').first().isVisible())
await ipad.screenshot({ path: `${out}/ipad-sync-4-banner.png` })
await ipad.reload()
await ipad.locator('.sync-banner').waitFor()
check('[ipad] 重新打开后提示还在', true)
await ipad.locator('.sync-banner a').click()
await ipad.getByRole('button', { name: '更换令牌' }).click()
await ipad.getByLabel('访问令牌').fill('good-token')
await ipad.getByRole('button', { name: '保存并同步' }).click()
await synced(ipad)
check('[ipad] 换上好的令牌后恢复同步，提示消失', (await ipad.locator('.sync-dot').count()) === 0)

// ── token expiry date (typed in by the person) and the reminder
const dayFromNow = (n) => {
  const d = new Date(Date.now() + n * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
check('[ipad] 没填到期日时说明不会有提醒', await ipad.getByText('还没有填令牌的到期日').isVisible())
await ipad.getByRole('button', { name: '填写到期日' }).click()
await ipad.getByLabel(/令牌的到期日/).fill(dayFromNow(30))
await ipad.getByRole('button', { name: '保存到期日' }).click()
await ipad.getByText(`令牌到期日：${dayFromNow(30)}`).waitFor()
check('[ipad] 到期日还远：不提醒', (await ipad.locator('.sync-dot').count()) === 0)
await ipad.getByRole('button', { name: '修改' }).click()
await ipad.getByLabel(/令牌的到期日/).fill(dayFromNow(5))
await ipad.getByRole('button', { name: '保存到期日' }).click()
await ipad.getByText(/令牌还有 5 天到期/).waitFor()
check('[ipad] 到期前 7 天内：设置页说明还有几天、怎么换', true)
await ipad.goto(`${url}#/library`)
await ipad.getByRole('link', { name: '设置（令牌快到期了）' }).waitFor()
check('[ipad] 设置图标上有提醒点', await ipad.locator('.sync-dot').isVisible())
check('[ipad] 快到期只是提醒，不弹全屏提示条', (await ipad.locator('.sync-banner').count()) === 0)
await ipad.reload()
await ipad.locator('.sync-dot').waitFor()
check('[ipad] 重新打开后提醒还在（到期日存在本机）', true)
await ipad.screenshot({ path: `${out}/ipad-sync-5-expiring.png` })
await ipad.goto(`${url}#/settings`)
await ipad.getByRole('button', { name: '更换令牌' }).click()
await ipad.getByLabel('访问令牌').fill('good-token')
await ipad.getByLabel(/令牌的到期日/).fill(dayFromNow(90))
await ipad.getByRole('button', { name: '保存并同步' }).click()
await ipad.getByText(`令牌到期日：${dayFromNow(90)}`).waitFor()
await synced(ipad)
check('[ipad] 换新令牌并填新日期后提醒消失', (await ipad.locator('.sync-dot').count()) === 0)
check('[ipad] 到期日没有写进数据仓库', ![...git.blobs.values()].some((b) => Buffer.from(b, 'base64').toString().includes(dayFromNow(90))))

// ── disconnect keeps content
ipad.on('dialog', (d) => void d.accept())
await ipad.getByRole('button', { name: '断开' }).click()
await ipad.getByRole('button', { name: '连接并同步' }).waitFor()
await ipad.goto(`${url}#/library`)
await ipad.getByText('示例论文标题一').first().waitFor()
check('[ipad] 断开后内容还在', true)

check('没有报错', errors.length === 0, errors.join(' | '))
console.log(`（模拟仓库共收到 ${requests} 次请求，${git.commits.size} 次提交）`)
await browser.close()
process.exit(failed ? 1 : 0)
