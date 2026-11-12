// Which years, months and days the time view shows: only the ones that have
// something. A day has something when a card carries that date, or a paper was
// read on it.

/** Sorted, unique YYYY-MM of every day that has something. */
export function shownMonths(days: string[]): string[] {
  return [...new Set(days.map((d) => d.slice(0, 7)))].sort()
}

/** Sorted, unique years that have something. */
export function shownYears(days: string[]): string[] {
  return [...new Set(days.map((d) => d.slice(0, 4)))].sort()
}

/** The shown entry before / after this one (it need not be a shown entry itself). */
export function neighbours(list: string[], current: string): { prev?: string; next?: string } {
  return { prev: [...list].reverse().find((x) => x < current), next: list.find((x) => x > current) }
}
