// Which months and years the time navigation shows. Only the ones with
// something in them, plus the current month, which is always there so today's
// board can be started by hand.

/** Sorted, unique YYYY-MM of every day that has something, plus the current month. */
export function shownMonths(days: string[], today: string): string[] {
  return [...new Set([...days.map((d) => d.slice(0, 7)), today.slice(0, 7)])].sort()
}

/** Sorted, unique years of the shown months. */
export function shownYears(days: string[], today: string): string[] {
  return [...new Set(shownMonths(days, today).map((m) => m.slice(0, 4)))]
}

/** The shown month before / after this one (it need not be a shown month itself). */
export function neighbours(list: string[], current: string): { prev?: string; next?: string } {
  return { prev: [...list].reverse().find((x) => x < current), next: list.find((x) => x > current) }
}

/** Every date of a month, in order. */
export function datesOfMonth(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number)
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: count }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)
}

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && datesOfMonth(s.slice(0, 7)).includes(s)
