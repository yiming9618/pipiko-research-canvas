import { useLiveQuery } from 'dexie-react-hooks'
import { activeBoxes } from '../domain/discussions'
import { db } from '../store/db'
import { IconChat, IconSettings } from './icons'
import { SearchBox } from './SearchBox'
import { useExpiryReminder, useSync } from '../views/settings/SyncSection'

type Place = 'home' | 'board' | 'time' | 'library' | 'settings' | 'discussions'

const LINKS: { place: Place; href: string; label: string }[] = [
  { place: 'home', href: '#/', label: '主页' },
  { place: 'board', href: '#/boards', label: '画板' },
  { place: 'time', href: '#/time', label: '时间' },
  { place: 'library', href: '#/library', label: '论文库' },
]

export function TopNav({ current }: { current: Place }) {
  const stopped = useSync().phase === 'problem'
  const expiring = useExpiryReminder()
  const boxes = useLiveQuery(async () => activeBoxes(await db.discussions.toArray()).length) ?? 0
  return (
    <nav className="topnav" aria-label="主导航">
      <div className="topnav-links">
        {LINKS.map((l) => (
          <a key={l.place} href={l.href} aria-current={current === l.place ? 'page' : undefined}>
            {l.label}
          </a>
        ))}
      </div>
      <div className="topnav-tools">
        <a
          className="icon-btn box-link"
          href="#/discussions"
          aria-label={boxes > 0 ? `讨论框，${boxes} 个` : '讨论框'}
          aria-current={current === 'discussions' ? 'page' : undefined}
        >
          <IconChat />
          {boxes > 0 && (
            <span className="box-badge" aria-hidden="true">
              {boxes}
            </span>
          )}
        </a>
        <SearchBox />
        <a
          className="icon-btn"
          href="#/settings"
          aria-label={stopped ? '设置（同步停了）' : expiring ? '设置（令牌快到期了）' : '设置'}
          aria-current={current === 'settings' ? 'page' : undefined}
        >
          <IconSettings />
          {(stopped || expiring) && <span className="sync-dot" aria-hidden="true" />}
        </a>
      </div>
    </nav>
  )
}
