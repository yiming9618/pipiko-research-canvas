import { IconSettings } from './icons'
import { SearchBox } from './SearchBox'

type Place = 'home' | 'board' | 'library' | 'settings'

const LINKS: { place: Place; href: string; label: string }[] = [
  { place: 'home', href: '#/', label: '主页' },
  { place: 'board', href: '#/board', label: '画板' },
  { place: 'library', href: '#/library', label: '论文库' },
]

export function TopNav({ current }: { current: Place }) {
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
        <SearchBox />
        <a
          className="icon-btn"
          href="#/settings"
          aria-label="设置"
          aria-current={current === 'settings' ? 'page' : undefined}
        >
          <IconSettings />
        </a>
      </div>
    </nav>
  )
}
