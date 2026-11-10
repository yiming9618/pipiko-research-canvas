import { PLACEHOLDER_LINES } from '../domain/templates'

export interface Section {
  heading: string
  body: string
}

/** Splits on level-2 headings (`## `), ignoring anything inside code fences. */
export function splitSections(body: string): { preamble: string; sections: Section[] } {
  const lines = body.split('\n')
  const preamble: string[] = []
  const sections: { heading: string; lines: string[] }[] = []
  let inFence = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const m = inFence ? null : /^##(?!#)\s*(.*?)\s*#*\s*$/.exec(line)
    if (m) {
      sections.push({ heading: m[1].trim(), lines: [] })
    } else if (sections.length === 0) {
      preamble.push(line)
    } else {
      sections[sections.length - 1].lines.push(line)
    }
  }
  return {
    preamble: trimBlankLines(preamble.join('\n')),
    sections: sections.map((s) => ({ heading: s.heading, body: trimBlankLines(s.lines.join('\n')) })),
  }
}

export function trimBlankLines(text: string): string {
  return text.replace(/^(\s*\n)+/, '').replace(/\s+$/, '')
}

/** True when a section has no content of its own: blank, or only template hint lines. */
export function isEmptyBody(body: string): boolean {
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (t !== '' && !PLACEHOLDER_LINES.has(t)) return false
  }
  return true
}
