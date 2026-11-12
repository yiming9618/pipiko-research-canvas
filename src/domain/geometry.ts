// Small geometry for the board: the lasso and the eraser. Pure.

export interface Pt {
  x: number
  y: number
}

/** Even-odd rule. The polygon closes itself. */
export function pointInPolygon(p: Pt, polygon: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** A box counts as lassoed when its centre is inside the loop. */
export function rectInLasso(r: { x: number; y: number; w: number; h: number }, lasso: Pt[]): boolean {
  return lasso.length >= 3 && pointInPolygon({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, lasso)
}

/** Ink points are stored flat: x, y, pressure, x, y, pressure, … */
export function strokePoints(points: number[]): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i + 1 < points.length; i += 3) out.push({ x: points[i], y: points[i + 1] })
  return out
}

/** A stroke counts as lassoed when most of it is inside the loop. */
export function strokeInLasso(points: number[], lasso: Pt[]): boolean {
  if (lasso.length < 3) return false
  const pts = strokePoints(points)
  if (pts.length === 0) return false
  const inside = pts.filter((p) => pointInPolygon(p, lasso)).length
  return inside * 2 > pts.length
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Does the eraser, at `p` with this reach, touch the stroke anywhere along its line? */
export function strokeTouched(points: number[], p: Pt, reach: number): boolean {
  const pts = strokePoints(points)
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= reach
  for (let i = 0; i + 1 < pts.length; i++) if (distToSegment(p, pts[i], pts[i + 1]) <= reach) return true
  return false
}

/** The same stroke, moved. Pressure values are left alone. */
export function moveStroke(points: number[], dx: number, dy: number): number[] {
  const out = points.slice()
  for (let i = 0; i + 1 < out.length; i += 3) {
    out[i] = Math.round((out[i] + dx) * 100) / 100
    out[i + 1] = Math.round((out[i + 1] + dy) * 100) / 100
  }
  return out
}

export function strokeBounds(points: number[]): { x: number; y: number; w: number; h: number } | null {
  const pts = strokePoints(points)
  if (pts.length === 0) return null
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
