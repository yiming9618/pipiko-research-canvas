import { useState } from 'react'
import { needsAttention } from '../sync/controller'
import { useSync } from '../views/settings/SyncSection'
import { IconClose } from './icons'

/** Shown on every page while sync is stopped for a reason only the person can fix. */
export function SyncBanner({ onSettings }: { onSettings: boolean }) {
  const sync = useSync()
  const [hidden, setHidden] = useState<string | null>(null)
  const problem = sync.phase === 'problem' ? sync.problem : null
  if (!problem || !needsAttention(problem.kind) || onSettings || hidden === problem.message) return null
  return (
    <div className="sync-banner" role="alert">
      <p>{problem.message}</p>
      <a className="btn" href="#/settings">
        去处理
      </a>
      <button type="button" className="icon-btn" aria-label="先收起这条提示" onClick={() => setHidden(problem.message)}>
        <IconClose />
      </button>
    </div>
  )
}
