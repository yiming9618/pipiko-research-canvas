import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type FormEvent } from 'react'
import { activeBoxes, archivedBoxes, itemsOf } from '../../domain/discussions'
import { buildExport } from '../../domain/exportMarkdown'
import { shortDate } from '../../domain/importer'
import type { Discussion, DiscussionItem } from '../../domain/types'
import { db } from '../../store/db'
import {
  archiveDiscussion,
  createDiscussion,
  deleteDiscussion,
  removeFromDiscussion,
  renameDiscussion,
} from '../../store/discussionActions'
import { copyText } from '../../ui/clipboard'
import { IconBack, IconChevron, IconClose, IconCopy, IconPlus } from '../../ui/icons'
import { TopNav } from '../../ui/TopNav'

const KIND_WORD: Record<DiscussionItem['ref_type'], string> = { paper: '篇论文', card: '张卡片', day: '天的画板', pile: '个堆', board: '块画板' }

function summary(items: DiscussionItem[]): string {
  if (items.length === 0) return '还是空的'
  return (['paper', 'card', 'day', 'pile'] as const)
    .map((t) => [t, items.filter((i) => i.ref_type === t).length] as const)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${KIND_WORD[t]}`)
    .join(' · ')
}

/** The list of discussion boxes. */
export function DiscussionsPage() {
  const boxes = useLiveQuery(() => db.discussions.toArray())
  const items = useLiveQuery(() => db.discussionItems.filter((i) => !i.deleted).toArray())
  const [name, setName] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const active = activeBoxes(boxes ?? [])
  const archived = archivedBoxes(boxes ?? [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await createDiscussion(name)
    setName('')
  }

  return (
    <main className="page">
      <TopNav current="discussions" />
      <header className="page-head">
        <h1>讨论框</h1>
      </header>

      <section className="section">
        <p className="section-note">
          把想和 AI 讨论的论文、卡片、画板、堆放进一个框里，再一次导出。放进来的只是引用，原件不会动。
        </p>
        {boxes && active.length === 0 && <p className="empty">还没有讨论框。在下面起个名字建一个，或者在论文、画板上点"放进讨论框"时当场新建。</p>}
        <ul className="box-list">
          {active.map((b) => (
            <li key={b.id}>
              <a className="box-row" href={`#/discussion/${b.id}`}>
                <span className="box-name">{b.name}</span>
                <span className="box-count">{summary(itemsOf(b.id, items ?? []))}</span>
              </a>
            </li>
          ))}
        </ul>
        <form className="box-new" onSubmit={(e) => void create(e)}>
          <label>
            <span className="sr-only">新讨论框的名字</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="新讨论框的名字" maxLength={40} />
          </label>
          <button type="submit" className="btn" disabled={!name.trim()}>
            <IconPlus />
            新建
          </button>
        </form>
      </section>

      {archived.length > 0 && (
        <section className="section group">
          <button type="button" className="group-head" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
            <span>已归档</span>
            <span className="group-count">{archived.length}</span>
            <IconChevron />
          </button>
          {showArchived && (
            <ul className="box-list">
              {archived.map((b) => (
                <li key={b.id} className="box-archived">
                  <a className="box-row" href={`#/discussion/${b.id}`}>
                    <span className="box-name">{b.name}</span>
                    <span className="box-count">
                      {summary(itemsOf(b.id, items ?? []))} · 归档于 {shortDate(b.archived_at!.slice(0, 10))}
                    </span>
                  </a>
                  <button type="button" className="btn btn-quiet" aria-label={`找回：${b.name}`} onClick={() => void archiveDiscussion(b, false)}>
                    找回
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  )
}

function Title({ box }: { box: Discussion }) {
  const [name, setName] = useState<string | null>(null)
  const save = () => {
    if (name !== null) void renameDiscussion(box, name)
    setName(null)
  }
  if (name === null) {
    return (
      <h1 className="pile-title">
        <button type="button" onClick={() => setName(box.name)} aria-label={`改名：${box.name}`}>
          {box.name}
        </button>
      </h1>
    )
  }
  return (
    <label className="pile-title-edit">
      <span className="sr-only">讨论框的名字</span>
      <input
        value={name}
        autoFocus
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') setName(null)
        }}
      />
    </label>
  )
}

/** One discussion box: what is in it, and "导出给 AI". */
export function DiscussionPage({ id }: { id: string }) {
  const data = useLiveQuery(async () => {
    const [box, items, papers, blocks, types, records, cards, boardItems, connectors, strokes, piles, imports] = await Promise.all([
      db.discussions.get(id),
      db.discussionItems.where('discussion_id').equals(id).toArray(),
      db.papers.toArray(),
      db.blocks.toArray(),
      db.types.toArray(),
      db.records.toArray(),
      db.cards.toArray(),
      db.boardItems.toArray(),
      db.connectors.toArray(),
      db.strokes.toArray(),
      db.piles.toArray(),
      db.imports.toArray(),
    ])
    return { box: box ?? null, items: itemsOf(id, items), papers, blocks, types, records, cards, boardItems, connectors, strokes, piles, imports }
  }, [id])
  const [exported, setExported] = useState<'ok' | 'manual' | null>(null)

  // Ready before the button is pressed: copying has to happen in the same tap on iPad and iPhone.
  const markdown = useMemo(() => (data?.box ? buildExport({ ...data, box: data.box }) : ''), [data])

  if (!data) return <main className="page"><TopNav current="discussions" /></main>
  const box = data.box
  if (!box || box.deleted) {
    return (
      <main className="page">
        <TopNav current="discussions" />
        <a className="crumb-link back-link" href="#/discussions">
          <IconBack />
          讨论框
        </a>
        <p className="empty">找不到这个讨论框，可能已经删掉了。</p>
      </main>
    )
  }

  // each item → what to show; items whose original is gone are left out
  const rows = data.items
    .map((item) => {
      if (item.ref_type === 'paper') {
        const p = data.papers.find((x) => x.id === item.ref_id && !x.deleted)
        return p && { item, kind: p.status === 'want' ? '想看' : '论文', text: p.title || p.doi || p.url, href: p.status === 'want' ? '#/library' : `#/paper/${p.id}` }
      }
      if (item.ref_type === 'card') {
        const c = data.cards.find((x) => x.id === item.ref_id && !x.deleted)
        if (!c) return null
        const edited = data.boardItems.find((i) => !i.deleted && i.board_id === `day:${c.date}` && i.ref_type === 'card' && i.ref_id === c.id && i.text_override !== undefined)
        const text = (edited?.text_override ?? c.body_md).replace(/\s+/g, ' ').trim()
        return { item, kind: `${c.kind === '其他' ? c.heading : c.kind} · ${shortDate(c.date)}`, text: text.length > 80 ? text.slice(0, 80) + '…' : text, href: `#/board/${c.date}` }
      }
      if (item.ref_type === 'day') {
        const titles = data.records.filter((r) => !r.deleted && r.date === item.ref_id).map((r) => r.title)
        return { item, kind: '整块画板', text: `${shortDate(item.ref_id)}${titles.length > 0 ? ` · ${titles.join('、')}` : ''}`, href: `#/board/${item.ref_id}` }
      }
      const pile = data.piles.find((x) => x.id === item.ref_id && !x.deleted)
      return pile && { item, kind: '堆', text: pile.name, href: `#/pile/${pile.id}` }
    })
    .filter((r): r is NonNullable<typeof r> => !!r)

  const doExport = async () => {
    setExported((await copyText(markdown)) ? 'ok' : 'manual')
  }

  return (
    <main className="page">
      <TopNav current="discussions" />
      <header className="page-head box-head">
        <a className="crumb-link" href="#/discussions" aria-label="回到讨论框列表">
          <IconBack />
        </a>
        <Title box={box} />
      </header>

      <section className="section">
        {box.archived_at && (
          <p className="section-note">
            这个讨论框已归档。
            <button type="button" className="link-btn" onClick={() => void archiveDiscussion(box, false)}>
              找回
            </button>
          </p>
        )}
        {rows.length === 0 && <p className="empty">还是空的。在论文页、想看列表、画板或堆里点"放进讨论框"。</p>}
        <ul className="box-items">
          {rows.map(({ item, kind, text, href }) => (
            <li key={item.id} className="box-item">
              <a href={href}>
                <span className="box-item-kind">{kind}</span>
                <span className="box-item-text">{text || '（没有标题）'}</span>
              </a>
              <button type="button" className="icon-btn" aria-label={`移出讨论框：${text}`} onClick={() => void removeFromDiscussion(item)}>
                <IconClose />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <div className="row-actions">
          <button type="button" className="btn btn-primary" disabled={rows.length === 0} onClick={() => void doExport()}>
            <IconCopy />
            导出给 AI
          </button>
        </div>
        <div role="status" aria-live="polite">
          {exported === 'ok' && (
            <div className="result">
              <p className="result-text">已复制到剪贴板，去和 AI 的对话里粘贴。</p>
              {!box.archived_at && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void archiveDiscussion(box, true).then(() => {
                      window.location.hash = '#/discussions'
                    })
                  }}
                >
                  归档这个讨论框
                </button>
              )}
            </div>
          )}
          {exported === 'manual' && <p className="status-line is-error">没能自动复制。请在下面的文本框里全选后手动复制。</p>}
        </div>
        {exported === 'manual' && (
          <label>
            <span className="sr-only">导出的内容</span>
            <textarea className="md-input" readOnly value={markdown} onFocus={(e) => e.currentTarget.select()} />
          </label>
        )}
        <details className="box-preview">
          <summary>看看会导出什么</summary>
          <pre className="raw">{markdown}</pre>
        </details>
      </section>

      <section className="section">
        <div className="row-actions">
          {!box.archived_at && (
            <button type="button" className="btn btn-quiet" onClick={() => void archiveDiscussion(box, true).then(() => (window.location.hash = '#/discussions'))}>
              归档
            </button>
          )}
          <button
            type="button"
            className="btn btn-quiet form-remove"
            onClick={() => {
              if (window.confirm(`删除讨论框「${box.name}」？放在里面的论文、卡片、画板和堆都不受影响。`)) {
                void deleteDiscussion(box).then(() => {
                  window.location.hash = '#/discussions'
                })
              }
            }}
          >
            删除这个讨论框
          </button>
        </div>
      </section>
    </main>
  )
}
