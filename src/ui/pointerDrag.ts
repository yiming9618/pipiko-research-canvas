// Dragging something out of a list with a finger, a pencil or the mouse.
// HTML5 drag and drop does not work with touch on iPad and iPhone, so this is
// done with Pointer Events: a small label follows the pointer, and where it is
// let go is announced to whoever is listening (the board).

export const POINTER_DROP = 'notebook-pointer-drop'

export interface PointerDrop {
  ref: { type: 'paper' | 'card' | 'cover'; id: string }
  clientX: number
  clientY: number
}

interface Start {
  pointerId: number
  pointerType: string
  clientX: number
  clientY: number
}

const SLOP = 8

/**
 * Call from `onPointerDown` on a draggable row. Nothing happens until the
 * pointer has moved a little; a finger also has to move more sideways than up
 * or down, so that scrolling the list still works. With `free` (the row's grip,
 * which the browser never scrolls from) a finger can drag in any direction. Returns nothing: a plain
 * tap is left alone (the row's own link opens).
 */
export function watchPointerDrag(e: Start, ref: PointerDrop['ref'], label: string, onStart?: () => void, free = false): void {
  const startX = e.clientX
  const startY = e.clientY
  let ghost: HTMLElement | null = null
  let over: HTMLElement | null = null

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    if (!ghost) {
      if (Math.hypot(dx, dy) < SLOP) return
      // a finger moving mostly up or down is scrolling the list
      // (not from the grip: there the browser never scrolls, so any direction drags)
      if (!free && e.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx)) return stop()
      ghost = document.createElement('div')
      ghost.className = 'drag-ghost'
      ghost.textContent = label
      document.body.appendChild(ghost)
      document.body.classList.add('is-pointer-dragging')
      onStart?.()
    }
    ev.preventDefault()
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`
    // something that takes a drop (a field's heading) lights up under the pointer
    const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-drop-target]') ?? null
    if (target !== over) {
      over?.classList.remove('is-over')
      target?.classList.add('is-over')
      over = target
    }
  }
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return
    const dragged = ghost !== null
    stop()
    if (!dragged || ev.type === 'pointercancel') return
    // With the mouse, letting go is followed by a click on the row's link: it must not open.
    // A finger that has dragged produces no click, so there is nothing to hold back
    // (and holding back would swallow the person's next real tap).
    if (e.pointerType === 'mouse') {
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400)
    }
    document.dispatchEvent(new CustomEvent<PointerDrop>(POINTER_DROP, { detail: { ref, clientX: ev.clientX, clientY: ev.clientY } }))
  }
  const swallow = (ev: Event) => {
    ev.preventDefault()
    ev.stopPropagation()
  }
  const stop = () => {
    over?.classList.remove('is-over')
    over = null
    ghost?.remove()
    ghost = null
    document.body.classList.remove('is-pointer-dragging')
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
  window.addEventListener('pointermove', move, { passive: false })
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}
