import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { boardHref, mostRecentBoard, sortBoards } from '../../domain/boards'
import type { BoardTarget } from '../../domain/importer'
import { db } from '../../store/db'
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
  /** The Markdown names a board that does not exist: waiting for the person to choose. */
  needsBoard?: { name: string; similar: { id: string; name: string }[]; text: string }
  /** Where a research import went, to offer a way there. */
  board?: { id: string; name: string }
}

const NEW_BOARD = '__new'

const KIND_LABEL: Record<ImportKind, string> = { research: '研究记录', paper: '论文' }

export function PastePanel() {
  const [kind, setKind] = useState<ImportKind>('research')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  // which board a research record goes onto: '' = the one used most recently
  const [boardChoice, setBoardChoice] = useState('')
  const [newBoardName, setNewBoardName] = useState('')
  const boards = useLiveQuery(() => db.boards.toArray())
  const boardUse = useLiveQuery(() => db.boardUse.toArray())
  const recent = boards && boardUse ? mostRecentBoard(boards, boardUse) : undefined
  const boardList = boards && boardUse ? sortBoards(boards, boardUse, 'used') : []
  // nothing to choose from yet: the first import makes the first board
  const choice = boardList.length === 0 ? NEW_BOARD : boardChoice || recent?.id || NEW_BOARD
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

  const send = async (text: string, target: BoardTarget | undefined, decided: boolean) => {
    setBusy(true)
    try {
      const out = await runImport(text, kind, { target, decided })
      setResult({
        message: out.message,
        notices: out.notices,
        entry: out.entry,
        plain: !out.stored,
        similar: out.similar,
        needsBoard: out.needsBoard ? { ...out.needsBoard, text } : undefined,
        board: out.stored ? out.board : undefined,
      })
      if (out.stored) {
        setText('')
        setNewBoardName('')
        setBoardChoice('')
      }
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

  const submit = () => {
    if (busy || text.trim() === '') return
    const target: BoardTarget = choice === NEW_BOARD ? { newName: newBoardName } : { id: choice }
    void send(text, kind === 'research' ? target : undefined, false)
  }

  /** The answer to "which board?": make the one named in the Markdown, or use an existing one. */
  const answerBoard = (target: BoardTarget) => {
    if (!result?.needsBoard) return
    void send(result.needsBoard.text, target, true)
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

      {kind === 'research' && (
        <div className="panel-board">
          <label>
            <span>放到哪块画板</span>
            <select value={choice} onChange={(e) => setBoardChoice(e.target.value)} disabled={boardList.length === 0}>
              {boardList.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.id === recent?.id ? '（最近使用）' : ''}
                </option>
              ))}
              <option value={NEW_BOARD}>＋ 新建一块画板</option>
            </select>
          </label>
          {choice === NEW_BOARD && (
            <label>
              <span className="sr-only">新画板的名字</span>
              <input value={newBoardName} onChange={(e) => setNewBoardName(e.target.value)} placeholder="新画板的名字" maxLength={40} />
            </label>
          )}
        </div>
      )}

      <div className="panel-row">
        <span className="panel-hint">
          {kind === 'paper' ? '放进论文库，已有的会合并' : 'Markdown 里写了 board 就以它为准'}
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
            {result.board && !result.plain && (
              <a className="btn" href={boardHref(result.board.id)}>
                去看看
              </a>
            )}
            {result.entry && !result.plain && (
              <button type="button" className="btn" onClick={() => void requestUndo(result.entry!)}>
                <IconUndo />
                撤销
              </button>
            )}
          </div>
        )}
        {result?.needsBoard && (
          <div className="result is-question">
            <p className="result-text">还没有叫「{result.needsBoard.name}」的画板。要放到哪里？</p>
            <div className="result-choices">
              <button type="button" className="btn" disabled={busy} onClick={() => answerBoard({ newName: result.needsBoard!.name })}>
                新建「{result.needsBoard.name}」
              </button>
              {result.needsBoard.similar.map((b) => (
                <button key={b.id} type="button" className="btn" disabled={busy} onClick={() => answerBoard({ id: b.id })}>
                  放进「{b.name}」
                </button>
              ))}
              <button type="button" className="btn btn-quiet" onClick={() => setResult(null)}>
                先不放
              </button>
            </div>
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
