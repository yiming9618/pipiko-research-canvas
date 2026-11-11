import { useState, useSyncExternalStore, type FormEvent } from 'react'
import {
  connectSync,
  daysLeft,
  disconnectSync,
  expiringSoon,
  getSyncState,
  needsAttention,
  replaceToken,
  setTokenExpiry,
  subscribeSync,
  syncNow,
} from '../../sync/controller'
import { todayLocal } from '../../store/db'

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

function ExpiryField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>令牌的到期日（可以不填）</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="field-hint">生成令牌时 GitHub 会显示。填了的话，到期前 7 天会在设置图标上提醒你。</span>
    </label>
  )
}

/** True when the settings icon should carry a dot for the token's expiry. */
export function useExpiryReminder(): boolean {
  const sync = useSync()
  return sync.phase !== 'off' && expiringSoon(sync.expires, todayLocal())
}

export function SyncSection() {
  const sync = useSync()
  const [owner, setOwner] = useState(guessOwner)
  const [repo, setRepo] = useState('')
  const [token, setToken] = useState('')
  const [changing, setChanging] = useState(false)
  const [expires, setExpires] = useState('')
  const [datingOnly, setDatingOnly] = useState(false)

  const connect = async (e: FormEvent) => {
    e.preventDefault()
    // "owner/repo" pasted into the repo field also works
    const parts = repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').split('/').filter(Boolean)
    const o = parts.length > 1 ? parts[0] : owner.trim()
    const r = parts.length > 1 ? parts[1] : (parts[0] ?? '')
    if (!o || !r || !token.trim()) return
    await connectSync({ owner: o, repo: r, token: token.trim(), ...(expires ? { expires } : {}) })
    setToken('')
    setExpires('')
  }

  const change = async (e: FormEvent) => {
    e.preventDefault()
    if (!token.trim()) return
    await replaceToken(token.trim(), expires)
    setToken('')
    setExpires('')
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
          <ExpiryField value={expires} onChange={setExpires} />
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
  const left = daysLeft(sync.expires, todayLocal())
  const soon = left !== null && left <= 7
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

      {soon && !problem && (
        <div className="sync-problem is-urgent" role="alert">
          <p>
            {left! < 0
              ? `按你填的日期，令牌已经在 ${sync.expires} 到期了。`
              : left === 0
                ? '令牌今天到期。'
                : `令牌还有 ${left} 天到期（${sync.expires}）。`}
            到期后同步会停下，这台设备上的内容不受影响。现在就可以换一个新的：在 GitHub 上重新生成令牌（只授权数据仓库，Contents 读写），再点下面的"更换令牌"。
          </p>
        </div>
      )}
      {!soon && (
        <p className="section-note">
          {sync.expires ? `令牌到期日：${sync.expires}。` : '还没有填令牌的到期日，到期前不会有提醒。'}
          {!datingOnly && !changing && (
            <button type="button" className="link-btn" onClick={() => { setExpires(sync.expires ?? ''); setDatingOnly(true) }}>
              {sync.expires ? '修改' : '填写到期日'}
            </button>
          )}
        </p>
      )}
      {datingOnly && !changing && (
        <form
          className="sync-form"
          onSubmit={(e) => {
            e.preventDefault()
            void setTokenExpiry(expires).then(() => {
              setDatingOnly(false)
              setExpires('')
            })
          }}
        >
          <ExpiryField value={expires} onChange={setExpires} />
          <div className="row-actions">
            <button type="submit" className="btn">
              保存到期日
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => { setDatingOnly(false); setExpires('') }}>
              取消
            </button>
          </div>
        </form>
      )}

      {changing ? (
        <form className="sync-form" onSubmit={(e) => void change(e)}>
          <TokenField value={token} onChange={setToken} />
          <ExpiryField value={expires} onChange={setExpires} />
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
          <button type="button" className="btn" onClick={() => { setDatingOnly(false); setExpires(''); setChanging(true) }}>
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
