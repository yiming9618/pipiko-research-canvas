import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { fieldOfPaper } from '../../domain/migrate'
import type { Paper } from '../../domain/types'
import { db } from '../../store/db'
import { createField, setPaperField } from '../../store/fieldActions'

const NEW = '__new'

/** The paper's field (领域): pick one, 未分类, or make a new one on the spot. */
export function FieldPicker({ paper }: { paper: Paper }) {
  const fields = useLiveQuery(() => db.fields.filter((f) => !f.deleted).toArray())
  const [making, setMaking] = useState(false)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const current = fieldOfPaper(paper, fields ?? [])?.id ?? ''

  const make = async (e: FormEvent) => {
    e.preventDefault()
    const out = await createField(name)
    if (out === 'empty') return
    if (out === 'taken') {
      setNote('已经有同名的领域了，直接在上面选它')
      return
    }
    await setPaperField(paper, out.id)
    setMaking(false)
    setName('')
    setNote('')
  }

  return (
    <div className="field-picker">
      <label>
        <span>领域</span>
        <select
          value={making ? NEW : current}
          onChange={(e) => {
            if (e.target.value === NEW) setMaking(true)
            else {
              setMaking(false)
              void setPaperField(paper, e.target.value)
            }
          }}
        >
          <option value="">未分类</option>
          {[...(fields ?? [])]
            .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          <option value={NEW}>＋ 新建领域…</option>
        </select>
      </label>
      {making && (
        <form className="new-named" onSubmit={(e) => void make(e)}>
          <label>
            <span className="sr-only">新领域的名字</span>
            <input value={name} autoFocus maxLength={40} placeholder="新领域的名字" onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            建好
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setMaking(false)}>
            取消
          </button>
        </form>
      )}
      {note && (
        <p className="status-line is-error" role="status">
          {note}
        </p>
      )}
    </div>
  )
}
