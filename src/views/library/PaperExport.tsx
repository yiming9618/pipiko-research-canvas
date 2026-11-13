import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { exportPaper, paperParts, SOURCE_LABEL, type PaperExportData } from '../../domain/exportPaper'
import type { Paper } from '../../domain/types'
import { db, todayLocal } from '../../store/db'
import { copyText } from '../../ui/clipboard'
import { downloadText } from '../../ui/CopyExport'
import { IconCopy, IconDownload, IconExport } from '../../ui/icons'
import { Markdown } from '../../ui/Markdown'
import { toast } from '../../ui/toast'

/** "导出" on a paper's page: Markdown (copied) or PDF (the system's print dialog, "Save as PDF"). */
export function PaperExport({ paper }: { paper: Paper }) {
  const data = useLiveQuery(async (): Promise<PaperExportData> => {
    const [blocks, types, comments, fields] = await Promise.all([
      db.blocks.where('paper_id').equals(paper.id).toArray(),
      db.types.toArray(),
      db.comments.where('paper_id').equals(paper.id).toArray(),
      db.fields.toArray(),
    ])
    return { paper, blocks, types, comments, fields }
  }, [paper])
  const assets = useLiveQuery(async () => {
    const ids = (data?.comments ?? []).filter((c) => !c.deleted && c.asset_id).map((c) => c.asset_id!)
    return new Map((await db.assets.bulkGet(ids)).filter((a) => !!a).map((a) => [a!.id, a!]))
  }, [data])
  const [open, setOpen] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [manual, setManual] = useState<string | null>(null)
  const ref = useRef<HTMLDialogElement>(null)
  const name = paper.title || paper.doi || '论文'

  useEffect(() => {
    const el = ref.current
    if (open && el && !el.open) el.showModal()
  }, [open])

  // The printed page exists only while printing; the system's dialog offers "Save as PDF".
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    const t = setTimeout(() => window.print(), 50)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', done)
    }
  }, [printing])

  const copy = async () => {
    if (!data) return
    const text = exportPaper(data)
    if (await copyText(text)) {
      ref.current?.close()
      toast('已复制这篇论文（Markdown）')
    } else setManual(text)
  }

  return (
    <>
      <button type="button" className="btn btn-quiet" onClick={() => setOpen(true)} disabled={!data}>
        <IconExport />
        导出
      </button>
      {open && (
        <dialog
          ref={ref}
          className="dialog export-dialog"
          onClose={() => {
            setOpen(false)
            setManual(null)
          }}
          aria-labelledby="paper-export-title"
        >
          <h2 id="paper-export-title">导出这篇论文</h2>
          <p>包括基本信息、一句话总结、基础、重点区块和我的理解。</p>
          {manual === null ? (
            <div className="export-choices">
              <button type="button" className="export-choice" onClick={() => void copy()}>
                <IconCopy />
                <span>
                  <b>Markdown</b>
                  <span>复制下来，贴给 AI 或存进笔记</span>
                </span>
              </button>
              <button
                type="button"
                className="export-choice"
                onClick={() => {
                  ref.current?.close()
                  setPrinting(true)
                }}
              >
                <IconDownload />
                <span>
                  <b>PDF</b>
                  <span>打开打印，选“存储为 PDF”；适合给别人看、打印、存档</span>
                </span>
              </button>
            </div>
          ) : (
            <>
              <p>没能自动复制。请在下面全选后手动复制，或者存成文件。</p>
              <label>
                <span className="sr-only">导出的内容</span>
                <textarea className="md-input" readOnly value={manual} onFocus={(e) => e.currentTarget.select()} />
              </label>
            </>
          )}
          <div className="dialog-actions">
            {manual !== null && (
              <button type="button" className="btn" onClick={() => downloadText(manual, name)}>
                <IconDownload />
                存成 .md 文件
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => ref.current?.close()}>
              {manual === null ? '取消' : '好'}
            </button>
          </div>
        </dialog>
      )}
      {printing && data && createPortal(<PaperSheet data={data} assets={assets} />, document.body)}
    </>
  )
}

/** The printed paper: one clean page flow, for reading on screen or on paper. */
function PaperSheet({ data, assets }: { data: PaperExportData; assets?: Map<string, { mime: string; data: string; w: number; h: number }> }) {
  const { paper, highlights, others, understanding, field } = paperParts(data)
  const rows: [string, string][] = [
    ['作者', paper.authors.join(', ')],
    ['年份', paper.year === null ? '' : String(paper.year)],
    ['期刊/会议', paper.venue],
    ['DOI', paper.doi],
    ['链接', paper.url],
    ['领域', field],
  ]
  return (
    <article className="print-sheet" aria-hidden="true">
      <h1>{paper.title || paper.doi || '（没有标题）'}</h1>
      <dl className="print-info">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {paper.one_liner.trim() && <p className="print-lead">{paper.one_liner.trim()}</p>}
      {paper.basics_md.trim() && (
        <section>
          <h2>基础</h2>
          <Markdown text={paper.basics_md} />
        </section>
      )}
      {highlights.length > 0 && (
        <section>
          <h2>重点</h2>
          {highlights.map((h) => (
            <div key={h.block.id} className="print-block" data-color={h.type?.color ?? 'default'}>
              <h3>{h.type?.name ?? '重点'}</h3>
              <Markdown text={h.text} />
            </div>
          ))}
        </section>
      )}
      {others.map((o) => (
        <section key={o.block.id}>
          <h2>{o.heading}</h2>
          <Markdown text={o.text} />
        </section>
      ))}
      {understanding.length > 0 && (
        <section>
          <h2>我的理解</h2>
          {understanding.map((c) => {
            const img = c.asset_id ? assets?.get(c.asset_id) : undefined
            return (
              <div key={c.id} className="print-note">
                <p className="print-note-head">
                  {c.date} · {SOURCE_LABEL[c.source]}
                </p>
                {img ? <img src={`data:${img.mime};base64,${img.data}`} width={img.w} height={img.h} alt="" /> : null}
                {c.text.trim() && <Markdown text={c.text} />}
              </div>
            )
          })}
        </section>
      )}
      <footer className="print-foot">研究笔记本 · 导出于 {todayLocal()}</footer>
    </article>
  )
}
