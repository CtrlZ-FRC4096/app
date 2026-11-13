// Tests for dxf.ts: turning a part's flat outline into a DXF for the router or laser.
import { describe, expect, it } from 'vitest'
import { circleOf, outlineToDxf } from './dxf'

/** A circle as Onshape sends it: `n` points round it. */
const ring = (x: number, y: number, r: number, n: number) =>
  Array.from({ length: n }, (_, i) => [x + r * Math.cos((2 * Math.PI * i) / n), y + r * Math.sin((2 * Math.PI * i) / n)]).flat()

describe('circleOf', () => {
  it('finds a hole that is a circle, and not a polygon or a slot', () => {
    const cases: [string, number[], { x: number; y: number; r: number } | null][] = [
      ['a #7 hole in 16 pieces', ring(0.75, 0.75, 0.1005, 16), { x: 0.75, y: 0.75, r: 0.1005 }],
      ['a bearing hole in 32 pieces, rounded to 0.001 in', ring(3, 3, 0.5625, 32).map((v) => Math.round(v * 1000) / 1000), { x: 3, y: 3, r: 0.5625 }],
      ['a square', [0, 0, 1, 0, 1, 1, 0, 1], null],
      ['a hexagon: too few points to be a circle', ring(0, 0, 0.25, 6), null],
      // Half a circle, then out to the slot's far end and back: enough points, but not round.
      ['a slot with a round end', [...ring(0, 0, 0.25, 16).slice(0, 18), -0.25, -0.25, 2, -0.25, 2, 0.25], null],
    ]
    for (const [label, loop, expected] of cases) {
      const found = circleOf(loop)
      if (!expected) expect(found, label).toBeNull()
      else {
        expect(found, label).not.toBeNull()
        // To within half a thousandth of an inch: points rounded to 0.001 in move it a little.
        const off = [found!.x - expected.x, found!.y - expected.y, found!.r - expected.r].map(Math.abs)
        expect(Math.max(...off), label).toBeLessThan(0.0005)
      }
    }
  })
})

describe('outlineToDxf', () => {
  it('writes the outside as a closed outline, round holes as circles and other holes as outlines, in inches', () => {
    const dxf = outlineToDxf([
      [0, 0, 18, 0, 18, 6, 0, 6],
      ring(0.75, 0.75, 0.1005, 16),
      [5.5, 2.25, 5.5, 3.75, 12.5, 3.75, 12.5, 2.25],
    ])
    const lines = dxf.trim().split('\n')
    // Pairs of lines: a code, then its value.
    expect(lines.length % 2).toBe(0)
    const entities = lines.filter((_, i) => i % 2 === 1 && lines[i - 1] === '0')
    expect(entities).toEqual(['SECTION', 'ENDSEC', 'SECTION', 'POLYLINE', 'VERTEX', 'VERTEX', 'VERTEX', 'VERTEX', 'SEQEND', 'CIRCLE', 'POLYLINE', 'VERTEX', 'VERTEX', 'VERTEX', 'VERTEX', 'SEQEND', 'ENDSEC', 'EOF'])
    expect(dxf).toMatch(/\$INSUNITS\n70\n1\n/) // 1 means inches
    expect(dxf).toMatch(/CIRCLE\n8\nHOLES\n10\n0\.75\n20\n0\.75\n30\n0\n40\n0\.1005\n/)
    expect(dxf).toMatch(/POLYLINE\n8\nOUTSIDE\n66\n1\n70\n1\n/) // 70 = 1: closed
  })
})
