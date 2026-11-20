import MarkdownIt from 'markdown-it'
import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, memo, useContext, useMemo } from 'react'
import { imagesIn } from '../domain/noteImages'
import type { Asset } from '../domain/types'
import { db } from '../store/db'

/** Pictures already loaded (the printed page needs them at once); otherwise each text loads its own. */
export const AssetsContext = createContext<Map<string, Pick<Asset, 'id' | 'mime' | 'data' | 'w' | 'h'>> | null>(null)

// html:false → any HTML in the pasted text is shown as text, never run.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

const defaultLinkOpen =
  md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = String(tokens[idx].attrGet('href') ?? '')
  if (href.startsWith('#cite:')) {
    // A citation matched to a paper in the library; the board opens a preview on tap.
    tokens[idx].attrSet('class', 'cite')
    tokens[idx].attrSet('data-paper', href.slice(6))
  } else {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener noreferrer')
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

// A picture in a note, `![图片](asset:<id>)`: drawn from the shared image table (see domain/noteImages.ts).
const defaultImage = md.renderer.rules.image ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const src = String(tokens[idx].attrGet('src') ?? '')
  if (!src.startsWith('asset:')) return defaultImage(tokens, idx, options, env, self)
  const a = (env as { assets?: Map<string, Pick<Asset, 'mime' | 'data' | 'w' | 'h'>> } | undefined)?.assets?.get(src.slice(6))
  return a
    ? `<img class="note-img" src="data:${md.utils.escapeHtml(a.mime)};base64,${a.data}" width="${a.w}" height="${a.h}" alt="图片">`
    : '<span class="note-img-missing">［图片还没同步到这台设备］</span>'
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const given = useContext(AssetsContext)
  const ids = useMemo(() => imagesIn(text), [text])
  const loaded = useLiveQuery(
    async () => (ids.length > 0 && !given ? new Map((await db.assets.bulkGet(ids)).filter((a): a is Asset => !!a).map((a) => [a.id, a])) : null),
    [ids.join(','), given],
  )
  const assets = given ?? loaded ?? undefined
  return <div className="md" dangerouslySetInnerHTML={{ __html: md.render(text, { assets }) }} />
})
