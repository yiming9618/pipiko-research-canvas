// Moving between year → month → day. Two things live here:
//  - the pinch gesture on the year and month grids
//  - the short zoom animation when the level changes, anchored on the tile
//    the user came from or is going into

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

export type Level = 0 | 1 | 2 // year, month, day

let last: { level: Level; id: string } | null = null
let origin: { x: number; y: number } | null = null

/** Call when a tile is tapped or pinched open, so the next view grows out of it. */
export function rememberOrigin(el: Element): void {
  const r = el.getBoundingClientRect()
  origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

// One trackpad pinch sends a long stream of wheel events. After it has changed
// the level once, the rest of that stream must not carry on into the next level.
let wheelLocked = false
let wheelLockTimer: ReturnType<typeof setTimeout> | null = null

function holdWheelLock(): void {
  if (wheelLockTimer) clearTimeout(wheelLockTimer)
  wheelLockTimer = setTimeout(() => {
    wheelLocked = false
  }, 220)
}

/** Call right after a zoom gesture changed the level. */
export function lockZoomWheel(): void {
  wheelLocked = true
  holdWheelLock()
}

/** True while the gesture that changed the level is still going; each call extends the wait. */
export function zoomWheelLocked(): boolean {
  if (wheelLocked) holdWheelLock()
  return wheelLocked
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Plays the zoom when this view appears after a change of level.
 * Going deeper: the view grows from the tile that was opened.
 * Going back out: it shrinks into the tile of where we came from (`data-zoom` = that id).
 */
export function useStageAnimation(ref: RefObject<HTMLElement | null>, level: Level, id: string, ready: boolean): void {
  const played = useRef(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !ready || played.current) return
    played.current = true
    const prev = last
    last = { level, id }
    const from = origin
    origin = null
    if (!prev || prev.level === level || reducedMotion()) return

    const rect = el.getBoundingClientRect()
    let ox = rect.width / 2
    let oy = Math.min(rect.height / 2, window.innerHeight / 2)
    const deeper = level > prev.level
    if (deeper && from) {
      ox = from.x - rect.left
      oy = from.y - rect.top
    } else if (!deeper) {
      // prev.id is a full date or a month; this view's tiles carry the matching prefix.
      const key = level === 1 ? prev.id.slice(0, 10) : prev.id.slice(0, 7)
      const tile = el.querySelector(`[data-zoom="${key}"]`)
      if (tile) {
        const r = tile.getBoundingClientRect()
        ox = r.left + r.width / 2 - rect.left
        oy = r.top + r.height / 2 - rect.top
      }
    }
    el.style.transformOrigin = `${ox}px ${oy}px`
    el.animate(
      [
        { transform: `scale(${deeper ? 0.55 : 1.7})`, opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: 300, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)' },
    )
  }, [ref, level, id, ready])
}

interface PinchOptions {
  /** Spread fingers over a tile: open it. Receives the tile under the fingers, if any. */
  onIn?: (tile: HTMLElement | null) => void
  /** Pinch fingers together: go up one level. */
  onOut?: () => void
}

/** The tile whose centre is closest to a point (so a pinch between tiles still opens something). */
function nearestTile(within: HTMLElement, x: number, y: number): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestDist = Infinity
  for (const tile of within.querySelectorAll<HTMLElement>('[data-zoom]')) {
    const r = tile.getBoundingClientRect()
    if (r.width === 0) continue
    // distance to the tile's edge (0 when inside), so a big tile is not penalised for its size
    const dx = Math.max(r.left - x, 0, x - r.right)
    const dy = Math.max(r.top - y, 0, y - r.bottom)
    const d = Math.hypot(dx, dy)
    if (d < bestDist) {
      bestDist = d
      best = tile
    }
  }
  return best
}

const IN_AT = 1.28
const OUT_AT = 0.8

/**
 * Pinch on a grid of tiles. The grid follows the fingers a little so the
 * gesture feels attached; letting go past a threshold changes level.
 * One-finger scrolling is left to the browser.
 */
export function usePinchNav(
  ref: RefObject<HTMLElement | null>,
  opts: PinchOptions,
  /** Where the gesture is listened for, when that is larger than the element that moves. */
  area?: RefObject<HTMLElement | null>,
): void {
  const latest = useRef(opts)
  latest.current = opts

  useEffect(() => {
    const el = ref.current
    const target = area?.current ?? el
    if (!el || !target) return
    let scale = 1
    let at = { x: 0, y: 0 }
    let active = false
    let safariGesture = false
    const touches = new Map<number, { x: number; y: number }>()
    let startDist = 0
    let wheelTimer: ReturnType<typeof setTimeout> | null = null

    const begin = (x: number, y: number) => {
      active = true
      scale = 1
      at = { x, y }
      const r = el.getBoundingClientRect()
      el.style.transition = 'none'
      el.style.transformOrigin = `${x - r.left}px ${y - r.top}px`
    }
    const update = (s: number) => {
      scale = s
      // follow the fingers, but only part of the way
      const shown = 1 + (Math.max(0.6, Math.min(1.6, s)) - 1) * 0.5
      el.style.transform = `scale(${shown})`
    }
    const settle = () => {
      el.style.transition = reducedMotion() ? 'none' : 'transform 200ms cubic-bezier(0.22, 0.8, 0.3, 1)'
      el.style.transform = ''
    }
    const end = () => {
      if (!active) return
      active = false
      const { onIn, onOut } = latest.current
      if (scale >= IN_AT && onIn) {
        // The tile under the fingers; between tiles, or when the browser gave no position, the nearest one.
        const tile = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>('[data-zoom]') ?? nearestTile(el, at.x, at.y)
        if (tile) {
          el.style.transform = ''
          rememberOrigin(tile)
          lockZoomWheel()
          onIn(tile)
          return
        }
      } else if (scale <= OUT_AT && onOut) {
        el.style.transform = ''
        lockZoomWheel()
        onOut()
        return
      }
      settle()
    }

    // On iPad and iPhone the gesture events carry no position, so remember where the two fingers are.
    let fingers: { x: number; y: number } | null = null
    const onTouch = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        fingers = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        }
      } else if (e.touches.length === 0) {
        fingers = null
      }
    }

    // Safari (iPad, iPhone, Mac trackpad) reports pinches as gesture events.
    const onGestureStart = (e: Event) => {
      const g = e as Event & { clientX?: number; clientY?: number }
      e.preventDefault()
      safariGesture = true
      const r = el.getBoundingClientRect()
      const hasPoint = typeof g.clientX === 'number' && typeof g.clientY === 'number' && (g.clientX !== 0 || g.clientY !== 0)
      if (hasPoint) begin(g.clientX!, g.clientY!)
      else if (fingers) begin(fingers.x, fingers.y)
      else begin(r.left + r.width / 2, Math.min(r.top + r.height / 2, window.innerHeight / 2))
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      if (active) update((e as Event & { scale: number }).scale)
    }
    const onGestureEnd = (e: Event) => {
      e.preventDefault()
      end()
      safariGesture = false
    }

    // Other touch browsers: two pointers.
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || safariGesture) return
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.size === 2) {
        const [a, b] = [...touches.values()]
        startDist = Math.hypot(a.x - b.x, a.y - b.y) || 1
        begin((a.x + b.x) / 2, (a.y + b.y) / 2)
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!touches.has(e.pointerId) || safariGesture) return
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (active && touches.size === 2) {
        const [a, b] = [...touches.values()]
        update(Math.hypot(a.x - b.x, a.y - b.y) / startDist)
      }
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId) || safariGesture) return
      if (touches.size < 2) end()
    }

    // Trackpad pinch in other desktop browsers arrives as ctrl+wheel.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      if (zoomWheelLocked()) return
      if (!active) begin(e.clientX, e.clientY)
      update(scale * Math.exp(-e.deltaY * 0.01))
      if (wheelTimer) clearTimeout(wheelTimer)
      if (scale >= IN_AT || scale <= OUT_AT) end()
      else wheelTimer = setTimeout(end, 180)
    }

    target.addEventListener('touchstart', onTouch, { passive: true })
    target.addEventListener('touchend', onTouch, { passive: true })
    target.addEventListener('touchcancel', onTouch, { passive: true })
    target.addEventListener('gesturestart', onGestureStart)
    target.addEventListener('gesturechange', onGestureChange)
    target.addEventListener('gestureend', onGestureEnd)
    target.addEventListener('pointerdown', onPointerDown)
    target.addEventListener('pointermove', onPointerMove)
    target.addEventListener('pointerup', onPointerUp)
    target.addEventListener('pointercancel', onPointerUp)
    target.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      if (wheelTimer) clearTimeout(wheelTimer)
      target.removeEventListener('touchstart', onTouch)
      target.removeEventListener('touchend', onTouch)
      target.removeEventListener('touchcancel', onTouch)
      target.removeEventListener('gesturestart', onGestureStart)
      target.removeEventListener('gesturechange', onGestureChange)
      target.removeEventListener('gestureend', onGestureEnd)
      target.removeEventListener('pointerdown', onPointerDown)
      target.removeEventListener('pointermove', onPointerMove)
      target.removeEventListener('pointerup', onPointerUp)
      target.removeEventListener('pointercancel', onPointerUp)
      target.removeEventListener('wheel', onWheel)
    }
  }, [ref, area])
}
