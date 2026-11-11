import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { activeBoxes, type BoxRef } from '../../domain/discussions'
import type { Discussion } from '../../domain/types'
import { db } from '../../store/db'
import { addToDiscussion, createDiscussion } from '../../store/discussionActions'
import { IconChat } from '../../ui/icons'
import { toast } from '../../ui/toast'

/** The chooser: pick a discussion box, or make one on the spot. */
export function DiscussionPicker({ refs, onClose }: { refs: BoxRef[]; onClose: (done: boolean) => void }) {
  const boxes = useLiveQuery(() => db.discussions.toArray())
  const items = useLiveQuery(() => db.discussionItems.filter((i) => !i.deleted).toArray())
  const [name, setName] = useState('')
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
  }, [])

  const put = async (box: Discussion) => {
    const { added, already } = await addToDiscussion(box.id, refs)
    toast(
      added === 0
        ? `已经在「${box.name}」里了`
        : `已放进「${box.name}」${refs.length > 1 ? `：${added} 项` : ''}${already > 0 ? `（${already} 项之前就在）` : ''}`,
    )
    onClose(true)
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await put(await createDiscussion(name))
  }

  const list = activeBoxes(boxes ?? [])
  return (
    <dialog ref={ref} className="dialog picker" onClose={() => onClose(false)} aria-labelledby="picker-title">
      <h2 id="picker-title">放进哪个讨论框</h2>
      {list.length > 0 && (
        <ul className="picker-list">
          {list.map((b) => (
            <li key={b.id}>
              <button type="button" className="picker-row" onClick={() => void put(b)}>
                <span>{b.name}</span>
                <span className="group-count">{(items ?? []).filter((i) => i.discussion_id === b.id).length} 项</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="picker-new" onSubmit={(e) => void create(e)}>
        <label className="field">
          <span>{list.length > 0 ? '或者新建一个' : '新建一个讨论框'}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：霉菌实验卡住了" maxLength={40} />
        </label>
        <button type="submit" className="btn" disabled={!name.trim()}>
          新建并放入
        </button>
      </form>
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={() => ref.current?.close()}>
          取消
        </button>
      </div>
    </dialog>
  )
}

interface Props {
  /** What goes in. A function is read at the moment the button is pressed. */
  refs: BoxRef[] | (() => BoxRef[])
  label?: string
  /** Icon-only button; `label` is then its accessible name. */
  iconOnly?: boolean
  className?: string
  onDone?: () => void
  children?: ReactNode
}

export function AddToDiscussion({ refs, label = '放进讨论框', iconOnly, className, onDone }: Props) {
  const [open, setOpen] = useState<BoxRef[] | null>(null)
  return (
    <>
      <button
        type="button"
        className={className ?? (iconOnly ? 'icon-btn' : 'btn btn-quiet')}
        aria-label={iconOnly ? label : undefined}
        onClick={() => {
          const list = typeof refs === 'function' ? refs() : refs
          if (list.length > 0) setOpen(list)
        }}
      >
        <IconChat />
        {!iconOnly && label}
      </button>
      {open && (
        <DiscussionPicker
          refs={open}
          onClose={(done) => {
            setOpen(null)
            if (done) onDone?.()
          }}
        />
      )}
    </>
  )
}
