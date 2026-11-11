// Hand edits in the library. Imported originals are never touched: block edits
// go to `edited_md`, and the pasted Markdown stays in the import entry.

import { extractDoi, incomplete } from '../domain/crossref'
import { findPaper, hashText } from '../domain/importer'
import type { Comment, HighlightType, Paper, PaperBlock } from '../domain/types'
import { applyChanges, db, newId, nowIso, todayLocal } from './db'
import { runLookups } from './lookup'

export async function saveBlockText(block: PaperBlock, text: string): Promise<void> {
  const next: PaperBlock = { ...block, updated_at: nowIso() }
  if (text.trim() === block.body_md.trim()) delete next.edited_md
  else next.edited_md = text.trim()
  await applyChanges({ blocks: [next] })
}

export async function deleteBlock(block: PaperBlock): Promise<void> {
  await applyChanges({ blocks: [{ ...block, deleted: true, updated_at: nowIso() }] })
}

export async function addBlock(paperId: string, typeId: string, text: string): Promise<void> {
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
        updated_at: nowIso(),
      },
    ],
  })
}

export async function savePaperField(
  paper: Paper,
  field: 'one_liner' | 'basics_md',
  value: string,
): Promise<void> {
  await applyChanges({ papers: [{ ...paper, [field]: value.trim(), updated_at: nowIso() }] })
}

export async function addComment(paperId: string, text: string): Promise<void> {
  await applyChanges({
    comments: [
      { id: newId('cmt'), paper_id: paperId, date: todayLocal(), source: 'me', text: text.trim(), updated_at: nowIso() },
    ],
  })
}

export async function addImageComment(
  paperId: string,
  image: { mime: string; w: number; h: number; data: string },
): Promise<void> {
  const now = nowIso()
  const assetId = `asset_${hashText(image.data)}`
  await applyChanges({
    assets: [{ id: assetId, ...image, updated_at: now }],
    comments: [
      { id: newId('cmt'), paper_id: paperId, date: todayLocal(), source: 'drawing', text: '', asset_id: assetId, updated_at: now },
    ],
  })
}

export async function saveComment(comment: Comment, text: string): Promise<void> {
  await applyChanges({ comments: [{ ...comment, text: text.trim(), updated_at: nowIso() }] })
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

/** Renaming keeps the old name as an alias, so Markdown using it still lands on this type. */
export async function saveType(type: HighlightType, patch: { name?: string; color?: string }): Promise<void> {
  const next: HighlightType = { ...type, updated_at: nowIso() }
  const name = patch.name?.trim()
  if (name && name !== type.name) {
    next.aliases = [...new Set([...type.aliases, type.name])]
    next.name = name
  }
  if (patch.color) next.color = patch.color
  await applyChanges({ types: [next] })
}
