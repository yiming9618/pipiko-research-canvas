import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef } from 'react'
import { neighbours, shownMonths, shownYears } from '../../domain/timeline'
import { recordBoardId } from '../../domain/migrate'
import { db } from '../../store/db'
import { loadTrashed } from '../../store/trashActions'
import { Crumb } from './Crumb'
import { rememberOrigin, usePinchNav, useStageAnimation } from './zoom'

const MAX_TITLES = 3

/** A year: only its months that have something. Every tile opens that month. */
export function YearView({ year, days }: { year: string; days: string[] }) {
  const records = useLiveQuery(
    async () => {
      const trash = await loadTrashed()
      return db.records.where('date').between(`${year}-01-01`, `${year}-12-31`, true, true).filter((r) => !r.deleted && !trash.boards.has(recordBoardId(r))).toArray()
    },
    [year],
  )

  const months = useMemo(() => {
    return shownMonths(days)
      .filter((ym) => ym.startsWith(year))
      .map((ym) => {
        const inMonth = (records ?? []).filter((r) => r.date.startsWith(ym)).sort((a, b) => (a.date < b.date ? -1 : 1))
        // Up to three titles, as written. Nothing is summarised or reworded.
        const titles = inMonth.map((r) => r.title || r.summary).filter(Boolean)
        const dayCount = new Set(days.filter((d) => d.startsWith(ym))).size
        return { ym, number: Number(ym.slice(5)), titles, dayCount }
      })
  }, [records, days, year])

  const ready = records !== undefined
  const stage = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  useStageAnimation(stage, 0, year, ready)
  usePinchNav(stage, {
    onIn: (tile) => {
      if (tile?.dataset.zoom) window.location.hash = `#/time/${tile.dataset.zoom}`
    },
  }, area)

  const { prev, next } = neighbours(shownYears(days), year)

  return (
    <div className="timeview" ref={area}>
      <header className="board-head">
        <Crumb
          year={year}
          prev={prev ? { href: `#/time/${prev}`, label: `${prev} 年` } : undefined}
          next={next ? { href: `#/time/${next}`, label: `${next} 年` } : undefined}
        />
        <span className="zoom-hint">点一个月，或双指放大进入</span>
      </header>

      <div className="stage year-grid" ref={stage} style={{ visibility: ready ? 'visible' : 'hidden' }}>
        {ready && months.length === 0 && <p className="empty">这一年没有内容。</p>}
        {months.map((m) => (
          <a key={m.ym} className="month-tile" href={`#/time/${m.ym}`} data-zoom={m.ym} onClick={(e) => rememberOrigin(e.currentTarget)}>
            <b>{m.number} 月</b>
            {m.titles.slice(0, MAX_TITLES).map((t, i) => (
              <span key={i} className="tile-title">
                {t}
              </span>
            ))}
            <span className="tile-count">
              {m.titles.length > MAX_TITLES ? `共 ${m.titles.length} 份 · ` : ''}
              {m.dayCount} 天
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}
