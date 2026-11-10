import { TopNav } from '../../ui/TopNav'
import { LibraryList } from './LibraryList'
import { PaperPage } from './PaperPage'

/**
 * Wide screens: list on the left, the open paper on the right.
 * Narrow screens: one at a time (see .lib in CSS).
 */
export function Library({ paperId }: { paperId?: string }) {
  return (
    <div className="lib" data-open={paperId ? 'paper' : 'list'}>
      <TopNav current="library" />
      <div className="lib-body">
        <aside className="lib-side">
          <LibraryList activeId={paperId} />
        </aside>
        <main className="lib-main">
          {paperId ? <PaperPage key={paperId} id={paperId} /> : <p className="empty lib-hint">选一篇论文打开。</p>}
        </main>
      </div>
    </div>
  )
}
