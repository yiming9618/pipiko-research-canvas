import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState, type DragEvent, type FormEvent } from 'react'
import { countContents } from '../../domain/piles'
import type { Pile } from '../../domain/types'
import { db } from '../../store/db'
import { ADD_MESSAGE, DRAG_TYPE, addToPile, createPile, readDrag } from '../../store/pileActions'
import { IconPlus } from '../../ui/icons'

const TINTS = ['pink', 'blue', 'yellow', 'green', 'orange', 'purple', 'teal']

export function countLabel(counts: { things: number; piles: number }): string {
  const parts = [`${counts.things} 张`]
  if (counts.piles > 0) parts.push(`${counts.piles} 个子堆`)
  return parts.join(' · ')
}

/** "我的堆": every pile as a small stack. Papers and piles can be dropped onto a stack. */
export function PileShelf() {
  const piles = useLiveQuery(() => db.piles.filter((p) => !p.deleted).sortBy('created_at'))
  const items = useLiveQuery(() => db.boardItems.filter((i) => !i.deleted && i.board_id.startsWith('pile:')).toArray())
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('新的堆')
  const [status, setStatus] = useState('')
  const [over, setOver] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const say = (text: string) => {
    setStatus(text)
    setTimeout(() => setStatus(''), 3200)
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    await createPile(name)
    setNaming(false)
    setName('新的堆')
  }

  const onDrop = async (e: DragEvent, pile: Pile) => {
    e.preventDefault()
    setOver(null)
    const ref = readDrag(e)
    if (!ref) return
    say(ADD_MESSAGE[await addToPile(pile.id, ref)](pile.name))
  }

  return (
    <section className="shelf" aria-labelledby="shelf-title">
      <h2 id="shelf-title">我的堆</h2>
      <div className="shelf-row">
        {piles?.map((pile, i) => (
          <a
            key={pile.id}
            className={`pile-tile${over === pile.id ? ' is-over' : ''}`}
            href={`#/pile/${pile.id}`}
            data-color={TINTS[i % TINTS.length]}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type: 'pile', id: pile.id }))
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
              e.preventDefault()
              setOver(pile.id)
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => void onDrop(e, pile)}
          >
            <span className="pile-back" aria-hidden="true" />
            <span className="pile-front">
              <span className="pile-name">{pile.name}</span>
              <span className="pile-count">{countLabel(countContents(pile.id, items ?? []))}</span>
            </span>
          </a>
        ))}

        {naming ? (
          <form className="pile-new-form" onSubmit={(e) => void create(e)}>
            <label>
              <span className="sr-only">堆的名字</span>
              <input
                ref={input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                autoFocus
                maxLength={30}
              />
            </label>
            <div className="edit-actions">
              <button type="submit" className="btn btn-small btn-dark">
                建好
              </button>
              <button type="button" className="btn btn-small" onClick={() => setNaming(false)}>
                取消
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="pile-new" onClick={() => setNaming(true)}>
            <IconPlus />
            新建堆
          </button>
        )}
      </div>
      <p className="status-line" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  )
}
