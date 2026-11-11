import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef } from 'react'
import { KIND_COLOR } from '../../domain/colors'
import type { Card, ResearchRecord } from '../../domain/types'
import { datesOfMonth, neighbours, shownMonths } from '../../domain/timeline'
import { db, todayLocal } from '../../store/db'
import { PileShelf } from '../piles/PileShelf'
import { Crumb } from './Crumb'
import { rememberOrigin, usePinchNav, useStageAnimation } from './zoom'

export { KIND_COLOR }

const PERIODS = [
  { label: '上旬', from: 1, to: 10 },
  { label: '中旬', from: 11, to: 20 },
  { label: '下旬', from: 21, to: 31 },
]

interface Day {
  date: string
  records: ResearchRecord[]
  cards: Card[]
  reads: string[]
}

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

  const byDate = useMemo(() => {
    const map = new Map<string, Day>()
    const get = (date: string) => {
      if (!map.has(date)) map.set(date, { date, records: [], cards: [], reads: [] })
      return map.get(date)!
    }
    for (const r of records ?? []) get(r.date).records.push(r)
    for (const c of cards ?? []) get(c.date).cards.push(c)
    for (const r of reads ?? []) {
      const day = get(r.date)
      if (!day.reads.includes(r.title)) day.reads.push(r.title)
    }
    for (const day of map.values()) {
      day.records.sort((a, b) => ((order?.get(a.import_id) ?? '') < (order?.get(b.import_id) ?? '') ? -1 : 1))
      const rank = new Map(day.records.map((r, i) => [r.id, i]))
      day.cards.sort((a, b) => (rank.get(a.record_id) ?? 0) - (rank.get(b.record_id) ?? 0) || a.order - b.order)
    }
    return map
  }, [records, cards, reads, order])

  const ready = records !== undefined && cards !== undefined && reads !== undefined
  const stage = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  useStageAnimation(stage, 1, ym, ready)
  usePinchNav(stage, {
    onIn: (tile) => {
      if (tile?.dataset.zoom) window.location.hash = `#/board/${tile.dataset.zoom}`
    },
    onOut: () => {
      window.location.hash = `#/board/${year}`
    },
  }, area)

  const today = todayLocal()
  const { prev, next } = neighbours(shownMonths(days, today), ym)
  const label = (m: string) => `${m.slice(0, 4)} 年 ${Number(m.slice(5))} 月`
  // A day counts when it has records, cards or papers read, or anything on its board.
  const withContent = new Set([...byDate.keys(), ...days.filter((d) => d.startsWith(ym))])
  const count = withContent.size
  const thisMonth = ym === today.slice(0, 7)
  const allDates = datesOfMonth(ym)

  return (
    <div className="timeview" ref={area}>
      <header className="board-head">
        <Crumb
          year={year}
          month={month}
          prev={prev ? { href: `#/board/${prev}`, label: label(prev) } : undefined}
          next={next ? { href: `#/board/${next}`, label: label(next) } : undefined}
        />
        {ready && <span className="board-state">{count > 0 ? `${count} 天有内容` : '这个月还是空的'}</span>}
        <span className="zoom-hint">点任何一天进入，双指缩小回到全年</span>
      </header>

      <div className="stage" ref={stage} style={{ visibility: ready ? 'visible' : 'hidden' }}>
        {PERIODS.map((p) => {
          const dates = allDates.filter((d) => {
            const n = Number(d.slice(8))
            return n >= p.from && n <= p.to
          })
          const full = dates.filter((d) => withContent.has(d))
          const blank = dates.filter((d) => !withContent.has(d))
          return (
            <section key={p.label} className="period" aria-label={p.label}>
              <h2 className="period-label">{p.label}</h2>
              <div className="period-body">
                {full.length > 0 && (
                  <div className="day-grid">
                    {full.map((d) => (
                      <DayTile key={d} day={byDate.get(d) ?? { date: d, records: [], cards: [], reads: [] }} today={d === today} />
                    ))}
                  </div>
                )}
                {/* Days with nothing yet: small, but each one opens a blank board. Fainter outside the current month. */}
                <div className={`blank-days${thisMonth ? '' : ' is-faint'}`}>
                  {blank.map((d) => (
                    <a
                      key={d}
                      className={`blank-day${d === today ? ' is-today' : ''}`}
                      href={`#/board/${d}`}
                      data-zoom={d}
                      aria-label={`${Number(d.slice(5, 7))} 月 ${Number(d.slice(8))} 日，空白${d === today ? '，今天' : ''}`}
                      onClick={(e) => rememberOrigin(e.currentTarget)}
                    >
                      {Number(d.slice(8))}
                    </a>
                  ))}
                </div>
              </div>
            </section>
          )
        })}
      </div>

      <PileShelf />
    </div>
  )
}

function DayTile({ day, today }: { day: Day; today: boolean }) {
  const first = day.records[0]
  const more = day.records.length - 1
  const title = first ? (first.title || first.summary || '（没有标题）') + (more > 0 ? ` 等 ${more + 1} 份` : '') : ''
  const label = `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8))}`
  return (
    <a
      className={`day-tile${today ? ' is-today' : ''}`}
      href={`#/board/${day.date}`}
      data-zoom={day.date}
      onClick={(e) => rememberOrigin(e.currentTarget)}
    >
      <b>{label}</b>
      {title && <span className="tile-title">{title}</span>}
      {day.reads.length > 0 && <span className="tile-title">读了 {day.reads.join('、')}</span>}
      {!first && day.reads.length === 0 && day.cards.length === 0 && <span className="tile-title">画板上有内容</span>}
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
