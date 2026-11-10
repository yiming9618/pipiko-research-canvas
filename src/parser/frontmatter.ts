// Tolerant, deterministic frontmatter reader. Flat `key: value` only.

export interface FrontmatterResult {
  /** Keys lower-cased. Multi-line `- item` lists are joined with ", ". */
  data: Record<string, string>
  body: string
  found: boolean
}

const DELIMITER = /^[-—–]{2,}\s*$/
const KEY_LINE = /^([A-Za-z_][\w-]*)\s*[:：]\s*(.*)$/
const LIST_ITEM = /^\s*[-*]\s+(.*)$/
const KNOWN_KEYS = new Set([
  'type',
  'title',
  'authors',
  'year',
  'venue',
  'doi',
  'category',
  'keywords',
  'date',
  'summary',
  'activities',
  'papers',
])

/** Line endings, BOM, and an outer ```markdown fence the AI may have added. */
export function normalizeInput(raw: string): string {
  let text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  let first = 0
  while (first < lines.length && lines[first].trim() === '') first++
  let last = lines.length - 1
  while (last > first && lines[last].trim() === '') last--
  if (
    last > first &&
    /^```+\s*(markdown|md)?\s*$/i.test(lines[first].trim()) &&
    /^```+\s*$/.test(lines[last].trim())
  ) {
    text = lines.slice(first + 1, last).join('\n')
  }
  return text
}

function cleanValue(value: string): string {
  let v = value.trim()
  if (v.length >= 2) {
    const a = v[0]
    const b = v[v.length - 1]
    if ((a === '"' && b === '"') || (a === "'" && b === "'") || (a === '“' && b === '”')) {
      v = v.slice(1, -1).trim()
    } else if (a === '[' && b === ']') {
      v = v.slice(1, -1).trim()
    }
  }
  return v
}

export function parseFrontmatter(input: string): FrontmatterResult {
  const lines = input.split('\n')
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++

  const opened = i < lines.length && DELIMITER.test(lines[i].trim())
  if (opened) {
    i++
  } else {
    // No opening line: only accept if the text starts with a known field.
    const m = i < lines.length ? KEY_LINE.exec(lines[i]) : null
    if (!m || !KNOWN_KEYS.has(m[1].toLowerCase())) {
      return { data: {}, body: input, found: false }
    }
  }

  const data: Record<string, string> = {}
  let currentKey: string | null = null
  for (; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (DELIMITER.test(trimmed)) {
      i++
      break
    }
    if (trimmed.startsWith('#')) break // closing line missing; body starts here
    if (trimmed === '') {
      if (!opened) {
        i++
        break
      }
      continue
    }
    const item = LIST_ITEM.exec(line)
    if (item && currentKey) {
      const v = cleanValue(item[1])
      if (v) data[currentKey] = data[currentKey] ? `${data[currentKey]}, ${v}` : v
      continue
    }
    const kv = KEY_LINE.exec(trimmed)
    if (kv) {
      currentKey = kv[1].toLowerCase()
      data[currentKey] = cleanValue(kv[2])
      continue
    }
    // Not a field: stop here so the line stays in the body instead of being lost.
    break
  }

  return { data, body: lines.slice(i).join('\n'), found: true }
}

export function splitList(value: string | undefined): string[] {
  if (!value) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of value.split(/[,，、;；]/)) {
    const v = cleanValue(part)
    if (v && !seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

/** Accepts 2026-11-11, 2026/11/11, 2026.11.11, 2026年11月11日. */
export function parseDate(value: string | undefined): string | null {
  if (!value) return null
  const m = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/.exec(value.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
