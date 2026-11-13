// Everything the Markdown export reads, loaded ahead of time. Copying to the
// clipboard on iPad and iPhone has to happen within the tap itself, so the
// text must be ready to build without waiting.

import { useLiveQuery } from 'dexie-react-hooks'
import type { NotebookData } from '../domain/exportMarkdown'
import { db } from './db'

export async function loadNotebook(): Promise<NotebookData> {
  const [papers, blocks, types, records, cards, boardItems, connectors, strokes, piles, boards, imports] = await Promise.all([
    db.papers.toArray(),
    db.blocks.toArray(),
    db.types.toArray(),
    db.records.toArray(),
    db.cards.toArray(),
    db.boardItems.toArray(),
    db.connectors.toArray(),
    db.strokes.toArray(),
    db.piles.toArray(),
    db.boards.toArray(),
    db.imports.toArray(),
  ])
  return { papers, blocks, types, records, cards, boardItems, connectors, strokes, piles, boards, imports }
}

export function useNotebook(): NotebookData | undefined {
  return useLiveQuery(loadNotebook)
}
