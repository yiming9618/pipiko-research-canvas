import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Card, Pile } from '../domain/types'
import { applyChanges, db } from '../store/db'
import { exportAll } from '../store/backup'
import { DexieLocal, markAllDirty } from './dexieLocal'
import { syncOnce } from './engine'
import { MemoryLocal, MemoryRemote } from './memory'

let tick = 0
const now = () => new Date(Date.UTC(2026, 10, 11, 0, 0, tick++)).toISOString()

const pile = (id: string, name: string, at: string, deleted = false): Pile =>
  ({ id, name, created_at: at, updated_at: at, ...(deleted ? { deleted: true } : {}) }) as Pile
const card = (id: string, body: string, at: string): Card =>
  ({ id, record_id: 'r1', date: '2026-11-10', kind: '问题', heading: '问题', body_md: body, order: 0, updated_at: at }) as Card

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('这台设备（IndexedDB）与数据仓库的同步', () => {
  it('本机的改动发出去，发完不再重复发', async () => {
    const remote = new MemoryRemote()
    await applyChanges({ piles: [pile('p1', '共在', now())] })
    const first = await syncOnce(new DexieLocal(), remote, now)
    expect(first.commits).toBe(1)
    expect(remote.files.get('data/piles.json')).toContain('共在')
    expect(await db.dirty.count()).toBe(0)
    const second = await syncOnce(new DexieLocal(), remote, now)
    expect(second.commits).toBe(0)
  })

  it('另一台设备的内容收进来，而且不会被当成本机改动再发回去', async () => {
    const remote = new MemoryRemote()
    const phone = new MemoryLocal()
    phone.write('cards', card('c1', '手机上导入的', now()))
    await syncOnce(phone, remote, now)

    const report = await syncOnce(new DexieLocal(), remote, now)
    expect(report.pulled).toBe(1)
    expect(report.commits).toBe(0)
    expect((await db.cards.get('c1'))?.body_md).toBe('手机上导入的')
    expect(await db.dirty.count()).toBe(0)
  })

  it('两台设备往同一个文件各加一条，两条都留下', async () => {
    const remote = new MemoryRemote()
    const phone = new MemoryLocal()
    phone.write('cards', card('c-phone', '手机', now()))
    await syncOnce(phone, remote, now)
    await applyChanges({ cards: [card('c-ipad', 'iPad', now())] })
    await syncOnce(new DexieLocal(), remote, now)
    await syncOnce(phone, remote, now)

    expect((await db.cards.toArray()).map((c) => c.id).sort()).toEqual(['c-ipad', 'c-phone'])
    expect(phone.all('cards').map((c) => c.id).sort()).toEqual(['c-ipad', 'c-phone'])
  })

  it('别处的删除不会被这台设备上的旧内容复活', async () => {
    const remote = new MemoryRemote()
    await applyChanges({ piles: [pile('p1', '旧名字', now())] })
    await syncOnce(new DexieLocal(), remote, now)
    const phone = new MemoryLocal()
    await syncOnce(phone, remote, now)
    phone.write('piles', pile('p1', '旧名字', now(), true))
    await syncOnce(phone, remote, now)

    await syncOnce(new DexieLocal(), remote, now)
    expect((await db.piles.get('p1'))?.deleted).toBe(true)
  })

  it('同步进行到一半时本机又改了：保留本机较新的，并在下一轮发出', async () => {
    const remote = new MemoryRemote()
    const phone = new MemoryLocal()
    phone.write('piles', pile('p1', '手机起的名字', '2026-11-11T00:00:00.000Z'))
    phone.write('cards', card('c1', '顺带的一条', '2026-11-11T00:00:00.000Z'))
    await syncOnce(phone, remote, now)

    // this device has its own edit to send, so the round makes a commit
    await applyChanges({ cards: [card('c2', '本机的', '2026-11-11T00:00:01.000Z')] })
    remote.beforeCommit = async () => {
      await applyChanges({ piles: [pile('p1', '同步途中改的名字', '2026-11-11T09:00:00.000Z')] })
    }
    await syncOnce(new DexieLocal(), remote, now)
    expect((await db.piles.get('p1'))?.name).toBe('同步途中改的名字')
    expect(await db.dirty.count()).toBe(1)

    await syncOnce(new DexieLocal(), remote, now)
    expect(remote.files.get('data/piles.json')).toContain('同步途中改的名字')
  })

  it('第一次连接时，把连接前就有的内容全部发出去', async () => {
    const remote = new MemoryRemote()
    await applyChanges({ piles: [pile('p1', '连接前', now())], cards: [card('c1', '连接前的卡片', now())] })
    await db.dirty.clear()
    await markAllDirty()
    await syncOnce(new DexieLocal(), remote, now)
    expect(remote.files.get('data/piles.json')).toContain('连接前')
    expect(remote.files.get('data/days/2026-11-10.json')).toContain('连接前的卡片')
  })

  it('令牌和同步记录不会进入备份文件', async () => {
    await db.device.put({ key: 'sync-config', value: { owner: 'o', repo: 'r', token: 'SECRET-TOKEN' } })
    expect(JSON.stringify(await exportAll())).not.toContain('SECRET-TOKEN')
  })
})
