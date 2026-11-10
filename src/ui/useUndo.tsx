import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ImportEntry } from '../domain/types'
import type { UndoPlan } from '../domain/undo'
import { commitUndo, prepareUndo } from '../store/actions'

/**
 * Undo for an import. If the user has built on the imported content since
 * (edits, piles, connectors), it lists what would be lost and waits for a yes.
 */
export function useUndo(onDone?: (entry: ImportEntry) => void): {
  requestUndo: (entry: ImportEntry) => Promise<void>
  dialog: ReactNode
} {
  const [pending, setPending] = useState<{ entry: ImportEntry; plan: UndoPlan } | null>(null)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (pending && !el.open) el.showModal()
    if (!pending && el.open) el.close()
  }, [pending])

  const finish = async (entry: ImportEntry, plan: UndoPlan) => {
    await commitUndo(plan)
    setPending(null)
    onDone?.(entry)
  }

  const requestUndo = async (entry: ImportEntry) => {
    const plan = await prepareUndo(entry)
    if (plan.impacts.length === 0) await finish(entry, plan)
    else setPending({ entry, plan })
  }

  const dialog = (
    <dialog ref={ref} className="dialog" onClose={() => setPending(null)} aria-labelledby="undo-title">
      {pending && (
        <>
          <h2 id="undo-title">撤销这次导入会影响这些地方</h2>
          <ul>
            {pending.plan.impacts.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>这些改动会一起消失。原始 Markdown 会保留，可以重新导入。</p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setPending(null)} autoFocus>
              先不撤销
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void finish(pending.entry, pending.plan)}
            >
              确认撤销
            </button>
          </div>
        </>
      )}
    </dialog>
  )

  return { requestUndo, dialog }
}
