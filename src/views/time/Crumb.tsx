import { IconBack, IconForward } from '../../ui/icons'

interface Props {
  year: string
  /** "11" style month, when at month or day level. */
  month?: string
  /** Full date, when at day level. */
  date?: string
  prev?: { href: string; label: string }
  next?: { href: string; label: string }
}

/** 2026 › 11 月 › 11/10. Every level above the current one is a link: the fallback for pinching. */
export function Crumb({ year, month, date, prev, next }: Props) {
  const monthLabel = month ? `${Number(month)} 月` : ''
  const dayLabel = date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : ''
  return (
    <>
      <nav className="crumb" aria-label="时间位置">
        {month ? (
          <a className="crumb-link" href={`#/board/${year}`}>
            {year}
          </a>
        ) : (
          <h1>{year}</h1>
        )}
        {month && <span aria-hidden="true">›</span>}
        {month &&
          (date ? (
            <a className="crumb-link" href={`#/board/${year}-${month}`}>
              {monthLabel}
            </a>
          ) : (
            <h1>{monthLabel}</h1>
          ))}
        {date && <span aria-hidden="true">›</span>}
        {date && <h1>{dayLabel}</h1>}
      </nav>
      <div className="crumb-nav">
        <a className="icon-btn" href={prev?.href} aria-label={prev ? `往前：${prev.label}` : '前面没有了'} aria-disabled={!prev}>
          <IconBack />
        </a>
        <a className="icon-btn" href={next?.href} aria-label={next ? `往后：${next.label}` : '后面没有了'} aria-disabled={!next}>
          <IconForward />
        </a>
      </div>
    </>
  )
}
