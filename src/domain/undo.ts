// Works out what undoing an import removes, and what the user would lose
// beyond the import itself (edits, pile placements, connectors). Pure.

import type {
  BoardItem,
  Field,
  Card,
  Changes,
  Comment,
  Connector,
  HighlightType,
  ImportEntry,
  ISODateTime,
  Paper,
  PaperBlock,
  Pile,
  ResearchRecord,
  Synced,
} from './types'

export interface UndoSnapshot {
  imports: ImportEntry[]
  papers: Paper[]
  blocks: PaperBlock[]
  comments: Comment[]
  types: HighlightType[]
  records: ResearchRecord[]
  cards: Card[]
  boardItems: BoardItem[]
  connectors: Connector[]
  piles: Pile[]
  fields?: Field[]
  /** Papers the person has put somewhere on purpose (a discussion box); never removed silently. */
  keptPaperIds?: Set<string>
}

export interface UndoPlan {
  /** Things the user did after importing that will be lost. Empty = safe to undo silently. */
  impacts: string[]
  changes: Changes
}

export function planUndo(entry: ImportEntry, snap: UndoSnapshot, now: ISODateTime): UndoPlan {
  const tomb = <T extends Synced>(e: T): T => ({ ...e, deleted: true, updated_at: now })
  const live = <T extends Synced>(rows: T[]) => rows.filter((r) => !r.deleted)
  const impacts: string[] = []
  const changes: Changes = { imports: [{ ...entry, undone: true, updated_at: now }] }

  /** Removes board items pointing at the given things, plus connectors touching them. */
  const removeFromBoards = (refs: { type: BoardItem['ref_type']; id: string }[], noun: string) => {
    const keys = new Set(refs.map((r) => `${r.type}:${r.id}`))
    const items = live(snap.boardItems).filter((i) => keys.has(`${i.ref_type}:${i.ref_id}`))
    const itemIds = new Set(items.map((i) => i.id))
    const connectors = live(snap.connectors).filter(
      (c) => itemIds.has(c.from) || itemIds.has(c.to) || keys.has(c.from) || keys.has(c.to),
    )

    const onDay = items.filter((i) => !i.board_id.startsWith('pile:'))
    const edited = onDay.filter((i) => i.text_override !== undefined).length
    const moved = onDay.length - edited
    if (edited > 0) impacts.push(`${edited} ${noun}改过文字`)
    if (moved > 0) impacts.push(`${moved} ${noun}在画板上移动或调整过`)

    const perPile = new Map<string, number>()
    for (const i of items) {
      if (i.board_id.startsWith('pile:')) {
        const id = i.board_id.slice(5)
        perPile.set(id, (perPile.get(id) ?? 0) + 1)
      }
    }
    for (const [pileId, count] of perPile) {
      const name = snap.piles.find((p) => p.id === pileId)?.name ?? '未命名'
      impacts.push(`${count} ${noun}在堆「${name}」里`)
    }
    if (connectors.length > 0) impacts.push(`${connectors.length} 条连线会消失`)

    changes.boardItems = [...(changes.boardItems ?? []), ...items.map(tomb)]
    changes.connectors = [...(changes.connectors ?? []), ...connectors.map(tomb)]
  }

  if (entry.kind === 'research') {
    const records = live(snap.records).filter((r) => r.import_id === entry.id)
    const cards = live(snap.cards).filter((c) => c.import_id === entry.id)
    changes.records = records.map(tomb)
    changes.cards = cards.map(tomb)
    removeFromBoards(
      [
        ...cards.map((c) => ({ type: 'card' as const, id: c.id })),
        ...records.map((r) => ({ type: 'cover' as const, id: r.id })),
      ],
      '张卡片',
    )

    // "想看" entries that exist only because this record named them.
    const recordIds = new Set(records.map((r) => r.id))
    const created = new Set(entry.wants_created ?? [])
    const papers: Paper[] = []
    for (const id of new Set([...created, ...(entry.mentions_added ?? [])])) {
      const paper = snap.papers.find((p) => p.id === id && !p.deleted)
      if (!paper) continue
      const rest = (paper.mentioned_in ?? []).filter((m) => !recordIds.has(m.record_id))
      const onlyFromHere = created.has(id) && rest.length === 0 && paper.status === 'want' && paper.added_by === 'ai'
      if (onlyFromHere && !paper.touched && !paper.why && !(snap.keptPaperIds?.has(id) ?? false)) {
        papers.push(tomb(paper))
      } else {
        if (onlyFromHere) impacts.push(`想看里的「${paper.title || paper.doi}」你动过，会保留在想看里`)
        papers.push({ ...paper, mentioned_in: rest, updated_at: now })
      }
    }
    if (papers.length > 0) changes.papers = papers
    return { impacts, changes }
  }

  const paper = snap.papers.find((p) => p.id === entry.paper_id && !p.deleted)
  const ownBlocks = live(snap.blocks).filter((b) => b.import_id === entry.id)
  const ownComments = live(snap.comments).filter((c) => c.import_id === entry.id)
  const editedBlocks = ownBlocks.filter((b) => b.edited_md !== undefined).length
  if (editedBlocks > 0) impacts.push(`${editedBlocks} 个重点区块改过文字`)
  changes.blocks = ownBlocks.map(tomb)
  changes.comments = ownComments.map(tomb)

  const effects = entry.effects
  if (paper && effects) {
    const otherImports = live(snap.imports).some(
      (e) => e.id !== entry.id && e.paper_id === paper.id && !e.undone,
    )
    if (effects.paper_created && !otherImports) {
      // This import is the only reason the paper exists: the whole paper goes.
      const manualBlocks = live(snap.blocks).filter((b) => b.paper_id === paper.id && !b.import_id)
      const manualComments = live(snap.comments).filter((c) => c.paper_id === paper.id && !c.import_id)
      if (manualBlocks.length > 0) impacts.push(`你手动加的 ${manualBlocks.length} 个区块会一起删除`)
      if (manualComments.length > 0) impacts.push(`你写的 ${manualComments.length} 条评论会一起删除`)
      changes.blocks.push(...manualBlocks.map(tomb))
      changes.comments.push(...manualComments.map(tomb))
      changes.papers = [tomb(paper)]
      removeFromBoards([{ type: 'paper', id: paper.id }], '张论文卡片')
    } else if (!effects.paper_created) {
      const restored: Paper = { ...paper, updated_at: now }
      for (const key of effects.filled) {
        if (key === 'authors') restored.authors = []
        else if (key === 'year') restored.year = null
        else restored[key] = ''
      }
      restored.keywords = paper.keywords.filter((k) => !effects.keywords_added.includes(k))
      if (effects.field_set) delete restored.field_id
      if (effects.want_before && !otherImports) {
        restored.status = 'want'
        restored.title = effects.want_before.title
        restored.url = effects.want_before.url
      }
      changes.papers = [restored]
    }
  }

  // The "想看" entry that was merged into this paper comes back as it was.
  if (effects?.merged_want) {
    changes.papers = [...(changes.papers ?? []), { ...effects.merged_want, updated_at: now }]
  }

  if (effects && effects.types_created.length > 0) {
    const ownIds = new Set(ownBlocks.map((b) => b.id))
    const stillUsed = new Set(
      live(snap.blocks)
        .filter((b) => !ownIds.has(b.id) && b.type_id)
        .map((b) => b.type_id),
    )
    changes.types = live(snap.types)
      .filter((t) => effects.types_created.includes(t.id) && !stillUsed.has(t.id))
      .map(tomb)
  }

  // a field made by this import goes too, unless another paper has been put in it since
  if (effects?.fields_created && effects.fields_created.length > 0) {
    const used = new Set(live(snap.papers).filter((p) => p.id !== entry.paper_id).map((p) => p.field_id))
    changes.fields = live(snap.fields ?? [])
      .filter((f) => effects.fields_created!.includes(f.id) && !used.has(f.id))
      .map(tomb)
  }

  return { impacts, changes }
}
