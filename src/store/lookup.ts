// Fills in bibliographic details from Crossref for papers that have a DOI and
// are marked as waiting. Failing is fine: the entry stays as saved and is
// tried again the next time the app is opened online.

import { fillFromLookup, needsLookup, parseCrossref } from '../domain/crossref'
import { applyChanges, db, nowIso } from './db'

let running = false
let again = false

export async function runLookups(): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    const waiting = (await db.papers.toArray()).filter(needsLookup)
    for (const snapshot of waiting) {
      let res: Response
      try {
        res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(snapshot.doi)}`, {
          headers: { Accept: 'application/json' },
        })
      } catch {
        return // offline: leave everything waiting
      }
      if (res.status === 429 || res.status >= 500) return // busy: try again another time
      const info = res.ok ? parseCrossref(await res.json().catch(() => null)) : null
      // read again: it may have been edited while the request was out
      const paper = await db.papers.get(snapshot.id)
      if (!paper || !needsLookup(paper) || paper.doi !== snapshot.doi) continue
      await applyChanges({
        papers: [
          info
            ? { ...fillFromLookup(paper, info), lookup: 'done', updated_at: nowIso() }
            : { ...paper, lookup: 'failed', updated_at: nowIso() },
        ],
      })
    }
  } finally {
    running = false
    if (again) {
      again = false
      void runLookups()
    }
  }
}

let wired = false

/** Called once when the app opens. */
export function initLookups(): void {
  if (wired) return
  wired = true
  window.addEventListener('online', () => void runLookups())
  void runLookups()
}
