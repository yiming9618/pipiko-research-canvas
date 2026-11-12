// Gathers everything searchable into one flat list. Built when the search
// panel opens; the notebook is small enough that this takes a few milliseconds.

import { KIND_COLOR } from '../domain/colors'
import type { Doc, TypeNames } from '../domain/search'
import { boardHref } from '../domain/boards'
import { homeBoardId, recordBoardId } from '../domain/migrate'
import { db } from './db'

export interface SearchData {
  docs: Doc[]
  types: TypeNames[]
}

const day = (iso: string) => iso.slice(0, 10)

export async function loadSearchData(): Promise<SearchData> {
  const [papers, blocks, types, comments, records, cards, piles, imports, boardItems, boards] = await Promise.all([
    db.papers.filter((p) => !p.deleted).toArray(),
    db.blocks.filter((b) => !b.deleted).toArray(),
    db.types.filter((t) => !t.deleted).toArray(),
    db.comments.filter((c) => !c.deleted).toArray(),
    db.records.filter((r) => !r.deleted).toArray(),
    db.cards.filter((c) => !c.deleted).toArray(),
    db.piles.filter((p) => !p.deleted).toArray(),
    db.imports.filter((e) => !e.deleted && !e.undone).toArray(),
    db.boardItems.filter((i) => !i.deleted && i.ref_type === 'card' && i.text_override !== undefined).toArray(),
    db.boards.filter((b) => !b.deleted).toArray(),
  ])

  const importDate = new Map(imports.map((e) => [e.id, e.date]))
  const typeById = new Map(types.map((t) => [t.id, t]))
  const paperById = new Map(papers.map((p) => [p.id, p]))
  const recordById = new Map(records.map((r) => [r.id, r]))
  const docs: Doc[] = []

  for (const p of papers) {
    const read = imports.filter((e) => e.paper_id === p.id).map((e) => e.date)
    const ownBlocks = blocks.filter((b) => b.paper_id === p.id)
    const ownComments = comments.filter((c) => c.paper_id === p.id)
    docs.push({
      key: `paper:${p.id}`,
      kind: 'paper',
      dates: read.length > 0 ? [...new Set(read)] : [day(p.created_at)],
      title: p.title,
      keywords: [...p.keywords, p.category, p.authors.join(' '), p.venue, p.doi, p.year ?? ''].join(' '),
      body: [p.one_liner, p.basics_md].filter(Boolean).join('\n'),
      deep: [...ownBlocks.map((b) => b.edited_md ?? b.body_md), ...ownComments.map((c) => c.text)].join('\n'),
      label: p.status === 'want' ? '想看' : '论文',
      color: 'red',
      href: p.status === 'want' ? '#/library' : `#/paper/${p.id}`,
      ref: p.status === 'want' ? null : { type: 'paper', id: p.id },
    })
  }

  for (const b of blocks) {
    const paper = paperById.get(b.paper_id)
    if (!paper) continue
    const type = b.type_id ? typeById.get(b.type_id) : undefined
    docs.push({
      key: `block:${b.id}`,
      kind: 'block',
      typeId: b.type_id ?? undefined,
      dates: [(b.import_id && importDate.get(b.import_id)) || day(b.updated_at)],
      title: paper.title,
      keywords: type?.name ?? b.heading,
      body: b.edited_md ?? b.body_md,
      label: type?.name ?? (b.heading || '其他内容'),
      color: type?.color ?? 'plain',
      href: `#/paper/${paper.id}`,
      ref: { type: 'paper', id: paper.id },
    })
  }

  for (const c of comments) {
    const paper = paperById.get(c.paper_id)
    if (!paper || !c.text) continue
    docs.push({
      key: `comment:${c.id}`,
      kind: 'comment',
      dates: [c.date],
      title: paper.title,
      keywords: '',
      body: c.text,
      label: c.source === 'ai' ? '理解 · AI 整理' : '理解 · 我写的',
      color: 'plain',
      href: `#/paper/${paper.id}`,
      ref: { type: 'paper', id: paper.id },
    })
  }

  for (const r of records) {
    docs.push({
      key: `record:${r.id}`,
      kind: 'record',
      dates: [r.date],
      title: r.title,
      keywords: [...r.keywords, ...r.activities].join(' '),
      body: [r.summary, r.preamble_md].filter(Boolean).join('\n'),
      label: '记录',
      color: 'plain',
      href: boardHref(recordBoardId(r)),
      ref: { type: 'cover', id: r.id },
    })
  }

  // the changed wording lives on the card's own board
  const homeOf = new Map(cards.map((c) => [c.id, homeBoardId(c)]))
  const edited = new Map(boardItems.filter((i) => homeOf.get(i.ref_id) === i.board_id).map((i) => [i.ref_id, i.text_override!]))
  for (const c of cards) {
    const record = recordById.get(c.record_id)
    docs.push({
      key: `card:${c.id}`,
      kind: 'card',
      cardKind: c.kind,
      dates: [c.date],
      title: record?.title ?? '',
      keywords: [...(record?.keywords ?? []), c.kind === '其他' ? c.heading : ''].join(' '),
      // the wording as it reads on the board now, plus the original if it was changed
      body: edited.has(c.id) ? `${edited.get(c.id)}\n${c.body_md}` : c.body_md,
      label: c.kind === '其他' ? c.heading : c.kind,
      color: KIND_COLOR[c.kind],
      href: boardHref(homeBoardId(c), c.id),
      ref: { type: 'card', id: c.id },
    })
  }

  for (const p of piles) {
    docs.push({
      key: `pile:${p.id}`,
      kind: 'pile',
      dates: [day(p.created_at)],
      title: p.name,
      keywords: '',
      body: '',
      label: '堆',
      color: 'pink',
      href: `#/pile/${p.id}`,
      ref: null,
    })
  }

  for (const b of boards) {
    docs.push({
      key: `board:${b.id}`,
      kind: 'board',
      dates: [day(b.created_at)],
      title: b.name,
      keywords: '',
      body: '',
      label: '画板',
      color: 'plain',
      href: boardHref(b.id),
      ref: null,
    })
  }

  return { docs, types: types.map((t) => ({ id: t.id, names: [t.name, ...t.aliases] })) }
}
