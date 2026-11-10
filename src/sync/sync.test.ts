import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, ImportEntry, Pile, ResearchRecord, Setting } from '../domain/types'
import { syncOnce } from './engine'
import { explainFailure } from './github'
import { MemoryLocal, MemoryRemote } from './memory'
import { SyncScheduler } from './scheduler'

const at = (s: number) => `2026-11-10T10:00:${String(s).padStart(2, '0')}.000Z`
const now = () => '2026-11-10T12:00:00.000Z'

const record = (id: string, t: number, title: string): ResearchRecord => ({
  id,
  date: '2026-11-10',
  title,
  summary: '',
  activities: [],
  keywords: [],
  paper_dois: [],
  preamble_md: '',
  import_id: 'imp_' + id,
  updated_at: at(t),
})
const card = (id: string, t: number, body: string, extra: Partial<Card> = {}): Card => ({
  id,
  record_id: 'rec_1',
  date: '2026-11-10',
  kind: '发现',
  heading: '发现',
  body_md: body,
  order: 0,
  import_id: 'imp_1',
  updated_at: at(t),
  ...extra,
})
const imp = (id: string, t: number, raw: string): ImportEntry => ({
  id,
  kind: 'research',
  raw_md: raw,
  raw_hash: 'h' + id,
  date: '2026-11-10',
  imported_at: at(t),
  notices: [],
  message: '',
  updated_at: at(t),
})

function setup() {
  const remote = new MemoryRemote()
  const phone = new MemoryLocal()
  const ipad = new MemoryLocal()
  const sync = (device: MemoryLocal) => syncOnce(device, remote, now)
  return { remote, phone, ipad, sync }
}

describe('同步', () => {
  it('手机导入的内容，iPad 同步后能看到（包括原始 Markdown）', async () => {
    const { remote, phone, ipad, sync } = setup()
    phone.write('imports', imp('imp_1', 1, '---\ntype: research\n---\n## 发现\na\n'))
    phone.write('records', record('rec_1', 1, '手机导入'))
    phone.write('cards', card('card_1', 1, 'a'))
    await sync(phone)
    await sync(ipad)

    expect(ipad.get<ResearchRecord>('records', 'rec_1')?.title).toBe('手机导入')
    expect(ipad.get<Card>('cards', 'card_1')?.body_md).toBe('a')
    expect(ipad.get<ImportEntry>('imports', 'imp_1')?.raw_md).toBe('---\ntype: research\n---\n## 发现\na\n')

    // The repo holds readable files: the original as .md, the rest as JSON without the raw text.
    expect(remote.files.get('raw/2026-11-10-imp_1.md')).toBe('---\ntype: research\n---\n## 发现\na\n')
    expect(remote.files.get('data/imports/2026-11.json')).not.toContain('raw_md')
    expect([...remote.files.keys()].sort()).toEqual([
      'data/days/2026-11-10.json',
      'data/imports/2026-11.json',
      'raw/2026-11-10-imp_1.md',
    ])
  })

  it('同一个文件两边都改了：手机新增记录 + iPad 编辑卡片，逐条合并，谁也不覆盖谁', async () => {
    const { remote, phone, ipad, sync } = setup()
    phone.write('records', record('rec_1', 1, '第一份'))
    phone.write('cards', card('card_1', 1, '原文'))
    await sync(phone)
    await sync(ipad)

    // Both go offline and change data/days/2026-11-10.json
    phone.write('records', record('rec_2', 20, '手机第二份'))
    phone.write('cards', card('card_2', 20, '手机新卡片', { record_id: 'rec_2' }))
    ipad.write('cards', card('card_1', 30, 'iPad 改过'))

    await sync(phone)
    await sync(ipad)
    await sync(phone)

    for (const device of [phone, ipad]) {
      expect(device.get<Card>('cards', 'card_1')?.body_md).toBe('iPad 改过')
      expect(device.get<Card>('cards', 'card_2')?.body_md).toBe('手机新卡片')
      expect(device.get<ResearchRecord>('records', 'rec_2')?.title).toBe('手机第二份')
    }
    const file = JSON.parse(remote.files.get('data/days/2026-11-10.json')!)
    expect(file.tables.cards.map((c: Card) => c.body_md).sort()).toEqual(['iPad 改过', '手机新卡片'])
    expect(file.tables.records).toHaveLength(2)
  })

  it('同步进行到一半时另一台设备先提交了：重新合并，不丢东西', async () => {
    const { remote, phone, ipad, sync } = setup()
    phone.write('cards', card('card_1', 1, '原文'))
    await sync(phone)
    await sync(ipad)

    phone.write('cards', card('card_p', 10, '手机的'))
    ipad.write('cards', card('card_i', 11, 'iPad 的'))
    // The phone slips its commit in right before the iPad's commit lands.
    remote.beforeCommit = async () => {
      await sync(phone)
    }
    await sync(ipad)

    const file = JSON.parse(remote.files.get('data/days/2026-11-10.json')!)
    expect(file.tables.cards.map((c: Card) => c.id).sort()).toEqual(['card_1', 'card_i', 'card_p'])
    expect(ipad.get('cards', 'card_p')).toBeDefined()
  })

  it('一边删除，另一边没动：同步后两边都是删除状态', async () => {
    const { phone, ipad, sync } = setup()
    phone.write('cards', card('card_1', 1, '原文'))
    await sync(phone)
    await sync(ipad)
    ipad.write('cards', card('card_1', 9, '原文', { deleted: true }))
    await sync(ipad)
    await sync(phone)
    expect(phone.get<Card>('cards', 'card_1')?.deleted).toBe(true)
  })

  it('piles.json 和 settings.json：两台设备各改各的，都保留', async () => {
    const { remote, phone, ipad, sync } = setup()
    const pile = (id: string, t: number, name: string): Pile => ({ id, name, created_at: at(t), updated_at: at(t) })
    const setting = (id: string, t: number, value: string): Setting => ({ id, value, updated_at: at(t) })
    phone.write('settings', setting('current_question', 1, '旧问题'))
    await sync(phone)
    await sync(ipad)

    phone.write('piles', pile('pile_phone', 5, '手机建的'))
    phone.write('settings', setting('current_question', 6, '手机改的问题'))
    ipad.write('piles', pile('pile_ipad', 7, 'iPad 建的'))
    ipad.write('settings', setting('note', 8, 'iPad 加的'))
    await sync(phone)
    await sync(ipad)
    await sync(phone)

    for (const device of [phone, ipad]) {
      expect(device.all<Pile>('piles').map((p) => p.name).sort()).toEqual(['iPad 建的', '手机建的'])
      expect(device.get<Setting>('settings', 'current_question')?.value).toBe('手机改的问题')
      expect(device.get<Setting>('settings', 'note')?.value).toBe('iPad 加的')
    }
    expect(JSON.parse(remote.files.get('data/piles.json')!).tables.piles).toHaveLength(2)
  })

  it('很多改动只产生一个提交；没有改动时不提交', async () => {
    const { remote, phone, sync } = setup()
    for (let i = 0; i < 25; i++) phone.write('cards', card(`card_${i}`, i, `第 ${i} 次拖动`))
    phone.write('settings', { id: 'current_question', value: 'q', updated_at: at(40) } as Setting)
    const first = await sync(phone)
    expect(first.commits).toBe(1)
    expect(remote.commits).toHaveLength(1)
    expect(remote.commits[0].paths.sort()).toEqual(['data/days/2026-11-10.json', 'data/settings.json'])

    const second = await sync(phone)
    expect(second).toMatchObject({ commits: 0, pulled: 0, pushed: 0 })
    expect(remote.commits).toHaveLength(1)
  })

  it('同步过程中又改了的条目，下次还会再同步', async () => {
    const { remote, phone, sync } = setup()
    phone.write('cards', card('card_1', 1, '第一版'))
    remote.beforeCommit = async () => {
      phone.write('cards', card('card_1', 2, '同步途中改的'))
    }
    await sync(phone)
    expect((await phone.listDirty()).map((d) => d.id)).toEqual(['card_1'])
    await sync(phone)
    expect(remote.files.get('data/days/2026-11-10.json')).toContain('同步途中改的')
  })
})

describe('同步的节奏', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('连续拖动不会每次都同步：停手 5 秒后才同步一次', async () => {
    const run = vi.fn(async () => {})
    const s = new SyncScheduler({ run })
    for (let i = 0; i < 20; i++) {
      s.notifyChange()
      await vi.advanceTimersByTimeAsync(1_000) // still dragging
    }
    expect(run).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('两次同步之间至少隔一分钟', async () => {
    const run = vi.fn(async () => {})
    const s = new SyncScheduler({ run })
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)

    s.notifyChange()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('打开应用时马上同步一次', async () => {
    const run = vi.fn(async () => {})
    const s = new SyncScheduler({ run })
    s.requestSoon()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('同步进行中又有改动：结束后再排一次，不会并发', async () => {
    let release = () => {}
    const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const s = new SyncScheduler({ run })
    s.requestSoon()
    await vi.advanceTimersByTimeAsync(0)
    s.notifyChange()
    s.notifyChange()
    expect(run).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('令牌失效时的提示', () => {
  it('过期：说明发生了什么、本机内容还在、怎么换新令牌', () => {
    const p = explainFailure(401, true)
    expect(p.kind).toBe('token')
    expect(p.message).toContain('已过期')
    expect(p.message).toContain('没有在同步')
    expect(p.message).toContain('内容都还在')
    expect(p.steps.join('\n')).toContain('Expiration 选最长')
    expect(p.steps.join('\n')).toContain('只勾选数据仓库')
    expect(p.steps.join('\n')).toContain('Contents 选 Read and write')
  })

  it('被撤销、权限不够、找不到仓库：各有各的说明', () => {
    expect(explainFailure(401, false).message).toContain('已失效')
    expect(explainFailure(403, false).kind).toBe('permission')
    expect(explainFailure(404, false).kind).toBe('not_found')
    expect(explainFailure(404, false).steps.length).toBeGreaterThan(0)
  })
})
