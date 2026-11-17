import { useEffect, useRef, useState } from 'react'
import type { ReadingPart } from '../../domain/exportPaper'
import type { HighlightType } from '../../domain/types'
import { IconClose } from '../../ui/icons'

/**
 * "定位": jump to a highlight card of this paper. Read straight from the cards themselves, in
 * every reading. A type goes to its first card; when it has several, each can be picked.
 * The jump is the same as selecting the card: its reading opens, it scrolls into view.
 */
export function LocateMenu({ parts, cardName, onGo }: { parts: ReadingPart[]; cardName: Map<string, string>; onGo: (blockId: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (open && el && !el.open) el.showModal()
  }, [open])

  // every card, with the reading it is in; grouped by type in the types' order
  const groups = new Map<string, { type: HighlightType; cards: { id: string; where: string; name: string; text: string }[] }>()
  for (const part of parts) {
    for (const h of part.highlights) {
      if (!h.type) continue
      const g = groups.get(h.type.id) ?? { type: h.type, cards: [] }
      g.cards.push({ id: h.block.id, where: `第 ${part.reading.number} 次阅读`, name: cardName.get(h.block.id) ?? h.type.name, text: h.text.replace(/[#*>`_\-[\]]/g, '').trim().slice(0, 28) })
      groups.set(h.type.id, g)
    }
  }
  const list = [...groups.values()].sort((a, b) => a.type.order - b.type.order)
  if (list.length === 0) return null

  const go = (id: string) => {
    ref.current?.close()
    setOpen(false)
    onGo(id)
  }

  return (
    <>
      <div className="locate-row">
        <button type="button" className="btn btn-quiet locate-open" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          定位重点
          <span className="locate-dots" aria-hidden="true">
            {list.map((g) => (
              <span key={g.type.id} className="dot" data-color={g.type.color} />
            ))}
          </span>
        </button>
      </div>
      {open && (
        <dialog ref={ref} className="dialog locate" aria-labelledby="locate-title" onClose={() => setOpen(false)}>
          <div className="locate-head">
            <h2 id="locate-title">定位到哪个重点</h2>
            <button type="button" className="icon-btn" aria-label="关闭" onClick={() => ref.current?.close()}>
              <IconClose />
            </button>
          </div>
          <ul className="locate-list">
            {list.map((g) => (
              <li key={g.type.id} data-color={g.type.color}>
                <button type="button" className="locate-type" onClick={() => go(g.cards[0].id)}>
                  <span className="dot" aria-hidden="true" />
                  <span className="locate-type-name">{g.type.name}</span>
                  <span className="group-count">{g.cards.length} 张</span>
                </button>
                {g.cards.length > 1 && (
                  <ul className="locate-cards">
                    {g.cards.map((c) => (
                      <li key={c.id}>
                        <button type="button" className="locate-card" onClick={() => go(c.id)}>
                          <span className="locate-where">
                            {c.where} · {c.name}
                          </span>
                          <span className="locate-text">{c.text}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </dialog>
      )}
    </>
  )
}
