import { describe, expect, it } from 'vitest'
import { compressReceiptImage, scaledSize } from './receipt-image'

describe('scaledSize', () => {
  it('scales landscape and portrait proportionally, and never upscales', () => {
    const cases: [number, number, number, { width: number; height: number }][] = [
      [4000, 2000, 100, { width: 100, height: 50 }],
      [2000, 4000, 100, { width: 50, height: 100 }],
      [800, 600, 2560, { width: 800, height: 600 }],
      [500, 333, 100, { width: 100, height: 67 }],
    ]
    for (const [width, height, maxEdge, expected] of cases) expect(scaledSize(width, height, maxEdge), `${width} × ${height}`).toEqual(expected)
  })

  it('refuses impossible dimensions instead of making an invalid canvas', () => {
    for (const [width, height, maxEdge] of [[0, 100, 100], [100, 0, 100], [100, 100, 0], [NaN, 100, 100]]) {
      expect(() => scaledSize(width, height, maxEdge)).toThrow(/dimensions/)
    }
  })
})

describe('compressReceiptImage', () => {
  it('uses the encoded file type, not the original filename or type', async () => {
    const original = new File(['original content'], 'someone’s card number.jpg', { type: 'image/jpeg' })
    for (const [type, filename] of [['image/webp', 'receipt.webp'], ['image/png', 'receipt.png'], ['image/jpeg', 'receipt.jpg']] as const) {
      const file = await compressReceiptImage(original, async () => new Blob(['re-encoded'], { type }))
      expect(file).toMatchObject({ name: filename, type })
      expect(file?.name).not.toContain('card')
    }
  })

  it('uses the actual raster settings, and returns null if the result is not a raster image', async () => {
    let passed: unknown
    const original = new File(['original'], 'photo.jpg', { type: 'image/jpeg' })
    await compressReceiptImage(original, async (_file, settings) => {
      passed = settings
      return new Blob(['encoded'], { type: 'image/webp' })
    })
    expect(passed).toMatchObject({ maxEdge: 2560, quality: 0.85 })
    const result = await compressReceiptImage(original, async () => new Blob(['not an image'], { type: 'application/pdf' }))
    expect(result).toBeNull()
  })
})
