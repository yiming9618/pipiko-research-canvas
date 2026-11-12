import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type DragEvent, type FormEvent } from 'react'
import { boardHref, boardsInPile, lastUsed, looseBoards, sortBoards, type BoardSort } from '../../domain/boards'
import { KIND_COLOR } from '../../domain/colors'
import { shortDate } from '../../domain/importer'
import { homeBoardId } from '../../domain/migrate'
import type { Board, Card, Pile } from '../../domain/types'
import { createBoard, createPile, deletePile, moveBoardToPile, renamePile } from '../../store/boardStore'
import { db } from '../../store/db'
import { IconBack, IconPlus } from '../../ui/icons'
import { toast } from '../../ui/toast'
import { TopNav } from '../../ui/TopNav'
import { AddToDiscussion } from '../discussions/AddToDiscussion'

const BOARD_DRAG = 'application/x-notebook-board'
const TINTS = ['pink', 'yellow', 'blue', 'green', 'purple', 'orange', 'teal']

function remember(): BoardSort {
  try {
    return localStorage.getItem('boards.sort') === 'created' ? 'created' : 'used'
  } catch {
    return 'used'
  }
}

function useBoardData() {
  const boards = useLiveQuery(() => db.boards.toArray())
  const use = useLiveQuery(() => db.boardUse.toArray())
  const piles = useLiveQuery(() => db.piles.filter((p) => !p.deleted).sortBy('created_at'))
  const cards = useLiveQuery(() => db.cards.filter((c) => !c.deleted).toArray())
  return { boards, use, piles, cards, ready: !!boards && !!use && !!piles && !!cards }
}

function NewNamed({ label, placeholder, onCreate }: { label: string; placeholder: string; onCreate: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await onCreate(name)
    setName('')
    setOpen(false)
  }
  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <IconPlus />
        {label}
      </button>
    )
  }
  return (
    <form className="new-named" onSubmit={(e) => void submit(e)}>
      <label>
        <span className="sr-only">{placeholder}</span>
        <input value={name} autoFocus maxLength={40} placeholder={placeholder} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
        建好
      </button>
      <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
        取消
      </button>
    </form>
  )
}

function BoardTile({ board, cards, usedAt, piles, inPile }: { board: Board; cards: Card[]; usedAt: string; piles: Pile[]; inPile: boolean }) {
  const mine = cards.filter((c) => homeBoardId(c) === board.id)
  const move = async (value: string) => {
    if (!value) return
    if (value === '__out') {
      await moveBoardToPile(board, undefined)
      toast(`「${board.name}」已移出堆`)
      return
    }
    const pile = value === '__new' ? await createPile('新的堆') : piles.find((p) => p.id === value)
    if (!pile) return
    await moveBoardToPile(board, pile.id)
    toast(`「${board.name}」已放进堆「${pile.name}」`)
  }
  return (
    <li className="board-tile">
      <a
        className="board-tile-main"
        href={boardHref(board.id)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(BOARD_DRAG, board.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
      >
        <span className="board-tile-name">{board.name}</span>
        <span className="thumb" role="img" aria-label={`${mine.length} 张卡片`}>
          {mine.slice(0, 9).map((c) => (
            <span key={c.id} data-color={KIND_COLOR[c.kind]} />
          ))}
        </span>
        <span className="board-tile-meta">
          {mine.length > 0 ? `${mine.length} 张卡片 · ` : '空白 · '}
          建于 {shortDate(board.created_at.slice(0, 10))}
          {usedAt.slice(0, 10) !== board.created_at.slice(0, 10) && ` · 用过 ${shortDate(new Date(usedAt).toLocaleDateString('sv-SE'))}`}
        </span>
      </a>
      <label className="board-tile-move">
        <span className="sr-only">把「{board.name}」放进堆</span>
        <select value="" onChange={(e) => void move(e.target.value)}>
          <option value="">{inPile ? '移到…' : '放进堆…'}</option>
          {inPile && <option value="__out">移出这个堆</option>}
          {piles
            .filter((p) => p.id !== board.pile_id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          <option value="__new">＋ 新建一个堆</option>
        </select>
      </label>
    </li>
  )
}

function SortSwitch({ sort, onChange }: { sort: BoardSort; onChange: (s: BoardSort) => void }) {
  const pick = (s: BoardSort) => {
    onChange(s)
    try {
      localStorage.setItem('boards.sort', s)
    } catch {
      // remembering the order is a convenience only
    }
  }
  return (
    <div className="seg seg-small" role="group" aria-label="排序">
      <button type="button" className="btn" aria-pressed={sort === 'used'} onClick={() => pick('used')}>
        最近使用
      </button>
      <button type="button" className="btn" aria-pressed={sort === 'created'} onClick={() => pick('created')}>
        创建日期
      </button>
    </div>
  )
}

/** All boards: the ones outside any pile, and the piles (folders) themselves. */
export function BoardsPage() {
  const { boards, use, piles, cards, ready } = useBoardData()
  const [sort, setSort] = useState<BoardSort>(remember)
  const [over, setOver] = useState<string | null>(null)

  const outside = ready ? sortBoards(looseBoards(boards!, piles!), use!, sort) : []

  const onDrop = async (e: DragEvent, pile: Pile) => {
    e.preventDefault()
    setOver(null)
    const board = boards?.find((b) => b.id === e.dataTransfer.getData(BOARD_DRAG) && !b.deleted)
    if (!board) return
    await moveBoardToPile(board, pile.id)
    toast(`「${board.name}」已放进堆「${pile.name}」`)
  }

  return (
    <main className="page page-wide">
      <TopNav current="board" />
      <header className="page-head boards-head">
        <h1>画板</h1>
        <SortSwitch sort={sort} onChange={setSort} />
      </header>

      <div className="row-actions">
        <NewNamed
          label="新建画板"
          placeholder="画板的名字，例如：霉菌研究"
          onCreate={async (name) => {
            const board = await createBoard(name)
            window.location.hash = boardHref(board.id)
          }}
        />
        <NewNamed label="新建堆" placeholder="堆的名字" onCreate={async (name) => void (await createPile(name))} />
      </div>

      {ready && piles!.length > 0 && (
        <section aria-labelledby="piles-title" className="boards-section">
          <h2 id="piles-title">堆</h2>
          <div className="shelf-row">
            {piles!.map((pile, i) => (
              <a
                key={pile.id}
                className={`pile-tile${over === pile.id ? ' is-over' : ''}`}
                href={`#/pile/${pile.id}`}
                data-color={TINTS[i % TINTS.length]}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(BOARD_DRAG)) return
                  e.preventDefault()
                  setOver(pile.id)
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => void onDrop(e, pile)}
              >
                <span className="pile-back" aria-hidden="true" />
                <span className="pile-front">
                  <span className="pile-name">{pile.name}</span>
                  <span className="pile-count">{boardsInPile(pile.id, boards!).length} 块画板</span>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section aria-label="不在堆里的画板" className="boards-section">
        {ready && piles!.length > 0 && <h2>画板</h2>}
        {ready && outside.length === 0 && (
          <p className="empty">
            {boards!.some((b) => !b.deleted) ? '所有画板都在堆里。' : '还没有画板。点“新建画板”起个名字，或者在主页导入一份研究记录。'}
          </p>
        )}
        <ul className="board-grid">
          {outside.map((b) => (
            <BoardTile key={b.id} board={b} cards={cards!} usedAt={lastUsed(b, use!)} piles={piles!} inPile={false} />
          ))}
        </ul>
      </section>
    </main>
  )
}

/** One pile: a folder of boards. */
export function PilePage({ id }: { id: string }) {
  const { boards, use, piles, cards, ready } = useBoardData()
  const [sort, setSort] = useState<BoardSort>(remember)
  const [name, setName] = useState<string | null>(null)
  const pile = piles?.find((p) => p.id === id)

  if (ready && !pile) {
    return (
      <main className="page page-wide">
        <TopNav current="board" />
        <a className="crumb-link back-link" href="#/boards">
          <IconBack />
          画板
        </a>
        <p className="empty">找不到这个堆，可能已经删掉了。</p>
      </main>
    )
  }
  if (!ready || !pile) return <main className="page page-wide"><TopNav current="board" /></main>

  const inside = sortBoards(boardsInPile(pile.id, boards!), use!, sort)
  const save = () => {
    if (name !== null) void renamePile(pile, name)
    setName(null)
  }

  return (
    <main className="page page-wide">
      <TopNav current="board" />
      <header className="page-head boards-head">
        <a className="crumb-link" href="#/boards" aria-label="回到画板列表">
          <IconBack />
        </a>
        {name === null ? (
          <h1 className="pile-title">
            <button type="button" onClick={() => setName(pile.name)} aria-label={`改名：${pile.name}`}>
              {pile.name}
            </button>
          </h1>
        ) : (
          <label className="pile-title-edit">
            <span className="sr-only">堆的名字</span>
            <input
              value={name}
              autoFocus
              maxLength={30}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={save}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
                if (e.key === 'Escape') setName(null)
              }}
            />
          </label>
        )}
        <SortSwitch sort={sort} onChange={setSort} />
      </header>

      <div className="row-actions">
        <NewNamed
          label="在这个堆里新建画板"
          placeholder="画板的名字"
          onCreate={async (n) => {
            const board = await createBoard(n, pile.id)
            window.location.hash = boardHref(board.id)
          }}
        />
        <AddToDiscussion refs={[{ type: 'pile', id: pile.id }]} label="整个堆放进讨论框" />
      </div>

      {inside.length === 0 && <p className="empty">这个堆还是空的。在画板列表里，用每块画板下面的“放进堆…”把画板放进来，或者把画板拖到堆上。</p>}
      <ul className="board-grid">
        {inside.map((b) => (
          <BoardTile key={b.id} board={b} cards={cards!} usedAt={lastUsed(b, use!)} piles={piles!} inPile />
        ))}
      </ul>

      <div className="row-actions pile-foot">
        <button
          type="button"
          className="btn btn-quiet form-remove"
          onClick={() => {
            const n = inside.length
            if (window.confirm(`删除堆「${pile.name}」？${n > 0 ? `里面的 ${n} 块画板不会被删除，会回到外面的画板列表。` : '它是空的。'}`)) {
              void deletePile(pile).then(() => {
                window.location.hash = '#/boards'
              })
            }
          }}
        >
          删除这个堆
        </button>
      </div>
    </main>
  )
}
