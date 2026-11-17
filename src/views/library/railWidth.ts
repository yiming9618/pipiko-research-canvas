// The width of the "我的理解" column on a paper's page: dragged by the line between it and the
// paper, remembered on this device, and kept in proportion when the room changes (the library
// list folded or opened, the window made wider or narrower).

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

const KEY = 'paper.rail.width'
const DEFAULT_W = 340
const MIN_W = 260
const MAX_W = 760
/** The paper keeps at least this much of the room. */
const MAIN_MIN = 420

function remembered(): number {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown
    return typeof v === 'number' && v >= MIN_W && v <= MAX_W ? v : DEFAULT_W
  } catch {
    return DEFAULT_W
  }
}

/** The width actually used: what was chosen, but never more than the room allows. */
export function fitRail(chosen: number, room: number): number {
  const most = Math.max(MIN_W, Math.min(MAX_W, room * 0.5, room - MAIN_MIN))
  return Math.round(Math.max(MIN_W, Math.min(most, chosen)))
}

export function useRailWidth() {
  const [chosen, setChosen] = useState(remembered)
  const [room, setRoom] = useState(0)
  const [el, setEl] = useState<HTMLElement | null>(null)
  const drag = useRef<{ x: number; w: number } | null>(null)

  // the room is the paper's content width (both columns and the gap between them)
  useEffect(() => {
    if (!el) return
    const measure = () => {
      const cs = getComputedStyle(el)
      setRoom(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.columnGap || '0'))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])

  const width = room > 0 ? fitRail(chosen, room) : chosen
  const save = (w: number) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(w))
    } catch {
      // remembering the width is a convenience only
    }
  }

  const grip = {
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    'aria-label': '拖动调整“我的理解”的宽度',
    'aria-valuenow': width,
    'aria-valuemin': MIN_W,
    'aria-valuemax': MAX_W,
    tabIndex: 0,
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      drag.current = { x: e.clientX, w: width }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      // the column is on the right: dragging the line to the left widens it
      if (drag.current) setChosen(fitRail(drag.current.w - (e.clientX - drag.current.x), room || Infinity))
    },
    onPointerUp: () => {
      if (!drag.current) return
      drag.current = null
      save(width)
    },
    onPointerCancel: () => {
      drag.current = null
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      const step = e.key === 'ArrowLeft' ? 20 : e.key === 'ArrowRight' ? -20 : 0
      if (!step) return
      e.preventDefault()
      const next = fitRail(width + step, room || Infinity)
      setChosen(next)
      save(next)
    },
  }

  return {
    ref: useCallback((node: HTMLElement | null) => setEl(node), []),
    style: { '--rail-w': `${width}px` } as CSSProperties,
    grip,
  }
}
