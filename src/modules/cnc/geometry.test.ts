// Tests for geometry.ts. Run them with `npm test`.
import { describe, expect, it } from 'vitest'
import {
  biggestClearPiece, boundsOf, designChecks, findSpot, findSpots, flatOutline, footprint, guessStock, inches, isPlate, materialName, materialWords,
  minutesText, nextLabel, onSheet, overlaps, parseInches, quarterTurn, routerMinutes, sizeText, snapInches, suggestCode, svgPath, toCorner, usedShare,
  type ShapeGeometry, type StockGeometry,
} from './geometry'

describe('parseInches', () => {
  it('reads decimals, fractions, mixed numbers and millimeters', () => {
    expect(parseInches('0.25')).toBe(0.25)
    expect(parseInches('.25')).toBe(0.25)
    expect(parseInches('1/4')).toBe(0.25)
    expect(parseInches('1/4"')).toBe(0.25)
    expect(parseInches('1/4 in')).toBe(0.25)
    expect(parseInches('1 1/2')).toBe(1.5)
    expect(parseInches('1-1/2 inches')).toBe(1.5)
    expect(parseInches('48')).toBe(48)
    expect(parseInches('6.35 mm')).toBe(0.25)
    expect(inches(parseInches('3/16')!)).toBe('3/16 in')
  })

  it("is null for anything that isn't a size", () => {
    for (const text of ['', 'abc', '1/0', '-2', '1/4/8', '2 ft']) expect(parseInches(text), text).toBeNull()
  })
})

describe('inches', () => {
  it('writes exact fractions down to 1/64, and decimals otherwise', () => {
    expect(inches(0.25)).toBe('1/4 in')
    expect(inches(0.125)).toBe('1/8 in')
    expect(inches(0.0625)).toBe('1/16 in')
    expect(inches(1.5)).toBe('1 1/2 in')
    expect(inches(48)).toBe('48 in')
    expect(inches(0.201)).toBe('0.201 in')
    expect(sizeText(18, 6.125)).toBe('18 × 6.13 in')
  })
})

describe('outlines', () => {
  const square = [[2, 3, 6, 3, 6, 5, 2, 5]]

  it('moves loops to the corner and finds their box', () => {
    expect(toCorner(square)).toEqual([[0, 0, 4, 0, 4, 2, 0, 2]])
    expect(boundsOf(square)).toEqual({ minX: 2, minY: 3, maxX: 6, maxY: 5 })
    expect(boundsOf([])).toBeNull()
  })

  it('turns loops a quarter turn, and lays a part long side along x', () => {
    expect(boundsOf(quarterTurn(square))).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 4 })
    expect(boundsOf(flatOutline({ outline: [[0, 0, 2, 0, 2, 9, 0, 9]] }))).toEqual({ minX: 0, minY: 0, maxX: 9, maxY: 2 })
  })

  it('draws loops as an SVG path with y going up', () => {
    expect(svgPath([[0, 0, 4, 0, 4, 2]], 1, 1, 10)).toBe('M1 9L5 9L5 7Z')
    expect(svgPath([[0, 0]])).toBe('')
  })
})

describe('footprint', () => {
  // An 18 x 6 plate drawn on Top, bottom face at 0.
  const shape = { axis: 'z' as const, low_in: 0, outline: [[0, 0, 18, 0, 18, 6, 0, 6]] }
  const moved = (x: number, y: number) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, 0, 0, 0, 0, 1]

  it('puts a part where the layout moves it', () => {
    expect(footprint(shape, moved(0.5, 7))).toEqual({ box: { x: 0.5, y: 7, length: 18, width: 6 }, outline: [[0, 0, 18, 0, 18, 6, 0, 6]], rotation: 0, flat: true })
  })

  it('turns it with the layout', () => {
    const turned = [0, -1, 0, 10, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1]
    const spot = footprint(shape, turned)!
    expect(spot.box).toEqual({ x: 4, y: 1, length: 6, width: 18 })
    expect(spot.rotation).toBe(90)
  })

  it('works for a plate drawn on Front, laid flat in the layout', () => {
    // Thickness along y; the outline is drawn on z (u) and x (v).
    const front = { axis: 'y' as const, low_in: 0, outline: [[0, 0, 6, 0, 6, 18, 0, 18]] }
    // Turn the part's y up to the layout's z: x→x, y→z, z→-y.
    const laid = [1, 0, 0, 2, 0, 0, -1, 30, 0, 1, 0, 0, 0, 0, 0, 1]
    const spot = footprint(front, laid)!
    expect(spot.flat).toBe(true)
    expect(spot.box).toEqual({ x: 2, y: 24, length: 18, width: 6 })
  })

  it('notices a part standing up, and has nothing for no outline', () => {
    const standing = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]
    expect(footprint(shape, standing)!.flat).toBe(false)
    expect(footprint({ ...shape, outline: [] }, moved(0, 0))).toBeNull()
  })
})

describe('finding room', () => {
  const sheet = { length_in: 48, width_in: 24 }

  it('knows when boxes overlap, and when one is on the sheet', () => {
    const a = { x: 0, y: 0, length: 10, width: 5 }
    expect(overlaps(a, { x: 10, y: 0, length: 5, width: 5 })).toBe(false)
    expect(overlaps(a, { x: 10, y: 0, length: 5, width: 5 }, 0.25)).toBe(true)
    expect(overlaps(a, { x: 5, y: 2, length: 1, width: 1 })).toBe(true)
    expect(onSheet(a, sheet)).toBe(true)
    expect(onSheet({ x: 40, y: 0, length: 10, width: 5 }, sheet)).toBe(false)
    expect(onSheet(a, sheet, 0.5)).toBe(false)
  })

  it('fills from the left end, then upward, keeping the gap', () => {
    const taken = [{ x: 0.5, y: 0.5, length: 18, width: 6 }]
    expect(findSpot(sheet, taken, { length: 18, width: 6 }, 0.5)).toEqual({ box: { x: 0.5, y: 7, length: 18, width: 6 }, turned: false })
  })

  it('turns a part a quarter turn when that fits further left', () => {
    const narrow = { length_in: 48, width_in: 10 }
    expect(findSpot(narrow, [], { length: 9, width: 30 }, 0.5)).toEqual({ box: { x: 0.5, y: 0.5, length: 30, width: 9 }, turned: true })
  })

  it("says when there's no room", () => {
    expect(findSpot({ length_in: 10, width_in: 10 }, [], { length: 12, width: 2 }, 0.25)).toBeNull()
    const full = [{ x: 0, y: 0, length: 48, width: 24 }]
    expect(findSpot(sheet, full, { length: 1, width: 1 }, 0.25)).toBeNull()
  })

  it('places several parts without them overlapping', () => {
    const spots = findSpots(sheet, [], Array.from({ length: 5 }, () => ({ length: 18, width: 6 })), 0.5)
    const boxes = spots.map((s) => s!.box)
    expect(spots.every(Boolean)).toBe(true)
    for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(overlaps(a, b, 0.5 - 1e-3)).toBe(false)
    // Three fit across the 24 in width, so the fourth starts a new column.
    expect(boxes[3].x).toBeGreaterThan(18)
  })

  it('finds the biggest clear piece left, for a remnant', () => {
    const taken = [{ x: 0.5, y: 0.5, length: 18, width: 6 }, { x: 0.5, y: 7, length: 18, width: 6 }]
    expect(biggestClearPiece(sheet, taken, 0.25)).toEqual({ x: 18.75, y: 0, length: 29.25, width: 24 })
    expect(biggestClearPiece(sheet, [], 0.25)).toEqual({ x: 0, y: 0, length: 48, width: 24 })
  })

  it('works out how much of a sheet is used', () => {
    expect(usedShare(sheet, [{ x: 0, y: 0, length: 24, width: 24 }])).toBe(0.5)
    expect(usedShare(sheet, [])).toBe(0)
  })
})

const plateShape: ShapeGeometry = {
  axis: 'z', low_in: 0, thickness_in: 0.25, width_in: 6, length_in: 18, outline: [[0, 0, 18, 0, 18, 6, 0, 6]],
  cut_length_in: 60, smallest_hole_in: null, tightest_inside_radius_in: null, sharp_inside_corners: 0, narrowest_gap_in: null, pockets: false,
}
const aluminum: StockGeometry = { kind: 'plate', thickness_in: 0.25, sheet_width_in: 24, sheet_length_in: 48, bit_in: 0.25, feed_ipm: 60, depth_per_pass_in: 0.0625 }

describe('router time', () => {
  it('goes round once per pass at the feed', () => {
    // 0.25 thick at 0.0625 a pass is 4 passes: 60 in × 4 / 60 in a minute.
    expect(routerMinutes(plateShape, aluminum)).toBe(4)
    expect(routerMinutes({ ...plateShape, thickness_in: 0.26 }, aluminum)).toBe(5)
  })

  it("can't say without a feed and depth", () => {
    expect(routerMinutes(plateShape, { ...aluminum, feed_ipm: null })).toBeNull()
    expect(routerMinutes({ ...plateShape, cut_length_in: 0 }, aluminum)).toBeNull()
  })

  it('reads the time the way people say it', () => {
    expect(minutesText(0.4)).toBe('under a minute')
    expect(minutesText(6.2)).toBe('about 6 min')
    expect(minutesText(80)).toBe('about 1 h 20 min')
    expect(minutesText(120)).toBe('about 2 h')
  })
})

describe('designChecks', () => {
  it('finds nothing wrong with a plain plate', () => {
    expect(designChecks(plateShape, aluminum)).toEqual([])
  })

  it('flags the wrong thickness, slots the bit cannot fit, and parts too big for a sheet', () => {
    const checks = designChecks({ ...plateShape, thickness_in: 0.125, narrowest_gap_in: 0.2, length_in: 50, width_in: 30 }, aluminum)
    expect(checks.map((c) => c.tone)).toEqual(['crit', 'crit', 'crit'])
    expect(checks[0].text).toContain('1/8 in thick')
    expect(checks[1].text).toContain('0.2 in wide')
    expect(checks[2].text).toContain('48 × 24 in')
  })

  it('warns about small holes, tight and sharp inside corners, and notes pockets', () => {
    const checks = designChecks({ ...plateShape, smallest_hole_in: 0.201, tightest_inside_radius_in: 0.0625, sharp_inside_corners: 1, pockets: true }, aluminum)
    expect(checks.map((c) => c.tone)).toEqual(['warn', 'warn', 'warn', 'plain'])
    expect(checks[1].text).toContain('leaves 1/8 in')
    expect(checks[2].text).toContain('1 sharp inside corner:')
  })

  it("checks a part fits on any of the stock's sheets, turned or not", () => {
    const big = { ...plateShape, length_in: 30, width_in: 20 }
    expect(designChecks(big, { ...aluminum, sheet_length_in: null, sheet_width_in: null }, [{ length_in: 24, width_in: 24 }]).map((c) => c.tone)).toEqual(['crit'])
    expect(designChecks(big, { ...aluminum, sheet_length_in: null, sheet_width_in: null }, [{ length_in: 20, width_in: 30 }])).toEqual([])
  })

  it('only checks plates, and says when there is no outline', () => {
    expect(designChecks({ ...plateShape, thickness_in: 1 }, { ...aluminum, kind: 'tube' })).toEqual([])
    expect(designChecks({ ...plateShape, outline: [] }, aluminum)[0].text).toContain("Couldn't find a flat outline")
  })
})

describe('matching parts to stock', () => {
  const stocks = [
    { id: 'al125', name: '1/8 in aluminum plate', material: '6061 aluminum', thickness_in: 0.125 },
    { id: 'al250', name: '1/4 in aluminum plate', material: '6061 aluminum', thickness_in: 0.25 },
    { id: 'pc125', name: '1/8 in polycarbonate plate', material: 'Polycarbonate', thickness_in: 0.125 },
    { id: 'pc250', name: '1/4 in polycarbonate plate', material: 'Polycarbonate', thickness_in: 0.25 },
    { id: 'tube', name: '2 x 1 in aluminum tube, 1/16 in wall', material: '6063 aluminum', thickness_in: 0.0625 },
  ]
  const guess = (material: string | null) => guessStock(material, stocks)?.id ?? null

  it('reads the words and sizes in a material', () => {
    expect([...materialWords('6061 Aluminium, 1/4" sheet')]).toEqual(['6061', 'aluminum', '0.25', 'plate'])
  })

  it("picks the stock from the part's material in the BOM", () => {
    expect(guess('6061 aluminum, 1/4 in plate')).toBe('al250')
    expect(guess('Polycarbonate, 1/8 in sheet')).toBe('pc125')
    expect(guess('2 x 1 in aluminum tube, 1/16 in wall')).toBe('tube')
    expect(guess('Lexan 0.25"')).toBe('pc250')
  })

  it("doesn't guess when it can't tell", () => {
    expect(guess('Aluminum')).toBeNull()
    expect(guess('Nylon 6/6 rod, 3/4 in')).toBeNull()
    expect(guess(null)).toBeNull()
  })
})

describe('stock from Onshape', () => {
  it('names just the material, however it is written', () => {
    expect(materialName('Aluminum - 6061')).toBe('aluminum')
    expect(materialName('6061 aluminum, 1/4 in plate')).toBe('aluminum')
    expect(materialName('Polycarbonate, 1/8 in sheet')).toBe('polycarbonate')
    expect(materialName('Carbon fiber')).toBe('carbon fiber')
    expect(materialName('6061')).toBeNull()
    expect(materialName(null)).toBeNull()
  })

  it("snaps Onshape's 3 decimal places back to the fraction they were drawn as", () => {
    expect(snapInches(0.188)).toBe(0.1875)
    expect(snapInches(0.063)).toBe(0.0625)
    expect(snapInches(0.25)).toBe(0.25)
    // 3 mm isn't a fraction of an inch: it stays as it is.
    expect(snapInches(0.118)).toBe(0.118)
  })

  it('tells plates from shafts, blocks and tubes', () => {
    const shape = (thickness: number, width: number) => ({ outline: [[0, 0, 1, 0, 1, 1]], thickness_in: thickness, width_in: width })
    expect(isPlate(shape(0.25, 6))).toBe(true)
    expect(isPlate(shape(0.5, 0.577))).toBe(false)
    expect(isPlate(shape(0.75, 2))).toBe(false)
    expect(isPlate(shape(1, 2))).toBe(false)
    expect(isPlate({ ...shape(0.25, 6), outline: [] })).toBe(false)
  })
})

describe('sheet IDs', () => {
  it("suggests a stock's code from its material and thickness", () => {
    expect(suggestCode('6061 aluminum', 0.25)).toBe('AL250')
    expect(suggestCode('Polycarbonate', 0.125)).toBe('PC125')
    expect(suggestCode('6063 aluminum', 0.0625)).toBe('AL063')
    expect(suggestCode('Baltic birch plywood', null)).toBe('PW')
    expect(suggestCode('Unobtainium', 0.5)).toBe('UN500')
  })

  it('numbers sheets one after the highest so far', () => {
    expect(nextLabel('AL250', ['AL250-001', 'AL250-007', 'AL125-009', 'AL250-X'])).toBe('AL250-008')
    expect(nextLabel('PC125', [])).toBe('PC125-001')
  })
})
