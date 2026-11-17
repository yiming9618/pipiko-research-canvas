// Small marks shown next to things: in a discussion box (a speech bubble outline, a shape and not a
// colour, so it cannot be mistaken for a 参考价值 dot), 在读, and 参考价值.

import { useLiveQuery } from 'dexie-react-hooks'
import { boxesByRef } from '../domain/discussions'
import type { HighlightType, Paper } from '../domain/types'
import { db } from '../store/db'
import { IconChat } from './icons'

/** `paper:<id>`, `card:<id>`, `board:<id>`, `pile:<id>` → names of the discussion boxes it is in. */
export function useBoxMarks(): Map<string, string[]> {
  return (
    useLiveQuery(async () => boxesByRef(await db.discussionItems.toArray(), await db.discussions.toArray())) ?? new Map<string, string[]>()
  )
}

/** Tiny: hover (Mac) shows the box names; screen readers read them. */
export function BoxMark({ names }: { names?: string[] }) {
  if (!names || names.length === 0) return null
  const text = `在讨论框：${names.join('、')}`
  return (
    <span className="box-mark" title={text} role="img" aria-label={text}>
      <IconChat />
    </span>
  )
}

/** The paper's 参考价值: a dot per type, "Full" as its own small tag. */
export function ValueMarks({ paper, types }: { paper: Paper; types: HighlightType[] }) {
  const chosen = new Set(paper.value_types ?? [])
  const dots = types.filter((t) => !t.deleted && chosen.has(t.id)).sort((a, b) => a.order - b.order)
  if (dots.length === 0 && !paper.value_full) return null
  const label = `参考价值：${[...dots.map((t) => t.name), ...(paper.value_full ? ['Full'] : [])].join('、')}`
  return (
    <span className="dots" role="img" aria-label={label}>
      {dots.map((t) => (
        <span key={t.id} className="dot" data-color={t.color} title={t.name} />
      ))}
      {paper.value_full && (
        <span className="full-tag" title="整篇都值得参考">
          Full
        </span>
      )}
    </span>
  )
}
