import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef } from 'react'
import { db } from '../../store/db'
import { Crumb } from './Crumb'
import { rememberOrigin, usePinchNav, useStageAnimation } from './zoom'

const MAX_TITLES = 3

export function YearView({ year, days }: { year: string; days: string[] }) {
  const records = useLiveQuery(
    () => db.records.where('date').between(`${year}-01-01`, `${year}-12-31`, true, true).filter((r) => !r.deleted).toArray(),
    [year],
  )

  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, '0')}`
      const inMonth = (records ?? []).filter((r) => r.date.startsWith(ym)).sort((a, b) => (a.date < b.date ? -1 : 1))
      // Up to three titles, as written. Nothing is summarised or reworded.
      const titles = inMonth.map((r) => r.title || r.summary).filter(Boolean)
      const dayCount = new Set(days.filter((d) => d.startsWith(ym))).size
      return { ym, number: i + 1, titles, dayCount }
    })
  }, [records, days, year])

  const ready = records !== undefined
  const stage = useRef<HTMLDivElement>(null)
  useStageAnimation(stage, 0, year, ready)
  usePinchNav(stage, {
    onIn: (tile) => {
      if (tile?.dataset.zoom) window.location.hash = `#/board/${tile.dataset.zoom}`
    },
  })

  const years = [...new Set(days.map((d) => d.slice(0, 4)))]
  const prev = [...years].reverse().find((y) => y < year)
  const next = years.find((y) => y > year)

  return (
    <div className="timeview">
      <header className="board-head">
        <Crumb
          year={year}
          prev={prev ? { href: `#/board/${prev}`, label: `${prev} 年` } : undefined}
          next={next ? { href: `#/board/${next}`, label: `${next} 年` } : undefined}
        />
        <span className="zoom-hint">双指放大进入某个月</span>
      </header>

      <div className="stage year-grid" ref={stage} style={{ visibility: ready ? 'visible' : 'hidden' }}>
        {months.map((m) =>
          m.dayCount === 0 ? (
            <div key={m.ym} className="month-tile is-empty">
              <b>{m.number} 月</b>
            </div>
          ) : (
            <a
              key={m.ym}
              className="month-tile"
              href={`#/board/${m.ym}`}
              data-zoom={m.ym}
              onClick={(e) => rememberOrigin(e.currentTarget)}
            >
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
          ),
        )}
      </div>
    </div>
  )
}
