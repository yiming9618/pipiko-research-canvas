import MarkdownIt from 'markdown-it'
import { memo } from 'react'

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

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return <div className="md" dangerouslySetInnerHTML={{ __html: md.render(text) }} />
})
