/** Browser image preparation for receipts. No packages or provider credentials. */

export const RECEIPT_IMAGE_SETTINGS = { maxEdge: 2560, quality: 0.85 } as const

/** A size that fits inside maxEdge, only shrinking, never cropping or upscaling. */
export function scaledSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  if (![width, height, maxEdge].every((n) => Number.isFinite(n) && n > 0)) throw new Error('Image dimensions must be positive.')
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Kept separate from browser decoding so tests can use a fake encoder. */
export type ImageEncoder = (file: Blob, settings: typeof RECEIPT_IMAGE_SETTINGS) => Promise<Blob>

/**
 * Re-encode a supported raster image. The output's own type chooses its
 * extension; the original filename, which can contain personal details, isn't kept.
 * Null means there was no usable encoded file, so the caller uses the original.
 */
export async function compressReceiptImage(file: File, encode: ImageEncoder = encodeRaster): Promise<File | null> {
  const encoded = await encode(file, RECEIPT_IMAGE_SETTINGS)
  const ending = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[encoded.type]
  return ending ? new File([encoded], `receipt.${ending}`, { type: encoded.type }) : null
}

/** Use the browser's built-in raster decoder and canvas, rather than an image package. */
async function encodeRaster(file: Blob, settings: typeof RECEIPT_IMAGE_SETTINGS): Promise<Blob> {
  // Respect the camera's orientation before working out the dimensions.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height, settings.maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot prepare an image.')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    const encoded = await new Promise<Blob | null>((resolve) => context.canvas.toBlob(resolve, 'image/webp', settings.quality))
    if (!encoded) throw new Error('This browser could not encode the image.')
    return encoded
  } finally {
    bitmap.close()
  }
}
