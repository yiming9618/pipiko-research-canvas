// A pannable, zoomable surface. Finger, pencil and mouse all go through the
// same Pointer Events code. Cards are ordinary HTML (selectable text, real
// links); connectors and ink are SVG layers below and above them.

import { getStroke } from 'perfect-freehand'
import { lockZoomWheel, zoomWheelLocked } from '../time/zoom'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

export interface CanvasNode {
  key: string
  x: number
  y: number
  w: number
  movable: boolean
  resizable: boolean
  /** Stacking order: whatever was moved last sits on top. */
  z?: number
  className?: string
  color?: string
  content: ReactNode
}

export interface CanvasLink {
  id: string
  from: string
  to: string
  arrow: boolean
}

export interface CanvasStroke {
  id: string
  points: number[]
  color: string
  size: number
}

export type Tool = 'move' | 'connect' | 'draw'
export type Selection = { kind: 'node' | 'link' | 'stroke'; id: string } | null

interface View {
  x: number
  y: number
  k: number
}

interface Props {
  nodes: CanvasNode[]
  links: CanvasLink[]
  strokes: CanvasStroke[]
  editing: boolean
  tool: Tool
  selection: Selection
  onSelect: (s: Selection) => void
  onMove: (key: string, x: number, y: number) => void
  onResize: (key: string, w: number) => void
  onLink: (from: string, to: string) => void
  onStroke: (points: number[]) => void
  onMeasure: (key: string, h: number) => void
  /** Buttons for the current selection, shown just above it. */
  actions?: ReactNode
  /** The view is re-fitted to the content whenever this changes (e.g. another day). */
  fitKey: string
  /** Space kept clear at the top for the header. */
  topInset?: number
  inkColor: string
  /** A dragged node was let go over an element marked `data-pile-drop`: it stays where it was. */
  onDropOn?: (key: string, target: HTMLElement) => void
  /** Called when the user keeps pinching in after the board is already at its smallest. */
  onZoomOut?: () => void
  /** Lets the parent turn a screen point into a board position (for placing new items). */
  apiRef?: React.RefObject<CanvasApi | null>
}

export interface CanvasApi {
  /** Board coordinates of the middle of what is visible. */
  center: () => { x: number; y: number }
}

const MIN_K = 0.25
const MAX_K = 2.5
const DRAG_THRESHOLD = 4
const INK_SIZE = 5

type Gesture =
  | { type: 'pan'; sx: number; sy: number; view: View }
  | { type: 'pinch'; dist: number; mx: number; my: number; view: View; wantOut: boolean }
  | { type: 'drag'; key: string; sx: number; sy: number; x: number; y: number; moved: boolean }
  | { type: 'resize'; key: string; sx: number; w: number }
  | { type: 'link'; from: string }
  | { type: 'draw'; points: number[]; pen: boolean }

type Live =
  | { type: 'link'; from: string; x: number; y: number }
  | { type: 'draw'; points: number[] }
  | null

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function strokePath(points: number[], size: number): string {
  const input: [number, number, number][] = []
  for (let i = 0; i < points.length; i += 3) input.push([points[i], points[i + 1], points[i + 2]])
  const outline = getStroke(input, { size, thinning: 0.5, smoothing: 0.5, streamline: 0.4 })
  if (outline.length === 0) return ''
  let d = `M${outline[0][0].toFixed(1)},${outline[0][1].toFixed(1)}`
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i]
    const [x1, y1] = outline[(i + 1) % outline.length]
    d += ` Q${x0.toFixed(1)},${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)},${((y0 + y1) / 2).toFixed(1)}`
  }
  return d + ' Z'
}

/** Where the line from this rect's centre toward `to` leaves the rect. */
function edgePoint(r: Rect, to: { x: number; y: number }, pad = 6): { x: number; y: number } {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const dx = to.x - cx
  const dy = to.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const scale = Math.min((r.w / 2 + pad) / Math.abs(dx || 1e-9), (r.h / 2 + pad) / Math.abs(dy || 1e-9))
  return { x: cx + dx * scale, y: cy + dy * scale }
}

function linkPath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  // a slight bow, so a connector reads as hand-placed rather than ruled
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${(mx - dy * 0.12).toFixed(1)},${(my + dx * 0.12).toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`
}

export function Canvas(props: Props) {
  const { nodes, links, strokes, editing, tool, selection, onSelect, onMeasure, topInset = 16 } = props
  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setViewState] = useState<View>({ x: 0, y: 0, k: 1 })
  const viewRef = useRef(view)
  const setView = useCallback((v: View) => {
    viewRef.current = v
    setViewState(v)
  }, [])

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)
  const fitK = useRef(1)
  const dropTarget = useRef<HTMLElement | null>(null)
  const setDropTarget = (el: HTMLElement | null) => {
    if (el === dropTarget.current) return
    dropTarget.current?.classList.remove('is-over')
    el?.classList.add('is-over')
    dropTarget.current = el
  }
  const zoomOut = useRef(props.onZoomOut)
  zoomOut.current = props.onZoomOut
  /** Smallest zoom. With a level above this board, half the fitted size is the floor; past it we leave. */
  const floorK = useCallback(() => (zoomOut.current ? Math.max(MIN_K, fitK.current * 0.5) : MIN_K), [])
  const penSeen = useRef(false)
  const [live, setLive] = useState<Live>(null)
  /** Shown from the moment a drag ends until the saved value comes back, so nothing snaps back. */
  const [overrides, setOverrides] = useState<Record<string, { x?: number; y?: number; w?: number }>>({})
  const [pendingInk, setPendingInk] = useState<number[][]>([])
  const [heights, setHeights] = useState<Record<string, number>>({})

  const placed = useMemo(
    () => nodes.map((n) => ({ ...n, ...(overrides[n.key] ?? {}) }) as CanvasNode),
    [nodes, overrides],
  )

  // Drop an override once the saved value has caught up with it.
  useEffect(() => {
    setOverrides((prev) => {
      let changed = false
      const next = { ...prev }
      for (const n of nodes) {
        const o = prev[n.key]
        if (!o) continue
        const same =
          (o.x === undefined || Math.abs(o.x - n.x) < 0.5) &&
          (o.y === undefined || Math.abs(o.y - n.y) < 0.5) &&
          (o.w === undefined || Math.abs(o.w - n.w) < 0.5)
        if (same) {
          delete next[n.key]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [nodes])

  useEffect(() => setPendingInk([]), [strokes.length])

  const rectOf = useCallback(
    (key: string): Rect | null => {
      const n = placed.find((p) => p.key === key)
      return n ? { x: n.x, y: n.y, w: n.w, h: heights[key] ?? 120 } : null
    },
    [placed, heights],
  )

  const measure = useCallback(
    (key: string, h: number) => {
      setHeights((prev) => (prev[key] === h ? prev : { ...prev, [key]: h }))
      onMeasure(key, h)
    },
    [onMeasure],
  )

  // ── fit the content into view once per board ─────────────────────────
  const fitted = useRef('')
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el || nodes.length === 0 || fitted.current === props.fitKey) return
    fitted.current = props.fitKey
    const minX = Math.min(...nodes.map((n) => n.x))
    const maxX = Math.max(...nodes.map((n) => n.x + n.w))
    const minY = Math.min(...nodes.map((n) => n.y))
    const width = maxX - minX
    const margin = el.clientWidth < 600 ? 16 : 40
    const k = Math.max(MIN_K, Math.min(1, (el.clientWidth - margin * 2) / width))
    fitK.current = k
    setView({ x: (el.clientWidth - width * k) / 2 - minX * k, y: topInset + 8 - minY * k, k })
  }, [nodes, props.fitKey, setView, topInset])

  useEffect(() => {
    if (!props.apiRef) return
    props.apiRef.current = {
      center: () => {
        const el = viewportRef.current
        const v = viewRef.current
        if (!el) return { x: 0, y: 0 }
        return { x: (el.clientWidth / 2 - v.x) / v.k, y: (el.clientHeight / 2 - v.y) / v.k }
      },
    }
  }, [props.apiRef])

  const local = (e: { clientX: number; clientY: number }) => {
    const r = viewportRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const toWorld = (p: { x: number; y: number }, v = viewRef.current) => ({ x: (p.x - v.x) / v.k, y: (p.y - v.y) / v.k })

  const zoomAt = useCallback(
    (p: { x: number; y: number }, factor: number, from: View = viewRef.current): number => {
      const raw = from.k * factor
      const k = Math.max(floorK(), Math.min(MAX_K, raw))
      const wx = (p.x - from.x) / from.k
      const wy = (p.y - from.y) / from.k
      setView({ x: p.x - wx * k, y: p.y - wy * k, k })
      return raw
    },
    [setView, floorK],
  )

  // ── wheel and trackpad ───────────────────────────────────────────────
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('textarea')) return
      e.preventDefault()
      const v = viewRef.current
      if (e.ctrlKey || e.metaKey) {
        if (zoomWheelLocked()) return
        const factor = Math.exp(-e.deltaY * 0.01)
        const raw = zoomAt(local(e), factor)
        // Already at the smallest size and still pinching in: build up, then leave.
        if (raw < floorK() && factor < 1) {
          pressure *= factor
          if (pressure < 0.6 && zoomOut.current) {
            pressure = 1
            lockZoomWheel()
            zoomOut.current()
          }
        } else {
          pressure = 1
        }
      } else setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
    }
    let pressure = 1
    let gestureRaw = 1
    // Safari on Mac reports trackpad pinches as gesture events, not ctrl+wheel.
    let start: View | null = null
    const onGestureStart = (e: Event) => {
      if (pointers.current.size > 0) return
      e.preventDefault()
      start = viewRef.current
    }
    const onGestureChange = (e: Event) => {
      if (!start || pointers.current.size > 0) return
      e.preventDefault()
      const g = e as Event & { scale: number; clientX: number; clientY: number }
      gestureRaw = zoomAt(local(g), g.scale, start)
    }
    const onGestureEnd = () => {
      if (start && gestureRaw < floorK() * 0.8) zoomOut.current?.()
      start = null
      gestureRaw = 1
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    el.addEventListener('gestureend', onGestureEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('gestureend', onGestureEnd)
    }
  }, [setView, zoomAt, floorK])

  // ── pointers ─────────────────────────────────────────────────────────
  const startPinch = () => {
    const [a, b] = [...pointers.current.values()]
    gesture.current = {
      type: 'pinch',
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
      view: viewRef.current,
      wantOut: false,
    }
    setLive(null)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    // Typing, and the selection's own buttons, are not canvas gestures.
    if (target.closest('textarea, input, select, [data-nocanvas]')) return
    // While just reading, taps on links and buttons inside cards work normally.
    if (!editing && target.closest('a, button, summary')) return
    if (e.pointerType === 'mouse' && e.button !== 0) return

    const p = local(e)
    pointers.current.set(e.pointerId, p)
    if (e.pointerType === 'pen') penSeen.current = true
    viewportRef.current?.setPointerCapture(e.pointerId)

    if (pointers.current.size === 2) return startPinch()
    if (pointers.current.size > 2) return

    const key = target.closest<HTMLElement>('[data-node]')?.dataset.node
    if (editing) {
      // Once a pencil has been used, fingers pan instead of drawing (palm rejection).
      if (tool === 'draw' && !(e.pointerType === 'touch' && penSeen.current)) {
        const w = toWorld(p)
        const pen = e.pointerType === 'pen'
        gesture.current = { type: 'draw', points: [w.x, w.y, pen ? e.pressure || 0.5 : 0.5], pen }
        return
      }
      if (tool === 'connect' && key) {
        gesture.current = { type: 'link', from: key }
        return
      }
      if (tool === 'move') {
        const node = key ? placed.find((n) => n.key === key) : undefined
        if (node && target.closest('[data-handle]')) {
          gesture.current = { type: 'resize', key: node.key, sx: p.x, w: node.w }
          return
        }
        if (node) {
          onSelect({ kind: 'node', id: node.key })
          if (node.movable) {
            gesture.current = { type: 'drag', key: node.key, sx: p.x, sy: p.y, x: node.x, y: node.y, moved: false }
            return
          }
        } else {
          const sel = target.closest<SVGElement>('[data-sel]')
          if (sel) {
            onSelect({ kind: sel.dataset.sel as 'link' | 'stroke', id: sel.dataset.id! })
            return
          }
          onSelect(null)
        }
      }
    }
    gesture.current = { type: 'pan', sx: p.x, sy: p.y, view: viewRef.current }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    const g = gesture.current
    if (!g) return
    const k = viewRef.current.k

    switch (g.type) {
      case 'pinch': {
        const [a, b] = [...pointers.current.values()]
        if (!b) return
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const raw = (g.view.k * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist
        const nk = Math.max(floorK(), Math.min(MAX_K, raw))
        g.wantOut = raw < floorK() * 0.8
        const wx = (g.mx - g.view.x) / g.view.k
        const wy = (g.my - g.view.y) / g.view.k
        setView({ x: mid.x - wx * nk, y: mid.y - wy * nk, k: nk })
        return
      }
      case 'pan':
        setView({ ...g.view, x: g.view.x + p.x - g.sx, y: g.view.y + p.y - g.sy })
        return
      case 'drag': {
        if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) < DRAG_THRESHOLD) return
        g.moved = true
        setOverrides((o) => ({ ...o, [g.key]: { ...o[g.key], x: g.x + (p.x - g.sx) / k, y: g.y + (p.y - g.sy) / k } }))
        if (props.onDropOn) {
          setDropTarget(document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-pile-drop]') ?? null)
        }
        return
      }
      case 'resize':
        setOverrides((o) => ({ ...o, [g.key]: { ...o[g.key], w: Math.max(160, g.w + (p.x - g.sx) / k) } }))
        return
      case 'link': {
        const w = toWorld(p)
        setLive({ type: 'link', from: g.from, x: w.x, y: w.y })
        return
      }
      case 'draw': {
        const events = e.nativeEvent.getCoalescedEvents?.() ?? []
        for (const ev of events.length > 0 ? events : [e.nativeEvent]) {
          const w = toWorld(local(ev))
          g.points.push(w.x, w.y, g.pen ? ev.pressure || 0.5 : 0.5)
        }
        setLive({ type: 'draw', points: g.points.slice() })
        return
      }
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    const p = local(e)
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (!g) return

    if (g.type === 'pinch') {
      if (g.wantOut && zoomOut.current) {
        gesture.current = null
        pointers.current.clear()
        zoomOut.current()
        return
      }
      // One finger lifted: carry on as a pan with the finger that is left.
      const rest = [...pointers.current.values()][0]
      gesture.current = rest ? { type: 'pan', sx: rest.x, sy: rest.y, view: viewRef.current } : null
      return
    }
    gesture.current = null
    const k = viewRef.current.k
    const cancelled = e.type === 'pointercancel'

    const droppedOn = dropTarget.current
    setDropTarget(null)
    if (g.type === 'drag' && g.moved && !cancelled && droppedOn && props.onDropOn) {
      // Put into a pile: the card itself goes back to where it was.
      props.onDropOn(g.key, droppedOn)
      setOverrides((o) => {
        const next = { ...o }
        delete next[g.key]
        return next
      })
    } else if (g.type === 'drag' && g.moved && !cancelled) {
      props.onMove(g.key, g.x + (p.x - g.sx) / k, g.y + (p.y - g.sy) / k)
    } else if (g.type === 'resize' && !cancelled) {
      props.onResize(g.key, Math.max(160, g.w + (p.x - g.sx) / k))
    } else if (g.type === 'link' && !cancelled) {
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-node]')
      const to = under?.dataset.node
      if (to && to !== g.from) props.onLink(g.from, to)
    } else if (g.type === 'draw' && !cancelled && g.points.length >= 6) {
      setPendingInk((prev) => [...prev, g.points])
      props.onStroke(g.points)
    }
    if (cancelled && (g.type === 'drag' || g.type === 'resize')) {
      setOverrides((o) => {
        const next = { ...o }
        delete next[g.key]
        return next
      })
    }
    setLive(null)
  }

  // ── geometry for connectors and the action bar ───────────────────────
  const linkShapes = links
    .map((l) => {
      const a = rectOf(l.from)
      const b = rectOf(l.to)
      if (!a || !b) return null
      const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
      const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
      const start = edgePoint(a, cb)
      const end = edgePoint(b, ca, l.arrow ? 12 : 6)
      return { link: l, d: linkPath(start, end), mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)

  let liveLink: string | null = null
  if (live?.type === 'link') {
    const a = rectOf(live.from)
    if (a) liveLink = linkPath(edgePoint(a, live), live)
  }

  let anchor: { x: number; y: number } | null = null
  if (selection && props.actions) {
    if (selection.kind === 'node') {
      const r = rectOf(selection.id)
      if (r) anchor = { x: r.x + r.w / 2, y: r.y }
    } else if (selection.kind === 'link') {
      anchor = linkShapes.find((s) => s.link.id === selection.id)?.mid ?? null
    } else {
      const s = strokes.find((st) => st.id === selection.id)
      if (s) {
        let minY = Infinity
        let sumX = 0
        for (let i = 0; i < s.points.length; i += 3) {
          sumX += s.points[i]
          minY = Math.min(minY, s.points[i + 1])
        }
        anchor = { x: sumX / (s.points.length / 3), y: minY }
      }
    }
  }
  const vw = viewportRef.current?.clientWidth ?? 0
  const barX = anchor ? Math.max(110, Math.min(vw - 110, anchor.x * view.k + view.x)) : 0
  const barY = anchor ? Math.max(topInset + 4, anchor.y * view.k + view.y - 56) : 0

  const selectable = editing && tool === 'move'

  return (
    <div
      ref={viewportRef}
      className="canvas"
      data-editing={editing || undefined}
      data-tool={editing ? tool : undefined}
      style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.k}px ${24 * view.k}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="layer links" aria-hidden="true">
          <defs>
            <marker id="arrowhead" viewBox="0 0 12 12" refX="9" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
              <path d="M2 2 L10 6 L2 10" fill="none" stroke="context-stroke" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          {linkShapes.map(({ link, d }) => (
            <g key={link.id} className={selection?.kind === 'link' && selection.id === link.id ? 'is-selected' : undefined}>
              <path className="link-line" d={d} markerEnd={link.arrow ? 'url(#arrowhead)' : undefined} />
              {selectable && <path className="link-hit" d={d} data-sel="link" data-id={link.id} />}
            </g>
          ))}
          {liveLink && <path className="link-line is-live" d={liveLink} markerEnd="url(#arrowhead)" />}
        </svg>

        {placed.map((n) => (
          <NodeView
            key={n.key}
            node={n}
            selected={selection?.kind === 'node' && selection.id === n.key}
            showHandle={selectable && n.resizable}
            onMeasure={measure}
          />
        ))}

        <svg className="layer ink" aria-hidden="true">
          {strokes.map((s) => (
            <path
              key={s.id}
              d={strokePath(s.points, s.size)}
              fill={s.color}
              className={selection?.kind === 'stroke' && selection.id === s.id ? 'is-selected' : undefined}
              data-sel={selectable ? 'stroke' : undefined}
              data-id={s.id}
            />
          ))}
          {pendingInk.map((pts, i) => (
            <path key={`p${i}`} d={strokePath(pts, INK_SIZE)} fill={props.inkColor} />
          ))}
          {live?.type === 'draw' && <path d={strokePath(live.points, INK_SIZE)} fill={props.inkColor} />}
        </svg>
      </div>

      {anchor && props.actions && (
        <div className="sel-bar" data-nocanvas style={{ left: barX, top: barY }}>
          {props.actions}
        </div>
      )}
    </div>
  )
}

export const DEFAULT_INK_SIZE = INK_SIZE

function NodeView({
  node,
  selected,
  showHandle,
  onMeasure,
}: {
  node: CanvasNode
  selected: boolean
  showHandle: boolean
  onMeasure: (key: string, h: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const report = () => onMeasure(node.key, el.offsetHeight)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [node.key, onMeasure])

  return (
    <div
      ref={ref}
      className={`node ${node.className ?? ''}${selected ? ' is-selected' : ''}`}
      data-node={node.key}
      data-color={node.color}
      style={{ transform: `translate(${node.x}px, ${node.y}px)`, width: node.w }}
    >
      {node.content}
      {selected && showHandle && <span className="handle" data-handle aria-hidden="true" />}
    </div>
  )
}
