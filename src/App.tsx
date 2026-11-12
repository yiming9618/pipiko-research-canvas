import { useEffect, useState } from 'react'
import { BoardPage } from './views/board/BoardPage'
import { BoardsPage, PilePage } from './views/boards/BoardsPage'
import { TimePage } from './views/time/TimePage'
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

  // "#/board/<id>?card=<id>": the part after "?" names a card to bring into view
  const [path, query = ''] = route.split('?')
  const rest = (prefix: string) => decodeURIComponent(path.slice(prefix.length))
  const focus = new URLSearchParams(query).get('card') ?? undefined

  // Addresses from the time of daily boards still work: a date opens the board that day became,
  // a year or a month opens the time view.
  const old = path.startsWith('/board/') ? rest('/board/') : ''
  useEffect(() => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(old)) window.location.replace(`#/board/${encodeURIComponent(`day:${old}`)}`)
    else if (/^\d{4}(-\d{2})?$/.test(old)) window.location.replace(`#/time/${old}`)
    else if (path === '/board') window.location.replace('#/boards')
  }, [old, path])

  let page = <Home />
  if (path === '/settings') page = <Settings />
  else if (path === '/boards' || path === '/board') page = <BoardsPage />
  else if (path.startsWith('/board/')) page = /^\d{4}(-\d{2}){0,2}$/.test(old) ? <BoardsPage /> : <BoardPage boardId={old} focus={focus} />
  else if (path.startsWith('/pile/')) page = <PilePage id={rest('/pile/')} />
  else if (path === '/time') page = <TimePage />
  else if (path.startsWith('/time/')) page = <TimePage param={rest('/time/')} />
  else if (path === '/discussions') page = <DiscussionsPage />
  else if (path.startsWith('/discussion/')) page = <DiscussionPage id={rest('/discussion/')} />
  else if (path === '/library') page = <Library />
  else if (path.startsWith('/paper/')) page = <Library paperId={rest('/paper/')} />
  return (
    <>
      {page}
      <SyncBanner onSettings={path === '/settings'} />
      <Toaster />
    </>
  )
}
