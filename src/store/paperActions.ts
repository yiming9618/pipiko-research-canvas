// Hand edits in the library. Imported originals are never touched: block edits
// go to `edited_md`, and the pasted Markdown stays in the import entry.

import { hashText } from '../domain/importer'
import type { Comment, HighlightType, Paper, PaperBlock } from '../domain/types'
import { applyChanges, db, newId, nowIso, todayLocal } from './db'

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

export async function addWant(title: string, url: string): Promise<void> {
  const now = nowIso()
  await applyChanges({
    papers: [
      {
        id: newId('paper'),
        title: title.trim(),
        authors: [],
        year: null,
        venue: '',
        doi: '',
        category: '',
        keywords: [],
        status: 'want',
        url: url.trim(),
        one_liner: '',
        basics_md: '',
        created_at: now,
        updated_at: now,
      },
    ],
  })
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
