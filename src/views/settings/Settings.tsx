import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { shortDate } from '../../domain/importer'
import type { Field, HighlightType, ImportEntry } from '../../domain/types'
import { fieldOfPaper } from '../../domain/migrate'
import { createField, deleteField, renameField } from '../../store/fieldActions'
import { downloadJson, exportAll, importBackup, parseBackup } from '../../store/backup'
import { db, todayLocal } from '../../store/db'
import { sampleImports } from '../../dev/samples'
import { runImport } from '../../store/actions'
import { saveType } from '../../store/paperActions'
import { backupBeforeBoards, currentBoardCheck, deleteBackupBeforeBoards, ensureBoards, lastMigrationReport } from '../../store/migration'
import { IconClose, IconDownload, IconUndo, IconUpload } from '../../ui/icons'
import { TopNav } from '../../ui/TopNav'
import { useUndo } from '../../ui/useUndo'
import { SyncSection } from './SyncSection'

const COLORS: [string, string][] = [
  ['default', '米色'],
  ['red', '红'],
  ['pink', '粉'],
  ['orange', '橙'],
  ['yellow', '黄'],
  ['green', '绿'],
  ['teal', '青'],
  ['blue', '蓝'],
  ['purple', '紫'],
  ['gray', '灰'],
]

/** The preset types are fixed; types that came in from Markdown can be renamed and recoloured. */
function TypeEditor() {
  const types = useLiveQuery(() => db.types.filter((t) => !t.deleted).sortBy('order'))
  return (
    <section className="section" aria-labelledby="s-types">
      <h2 id="s-types">重点类型</h2>
      <p className="section-note">预设的 8 种是固定的。导入时新出现的类型可以在这里改名、改颜色，已有的区块会一起更新。</p>
      <ul className="type-list">
        {types?.map((t: HighlightType) => (
          <li key={t.id} className="type-row" data-color={t.color}>
            <span className="dot" aria-hidden="true" />
            {t.builtin ? (
              <span className="type-name">{t.name}</span>
            ) : (
              <>
                <label className="type-name">
                  <span className="sr-only">类型名称</span>
                  <input
                    key={t.name}
                    defaultValue={t.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim()
                      if (name && name !== t.name) void saveType(t, { name })
                      else e.target.value = t.name
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                  />
                </label>
                <label>
                  <span className="sr-only">颜色</span>
                  <select value={t.color} onChange={(e) => void saveType(t, { color: e.target.value })}>
                    {COLORS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Fields (领域): make, rename, delete. A paper belongs to at most one. */
function FieldEditor({ focus }: { focus: boolean }) {
  const fields = useLiveQuery(() => db.fields.filter((f) => !f.deleted).toArray())
  const papers = useLiveQuery(() => db.papers.filter((p) => !p.deleted && p.status === 'read').toArray())
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (focus && fields) ref.current?.scrollIntoView({ block: 'start' })
  }, [focus, fields !== undefined])

  const count = (f: Field) => (papers ?? []).filter((p) => fieldOfPaper(p, fields ?? [])?.id === f.id).length
  const sorted = [...(fields ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  const say = (text: string) => {
    setNote(text)
    setTimeout(() => setNote(''), 3200)
  }

  return (
    <section className="section" aria-labelledby="s-fields" ref={ref}>
      <h2 id="s-fields">领域</h2>
      <p className="section-note">一篇论文属于一个领域，论文库按领域分组。改名后所有论文跟着变；删除领域，里面的论文变回“未分类”，论文本身不受影响。</p>
      {fields && sorted.length === 0 && <p className="empty">还没有领域。导入论文时，Markdown 里的 category 会自动变成领域。</p>}
      <ul className="type-list">
        {sorted.map((f) => (
          <li key={f.id} className="type-row field-row">
            <label className="type-name">
              <span className="sr-only">领域名称</span>
              <input
                key={f.name}
                defaultValue={f.name}
                onBlur={(e) => {
                  const next = e.target.value
                  void renameField(f, next).then((r) => {
                    if (r !== 'done') {
                      e.target.value = f.name
                      say(r === 'taken' ? `已经有叫「${next.trim()}」的领域了` : '领域的名字不能是空的')
                    }
                  })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
              />
            </label>
            <span className="field-count">{count(f)} 篇</span>
            <button
              type="button"
              className="icon-btn"
              aria-label={`删除领域：${f.name}`}
              onClick={() => {
                const n = count(f)
                if (window.confirm(`删除领域「${f.name}」？${n > 0 ? `里面的 ${n} 篇论文会变回“未分类”。` : ''}`)) void deleteField(f)
              }}
            >
              <IconClose />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="box-new"
        onSubmit={(e) => {
          e.preventDefault()
          void createField(name).then((out) => {
            if (out === 'taken') say('已经有同名的领域了')
            else if (out !== 'empty') setName('')
          })
        }}
      >
        <label>
          <span className="sr-only">新领域的名字</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="新领域的名字" maxLength={40} />
        </label>
        <button type="submit" className="btn" disabled={!name.trim()}>
          新建
        </button>
      </form>
      <p className="status-line is-error" role="status">
        {note}
      </p>
    </section>
  )
}

/** Only in the local test build: one tap to fill the notebook with placeholder content. */
function Samples() {
  const [status, setStatus] = useState('')
  const add = async () => {
    const lines: string[] = []
    for (const sample of sampleImports(todayLocal())) {
      const out = await runImport(sample.md, sample.kind)
      lines.push(out.message)
    }
    setStatus(lines.join('；'))
  }
  return (
    <section className="section" aria-labelledby="s-samples">
      <h2 id="s-samples">测试用</h2>
      <p className="section-note">
        只在本地测试版里出现。放入两篇占位论文和两份引用它们的研究记录（今天和三天前）。每一份都可以在上面的"最近导入"里撤销。
      </p>
      <div className="row-actions">
        <button type="button" className="btn" onClick={() => void add()}>
          放入示例内容
        </button>
      </div>
      <p className="status-line" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  )
}

/** The backup taken automatically just before the move to subject boards, and how that move went. */
function BeforeBoards() {
  const state = useLiveQuery(async () => ({
    backup: await backupBeforeBoards(),
    report: await lastMigrationReport(),
    check: await currentBoardCheck(),
  }))
  if (!state || (!state.backup && !state.report)) return null
  const { backup, report, check } = state
  return (
    <div className="before-boards">
      {report && !report.ok && (
        <p className="status-line is-error" role="alert">
          画板的升级没有执行：迁移前的备份没能存上（{report.error}）。这台设备上的内容没有任何改动，下次打开会再试。
        </p>
      )}
      {check.total > 0 && (
        <p className="status-line is-error" role="alert">
          有 {check.total} 条内容找不到所属的画板（卡片 {check.cards}、记录 {check.records}、画板上的东西{' '}
          {check.boardItems + check.connectors + check.strokes}）。它们都还在，没有被删除；请把这句话告诉开发者。
        </p>
      )}
      {backup && (
        <>
          <p className="section-note">
            升级画板之前，这台设备自动存了一份全量备份（{clock(backup.exported_at)}）。它只存在这台设备里，不参与同步。
          </p>
          <div className="row-actions">
            <button type="button" className="btn" onClick={() => downloadJson(backup, `升级画板前-${backup.exported_at.slice(0, 10)}`)}>
              <IconDownload />
              下载升级前的备份
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                if (window.confirm('删除这份升级前的备份？建议先下载一份再删。')) void deleteBackupBeforeBoards()
              }}
            >
              不需要了，删除
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function clock(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function Settings({ section }: { section?: string }) {
  const imports = useLiveQuery(() => db.imports.orderBy('imported_at').reverse().limit(30).toArray())
  const { requestUndo, dialog } = useUndo()
  const [openRaw, setOpenRaw] = useState<string | null>(null)
  const [backup, setBackup] = useState<{ text: string; error?: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const doExport = async () => {
    try {
      downloadJson(await exportAll(), todayLocal())
      setBackup({ text: '已导出。请把这个文件存到"文件"或 iCloud 云盘里。' })
    } catch (err) {
      setBackup({ text: `导出失败：${err instanceof Error ? err.message : String(err)}`, error: true })
    }
  }

  const doImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const { added, total } = await importBackup(parseBackup(await file.text()))
      // a backup from before subject boards brings daily boards and old piles: give them their boards
      await ensureBoards()
      setBackup({
        text:
          added === 0
            ? `备份里的 ${total} 条内容这台设备上都已经有了，没有变化。`
            : `已导入：补上或更新了 ${added} 条内容（备份共 ${total} 条）。`,
      })
    } catch (err) {
      setBackup({ text: err instanceof Error ? err.message : String(err), error: true })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <main className="page">
      <TopNav current="settings" />
      <header className="page-head">
        <h1>设置</h1>
      </header>

      <section className="section" aria-labelledby="s-imports">
        <h2 id="s-imports">最近导入</h2>
        {imports && imports.length === 0 && <p className="empty">还没有导入过内容。</p>}
        <ul className="import-list">
          {imports?.map((e: ImportEntry) => (
            <li key={e.id} className={`import-item${e.undone ? ' is-undone' : ''}`}>
              <div className="import-meta">
                <span className="tag">{e.kind === 'paper' ? '论文' : '研究记录'}</span>
                <span>内容日期 {shortDate(e.date)}</span>
                <span>导入于 {clock(e.imported_at)}</span>
                {e.undone && <span>已撤销</span>}
              </div>
              <p className="import-msg">{e.message}</p>
              <div className="import-actions">
                <button
                  type="button"
                  className="btn btn-quiet"
                  aria-expanded={openRaw === e.id}
                  onClick={() => setOpenRaw(openRaw === e.id ? null : e.id)}
                >
                  {openRaw === e.id ? '收起原文' : '查看原始 Markdown'}
                </button>
                {!e.undone && (
                  <button type="button" className="btn btn-quiet" onClick={() => void requestUndo(e)}>
                    <IconUndo />
                    撤销
                  </button>
                )}
              </div>
              {openRaw === e.id && <pre className="raw">{e.raw_md}</pre>}
            </li>
          ))}
        </ul>
      </section>

      <TypeEditor />

      <FieldEditor focus={section === 'fields'} />

      {import.meta.env.DEV && <Samples />}

      <section className="section" aria-labelledby="s-backup">
        <h2 id="s-backup">备份</h2>
        <p className="section-note">
          导出会把这台设备上的全部内容存成一个 JSON 文件。导入只会补上缺少的、更新较旧的，不会删掉这台设备上已有的内容。
        </p>
        <div className="row-actions">
          <button type="button" className="btn" onClick={() => void doExport()}>
            <IconDownload />
            导出全部
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            <IconUpload />
            从备份导入
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(ev) => void doImport(ev.target.files?.[0])}
          />
        </div>
        <p className={`status-line${backup?.error ? ' is-error' : ''}`} role="status" aria-live="polite">
          {backup?.text}
        </p>
        <BeforeBoards />
      </section>

      <SyncSection />

      {dialog}
    </main>
  )
}
