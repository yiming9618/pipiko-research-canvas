import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { saveSetting } from '../../store/actions'
import { db } from '../../store/db'
import { IconArrowDown } from '../../ui/icons'
import { TopNav } from '../../ui/TopNav'
import { PastePanel } from './PastePanel'

const QUESTION_KEY = 'current_question'

export function Home() {
  const rootRef = useRef<HTMLDivElement>(null)
  const pasteRef = useRef<HTMLElement>(null)

  // Scroll progress 0→1 drives the hero fading out and the panel floating in (see .hero/.panel in CSS).
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const p = Math.max(0, Math.min(1, window.scrollY / (window.innerHeight * 0.65)))
      rootRef.current?.style.setProperty('--p', p.toFixed(3))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  const now = new Date()
  const dateText = `${now.getFullYear()} · ${String(now.getMonth() + 1).padStart(2, '0')} · ${String(now.getDate()).padStart(2, '0')}`

  const goToPanel = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    pasteRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div className="home" ref={rootRef}>
      <div className="glow" aria-hidden="true" />

      <TopNav current="home" />

      <main>
        <section className="hero">
          <p className="hero-date">{dateText}</p>
          <h1>欢迎回来</h1>
          <Question />
          <button type="button" className="hero-hint" onClick={goToPanel}>
            往下滑，放进今天的研究
            <IconArrowDown />
          </button>
        </section>

        <section className="paste" ref={pasteRef} aria-label="粘贴今天的研究">
          <PastePanel />
        </section>
      </main>
    </div>
  )
}

function Question() {
  const stored = useLiveQuery(() => db.settings.get(QUESTION_KEY))
  const value = stored && !stored.deleted ? stored.value : ''
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (draft !== null) inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft !== null])

  const save = async () => {
    if (draft === null) return
    const next = draft.trim()
    setDraft(null)
    if (next !== value) await saveSetting(QUESTION_KEY, next)
  }

  return (
    <div className="question">
      <p className="question-label" id="question-label">
        现在在想的问题
      </p>
      {draft === null ? (
        <button
          type="button"
          className={`question-text${value ? '' : ' is-empty'}`}
          onClick={() => setDraft(value)}
          aria-describedby="question-label"
        >
          {value || '点一下，写下现在在想的问题'}
        </button>
      ) : (
        <textarea
          ref={inputRef}
          className="question-input"
          aria-labelledby="question-label"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void save()
            }
            if (e.key === 'Escape') setDraft(null)
          }}
        />
      )}
    </div>
  )
}
