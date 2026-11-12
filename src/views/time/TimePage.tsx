import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { db } from '../../store/db'
import { TopNav } from '../../ui/TopNav'
import { DayView } from './DayView'
import { MonthView } from './MonthView'
import { YearView } from './YearView'

/**
 * The time view, like the library in Photos: every card on every board, by the
 * card's own date. `param` is a year (2026), a month (2026-11) or a day (2026-11-10).
 */
export function TimePage({ param }: { param?: string }) {
  const level = !param ? null : /^\d{4}$/.test(param) ? 'year' : /^\d{4}-\d{2}$/.test(param) ? 'month' : 'day'

  // Every day that has something: a card with that date, or a paper read on it.
  const days = useLiveQuery(async () => {
    const [cards, reads] = await Promise.all([
      db.cards.filter((c) => !c.deleted).toArray(),
      db.imports.filter((e) => e.kind === 'paper' && !e.undone && !e.deleted).toArray(),
    ])
    return [...new Set([...cards.map((c) => c.date), ...reads.map((e) => e.date)])].sort()
  })

  // "#/time" opens the most recent month that has something.
  useEffect(() => {
    if (level || !days || days.length === 0) return
    window.location.replace(`#/time/${days[days.length - 1].slice(0, 7)}`)
  }, [level, days])

  return (
    <div className="boardpage timepage">
      <TopNav current="time" />
      <main className="board-main">
        {!level && days && days.length === 0 && (
          <p className="empty time-empty">还没有卡片。导入一份研究记录，或者在画板上写一张卡片，它们会按日期出现在这里。</p>
        )}
        {level === 'year' && <YearView key={param} year={param!} days={days ?? []} />}
        {level === 'month' && <MonthView key={param} ym={param!} days={days ?? []} />}
        {level === 'day' && <DayView key={param} date={param!} days={days ?? []} />}
      </main>
    </div>
  )
}
