import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupFile } from './backup'
import { applyChanges, db, TABLE_NAMES } from './db'
import { backupBeforeBoards, ensureBoards, lastMigrationReport } from './migration'
import { DexieLocal } from '../sync/dexieLocal'
import { syncOnce } from '../sync/engine'
import { MemoryRemote } from '../sync/memory'

const T = '2026-11-10T10:00:00.000Z'
let tick = 0
const now = () => new Date(Date.UTC(2026, 10, 14, 0, 0, tick++)).toISOString()

/** A device as it is today, before the update. */
async function oldNotebook() {
  await applyChanges({
    records: [{ id: 'r1', date: '2026-11-10', title: '记录', summary: '', activities: [], keywords: [], paper_dois: [], preamble_md: '', import_id: 'i1', updated_at: T }],
    cards: [
      { id: 'c1', record_id: 'r1', date: '2026-11-10', kind: '发现', heading: '发现', body_md: '导入的', order: 0, import_id: 'i1', updated_at: T },
      { id: 'h1', record_id: '', date: '2026-11-12', kind: '问题', heading: '问题', body_md: '手写的', order: 1, updated_at: T },
    ],
    boardItems: [
      { id: 'b1', board_id: 'day:2026-11-10', ref_type: 'card', ref_id: 'c1', x: 40, y: 50, w: 340, h: 0, z: 2, text_override: '改过', updated_at: T },
      { id: 'b2', board_id: 'pile:p1', ref_type: 'paper', ref_id: 'a', x: 1, y: 2, w: 300, h: 0, z: 1, updated_at: T },
    ],
    connectors: [{ id: 'k1', board_id: 'day:2026-11-10', from: 'card:c1', to: 'b1', arrow: true, updated_at: T }],
    strokes: [{ id: 's1', board_id: 'day:2026-11-10', points: [1, 2, 0.5], color: '#b4455c', size: 5, updated_at: T }],
    piles: [{ id: 'p1', name: '共在', created_at: T, updated_at: T }],
    papers: [{ id: 'a', title: '论文', authors: [], year: null, venue: '', doi: '', category: '霉菌', keywords: [], status: 'read', url: '', one_liner: '', basics_md: '', created_at: T, updated_at: T }],
  })
}

const dump = async () => {
  const out: Record<string, unknown[]> = {}
  for (const name of TABLE_NAMES) out[name] = (await db.table(name).toArray()).sort((a, b) => (a.id < b.id ? -1 : 1))
  return out
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await db.delete()
  await db.open()
})

describe('在这台设备上执行迁移', () => {
  it('先存一份全量备份，再新增；备份里是迁移前的样子', async () => {
    await oldNotebook()
    const before = await dump()
    const report = await ensureBoards()
    expect(report).toMatchObject({ ok: true, boardsAdded: 3, fieldsAdded: 1 })
    expect(report?.check.total).toBe(0)

    const backup = (await backupBeforeBoards()) as BackupFile
    expect(backup.tables.boards).toEqual([])
    expect(backup.tables.cards).toHaveLength(2)
    expect(backup.tables.strokes).toHaveLength(1)
    expect(JSON.stringify(backup.tables.boardItems)).toContain('改过')

    // every entry that existed is still there, byte for byte
    const after = await dump()
    for (const name of TABLE_NAMES) {
      if (name === 'boards' || name === 'fields') continue
      expect(after[name], name).toEqual(before[name])
    }
    expect((after.boards as { id: string }[]).map((b) => b.id)).toEqual(['day:2026-11-10', 'day:2026-11-12', 'pile:p1'])
    expect(await lastMigrationReport()).toMatchObject({ ok: true })
  })

  it('备份存不上：什么都不改，下次再试', async () => {
    await oldNotebook()
    const before = await dump()
    const real = db.device.put.bind(db.device)
    const put = vi.spyOn(db.device, 'put').mockImplementation(((row: { key: string }) =>
      row.key === 'backup-before-boards' ? Promise.reject(new Error('QuotaExceededError')) : real(row as never)) as never)
    const report = await ensureBoards()
    expect(report).toMatchObject({ ok: false, boardsAdded: 0 })
    expect(report?.error).toContain('Quota')
    expect(await dump()).toEqual(before)
    expect(await db.boards.count()).toBe(0)

    put.mockRestore()
    expect(await ensureBoards()).toMatchObject({ ok: true, boardsAdded: 3 })
  })

  it('再打开一次：没有可做的，备份也不会被后来的状态盖掉', async () => {
    await oldNotebook()
    await ensureBoards()
    const first = JSON.stringify(await backupBeforeBoards())
    expect(await ensureBoards()).toBeNull()
    await applyChanges({ cards: [{ id: 'late', record_id: '', date: '2026-11-20', kind: '思考', heading: '思考', body_md: '旧版本设备后来写的', order: 2, updated_at: T }] })
    expect(await ensureBoards()).toMatchObject({ ok: true, boardsAdded: 1 })
    expect(JSON.stringify(await backupBeforeBoards())).toBe(first)
  })

  it('全新的设备：没有内容，什么都不做，也不留备份', async () => {
    expect(await ensureBoards()).toBeNull()
    expect(await backupBeforeBoards()).toBeNull()
  })

  it('迁移后同步：画板和领域进了数据仓库，旧内容的文件不变', async () => {
    const remote = new MemoryRemote()
    await oldNotebook()
    await syncOnce(new DexieLocal(), remote, now)
    const dayFile = remote.files.get('data/days/2026-11-10.json')
    const boardFile = remote.files.get('data/boards/day-2026-11-10.json')

    await ensureBoards()
    const report = await syncOnce(new DexieLocal(), remote, now)
    expect(report.files.sort()).toEqual(['data/board-list.json', 'data/fields.json'])
    expect(remote.files.get('data/days/2026-11-10.json')).toBe(dayFile)
    expect(remote.files.get('data/boards/day-2026-11-10.json')).toBe(boardFile)
    expect(remote.files.get('data/board-list.json')).toContain('2026/11/10')
  })

  it('另一台设备已经迁移并同步过：这台设备收到后不会再建一遍', async () => {
    const remote = new MemoryRemote()
    await oldNotebook()
    await ensureBoards()
    await syncOnce(new DexieLocal(), remote, now)
    const listed = remote.files.get('data/board-list.json')

    // the same notebook on a second device that has not migrated yet
    await db.delete()
    await db.open()
    await oldNotebook()
    await ensureBoards()
    const report = await syncOnce(new DexieLocal(), remote, now)
    expect(report.commits).toBe(0)
    expect(remote.files.get('data/board-list.json')).toBe(listed)
    expect(await db.boards.count()).toBe(3)
  })
})
