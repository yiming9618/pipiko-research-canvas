import { useSyncExternalStore } from 'react'

// One short message at the bottom of the screen, for things done from small
// buttons that have no room for a status line of their own.

let current: { text: string; id: number } | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

export function toast(text: string): void {
  current = { text, id: (current?.id ?? 0) + 1 }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    current = null
    for (const l of listeners) l()
  }, 3200)
  for (const l of listeners) l()
}

export function Toaster() {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
  return (
    <div className="toaster" role="status" aria-live="polite">
      {value && (
        <p key={value.id} className="toast">
          {value.text}
        </p>
      )}
    </div>
  )
}
