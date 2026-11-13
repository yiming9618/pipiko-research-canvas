import { useLiveQuery } from 'dexie-react-hooks'
import { useRef } from 'react'
import { boardHref } from '../../domain/boards'
import { KIND_COLOR } from '../../domain/colors'
import { homeBoardId } from '../../domain/migrate'
import { neighbours } from '../../domain/timeline'
import type { Card } from '../../domain/types'
import { db } from '../../store/db'
import { Crumb } from './Crumb'
import { rememberOrigin, usePinchNav, useStageAnimation } from './zoom'

const KIND_ORDER = ['发现', '实验', '问题', '思考', '下一步']

/** "发现 2 · 实验 1 · 思考 1" (other headings after the five kinds). */
function kindCounts(cards: Card[]): string {
  const counts = new Map<string, number>()
  for (const c of cards) {
    const k = c.kind === '其他' ? c.heading || '其他' : c.kind
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const rank = (k: string) => (KIND_ORDER.includes(k) ? KIND_ORDER.indexOf(k) : KIND_ORDER.length)
  return [...counts.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ')
}

/**
 * One day: every card that carries this date, whichever board it is on.
 * Each card names its board; tapping it opens that board with the card in view.
 */
export function DayView({ date, days }: { date: string; days: string[] }) {
  const [year, month] = date.split('-')
  const data = useLiveQuery(async () => {
    const [cards, boards, items, imports] = await Promise.all([
      db.cards.where('date').equals(date).filter((c) => !c.deleted).toArray(),
      db.boards.toArray(),
      db.boardItems.filter((i) => !i.deleted && i.ref_type === 'card' && i.text_override !== undefined).toArray(),
      db.imports.filter((e) => e.kind === 'paper' && !e.undone && !e.deleted).toArray(),
    ])
    const readToday = imports.filter((e) => e.date === date && e.paper_id)
    const papers = await db.papers.bulkGet([...new Set(readToday.map((e) => e.paper_id!))])
    const reads = papers
      .filter((p) => !!p && !p.deleted && !p.trashed_at)
      .map((p) => ({ paper: p!, again: imports.some((o) => o.paper_id === p!.id && o.date < date) }))
    return { cards, boards, items, reads }
  }, [date])

  const ready = data !== undefined
  const stage = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  useStageAnimation(stage, 2, date, ready)
  usePinchNav(stage, {
    onOut: () => {
      window.location.hash = `#/time/${year}-${month}`
    },
  }, area)

  const { prev, next } = neighbours(days, date)
  const short = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`

  // cards grouped by the board they are on, boards in order of name
  const groups = new Map<string, Card[]>()
  for (const c of data?.cards ?? []) groups.set(homeBoardId(c), [...(groups.get(homeBoardId(c)) ?? []), c])
  const boardName = (id: string) => data?.boards.find((b) => b.id === id && !b.deleted && !b.trashed_at)?.name
  const ordered = [...groups.entries()]
    .filter(([id]) => boardName(id) !== undefined)
    .sort(([a], [b]) => boardName(a)!.localeCompare(boardName(b)!, 'zh'))
  // the wording as it reads on its board now
  const textOf = (c: Card) => data?.items.find((i) => i.board_id === homeBoardId(c) && i.ref_id === c.id)?.text_override ?? c.body_md

  return (
    <div className="timeview" ref={area}>
      <header className="board-head">
        <Crumb
          base="#/time"
          year={year}
          month={month}
          date={date}
          prev={prev ? { href: `#/time/${prev}`, label: short(prev) } : undefined}
          next={next ? { href: `#/time/${next}`, label: short(next) } : undefined}
        />
        {ready && <span className="board-state">{data.cards.length} 张卡片</span>}
        <span className="zoom-hint">点一张卡片，打开它所在的画板</span>
      </header>

      <div className="stage day-stage" ref={stage} style={{ visibility: ready ? 'visible' : 'hidden' }}>
        {ready && data.reads.length > 0 && (
          <div className="markers day-reads">
            {data.reads.map(({ paper, again }) => (
              <a key={paper.id} className="marker" href={`#/paper/${paper.id}`}>
                {again ? '重读了' : '读了'} {paper.title}
              </a>
            ))}
          </div>
        )}
        {ready && ordered.length === 0 && data.reads.length === 0 && <p className="empty">这一天没有内容。</p>}
        {ordered.map(([boardId, cards]) => (
          <section key={boardId} className="day-board" aria-label={`画板：${boardName(boardId)}`}>
            <h2>
              <a href={boardHref(boardId)}>{boardName(boardId)}</a>
              <span className="day-board-count">{kindCounts(cards)}</span>
            </h2>
            <ul className="day-cards">
              {cards
                .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
                .map((c) => (
                  <li key={c.id}>
                    <a className="day-card" data-color={KIND_COLOR[c.kind]} href={boardHref(boardId, c.id)} onClick={(e) => rememberOrigin(e.currentTarget)}>
                      <span className="card-kind">{c.kind === '其他' ? c.heading : c.kind}</span>
                      <span className="day-card-text">{textOf(c)}</span>
                      <span className="day-card-board">在「{boardName(boardId)}」</span>
                    </a>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
