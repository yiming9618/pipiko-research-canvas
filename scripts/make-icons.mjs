import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const svg = readFileSync('public/favicon.svg', 'utf-8')
const b = await chromium.launch()
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  const p = await b.newPage({ viewport: { width: size, height: size } })
  await p.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
  await p.screenshot({ path: `public/${name}` })
}
await b.close()
