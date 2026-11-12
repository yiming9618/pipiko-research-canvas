// @ts-nocheck — uses Node's file reading, which the app's own type settings do not include.
// A dry run of the migration against a real backup file (设置 → 导出全部).
// Nothing is written anywhere. Run:
//   BACKUP="/path/to/研究笔记本-备份-….json" npx vitest run src/domain/migrate.real.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkBoards, planMigration, type MigrationSnapshot } from './migrate'

const path = process.env.BACKUP

describe.skipIf(!path)('用真实备份试跑迁移（不写入任何东西）', () => {
  it('只新增；迁移后每条内容都有所属画板；再跑一次无事可做', () => {
    const file = JSON.parse(readFileSync(path!, 'utf-8')) as { tables: Record<string, { id: string; deleted?: boolean }[]> }
    const t = (name: string) => (file.tables[name] ?? []) as never[]
    const snap: MigrationSnapshot = {
      boards: t('boards'), fields: t('fields'), piles: t('piles'), papers: t('papers'), records: t('records'),
      cards: t('cards'), boardItems: t('boardItems'), connectors: t('connectors'), strokes: t('strokes'),
    }
    const frozen = JSON.stringify(snap)
    const changes = planMigration(snap)
    expect(JSON.stringify(snap)).toBe(frozen)
    expect(Object.keys(changes).every((k) => k === 'boards' || k === 'fields')).toBe(true)

    const after = { ...snap, boards: [...snap.boards, ...(changes.boards ?? [])], fields: [...snap.fields, ...(changes.fields ?? [])] }
    const check = checkBoards(after)
    const live = (rows: { deleted?: boolean }[]) => rows.filter((r) => !r.deleted).length
    console.log(
      [
        `备份里现有：记录 ${live(snap.records)}、卡片 ${live(snap.cards)}、画板上的位置 ${live(snap.boardItems)}、连线 ${live(snap.connectors)}、笔迹 ${live(snap.strokes)}、堆 ${live(snap.piles)}、论文 ${live(snap.papers)}`,
        `会新增：画板 ${changes.boards?.length ?? 0} 块（其中由堆的内容转来 ${(changes.boards ?? []).filter((b) => b.pile_id).length} 块）、领域 ${changes.fields?.length ?? 0} 个`,
        `画板名：${(changes.boards ?? []).map((b) => b.name).join('、') || '（无）'}`,
        `领域名：${(changes.fields ?? []).map((f) => f.name).join('、') || '（无）'}`,
        `迁移后找不到所属画板的内容：${check.total} 条`,
      ].join('\n'),
    )
    expect(check.total).toBe(0)
    expect(planMigration(after)).toEqual({})
  })
})
