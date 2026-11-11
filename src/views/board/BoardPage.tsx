import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { db, todayLocal } from '../../store/db'
import { TopNav } from '../../ui/TopNav'
import { LibraryList } from '../library/LibraryList'
import { MonthView } from '../time/MonthView'
import { YearView } from '../time/YearView'
import { BoardView } from './BoardView'

/**
 * The board area: the library list on the left (wide screens), and on the
 * right a year (2026), a month (2026-11), a day (2026-11-10) or a pile.
 */
export function BoardPage({ param, pileId }: { param?: string; pileId?: string }) {
  const level = pileId
    ? 'pile'
    : !param
      ? null
      : /^\d{4}$/.test(param)
        ? 'year'
        : /^\d{4}-\d{2}$/.test(param)
          ? 'month'
          : 'day'

  const days = useLiveQuery(async () => {
    const records = await db.records.filter((r) => !r.deleted).toArray()
    const reads = await db.imports.filter((e) => e.kind === 'paper' && !e.undone && !e.deleted).toArray()
    return [...new Set([...records.map((r) => r.date), ...reads.map((e) => e.date)])].sort()
  })

  // "#/board" opens the most recent month that has something (this month if there is nothing yet).
  useEffect(() => {
    if (level || !days) return
    const latest = days.length > 0 ? days[days.length - 1] : todayLocal()
    window.location.replace(`#/board/${latest.slice(0, 7)}`)
  }, [level, days])

  return (
    <div className="boardpage">
      <TopNav current="board" />
      <div className="board-body">
        <aside className="board-side">
          <LibraryList />
        </aside>
        <main className="board-main">
          {level === 'year' && <YearView key={param} year={param!} days={days ?? []} />}
          {level === 'month' && <MonthView key={param} ym={param!} days={days ?? []} />}
          {level === 'day' && <BoardView key={param} kind="day" date={param!} days={days ?? []} />}
          {level === 'pile' && <BoardView key={pileId} kind="pile" pileId={pileId!} />}
        </main>
      </div>
    </div>
  )
}
