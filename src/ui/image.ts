const MAX_SIDE = 1600

/** Shrinks a photo or sketch to a size that is comfortable to store and sync. */
export async function fileToImage(file: File): Promise<{ mime: string; w: number; h: number; data: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('这台设备暂时处理不了图片')
    ctx.fillStyle = '#ffffff' // transparent sketches get a white page
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    return { mime: 'image/jpeg', w, h, data: dataUrl.slice(dataUrl.indexOf(',') + 1) }
  } catch (err) {
    if (err instanceof Error && err.message.includes('处理不了')) throw err
    throw new Error('这张图片打不开，换一张试试（支持照片和截图）')
  } finally {
    URL.revokeObjectURL(url)
  }
}
