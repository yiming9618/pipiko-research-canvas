import type { CardKind } from './types'

/** Palette key for each kind of research card (see the type colours in index.css). */
export const KIND_COLOR: Record<CardKind, string> = {
  发现: 'blue',
  实验: 'green',
  问题: 'pink',
  思考: 'yellow',
  下一步: 'orange',
  其他: 'default',
}
