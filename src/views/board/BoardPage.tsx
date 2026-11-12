import { TopNav } from '../../ui/TopNav'
import { LibraryList } from '../library/LibraryList'
import { BoardView } from './BoardView'

/** One board, with the library list beside it on wide screens (papers can be dragged onto the board). */
export function BoardPage({ boardId, focus }: { boardId: string; focus?: string }) {
  return (
    <div className="boardpage">
      <TopNav current="board" />
      <div className="board-body">
        <aside className="board-side">
          <LibraryList />
        </aside>
        <main className="board-main">
          <BoardView key={boardId} boardId={boardId} focus={focus} />
        </main>
      </div>
    </div>
  )
}
