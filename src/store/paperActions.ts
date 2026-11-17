// Hand edits in the library. Imported originals are never touched: block edits
// go to `edited_md`, and the pasted Markdown stays in the import entry.

import { extractDoi, incomplete } from '../domain/crossref'
import { findPaper, hashText, normalizeTypeName } from '../domain/importer'
import { readingIdOfImport, type ReadingView } from '../domain/readings'
import type { Comment, HighlightType, ImportEntry, Paper, PaperBlock, Reading } from '../domain/types'
import { applyChanges, db, newId, nowIso, todayLocal } from './db'
import { runLookups } from './lookup'
import { workedRow } from './paperUse'

export async function saveBlockText(block: PaperBlock, text: string): Promise<void> {
  if (text.trim() === (block.edited_md ?? block.body_md).trim()) return
  const next: PaperBlock = { ...block, updated_at: nowIso() }
  if (text.trim() === block.body_md.trim()) delete next.edited_md
  else next.edited_md = text.trim()
  await applyChanges({ blocks: [next], paperUse: [await workedRow(block.paper_id)] })
}

export async function deleteBlock(block: PaperBlock): Promise<void> {
  await applyChanges({ blocks: [{ ...block, deleted: true, updated_at: nowIso() }] })
}

/** `readingId`: the reading it is added to. */
export async function addBlock(paperId: string, typeId: string, text: string, readingId?: string): Promise<void> {
  const siblings = await db.blocks.where('paper_id').equals(paperId).toArray()
  const order = siblings.reduce((max, b) => Math.max(max, b.order + 1), 0)
  const type = await db.types.get(typeId)
  await applyChanges({
    blocks: [
      {
        id: newId('block'),
        paper_id: paperId,
        type_id: typeId,
        heading: `重点：${type?.name ?? ''}`,
        body_md: text.trim(),
        order,
        ...(readingId ? { reading_id: readingId } : {}),
        updated_at: nowIso(),
      },
    ],
    paperUse: [await workedRow(paperId)],
  })
}

export async function savePaperField(
  paper: Paper,
  field: 'one_liner' | 'basics_md',
  value: string,
): Promise<void> {
  if (value.trim() === paper[field].trim()) return
  await applyChanges({ papers: [{ ...paper, [field]: value.trim(), updated_at: nowIso() }], paperUse: [await workedRow(paper.id)] })
}

/** `blockId`: the highlight card the note is about (none = the whole paper). */
export async function addComment(paperId: string, text: string, blockId?: string, readingId?: string): Promise<void> {
  const now = nowIso()
  await applyChanges({
    comments: [
      { id: newId('cmt'), paper_id: paperId, date: todayLocal(), source: 'me', text: text.trim(), created_at: now, ...(blockId ? { block_id: blockId } : {}), ...(readingId ? { reading_id: readingId } : {}), updated_at: now },
    ],
    paperUse: [await workedRow(paperId, now)],
  })
}

export async function addImageComment(
  paperId: string,
  image: { mime: string; w: number; h: number; data: string },
  blockId?: string,
  readingId?: string,
): Promise<void> {
  const now = nowIso()
  const assetId = `asset_${hashText(image.data)}`
  await applyChanges({
    assets: [{ id: assetId, ...image, updated_at: now }],
    comments: [
      { id: newId('cmt'), paper_id: paperId, date: todayLocal(), source: 'drawing', text: '', asset_id: assetId, created_at: now, ...(blockId ? { block_id: blockId } : {}), ...(readingId ? { reading_id: readingId } : {}), updated_at: now },
    ],
    paperUse: [await workedRow(paperId, now)],
  })
}

export async function saveComment(comment: Comment, text: string): Promise<void> {
  if (text.trim() === comment.text.trim()) return
  await applyChanges({ comments: [{ ...comment, text: text.trim(), updated_at: nowIso() }], paperUse: [await workedRow(comment.paper_id)] })
}

export async function deleteComment(comment: Comment): Promise<void> {
  await applyChanges({ comments: [{ ...comment, deleted: true, updated_at: nowIso() }] })
}

export interface PaperInput {
  doi: string
  url: string
  title: string
  why: string
  status: 'read' | 'want'
}

/** What was typed, tidied: a DOI is recognised wherever it was put; a link typed as the title becomes the link. */
export function tidyInput(input: PaperInput): PaperInput {
  let title = input.title.trim()
  let url = input.url.trim()
  const doi = extractDoi(input.doi) || extractDoi(url) || extractDoi(title)
  if (/^https?:\/\//i.test(title)) {
    if (!url) url = title
    title = ''
  } else if (doi && extractDoi(title) === doi && title.replace(/^doi\s*[:：]\s*/i, '').toLowerCase() === doi) {
    title = ''
  }
  return { doi, url, title, why: input.why.trim(), status: input.status }
}

export type AddPaperResult = { result: 'added' | 'empty' } | { result: 'exists'; paper: Paper }

/** Adds a paper by hand. One of DOI, link or title is enough. */
export async function addPaper(raw: PaperInput): Promise<AddPaperResult> {
  const input = tidyInput(raw)
  if (!input.doi && !input.url && !input.title) return { result: 'empty' }
  const existing = findPaper(await db.papers.toArray(), input.doi, input.title)
  if (existing) return { result: 'exists', paper: existing }
  const now = nowIso()
  await applyChanges({
    papers: [
      {
        id: newId('paper'),
        title: input.title,
        authors: [],
        year: null,
        venue: '',
        doi: input.doi,
        category: '',
        keywords: [],
        status: input.status,
        url: input.url,
        one_liner: '',
        basics_md: '',
        created_at: now,
        updated_at: now,
        why: input.why,
        added_by: 'me',
        ...(input.doi ? { lookup: 'pending' as const } : {}),
      },
    ],
  })
  if (input.doi) void runLookups()
  return { result: 'added' }
}

export interface PaperInfoPatch {
  title?: string
  url?: string
  doi?: string
  why?: string
  authors?: string[]
  year?: number | null
  venue?: string
  /** 参考价值 */
  value_types?: string[]
  value_full?: boolean
}

/** Edits the details of a paper. A new DOI is looked up again when details are still missing. */
export async function savePaperInfo(paper: Paper, patch: PaperInfoPatch): Promise<void> {
  const next: Paper = { ...paper, touched: true, updated_at: nowIso() }
  if (patch.title !== undefined) next.title = patch.title.trim()
  if (patch.url !== undefined) next.url = patch.url.trim()
  if (patch.why !== undefined) next.why = patch.why.trim()
  if (patch.authors !== undefined) next.authors = patch.authors
  if (patch.year !== undefined) next.year = patch.year
  if (patch.venue !== undefined) next.venue = patch.venue.trim()
  if (patch.value_types !== undefined) {
    if (patch.value_types.length > 0) next.value_types = patch.value_types
    else delete next.value_types
  }
  if (patch.value_full !== undefined) {
    if (patch.value_full) next.value_full = true
    else delete next.value_full
  }
  if (patch.doi !== undefined) {
    const doi = extractDoi(patch.doi)
    if (doi !== paper.doi) {
      next.doi = doi
      if (doi && incomplete(next)) next.lookup = 'pending'
      else delete next.lookup
    }
  }
  await applyChanges({ papers: [next] })
  if (next.lookup === 'pending') void runLookups()
}

/** Asks Crossref once more for an entry whose lookup failed. */
export async function retryLookup(paper: Paper): Promise<void> {
  if (!paper.doi) return
  await applyChanges({ papers: [{ ...paper, lookup: 'pending', updated_at: nowIso() }] })
  void runLookups()
}

/** "想看" → "已读" by hand: the paper gets its own (still empty) page. */
export async function markRead(paper: Paper): Promise<void> {
  await applyChanges({ papers: [{ ...paper, status: 'read', updated_at: nowIso() }] })
}

export async function removeWant(paper: Paper): Promise<void> {
  await applyChanges({ papers: [{ ...paper, deleted: true, updated_at: nowIso() }] })
}

/** Another live type already answers to this name (its name or a former name). */
async function typeNameTaken(name: string, except?: string): Promise<boolean> {
  const key = normalizeTypeName(name)
  const types = await db.types.filter((t) => !t.deleted && t.id !== except).toArray()
  return types.some((t) => normalizeTypeName(t.name) === key || t.aliases.some((a) => normalizeTypeName(a) === key))
}

/** Renaming keeps the old name as an alias, so Markdown using it still lands on this type. */
export async function saveType(type: HighlightType, patch: { name?: string; color?: string }): Promise<'done' | 'taken'> {
  const name = patch.name?.trim()
  if (name && name !== type.name && (await typeNameTaken(name, type.id))) return 'taken'
  // on top of what is stored now: a colour picked while a rename was being checked is kept
  const latest = (await db.types.get(type.id)) ?? type
  const next: HighlightType = { ...latest, updated_at: nowIso() }
  if (name && name !== latest.name) {
    next.aliases = [...new Set([...latest.aliases, latest.name])]
    next.name = name
  }
  if (patch.color) next.color = patch.color
  await applyChanges({ types: [next] })
  return 'done'
}

/** A highlight type made by hand. It can be picked when adding a highlight, and Markdown can use its name. */
export async function addType(name: string, color: string): Promise<'done' | 'taken' | 'empty'> {
  const clean = name.trim()
  if (!clean) return 'empty'
  if (await typeNameTaken(clean)) return 'taken'
  const order = (await db.types.toArray()).reduce((max, t) => Math.max(max, t.order + 1), 0)
  await applyChanges({ types: [{ id: newId('type'), name: clean, color, builtin: false, aliases: [], order, updated_at: nowIso() }] })
  return 'done'
}

/** How many live highlights, and papers marked with it as 参考价值, use a type. */
export async function typeUse(typeId: string): Promise<number> {
  const blocks = await db.blocks.filter((b) => !b.deleted && b.type_id === typeId).count()
  const papers = await db.papers.filter((p) => !p.deleted && !!p.value_types?.includes(typeId)).count()
  return blocks + papers
}

/** Only a type made by hand or by an import, and only when no highlight uses it (the page checks). */
export async function deleteType(type: HighlightType): Promise<void> {
  if (type.builtin || (await typeUse(type.id)) > 0) return
  await applyChanges({ types: [{ ...type, deleted: true, updated_at: nowIso() }] })
}

// ── Readings ──
// A reading worked out from an import has no row until it is named or removed; the row then
// takes the same id, so the same change made on two devices merges into one reading.

function rowOf(r: ReadingView, now: string): Reading {
  return r.row ? { ...r.row } : { id: r.id, paper_id: r.paper_id, date: r.date, title: r.title, created_at: r.created_at, updated_at: now }
}

export async function saveReadingTitle(r: ReadingView, title: string): Promise<void> {
  if (title.trim() === r.title.trim()) return
  const now = nowIso()
  const { deleted: _gone, ...row } = rowOf(r, now)
  await applyChanges({ readings: [{ ...row, title: title.trim(), updated_at: now }], paperUse: [await workedRow(r.paper_id, now)] })
}

/** "+ 新的一次阅读": an empty reading dated today. Returns its id. */
export async function addReading(paperId: string): Promise<string> {
  const now = nowIso()
  const id = newId('reading')
  await applyChanges({ readings: [{ id, paper_id: paperId, date: todayLocal(), title: '', created_at: now, updated_at: now }], paperUse: [await workedRow(paperId, now)] })
  return id
}

/** Only for an empty reading (the page checks). Nothing in it is touched. */
export async function removeReading(r: ReadingView): Promise<void> {
  const now = nowIso()
  await applyChanges({ readings: [{ ...rowOf(r, now), deleted: true, updated_at: now }] })
}

/** After importing: put this import into an existing reading, or (null) back into a reading of its own. */
export async function setImportReading(entryId: string, readingId: string | null): Promise<void> {
  const entry = await db.imports.get(entryId)
  if (!entry) return
  const next: ImportEntry = { ...entry, updated_at: nowIso() }
  if (readingId && readingId !== readingIdOfImport(entry.id)) next.reading_id = readingId
  else delete next.reading_id
  await applyChanges({ imports: [next] })
}
