import { useEffect, useState } from 'react'
import { BoardPage } from './views/board/BoardPage'
import { Home } from './views/home/Home'
import { Library } from './views/library/Library'
import { Settings } from './views/settings/Settings'
import { SyncBanner } from './ui/SyncBanner'
import { initSync } from './sync/controller'

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
    void initSync()
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  let page = <Home />
  if (route === '/settings') page = <Settings />
  else if (route === '/board') page = <BoardPage />
  else if (route.startsWith('/board/')) page = <BoardPage param={route.slice(7)} />
  else if (route.startsWith('/pile/')) page = <BoardPage pileId={decodeURIComponent(route.slice(6))} />
  else if (route === '/library') page = <Library />
  else if (route.startsWith('/paper/')) page = <Library paperId={decodeURIComponent(route.slice(7))} />
  return (
    <>
      {page}
      <SyncBanner onSettings={route === '/settings'} />
    </>
  )
}
