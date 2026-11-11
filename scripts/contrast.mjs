// Checks every text/background pair in the palette against WCAG AA.
// Usage: node scripts/contrast.mjs
import { readFileSync } from 'node:fs'
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const lum = (hex) => {
  const v = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const root = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]))
const pairs = []
for (const bg of ['bg', 'bg-warm', 'surface']) {
  for (const fg of ['text', 'text-soft', 'accent', 'accent-deep', 'danger']) pairs.push([`${fg} on ${bg}`, root[fg], root[bg], 4.5])
}
pairs.push(['white on accent', '#ffffff', root.accent, 4.5], ['white on text', '#ffffff', root.text, 4.5], ['white on danger', '#ffffff', root.danger, 4.5])
pairs.push(['accent-deep on accent-wash', root['accent-deep'], root['accent-wash'], 4.5], ['text on accent-wash', root.text, root['accent-wash'], 4.5])
for (const m of css.matchAll(/\[data-color='(\w+)'\]\s*\{\s*--c-bg:\s*(#[0-9a-f]{6});\s*--c-dot:\s*(#[0-9a-f]{6});\s*--c-ink:\s*(#[0-9a-f]{6})/gi)) {
  pairs.push([`${m[1]}: label on tint`, m[4], m[2], 4.5], [`${m[1]}: body text on tint`, root.text, m[2], 4.5], [`${m[1]}: dot on white`, m[3], '#ffffff', 3], [`${m[1]}: dot on warm bg`, m[3], root['bg-warm'], 3])
}
for (const m of css.matchAll(/(?:color|background):\s*(#[0-9a-f]{6});[^}]*?\/\*\s*on\s*(#[0-9a-f]{6})\s*\*\//gi)) pairs.push([`${m[1]} on ${m[2]}`, m[1], m[2], 4.5])
let bad = 0
for (const [name, fg, bg, need] of pairs) {
  const r = ratio(fg, bg)
  if (r < need) { bad++; console.log(`LOW  ${name}: ${r.toFixed(2)} (needs ${need})  ${fg} / ${bg}`) }
}
console.log(`${pairs.length - bad} of ${pairs.length} pairs pass`)
process.exit(bad ? 1 : 0)
