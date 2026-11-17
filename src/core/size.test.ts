import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'
import { SIZES, SIZE_ZOOM, zoomFor } from './size'

describe('size', () => {
  it('zooms the app for each size, and treats anything else as Normal', () => {
    const cases: [saved: unknown, zoom: number][] = [
      ['Smallest', 0.7], ['Normal', 0.9], ['Larger', 1], ['Largest', 1.15],
      ['Huge', 0.9], ['largest', 0.9], [null, 0.9], [3, 0.9],
    ]
    for (const [saved, zoom] of cases) expect(zoomFor(saved), String(saved)).toBe(zoom)
  })

  // index.html puts the size on the page before the app loads, so it needs
  // the same zoom as size.ts for every size, with Normal when nothing is saved.
  it("is put on the page by index.html's script, with the same zoom as size.ts", () => {
    expect(html).toContain("localStorage.getItem('ctrlz-app:size:v1')")
    expect(html).toMatch(new RegExp(`var zoom = ${SIZE_ZOOM.Normal}\\r?\\n`))
    for (const size of SIZES.filter((s) => s !== 'Normal')) expect(html, size).toContain(`'"${size}"': ${SIZE_ZOOM[size]}`)
  })
})
