// A pannable, zoomable surface. Finger, pencil and mouse all go through the
// same Pointer Events code. Cards are ordinary HTML (selectable text, real
// links); connectors and ink are SVG layers below and above them.

import { getStroke } from 'perfect-freehand'
import { rectInLasso, strokeBounds, strokeInLasso, strokeTouched, type Pt } from '../../domain/geometry'
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
  pen?: 'pen' | 'marker'
}

/** select: tap, shift-tap or lasso, then drag / act on the selection. pen and marker draw; eraser removes whole strokes. */
export type Tool = 'select' | 'connect' | 'pen' | 'marker' | 'eraser'

/** What is selected: any number of things on the board and of ink strokes, or one connector. */
export interface Selection {
  nodes: string[]
  strokes: string[]
  link: string | null
}
export const NOTHING: Selection = { nodes: [], strokes: [], link: null }
export const selectionSize = (s: Selection) => s.nodes.length + s.strokes.length + (s.link ? 1 : 0)

export interface Ink {
  color: string
  size: number
  /** 1 for the pen; the marker is see-through. */
  opacity: number
}
export const MARKER_OPACITY = 0.38

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
  /** The selection was dragged: where each selected thing ends up, and how far the selected ink moved. */
  onMoveMany: (moves: { key: string; x: number; y: number }[], strokes: string[], dx: number, dy: number) => void
  onResize: (key: string, w: number) => void
  onLink: (from: string, to: string) => void
  onStroke: (points: number[]) => void
  /** The eraser went over these strokes (all of one pass, so it is one step to undo). */
  onErase: (ids: string[]) => void
  /** Right click, or a long press with a finger, on a thing or a stroke: select it and show what can be done. */
  onGrab?: (target: { node?: string; stroke?: string }) => void
  /** Two fingers tapped together (undo, on a touch screen). */
  onTwoFingerTap?: () => void
  onMeasure: (key: string, h: number) => void
  /** Buttons for the current selection, shown just above it. */
  actions?: ReactNode
  /** The view is re-fitted to the content whenever this changes (e.g. another day). */
  fitKey: string
  /** Space kept clear at the top for the header. */
  topInset?: number
  ink: Ink
  /** Called when the user keeps pinching in after the board is already at its smallest. */
  onZoomOut?: () => void
  /** Lets the parent turn a screen point into a board position (for placing new items). */
  apiRef?: React.RefObject<CanvasApi | null>
}

export interface CanvasApi {
  /** Board coordinates of the middle of what is visible. */
  center: () => { x: number; y: number }
  /** A point on the screen → the board position under it. */
  toBoard: (clientX: number, clientY: number) => { x: number; y: number }
  /** Brings a rectangle of the board to the middle of the view, at a readable size. */
  focusOn: (x: number, y: number, w: number, h: number) => void
}

const MIN_K = 0.25
const MAX_K = 2.5
const DRAG_THRESHOLD = 4
const INK_SIZE = 5

type Gesture =
  | { type: 'pan'; sx: number; sy: number; view: View }
  | { type: 'pinch'; dist: number; mx: number; my: number; view: View; wantOut: boolean; at: number; moved: boolean }
  | { type: 'drag'; sx: number; sy: number; moved: boolean; nodes: { key: string; x: number; y: number }[]; strokes: string[] }
  | { type: 'resize'; key: string; sx: number; w: number }
  | { type: 'link'; from: string }
  | { type: 'draw'; points: number[]; pen: boolean }
  | { type: 'lasso'; points: Pt[]; add: boolean; sx: number; sy: number }
  | { type: 'erase'; ids: Set<string> }

type Live =
  | { type: 'link'; from: string; x: number; y: number }
  | { type: 'draw'; points: number[] }
  | { type: 'lasso'; points: Pt[] }
  | null

// Shorter than the system's own long press (about half a second), which would otherwise
// start selecting text and take the touch away before this fires.
const LONG_PRESS = 400
const TAP_MS = 300
const ERASER_REACH = 12

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function strokePath(points: number[], size: number, marker = false): string {
  const input: [number, number, number][] = []
  for (let i = 0; i < points.length; i += 3) input.push([points[i], points[i + 1], points[i + 2]])
  // the marker keeps one width; the pen thins with speed and pressure
  const outline = getStroke(input, { size, thinning: marker ? 0 : 0.5, smoothing: 0.5, streamline: 0.4 })
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
  const press = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current)
    press.current = null
  }
  /** How far the selected ink has been dragged so far (it is redrawn in place only when let go). */
  const [inkShift, setInkShift] = useState<{ dx: number; dy: number } | null>(null)
  /** Strokes the eraser has passed over in this stroke of the eraser: hidden at once, removed when it lifts. */
  const [erasing, setErasing] = useState<string[]>([])
  const zoomOut = useRef(props.onZoomOut)
  zoomOut.current = props.onZoomOut
  /** Smallest zoom. With a level above this board, half the fitted size is the floor; past it we leave. */
  const floorK = useCallback(() => (zoomOut.current ? Math.max(MIN_K, fitK.current * 0.5) : MIN_K), [])
  const penSeen = useRef(false)
  const [live, setLive] = useState<Live>(null)
  /** Shown from the moment a drag ends until the saved value comes back, so nothing snaps back. */
  const [overrides, setOverrides] = useState<Record<string, { x?: number; y?: number; w?: number }>>({})
  const [pendingInk, setPendingInk] = useState<{ points: number[]; ink: Ink; marker: boolean }[]>([])
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

  useEffect(() => {
    setPendingInk([])
    setErasing([])
    setInkShift(null)
  }, [strokes])

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
    const whole = Math.max(MIN_K, Math.min(1, (el.clientWidth - margin * 2) / width))
    // zooming out can still go as far as showing everything
    fitK.current = whole
    // A board with several imports side by side is very wide: do not open it as a row of specks.
    // Start readable, at its left edge; the rest is a pan away.
    const k = Math.max(whole, el.clientWidth < 600 ? 0.5 : 0.7)
    const x = k === whole ? (el.clientWidth - width * k) / 2 - minX * k : margin - minX * k
    setView({ x, y: topInset + 8 - minY * k, k })
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
      toBoard: (clientX, clientY) => {
        const el = viewportRef.current
        const v = viewRef.current
        if (!el) return { x: 0, y: 0 }
        const r = el.getBoundingClientRect()
        return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k }
      },
      focusOn: (x, y, w, h) => {
        const el = viewportRef.current
        if (!el) return
        const k = Math.max(viewRef.current.k, el.clientWidth < 600 ? 0.6 : 0.8)
        setView({ x: el.clientWidth / 2 - (x + w / 2) * k, y: Math.max(topInset + 16, el.clientHeight / 2 - (h / 2) * k) - y * k, k })
      },
    }
  }, [props.apiRef, setView, topInset])

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
      at: performance.now(),
      moved: false,
    }
    setLive(null)
    setInkShift(null)
  }

  const strokeAt = (target: HTMLElement) => target.closest<SVGElement>('[data-stroke]')?.dataset.stroke

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    // Typing, and the selection's own buttons, are not canvas gestures.
    if (target.closest('textarea, input, select, [data-nocanvas]')) return
    // While just reading, taps on links and buttons inside cards work normally…
    if (!editing && target.closest('a, button, summary')) {
      // …but a finger held still on one still selects the card it is in.
      const held = target.closest<HTMLElement>('[data-node]')?.dataset.node
      if (e.pointerType === 'touch' && held && props.onGrab) {
        const grab = props.onGrab
        const sx = e.clientX
        const sy = e.clientY
        const stop = () => {
          cancelPress()
          window.removeEventListener('pointerup', stop)
          window.removeEventListener('pointercancel', stop)
          window.removeEventListener('pointermove', moved)
        }
        const moved = (ev: PointerEvent) => {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) stop()
        }
        cancelPress()
        press.current = setTimeout(() => {
          stop()
          // the link under the finger must not open when the finger lifts
          const swallow = (ev: Event) => {
            ev.preventDefault()
            ev.stopPropagation()
          }
          window.addEventListener('click', swallow, { capture: true, once: true })
          setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 1500)
          grab({ node: held })
        }, LONG_PRESS)
        window.addEventListener('pointerup', stop)
        window.addEventListener('pointercancel', stop)
        window.addEventListener('pointermove', moved)
      }
      return
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return

    const p = local(e)
    pointers.current.set(e.pointerId, p)
    if (e.pointerType === 'pen') penSeen.current = true
    viewportRef.current?.setPointerCapture(e.pointerId)

    cancelPress()
    if (pointers.current.size === 2) return startPinch()
    if (pointers.current.size > 2) return

    const key = target.closest<HTMLElement>('[data-node]')?.dataset.node
    const strokeId = strokeAt(target)

    // A finger held still on a thing or a stroke: select it and show what can be done with it.
    if (e.pointerType === 'touch' && (key || strokeId) && props.onGrab && (!editing || tool === 'select')) {
      const grab = props.onGrab
      press.current = setTimeout(() => {
        press.current = null
        gesture.current = null
        setOverrides({})
        setInkShift(null)
        grab(key ? { node: key } : { stroke: strokeId })
      }, LONG_PRESS)
    }

    // Once a pencil has been used, a finger pans instead of drawing, erasing or lassoing (palm rejection).
    const palm = e.pointerType === 'touch' && penSeen.current
    if (editing) {
      if ((tool === 'pen' || tool === 'marker') && !palm) {
        const w = toWorld(p)
        const pen = e.pointerType === 'pen'
        gesture.current = { type: 'draw', points: [w.x, w.y, pen ? e.pressure || 0.5 : 0.5], pen }
        return
      }
      if (tool === 'eraser' && !palm) {
        gesture.current = { type: 'erase', ids: new Set() }
        eraseAt(p, gesture.current.ids)
        return
      }
      if (tool === 'connect' && key) {
        gesture.current = { type: 'link', from: key }
        return
      }
      if (tool === 'select') {
        const node = key ? placed.find((n) => n.key === key) : undefined
        if (node && target.closest('[data-handle]')) {
          gesture.current = { type: 'resize', key: node.key, sx: p.x, w: node.w }
          return
        }
        if (node || strokeId) {
          const isSelected = node ? selection.nodes.includes(node.key) : selection.strokes.includes(strokeId!)
          if (e.shiftKey) {
            // add to, or take out of, what is selected
            onSelect({
              link: null,
              nodes: node ? (isSelected ? selection.nodes.filter((k) => k !== node.key) : [...selection.nodes, node.key]) : selection.nodes,
              strokes: strokeId ? (isSelected ? selection.strokes.filter((k) => k !== strokeId) : [...selection.strokes, strokeId]) : selection.strokes,
            })
            return
          }
          const sel: Selection = isSelected ? selection : { nodes: node ? [node.key] : [], strokes: strokeId ? [strokeId] : [], link: null }
          if (!isSelected) onSelect(sel)
          // dragging one selected thing moves everything that is selected
          gesture.current = {
            type: 'drag',
            sx: p.x,
            sy: p.y,
            moved: false,
            nodes: placed.filter((n) => sel.nodes.includes(n.key) && n.movable).map((n) => ({ key: n.key, x: n.x, y: n.y })),
            strokes: sel.strokes,
          }
          return
        }
        const link = target.closest<SVGElement>('[data-sel="link"]')
        if (link) {
          onSelect({ nodes: [], strokes: [], link: link.dataset.id! })
          return
        }
        if (!palm) {
          const w = toWorld(p)
          gesture.current = { type: 'lasso', points: [w], add: e.shiftKey, sx: p.x, sy: p.y }
          return
        }
      }
    }
    gesture.current = { type: 'pan', sx: p.x, sy: p.y, view: viewRef.current }
  }

  /** Marks every stroke the eraser touches at this point. */
  const eraseAt = (p: { x: number; y: number }, ids: Set<string>) => {
    const w = toWorld(p)
    const reach = ERASER_REACH / viewRef.current.k
    let changed = false
    for (const s of strokes) {
      if (ids.has(s.id)) continue
      if (strokeTouched(s.points, w, reach + s.size / 2)) {
        ids.add(s.id)
        changed = true
      }
    }
    if (changed) setErasing([...ids])
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    const p = local(e)
    const was = pointers.current.get(e.pointerId)!
    pointers.current.set(e.pointerId, p)
    const g = gesture.current
    if (!g) return
    const k = viewRef.current.k

    switch (g.type) {
      case 'pinch': {
        const [a, b] = [...pointers.current.values()]
        if (!b) return
        if (Math.hypot(p.x - was.x, p.y - was.y) > 0.5 && Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - g.dist) + Math.hypot((a.x + b.x) / 2 - g.mx, (a.y + b.y) / 2 - g.my) > 10) g.moved = true
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
        if (Math.hypot(p.x - g.sx, p.y - g.sy) > 8) cancelPress()
        setView({ ...g.view, x: g.view.x + p.x - g.sx, y: g.view.y + p.y - g.sy })
        return
      case 'drag': {
        if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) < DRAG_THRESHOLD) return
        g.moved = true
        cancelPress()
        const dx = (p.x - g.sx) / k
        const dy = (p.y - g.sy) / k
        setOverrides((o) => {
          const next = { ...o }
          for (const n of g.nodes) next[n.key] = { ...o[n.key], x: n.x + dx, y: n.y + dy }
          return next
        })
        if (g.strokes.length > 0) setInkShift({ dx, dy })
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
      case 'lasso': {
        if (Math.hypot(p.x - g.sx, p.y - g.sy) > 8) cancelPress()
        g.points.push(toWorld(p))
        setLive({ type: 'lasso', points: g.points.slice() })
        return
      }
      case 'erase':
        eraseAt(p, g.ids)
        return
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    const p = local(e)
    pointers.current.delete(e.pointerId)
    cancelPress()
    const g = gesture.current
    if (!g) return

    if (g.type === 'pinch') {
      if (g.wantOut && zoomOut.current) {
        gesture.current = null
        pointers.current.clear()
        zoomOut.current()
        return
      }
      // Two fingers down and up again, quickly and without moving: a tap, not a pinch.
      if (!g.moved && performance.now() - g.at < TAP_MS && props.onTwoFingerTap) {
        gesture.current = null
        pointers.current.clear()
        setView(g.view)
        props.onTwoFingerTap()
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

    if (g.type === 'drag') {
      if (g.moved && !cancelled) {
        const dx = (p.x - g.sx) / k
        const dy = (p.y - g.sy) / k
        props.onMoveMany(g.nodes.map((n) => ({ key: n.key, x: n.x + dx, y: n.y + dy })), g.strokes, dx, dy)
      } else {
        setInkShift(null)
        if (cancelled) setOverrides({})
      }
    } else if (g.type === 'resize') {
      if (!cancelled) props.onResize(g.key, Math.max(160, g.w + (p.x - g.sx) / k))
      else setOverrides({})
    } else if (g.type === 'link' && !cancelled) {
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-node]')
      const to = under?.dataset.node
      if (to && to !== g.from) props.onLink(g.from, to)
    } else if (g.type === 'draw' && !cancelled && g.points.length >= 6) {
      setPendingInk((prev) => [...prev, { points: g.points, ink: props.ink, marker: tool === 'marker' }])
      props.onStroke(g.points)
    } else if (g.type === 'lasso' && !cancelled) {
      if (g.points.length < 4 || Math.hypot(p.x - g.sx, p.y - g.sy) + g.points.length < 8) {
        // a tap on empty space: let go of the selection
        if (!g.add) onSelect(NOTHING)
      } else {
        const inNodes = placed.filter((n) => rectInLasso({ x: n.x, y: n.y, w: n.w, h: heights[n.key] ?? 120 }, g.points)).map((n) => n.key)
        const inStrokes = strokes.filter((st) => strokeInLasso(st.points, g.points)).map((st) => st.id)
        onSelect({
          link: null,
          nodes: g.add ? [...new Set([...selection.nodes, ...inNodes])] : inNodes,
          strokes: g.add ? [...new Set([...selection.strokes, ...inStrokes])] : inStrokes,
        })
      }
    } else if (g.type === 'erase') {
      if (g.ids.size > 0 && !cancelled) props.onErase([...g.ids])
      else setErasing([])
    }
    setLive(null)
  }

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('textarea, input, [data-nocanvas]')) return
    const key = target.closest<HTMLElement>('[data-node]')?.dataset.node
    const strokeId = strokeAt(target)
    if (!props.onGrab || (!key && !strokeId)) return
    e.preventDefault()
    props.onGrab(key ? { node: key } : { stroke: strokeId })
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

  // The action bar sits above the middle of everything that is selected.
  let anchor: { x: number; y: number } | null = null
  if (props.actions && selectionSize(selection) > 0) {
    if (selection.link) {
      anchor = linkShapes.find((s) => s.link.id === selection.link)?.mid ?? null
    } else {
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      for (const key of selection.nodes) {
        const r = rectOf(key)
        if (!r) continue
        minX = Math.min(minX, r.x)
        maxX = Math.max(maxX, r.x + r.w)
        minY = Math.min(minY, r.y)
      }
      for (const id of selection.strokes) {
        const st = strokes.find((x) => x.id === id)
        const b = st && strokeBounds(st.points)
        if (!b) continue
        minX = Math.min(minX, b.x + (inkShift?.dx ?? 0))
        maxX = Math.max(maxX, b.x + b.w + (inkShift?.dx ?? 0))
        minY = Math.min(minY, b.y + (inkShift?.dy ?? 0))
      }
      if (Number.isFinite(minX)) anchor = { x: (minX + maxX) / 2, y: minY }
    }
  }
  const vw = viewportRef.current?.clientWidth ?? 0
  const half = Math.min(190, vw / 2 - 6)
  const barX = anchor ? Math.max(half + 6, Math.min(vw - half - 6, anchor.x * view.k + view.x)) : 0
  const barY = anchor ? Math.max(topInset + 4, anchor.y * view.k + view.y - 56) : 0

  const selectable = editing && tool === 'select'
  const one = selection.nodes.length === 1 && selection.strokes.length === 0 ? selection.nodes[0] : null
  const lassoPath = live?.type === 'lasso' && live.points.length > 1 ? `M${live.points.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' L')} Z` : null

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
      onContextMenu={onContextMenu}
    >
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="layer links" aria-hidden="true">
          <defs>
            <marker id="arrowhead" viewBox="0 0 12 12" refX="9" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
              <path d="M2 2 L10 6 L2 10" fill="none" stroke="context-stroke" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          {linkShapes.map(({ link, d }) => (
            <g key={link.id} className={selection.link === link.id ? 'is-selected' : undefined}>
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
            selected={selection.nodes.includes(n.key)}
            showHandle={selectable && n.resizable && one === n.key}
            onMeasure={measure}
          />
        ))}

        <svg className="layer ink" aria-hidden="true">
          {strokes
            .filter((s) => !erasing.includes(s.id))
            .map((s) => {
              const chosen = selection.strokes.includes(s.id)
              return (
                <path
                  key={s.id}
                  d={strokePath(s.points, s.size, s.pen === 'marker')}
                  fill={s.color}
                  fillOpacity={s.pen === 'marker' ? MARKER_OPACITY : undefined}
                  className={chosen ? 'is-selected' : undefined}
                  transform={chosen && inkShift ? `translate(${inkShift.dx} ${inkShift.dy})` : undefined}
                  // always marked, so a right click or a long press can find it
                  data-stroke={s.id}
                />
              )
            })}
          {pendingInk.map((pending, i) => (
            <path key={`p${i}`} d={strokePath(pending.points, pending.ink.size, pending.marker)} fill={pending.ink.color} fillOpacity={pending.ink.opacity} />
          ))}
          {live?.type === 'draw' && <path d={strokePath(live.points, props.ink.size, tool === 'marker')} fill={props.ink.color} fillOpacity={props.ink.opacity} />}
          {lassoPath && <path className="lasso" d={lassoPath} />}
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

export const PEN_SIZE = INK_SIZE
export const MARKER_SIZE = 18

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
