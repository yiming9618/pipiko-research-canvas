import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { IconBook, IconClose, IconExpand, IconShrink } from '../../ui/icons'
import { TopNav } from '../../ui/TopNav'
import { LibraryList } from '../library/LibraryList'
import { BoardView } from './BoardView'
import { useNarrow } from './parts'

const MIN_W = 260
const MAX_W = 620
const DEFAULT_W = 340

function savedWidth(): number {
  try {
    const n = Number(localStorage.getItem('board.side.width'))
    return n >= MIN_W && n <= MAX_W ? n : DEFAULT_W
  } catch {
    return DEFAULT_W
  }
}

/**
 * One board. The library list is tucked away as an icon; opened, it sits
 * beside the board (over it on a phone) and papers can be dragged out of it
 * onto the board. Its width can be dragged and is remembered.
 */
export function BoardPage({ boardId, focus }: { boardId: string; focus?: string }) {
  const [open, setOpen] = useState(false)
  /** Only the board: navigation, header and bars hidden, for writing, looking and screenshots. */
  const [immersive, setImmersive] = useState(false)
  const [width, setWidth] = useState(savedWidth)
  /** Phone: a paper is being dragged out, so the list steps aside to show the board. */
  const [away, setAway] = useState(false)
  const narrow = useNarrow()
  const drag = useRef<{ x: number; w: number } | null>(null)

  // Esc brings the interface back (Mac)
  useEffect(() => {
    if (!immersive) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (e.key === 'Escape' && tag !== 'INPUT' && tag !== 'TEXTAREA') setImmersive(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [immersive])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.target as HTMLElement).tagName !== 'INPUT' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // On a phone the list covers the board, so it moves out of the way while a paper is dragged.
  // It must stay in the page until the finger lifts: the touch belongs to the row it started on,
  // and removing that row would cut the drag off.
  const stepAside = () => {
    if (!narrow) return
    setAway(true)
    const done = () => {
      window.removeEventListener('pointerup', done)
      window.removeEventListener('pointercancel', done)
      setAway(false)
      setOpen(false)
    }
    window.addEventListener('pointerup', done)
    window.addEventListener('pointercancel', done)
  }

  const clamp = (w: number) => Math.max(MIN_W, Math.min(MAX_W, Math.min(window.innerWidth - 320, w)))
  const onGrip = {
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
      try {
        localStorage.setItem('board.side.width', String(Math.round(width)))
      } catch {
        // remembering the width is a convenience only
      }
    },
  }

  return (
    <div className={`boardpage${immersive ? ' is-immersive' : ''}`}>
      <TopNav current="board" />
      <div className={`board-body${open ? ' has-side' : ''}`} style={open && !narrow ? { gridTemplateColumns: `${width}px minmax(0, 1fr)` } : undefined}>
        {open && (
          <aside className={`board-side${away ? ' is-away' : ''}`} aria-label="论文库">
            <button type="button" className="icon-btn side-close" aria-label="收起论文库" onClick={() => setOpen(false)}>
              <IconClose />
            </button>
            <p className="side-hint">把论文拖到画板上，生成论文卡片。</p>
            <LibraryList onDragOut={stepAside} />
            {!narrow && (
              <div
                className="side-grip"
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
                {...onGrip}
                onPointerCancel={onGrip.onPointerUp}
              />
            )}
          </aside>
        )}
        <main className="board-main">
          {!open && (
            <button type="button" className="icon-btn side-open" aria-label="打开论文库" aria-expanded={false} onClick={() => setOpen(true)}>
              <IconBook />
            </button>
          )}
          <button
            type="button"
            className="icon-btn immersive-toggle"
            aria-pressed={immersive}
            aria-label={immersive ? '显示界面' : '隐藏界面'}
            title={immersive ? '显示界面' : '隐藏界面'}
            onClick={() => {
              setOpen(false)
              setImmersive(!immersive)
            }}
          >
            {immersive ? <IconShrink /> : <IconExpand />}
          </button>
          <BoardView key={boardId} boardId={boardId} focus={focus} />
        </main>
      </div>
    </div>
  )
}
