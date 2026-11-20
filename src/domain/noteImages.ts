// Pictures inside note text (基础, highlight cards, 我的理解). A picture is one line of the text,
// `![图片](asset:<asset id>)`, so it is saved and synced with the note itself; the picture is an
// entry of the shared image table (the same as a board's 贴图), synced as an image file.

const IMAGE = /!\[[^\]\n]*\]\(asset:([A-Za-z0-9_-]+)\)/g

export const imageLine = (assetId: string) => `![图片](asset:${assetId})`

/** The asset ids a text shows, in order. */
export function imagesIn(text: string): string[] {
  return [...text.matchAll(IMAGE)].map((m) => m[1])
}

/** For Markdown exports: each picture becomes "[图片]". */
export const withImagePlaceholders = (text: string) => text.replace(IMAGE, '[图片]')

/** For search: pictures are left out. */
export const withoutImages = (text: string) => text.replace(IMAGE, ' ')
