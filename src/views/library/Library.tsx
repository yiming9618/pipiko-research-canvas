import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { IconBook } from '../../ui/icons'
import { TopNav } from '../../ui/TopNav'
import { LibraryList } from './LibraryList'
import { PaperPage } from './PaperPage'

const MIN_W = 260
const MAX_W = 620
const DEFAULT_W = 380

function read<T>(key: string, fallback: T, ok: (v: unknown) => v is T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as unknown
    return ok(v) ? v : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // remembering the layout is a convenience only
  }
}
const isWidth = (v: unknown): v is number => typeof v === 'number' && v >= MIN_W && v <= MAX_W
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

/**
 * Wide screens: the list on the left, the open paper on the right. The list can be folded
 * down to a narrow strip (to read) and its width dragged (to manage); both are remembered.
 * Narrow screens: one at a time (see .lib in CSS).
 */
export function Library({ paperId }: { paperId?: string }) {
  const [collapsed, setCollapsed] = useState(() => read('lib.side.collapsed', false, isBool))
  const [width, setWidth] = useState(() => read('lib.side.width', DEFAULT_W, isWidth))
  const drag = useRef<{ x: number; w: number } | null>(null)

  const fold = (next: boolean) => {
    setCollapsed(next)
    write('lib.side.collapsed', next)
  }
  const clamp = (w: number) => Math.max(MIN_W, Math.min(MAX_W, Math.min(window.innerWidth - 480, w)))
  const grip = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      drag.current = { x: e.clientX, w: width }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (drag.current) setWidth(clamp(drag.current.w + e.clientX - drag.current.x))
    },
    onPointerUp: () => {
      if (!drag.current) return
      drag.current = null
      write('lib.side.width', Math.round(width))
    },
  }

  return (
    <div
      className={`lib${collapsed ? ' is-collapsed' : ''}`}
      data-open={paperId ? 'paper' : 'list'}
      style={{ '--lib-w': collapsed ? '56px' : `${width}px` } as CSSProperties}
    >
      <TopNav current="library" />
      <div className="lib-body">
        <aside className="lib-side" aria-label="论文库">
          {collapsed ? (
            <button type="button" className="icon-btn lib-expand" aria-label="展开论文库" title="展开论文库" onClick={() => fold(false)}>
              <IconBook />
            </button>
          ) : (
            <LibraryList activeId={paperId} onCollapse={() => fold(true)} />
          )}
        </aside>
        {!collapsed && (
          <div
            className="lib-grip"
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整论文库的宽度"
            aria-valuenow={Math.round(width)}
            aria-valuemin={MIN_W}
            aria-valuemax={MAX_W}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setWidth((w) => clamp(w - 20))
              if (e.key === 'ArrowRight') setWidth((w) => clamp(w + 20))
            }}
            {...grip}
            onPointerCancel={grip.onPointerUp}
          />
        )}
        <main className="lib-main">
          {paperId ? <PaperPage key={paperId} id={paperId} /> : <p className="empty lib-hint">选一篇论文打开。</p>}
        </main>
      </div>
    </div>
  )
}
