import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import type { BoardRefType } from '../../domain/types'
import { db } from '../../store/db'
import { ADD_MESSAGE, addToPile, createPile } from '../../store/pileActions'

const NEW = '__new__'

/**
 * One native picker: "放进堆…". The way to put something in a pile without
 * dragging (and the only way on a phone).
 */
export function AddToPile({ target, label = '放进堆…' }: { target: { type: BoardRefType; id: string }; label?: string }) {
  const piles = useLiveQuery(() => db.piles.filter((p) => !p.deleted).toArray())
  const [status, setStatus] = useState('')

  const choose = async (value: string) => {
    if (!value) return
    const pile = value === NEW ? await createPile('新的堆') : piles?.find((p) => p.id === value)
    if (!pile) return
    const result = await addToPile(pile.id, target)
    setStatus(ADD_MESSAGE[result](pile.name))
    setTimeout(() => setStatus(''), 3200)
  }

  const options = (piles ?? [])
    .filter((p) => !(target.type === 'pile' && p.id === target.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))

  return (
    <span className="add-to-pile">
      <label>
        <span className="sr-only">{label}</span>
        <select value="" onChange={(e) => void choose(e.target.value)}>
          <option value="">{label}</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value={NEW}>＋ 新建一个堆</option>
        </select>
      </label>
      <span className="add-to-pile-status" role="status" aria-live="polite">
        {status}
      </span>
    </span>
  )
}
