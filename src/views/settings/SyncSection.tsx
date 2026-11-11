import { useState, useSyncExternalStore, type FormEvent } from 'react'
import {
  connectSync,
  disconnectSync,
  getSyncState,
  needsAttention,
  replaceToken,
  subscribeSync,
  syncNow,
} from '../../sync/controller'

export function useSync() {
  return useSyncExternalStore(subscribeSync, getSyncState)
}

/** On the published site the address already says whose notebook this is. */
function guessOwner(): string {
  const m = window.location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i)
  return m ? m[1] : ''
}

function clock(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function TokenField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>访问令牌</span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="github_pat_…"
        required
      />
    </label>
  )
}

export function SyncSection() {
  const sync = useSync()
  const [owner, setOwner] = useState(guessOwner)
  const [repo, setRepo] = useState('')
  const [token, setToken] = useState('')
  const [changing, setChanging] = useState(false)

  const connect = async (e: FormEvent) => {
    e.preventDefault()
    // "owner/repo" pasted into the repo field also works
    const parts = repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').split('/').filter(Boolean)
    const o = parts.length > 1 ? parts[0] : owner.trim()
    const r = parts.length > 1 ? parts[1] : (parts[0] ?? '')
    if (!o || !r || !token.trim()) return
    await connectSync({ owner: o, repo: r, token: token.trim() })
    setToken('')
  }

  const change = async (e: FormEvent) => {
    e.preventDefault()
    if (!token.trim()) return
    await replaceToken(token.trim())
    setToken('')
    setChanging(false)
  }

  if (sync.phase === 'off') {
    return (
      <section className="section" aria-labelledby="s-sync">
        <h2 id="s-sync">同步</h2>
        <p className="section-note">
          这台设备还没有连接。连接后，这里的内容会和你的私有数据仓库互相补齐，其他设备上导入的也会出现在这里。令牌只存在这台设备里，不会进入同步和备份文件。
        </p>
        <form className="sync-form" onSubmit={(e) => void connect(e)}>
          <label className="field">
            <span>GitHub 用户名</span>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} required />
          </label>
          <label className="field">
            <span>数据仓库的名字</span>
            <input value={repo} onChange={(e) => setRepo(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} required />
          </label>
          <TokenField value={token} onChange={setToken} />
          <div className="row-actions">
            <button type="submit" className="btn">
              连接并同步
            </button>
          </div>
        </form>
      </section>
    )
  }

  const problem = sync.phase === 'problem' ? sync.problem : null
  return (
    <section className="section" aria-labelledby="s-sync">
      <h2 id="s-sync">同步</h2>
      <p className="section-note">
        已连接到 {sync.owner}/{sync.repo}。编辑停下几秒后会自动同步，最多每分钟一次。
      </p>

      {problem ? (
        <div className={`sync-problem${needsAttention(problem.kind) ? ' is-urgent' : ''}`} role="alert">
          <p>{problem.message}</p>
          {problem.steps.length > 0 && (
            <ol>
              {problem.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <p className="status-line" role="status" aria-live="polite">
          {sync.phase === 'syncing'
            ? '正在同步…'
            : `已同步${sync.lastSyncAt ? `，上次 ${clock(sync.lastSyncAt)}` : ''}${sync.pulled > 0 ? `，收到 ${sync.pulled} 条新内容` : ''}`}
        </p>
      )}

      {changing ? (
        <form className="sync-form" onSubmit={(e) => void change(e)}>
          <TokenField value={token} onChange={setToken} />
          <div className="row-actions">
            <button type="submit" className="btn">
              保存并同步
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setChanging(false)}>
              取消
            </button>
          </div>
        </form>
      ) : (
        <div className="row-actions">
          <button type="button" className="btn" onClick={syncNow} disabled={sync.phase === 'syncing'}>
            现在同步
          </button>
          <button type="button" className="btn" onClick={() => setChanging(true)}>
            更换令牌
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              if (window.confirm('断开后这台设备不再同步。这台设备和数据仓库里的内容都不会被删除。要断开吗？')) void disconnectSync()
            }}
          >
            断开
          </button>
        </div>
      )}
    </section>
  )
}
