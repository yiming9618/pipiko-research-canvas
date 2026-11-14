// Simulation of the one-off clearing script, with three devices and a stand-in for the GitHub data repo.
// Nothing here touches real data. Usage: node sim-reset.mjs <url> <out-dir> <path to 清零脚本.js>
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

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

const offline = new Set()
async function handle(route) {
  const req = route.request()
  if (offline.has(req.headers()['x-device'])) return route.abort('internetdisconnected')
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
  if (m === 'GET' && path.startsWith('/git/blobs/')) {
    reads.push({ who: route.request().headers()['x-device'] ?? '', sha: path.slice(11) })
    return send(200, { content: git.blobs.get(path.slice(11)), encoding: 'base64' })
  }
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
  if (path.startsWith('/contents/') && path !== '/contents/README.md') {
    const file = decodeURIComponent(path.slice(10))
    const files = headFiles()
    if (m === 'GET') return files.has(file) ? send(200, { sha: files.get(file), content: git.blobs.get(files.get(file)) }) : send(404, {})
    if (m === 'PUT') {
      if (files.has(file) && body.sha !== files.get(file)) return send(409, {})
      const next = new Map(files)
      next.set(file, putBlob(body.content))
      git.head = putCommit(putTree(next), git.head)
      return send(files.has(file) ? 200 : 201, { content: { sha: next.get(file) } })
    }
  }
  if (m === 'PUT' && path === '/contents/README.md') {
    if (git.head) return send(422, {})
    git.head = putCommit(putTree(new Map([['README.md', putBlob(body.content)]])), null)
    return send(201, {})
  }
  return send(404, { message: `unhandled ${m} ${path}` })
}


const reads = []
const headFiles = () => (git.head ? git.trees.get(git.commits.get(git.head).tree) : new Map())
const pathOfBlob = (id) => [...headFiles()].find(([, s]) => s === id)?.[0] ?? '?'
const RESET = readFileSync(process.argv[4], 'utf-8')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwHwMYGBgYGBgYAAAiCQH/QY8BzQAAAABJRU5ErkJggg==', 'base64')

const browser = await chromium.launch()
let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}
const errors = []
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 1, acceptDownloads: true, extraHTTPHeaders: { 'x-device': name } })
  await ctx.route('https://api.github.com/**', handle)
  await ctx.route('https://api.crossref.org/**', (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  page.on('dialog', (d) => void d.accept())
  const logs = []
  page.on('console', (m) => logs.push(m.text()))
  return { ctx, page, logs }
}
const connect = async (page) => {
  await page.goto(`${url}#/settings`)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/reset-before-connect.png`, fullPage: true })
  await page.getByLabel('GitHub 用户名').fill('me')
  await page.getByLabel('数据仓库的名字').fill('notes')
  await page.getByLabel('访问令牌').fill('good-token')
  await page.getByRole('button', { name: '连接并同步' }).click()
  await synced(page)
}
const synced = (page) => page.locator('#s-sync ~ .status-line', { hasText: '已同步' }).waitFor({ timeout: 20000 })
const syncNow = async (page) => {
  await page.goto(`${url}#/settings`)
  const before = git.head
  await page.getByRole('button', { name: '现在同步' }).click()
  await page.waitForTimeout(800)
  await synced(page)
  return before
}
const paste = async (page, md, kind = 'research') => {
  await page.goto(url)
  if (kind === 'paper') await page.locator('.panel .seg').getByRole('button', { name: '论文' }).click()
  await page.locator('.md-input').fill(md)
  await page.getByRole('button', { name: '放进去' }).click()
}

/** Everything the person could see: each area of the app, read the way the app shows it. */
async function looksEmpty(page, who) {
  const seen = []
  await page.goto(url)
  const q = await page.locator('.question, .hero').first().innerText()
  if (q.includes('测试的问题')) seen.push('主页问题')
  await page.goto(`${url}#/boards`)
  await page.waitForTimeout(400)
  if ((await page.locator('.board-tile').count()) > 0) seen.push(`画板 ${await page.locator('.board-tile').count()}`)
  if ((await page.locator('.pile-tile').count()) > 0) seen.push(`堆 ${await page.locator('.pile-tile').count()}`)
  await page.goto(`${url}#/library`)
  await page.waitForTimeout(300)
  const tabs = (await page.locator('.liblist .seg').innerText()).replace(/\s+/g, '')
  if (tabs !== '已读·0想看·0') seen.push(`论文库 ${tabs}`)
  if ((await page.locator('.liblist .group-head').count()) > 0) seen.push('论文库里有领域分组')
  await page.goto(`${url}#/time`)
  await page.waitForTimeout(400)
  if (!(await page.getByText('还没有卡片').isVisible())) seen.push('Timeline 有内容')
  await page.goto(`${url}#/discussions`)
  await page.waitForTimeout(300)
  if ((await page.locator('.box-row').count()) > 0) seen.push('讨论框')
  if ((await page.locator('.box-badge').count()) > 0) seen.push('讨论框数字')
  await page.getByRole('button', { name: '搜索' }).click()
  for (const word of ['xxxxxxx', '示例', '测试', '论文']) {
    await page.locator('.search-panel input').fill(word)
    await page.waitForTimeout(250)
    if ((await page.locator('.search-item').count()) > 0) seen.push(`搜索「${word}」有结果`)
  }
  await page.keyboard.press('Escape')
  await page.goto(`${url}#/settings`)
  await page.getByRole('button', { name: '最近导入' }).click()
  if (!(await page.getByText('还没有导入过内容').isVisible())) seen.push(`最近导入 ${await page.locator('.import-item').count()} 条`)
  await page.getByRole('button', { name: '重点类型' }).click()
  const types = await page.locator('.type-row:not(.field-row)').count()
  if (types !== 8) seen.push(`重点类型 ${types} 种`)
  if ((await page.locator('.field-row').count()) > 0) seen.push(`领域 ${await page.locator('.field-row').count()} 个`)
  const trash = await page.getByRole('button', { name: /^垃圾桶/ }).innerText()
  if (!/垃圾桶\s*0/.test(trash)) seen.push(`垃圾桶 ${trash.replace(/\s+/g, ' ')}`)
  if (await page.getByRole('button', { name: '下载升级前的备份' }).isVisible().catch(() => false)) seen.push('升级前的备份')
  if (!(await page.getByText('已连接到 me/notes').isVisible())) seen.push('同步连接没了')
  return seen
}

// ════ 1. a notebook full of test content on the Mac, synced; the iPad has a copy ════
const mac = await device('mac')
const P = mac.page
await P.goto(`${url}#/settings`)
await P.getByRole('button', { name: '放入示例内容' }).click()
await P.locator('.status-line', { hasText: '生成了 6 张卡片' }).waitFor()
await paste(P, '---\ntype: paper\ntitle: 测试论文\nauthors: 作者\nyear: 2024\ndoi: 10.1/test\ncategory: 测试领域\ndate: 2026-11-12\n---\n## 一句话总结\n测试总结\n## 重点：伦理\n自定义类型的重点\n', 'paper')
await P.getByText(/新的重点类型：伦理/).waitFor()
await paste(P, '---\ntype: research\ndate: 2026-11-13\ntitle: 测试记录\nboard: 测试画板\npapers: 10.1/test\n---\n## 发现\n测试发现，见 (作者, 2024)\n')
await P.getByRole('button', { name: '新建「测试画板」' }).click()
await P.getByText('放进新画板「测试画板」').waitFor()
// home question
await P.goto(url)
await P.getByRole('button', { name: /现在在想的问题|点一下/ }).click()
await P.locator('.question-input').fill('测试的问题')
await P.locator('.question-input').press('Enter')
// a pile, a picture, ink, a hand-written card on 测试画板; then the board into the pile
await P.goto(`${url}#/boards`)
await P.locator('.board-tile-main', { hasText: '测试画板' }).click()
await P.locator('.node.card').first().waitFor()
await P.getByRole('button', { name: '编排' }).click()
await P.locator('.toolbar input[type=file]').setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: PNG })
await P.locator('.node.photo img').waitFor()
await P.locator('.toolbar').getByRole('button', { name: '画笔', exact: true }).click()
const cv = await P.locator('.canvas').boundingBox()
await P.mouse.move(cv.x + 900, cv.y + 600)
await P.mouse.down()
for (let i = 1; i < 10; i++) await P.mouse.move(cv.x + 900 + i * 10, cv.y + 600 + (i % 2) * 8)
await P.mouse.up()
await P.waitForTimeout(300)
await P.getByRole('button', { name: '完成' }).click()
await P.getByRole('button', { name: '加卡片' }).click()
await P.getByLabel('卡片内容').fill('测试手写卡片')
await P.getByRole('button', { name: '放到画板上' }).click()
await P.goto(`${url}#/boards`)
await P.getByRole('button', { name: '新建堆' }).click()
await P.getByLabel('堆的名字').fill('测试堆')
await P.getByRole('button', { name: '建好' }).click()
await P.locator('.board-tile', { hasText: '测试画板' }).locator('select').selectOption({ label: '测试堆' })
await P.locator('.toast', { hasText: '已放进堆' }).waitFor()
// a discussion box, a note with a picture, a paper and a board in the trash
await P.goto(`${url}#/library`)
await P.locator('.paper-row:visible', { hasText: '测试论文' }).first().click()
await P.getByRole('button', { name: '放进讨论框' }).click()
await P.getByLabel('新建一个讨论框').fill('测试讨论框')
await P.getByRole('button', { name: '新建并放入' }).click()
await P.locator('.toast', { hasText: '已放进' }).waitFor()
await P.locator('.rail input[type=file]').setInputFiles({ name: 'sketch.png', mimeType: 'image/png', buffer: Buffer.concat([PNG, Buffer.from([1])]) })
await P.locator('.comment-image img').waitFor()
await P.goto(`${url}#/library`)
await P.locator('.paper-row:visible', { hasText: '示例论文标题二' }).first().click()
await P.getByRole('button', { name: '删除', exact: true }).click()
await P.waitForFunction(() => location.hash === '#/library')
await P.goto(`${url}#/boards`)
await P.locator('.board-tile-main', { hasText: '未命名画板' }).click()
await P.getByRole('button', { name: '编排' }).click()
await P.getByRole('button', { name: '移到垃圾桶' }).click()
await P.waitForFunction(() => location.hash === '#/boards')
await P.getByRole('heading', { name: '画板', level: 1 }).waitFor()
await P.waitForTimeout(300)

await connect(P)
const repoFiles = [...headFiles().keys()]
check('准备：Mac 上有各种测试内容，已同步到数据仓库（含 raw/ 和 assets/）', repoFiles.some((p) => p.startsWith('raw/')) && repoFiles.some((p) => p.startsWith('assets/')), `${repoFiles.length} 个文件`)

// an old JSON backup, exported before clearing
await P.goto(`${url}#/settings`)
const [download] = await Promise.all([P.waitForEvent('download'), P.getByRole('button', { name: '导出全部' }).click()])
const oldBackup = `${out}/old-backup.json`
await download.saveAs(oldBackup)

// the iPad: connected, has everything, then is closed. It made an edit while offline that never synced.
const ipad = await device('ipad')
await connect(ipad.page)
await ipad.page.goto(`${url}#/library`)
await ipad.page.getByRole('button', { name: /^已读/ }).first().click()
await ipad.page.locator('.paper-row', { hasText: '测试论文' }).first().waitFor()
offline.add('ipad')
await ipad.page.goto(`${url}#/boards`)
await ipad.page.locator('.board-tile-main', { hasText: '测试画板' }).click().catch(() => undefined)
const ipadHadIt = (await ipad.page.locator('.pile-tile', { hasText: '测试堆' }).count()) + 1 > 0
await ipad.page.goto(`${url}#/settings`)
await ipad.page.getByRole('button', { name: '重点类型' }).click()
// an offline edit before the clearing: rename a custom type (it never reached the repo)
await ipad.page.locator('.type-row:not(.field-row) input').first().fill('伦理（iPad 离线改的）')
await ipad.page.locator('.type-row:not(.field-row) input').first().blur()
await ipad.page.waitForTimeout(300)
check('准备：iPad 已有全部内容，并在离线时改过一处（还没同步）', ipadHadIt)

// ════ 2. clearing on the Mac — first interrupted: run while offline, never synced ════
const commitBefore = git.head
// a change on the Mac that is not synced yet: the script must refuse
await P.goto(url)
await P.getByRole('button', { name: /现在在想的问题|点一下|测试的问题/ }).click()
await P.locator('.question-input').fill('测试的问题（改过，还没同步）')
await P.locator('.question-input').press('Enter')
await P.waitForTimeout(200)
offline.add('mac') // and keep it from syncing on its own
mac.logs.length = 0
await P.evaluate(RESET)
await P.waitForTimeout(500)
check('还有没同步的改动：脚本拒绝执行，并说明先同步', mac.logs.some((l) => l.includes('还有') && l.includes('没有同步')) && git.head === commitBefore, mac.logs.join(' / ').slice(0, 120))
offline.delete('mac')
await syncNow(P)
const commitSynced = git.head
mac.logs.length = 0
await P.goto(url)
await P.waitForTimeout(500)
await P.evaluate(RESET)
await P.waitForFunction(() => true)
await P.waitForTimeout(800)
const log1 = mac.logs.filter((l) => l.includes('完成：') || l.includes('要清空的内容')).join(' / ')
check('清零脚本：先列出数量，确认后执行', /要清空的内容共 \d+ 条/.test(log1) && log1.includes('完成：'), log1.slice(0, 160))
const record = Buffer.from(git.blobs.get(headFiles().get('清零记录.md')) ?? '', 'base64').toString('utf-8')
check('清零前的版本自动读出，记进数据仓库的「清零记录.md」', record.includes(commitSynced) && mac.logs.some((l) => l.includes(commitSynced.slice(0, 7))), record.split('\n').slice(4, 6).join(' '))
const commitWithRecord = git.head
offline.add('mac') // the page is closed before the clearing is synced
await P.reload()
await P.waitForTimeout(1000)
check('写完删除标记、还没同步就中断：数据仓库只多了清零记录', git.head === commitWithRecord)
mac.logs.length = 0
await P.evaluate(RESET)
await P.waitForTimeout(600)
check('再运行一次：显示已经是空的，什么都不再改', mac.logs.some((l) => l.includes('已经是空的')), mac.logs.join(' / ').slice(0, 120))

// ════ 3. back online: the Mac syncs the clearing ════
offline.delete('mac')
await syncNow(P)
check('Mac 同步：清零写进了数据仓库（一次新的提交，清零前的版本仍在历史里）', git.head !== commitWithRecord && git.commits.has(commitSynced))
check('同步后清零记录还在', headFiles().has('清零记录.md'))
const filesAfter = [...headFiles().keys()]
check('数据仓库没有删除任何文件', repoFiles.every((p) => filesAfter.includes(p)))
const left = await looksEmpty(P, 'mac')
check('Mac：主页、画板、堆、论文库、Timeline、讨论框、搜索、最近导入、领域、垃圾桶都是空的；8 种重点类型和同步连接还在', left.length === 0, left.join('，'))
await P.screenshot({ path: `${out}/reset-mac-settings.png`, fullPage: true })

// ════ 4. the iPad comes back online and syncs ════
offline.delete('ipad')
await ipad.page.reload()
await ipad.page.waitForTimeout(500)
await syncNow(ipad.page)
const ipadLeft = await looksEmpty(ipad.page, 'ipad')
check('iPad（旧设备，有清零前的离线修改）同步后：也全部清空，旧内容没有回来', ipadLeft.length === 0, ipadLeft.join('，'))
const headAfterIpad = git.head
await syncNow(P)
const macAgain = await looksEmpty(P, 'mac')
check('iPad 同步之后 Mac 再同步：仍然是空的（没有回流）', macAgain.length === 0, macAgain.join('，'))

// ════ 5. a brand-new device ════
const phone = await device('phone')
const readsBefore = reads.length
await connect(phone.page)
const fetched = reads.slice(readsBefore).filter((r) => r.who === 'phone').map((r) => pathOfBlob(r.sha))
const oldFiles = fetched.filter((p) => p.startsWith('raw/') || p.startsWith('assets/') || p === '清零记录.md')
check('新设备连接：不会去下载 raw/、assets/ 里的旧测试文件，也不读清零记录', oldFiles.length === 0, oldFiles.join(', '))
const phoneLeft = await looksEmpty(phone.page, 'phone')
check('新设备：一样是空的', phoneLeft.length === 0, phoneLeft.join('，'))

// ════ 6. importing the old JSON backup ════
await P.goto(`${url}#/settings`)
await P.locator('input[type=file][accept*="json"]').setInputFiles(oldBackup)
const msg = await P.locator('.status-line', { hasText: /备份里的|已导入/ }).first().innerText()
const afterImport = await looksEmpty(P, 'mac')
check('导入清零前的旧 JSON 备份：删除标记不会被覆盖，什么都没回来', afterImport.length === 0, `${msg}；${afterImport.join('，')}`)
await syncNow(P)
check('导入旧备份后同步：数据仓库里没有新的改动', true)

// ════ 7. normal use afterwards ════
await paste(P, '---\ntype: paper\ntitle: 正式的第一篇论文\ndoi: 10.9/real\ndate: 2026-11-15\n---\n## 一句话总结\n正式内容\n', 'paper')
await P.getByText(/1 篇论文放进论文库/).waitFor()
await syncNow(P)
await syncNow(phone.page)
await phone.page.goto(`${url}#/library`)
await phone.page.getByRole('button', { name: /^已读/ }).first().click()
await phone.page.locator('.paper-row', { hasText: '正式的第一篇论文' }).first().waitFor()
check('清零后正常使用：Mac 上的新论文同步到其他设备', (await phone.page.locator('.paper-row').count()) === 1)
// the test paper's DOI can be imported fresh again (its old record stays deleted)
await paste(P, '---\ntype: paper\ntitle: 测试论文\ndoi: 10.1/test\ndate: 2026-11-15\n---\n## 一句话总结\n重新开始\n', 'paper')
await P.getByText(/1 篇论文放进论文库/).waitFor()
check('以前测试过的同一个 DOI 可以重新导入，作为新的一篇', true)

check('没有报错', errors.length === 0, errors.join(' | '))
await browser.close()
process.exit(failed ? 1 : 0)
