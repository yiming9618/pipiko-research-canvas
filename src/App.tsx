import { useEffect, useState } from 'react'
import { BoardPage } from './views/board/BoardPage'
import { Home } from './views/home/Home'
import { Library } from './views/library/Library'
import { Settings } from './views/settings/Settings'
import { SyncBanner } from './ui/SyncBanner'
import { Toaster } from './ui/toast'
import { DiscussionPage, DiscussionsPage } from './views/discussions/DiscussionsPage'
import { initSync } from './sync/controller'
import { initLookups } from './store/lookup'
import { ensureBoards } from './store/migration'

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
    // boards first, then sync: what this device has is in place before anything arrives
    void ensureBoards().then(() => initSync())
    initLookups()
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  let page = <Home />
  if (route === '/settings') page = <Settings />
  else if (route === '/board') page = <BoardPage />
  else if (route.startsWith('/board/')) page = <BoardPage param={route.slice(7)} />
  else if (route.startsWith('/pile/')) page = <BoardPage pileId={decodeURIComponent(route.slice(6))} />
  else if (route === '/discussions') page = <DiscussionsPage />
  else if (route.startsWith('/discussion/')) page = <DiscussionPage id={decodeURIComponent(route.slice(12))} />
  else if (route === '/library') page = <Library />
  else if (route.startsWith('/paper/')) page = <Library paperId={decodeURIComponent(route.slice(7))} />
  return (
    <>
      {page}
      <SyncBanner onSettings={route === '/settings'} />
      <Toaster />
    </>
  )
}
