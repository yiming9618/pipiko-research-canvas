import { useEffect, useState } from 'react'
import { BoardPage } from './views/board/BoardPage'
import { Home } from './views/home/Home'
import { Library } from './views/library/Library'
import { Settings } from './views/settings/Settings'

function currentRoute(): string {
  return window.location.hash.replace(/^#/, '') || '/'
}

export default function App() {
  const [route, setRoute] = useState(currentRoute)

  useEffect(() => {
    const onChange = () => {
      setRoute(currentRoute())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  if (route === '/settings') return <Settings />
  if (route === '/board') return <BoardPage />
  if (route.startsWith('/board/')) return <BoardPage date={route.slice(7)} />
  if (route === '/library') return <Library />
  if (route.startsWith('/paper/')) return <Library paperId={decodeURIComponent(route.slice(7))} />
  return <Home />
}
