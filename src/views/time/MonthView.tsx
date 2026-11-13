import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef } from 'react'
import { KIND_COLOR } from '../../domain/colors'
import { homeBoardId } from '../../domain/migrate'
import { neighbours, shownMonths } from '../../domain/timeline'
import type { Card, ResearchRecord } from '../../domain/types'
import { db, todayLocal } from '../../store/db'
import { Crumb } from './Crumb'
import { rememberOrigin, usePinchNav, useStageAnimation } from './zoom'

interface Day {
  date: string
  records: ResearchRecord[]
  cards: Card[]
  reads: string[]
}

/** A month: one tile for every day that has something, and nothing for the days that do not. */
export function MonthView({ ym, days }: { ym: string; days: string[] }) {
  const [year, month] = ym.split('-')
  const range = [`${ym}-01`, `${ym}-31`] as const

  const records = useLiveQuery(
    () => db.records.where('date').between(range[0], range[1], true, true).filter((r) => !r.deleted).toArray(),
    [ym],
  )
  const cards = useLiveQuery(
    () => db.cards.where('date').between(range[0], range[1], true, true).filter((c) => !c.deleted).toArray(),
    [ym],
  )
  const reads = useLiveQuery(async () => {
    const imports = await db.imports
      .filter((e) => e.kind === 'paper' && !e.undone && !e.deleted && e.date.startsWith(ym))
      .toArray()
    const papers = await db.papers.bulkGet(imports.map((e) => e.paper_id ?? ''))
    return imports.map((e, i) => ({ date: e.date, title: papers[i]?.title ?? '' })).filter((r) => r.title)
  }, [ym])
  const order = useLiveQuery(async () => new Map((await db.imports.toArray()).map((e) => [e.id, e.imported_at])))
  const boardNames = useLiveQuery(async () => new Map((await db.boards.filter((b) => !b.deleted).toArray()).map((b) => [b.id, b.name])))

  const shown = useMemo(() => {
    const map = new Map<string, Day>()
    const get = (date: string) => {
      if (!map.has(date)) map.set(date, { date, records: [], cards: [], reads: [] })
      return map.get(date)!
    }
    for (const c of cards ?? []) get(c.date).cards.push(c)
    for (const r of reads ?? []) {
      const day = get(r.date)
      if (!day.reads.includes(r.title)) day.reads.push(r.title)
    }
    // a record is listed on a day only when that day shows something of it
    for (const r of records ?? []) if (map.has(r.date)) map.get(r.date)!.records.push(r)
    for (const day of map.values()) {
      day.records.sort((a, b) => ((order?.get(a.import_id) ?? '') < (order?.get(b.import_id) ?? '') ? -1 : 1))
      const rank = new Map(day.records.map((r, i) => [r.id, i]))
      day.cards.sort((a, b) => (rank.get(a.record_id) ?? 99) - (rank.get(b.record_id) ?? 99) || a.order - b.order)
    }
    return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
  }, [records, cards, reads, order])

  const ready = records !== undefined && cards !== undefined && reads !== undefined
  const stage = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  useStageAnimation(stage, 1, ym, ready)
  usePinchNav(stage, {
    onIn: (tile) => {
      if (tile?.dataset.zoom) window.location.hash = `#/time/${tile.dataset.zoom}`
    },
    onOut: () => {
      window.location.hash = `#/time/${year}`
    },
  }, area)

  const { prev, next } = neighbours(shownMonths(days), ym)
  const label = (m: string) => `${m.slice(0, 4)} 年 ${Number(m.slice(5))} 月`
  const today = todayLocal()

  return (
    <div className="timeview" ref={area}>
      <header className="board-head">
        <Crumb
          base="#/time"
          year={year}
          month={month}
          prev={prev ? { href: `#/time/${prev}`, label: label(prev) } : undefined}
          next={next ? { href: `#/time/${next}`, label: label(next) } : undefined}
        />
        {ready && <span className="board-state">{shown.length > 0 ? `${shown.length} 天有内容` : '这个月没有内容'}</span>}
        <span className="zoom-hint">点一天进入，双指缩小回到全年</span>
      </header>

      <div className="stage" ref={stage} style={{ visibility: ready ? 'visible' : 'hidden' }}>
        <div className="day-grid">
          {shown.map((d) => (
            <DayTile key={d.date} day={d} today={d.date === today} boardNames={boardNames} />
          ))}
        </div>
      </div>
    </div>
  )
}

const SHOW_BOARDS = 3

function DayTile({ day, today, boardNames }: { day: Day; today: boolean; boardNames?: Map<string, string> }) {
  // the boards this day's cards are on, most cards first; at most three lines, then "另有 N 个画板"
  const perBoard = new Map<string, number>()
  for (const c of day.cards) {
    const name = boardNames?.get(homeBoardId(c))
    if (name !== undefined) perBoard.set(name, (perBoard.get(name) ?? 0) + 1)
  }
  const boards = [...perBoard.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
  const shown = boards.length > SHOW_BOARDS ? boards.slice(0, SHOW_BOARDS - 1) : boards
  const rest = boards.length - shown.length
  const first = day.records[0]
  const more = day.records.length - 1
  const title = first ? (first.title || first.summary || '（没有标题）') + (more > 0 ? ` 等 ${more + 1} 份` : '') : ''
  const label = `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8))}`
  return (
    <a className={`day-tile${today ? ' is-today' : ''}`} href={`#/time/${day.date}`} data-zoom={day.date} onClick={(e) => rememberOrigin(e.currentTarget)}>
      <b>{label}</b>
      {title && <span className="tile-title">{title}</span>}
      {day.reads.length > 0 && <span className="tile-title">读了 {day.reads.join('、')}</span>}
      {shown.length > 0 && (
        <span className="tile-boards">
          {shown.map(([name, n]) => (
            <span key={name} className="tile-board">
              <span className="tile-board-name">{name}</span>
              <span className="tile-board-n">{n} 张</span>
            </span>
          ))}
          {rest > 0 && <span className="tile-board tile-board-more">另有 {rest} 个画板</span>}
        </span>
      )}
      {day.cards.length > 0 && (
        <span className="thumb" role="img" aria-label={`${day.cards.length} 张卡片`}>
          {day.cards.slice(0, 9).map((c) => (
            <span key={c.id} data-color={KIND_COLOR[c.kind]} />
          ))}
        </span>
      )}
    </a>
  )
}
