import { useEffect, useRef, useState } from 'react'
import { PAPER_PROMPT, RESEARCH_PROMPT } from '../../domain/templates'
import type { ImportEntry, ImportKind } from '../../domain/types'
import { confirmSameAsWant, runImport } from '../../store/actions'
import { copyText } from '../../ui/clipboard'
import { IconCheck, IconCopy, IconUndo } from '../../ui/icons'
import { useUndo } from '../../ui/useUndo'

interface Result {
  message: string
  notices: string[]
  entry?: ImportEntry
  plain?: boolean
  similar?: { paper_id: string; want_id: string; want_title: string }
}

const KIND_LABEL: Record<ImportKind, string> = { research: '研究记录', paper: '论文' }

export function PastePanel() {
  const [kind, setKind] = useState<ImportKind>('research')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  const { requestUndo, dialog } = useUndo(() =>
    setResult({ message: '已撤销这次导入', notices: [], plain: true }),
  )

  // The result (and any question in it) appears below the button: bring it into view.
  const resultRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!result) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    resultRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [result])

  const submit = async () => {
    if (busy || text.trim() === '') return
    setBusy(true)
    try {
      const out = await runImport(text, kind)
      setResult({ message: out.message, notices: out.notices, entry: out.entry, plain: !out.stored, similar: out.similar })
      if (out.stored) setText('')
    } catch (err) {
      setResult({
        message: '没有放进去：保存时出了问题。内容还在输入框里，可以再试一次。',
        notices: [err instanceof Error ? err.message : String(err)],
        plain: true,
      })
    } finally {
      setBusy(false)
    }
  }

  const sameAsWant = async () => {
    if (!result?.similar || !result.entry) return
    const { paper_id, want_id } = result.similar
    const ok = await confirmSameAsWant(result.entry.id, paper_id, want_id)
    setResult({
      ...result,
      similar: undefined,
      message: ok ? `${result.message}；想看里的那一条已经并进这篇论文` : result.message,
    })
  }

  const copyTemplate = async () => {
    const ok = await copyText(kind === 'paper' ? PAPER_PROMPT : RESEARCH_PROMPT)
    setCopied(ok ? 'ok' : 'fail')
    setTimeout(() => setCopied(null), 2400)
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>今天的研究</h2>
        <span>粘贴 AI 整理好的 Markdown</span>
      </div>

      <div className="seg" role="group" aria-label="内容类型">
        {(['research', 'paper'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className="btn"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <label>
        <span className="sr-only">Markdown 内容</span>
        <textarea
          className="md-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            kind === 'paper'
              ? '---\ntype: paper\ntitle: 论文完整标题\n...'
              : '---\ntype: research\ndate: 2026-11-11\n...'
          }
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </label>

      <div className="panel-row">
        <span className="panel-hint">
          {kind === 'paper' ? '放进论文库，已有的会合并' : '放进那一天的画板'}
        </span>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void submit()}
          disabled={busy || text.trim() === ''}
        >
          {busy ? '正在放…' : '放进去'}
        </button>
      </div>

      <div role="status" aria-live="polite" ref={resultRef} className="result-area">
        {result && (
          <div className={`result${result.plain ? ' is-plain' : ''}`}>
            <div>
              <p className="result-text">{result.message}</p>
              {result.notices.length > 0 && (
                <ul className="result-notices">
                  {result.notices.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
            {result.entry && !result.plain && (
              <button type="button" className="btn" onClick={() => void requestUndo(result.entry!)}>
                <IconUndo />
                撤销
              </button>
            )}
          </div>
        )}
        {result?.similar && result.entry && (
          <div className="result is-question">
            <p className="result-text">这是不是想看里的「{result.similar.want_title}」？</p>
            <div className="result-choices">
              <button type="button" className="btn" onClick={() => void sameAsWant()}>
                是，合并
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setResult({ ...result, similar: undefined })}>
                不是
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="panel-foot">
        <button type="button" className="btn btn-quiet" onClick={() => void copyTemplate()}>
          {copied === 'ok' ? <IconCheck /> : <IconCopy />}
          {copied === 'ok'
            ? '已复制，粘贴给 AI 就行'
            : copied === 'fail'
              ? '没复制成功，请再点一次'
              : `复制「${KIND_LABEL[kind]}」模板`}
        </button>
      </div>

      {dialog}
    </div>
  )
}
