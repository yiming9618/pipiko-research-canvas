import { useLiveQuery } from 'dexie-react-hooks'
import { boardHref } from '../../domain/boards'
import { shortDate } from '../../domain/importer'
import { recordBoardId } from '../../domain/migrate'
import type { Paper } from '../../domain/types'
import { db } from '../../store/db'

/** Where an AI-mentioned entry came from: the days whose record named it. */
export function Sources({ paper }: { paper: Paper }) {
  const list = paper.mentioned_in ?? []
  // each source is a research record; the link goes to the board that record is on
  const where = useLiveQuery(async () => {
    const records = await db.records.bulkGet(list.map((m) => m.record_id))
    return new Map(records.filter((r) => !!r).map((r) => [r!.id, boardHref(recordBoardId(r!))]))
  }, [list.map((m) => m.record_id).join(',')])
  if (list.length === 0) return null
  return (
    <span className="paper-meta">
      提到它的记录：
      {list.map((m, i) => (
        <span key={m.record_id}>
          {i > 0 && '、'}
          <a href={where?.get(m.record_id) ?? '#/boards'}>{shortDate(m.date)}</a>
        </span>
      ))}
    </span>
  )
}

