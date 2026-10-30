// Tests for the onshape server function's CNC requests: parts' shapes
// (supabase/functions/onshape/shape.ts) and where parts sit in a sheet's
// layout assembly (layoutPlacements in onshape.ts). The sample answers have
// the shape of Onshape's, cut down to what we read. Onshape works in meters.
import { describe, expect, it } from 'vitest'
import { layoutPlacements, MOST_SHAPES, onshapeRequest, partVersions, paths, shapeAsk } from '../functions/onshape/onshape.ts'
import { readEdges, shapeFromEdges } from '../functions/onshape/shape.ts'

const D = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const W = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const E = 'cccccccccccccccccccccccc'
const URL = `https://cad.onshape.com/documents/${D}/w/${W}/e/${E}`
const link = { documentId: D, wvm: 'w' as const, wvmId: W, elementId: E }

// ---------------------------------------------------------------------------
// Building sample parts, in inches, turned into Onshape's answer in meters.

type P = [number, number, number]
const m = (p: P) => p.map((n) => n * 0.0254)

/** Points round part of a circle, from angle a to b (degrees), at height z. */
function arc(cx: number, cy: number, r: number, a: number, b: number, z: number, n = 12): P[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = ((a + ((b - a) * i) / n) * Math.PI) / 180
    return [cx + r * Math.cos(t), cy + r * Math.sin(t), z]
  })
}

/** A flat part: its outline loops (each a list of edges) on the bottom and top, joined by upright edges at each corner. */
function plate(loops: P[][][], thickness: number): P[][] {
  const edges: P[][] = []
  for (const loop of loops) {
    for (const edge of loop) {
      edges.push(edge)
      edges.push(edge.map(([x, y]) => [x, y, thickness]))
      const [x, y] = edge[0]
      if (edge.length === 2 || loop.length > 1) edges.push([[x, y, 0], [x, y, thickness]])
    }
  }
  return edges
}

/** Straight edges between the corners, going round. */
function polygon(corners: [number, number][]): P[][] {
  return corners.map(([x, y], i) => {
    const [nx, ny] = corners[(i + 1) % corners.length]
    return [[x, y, 0], [nx, ny, 0]]
  })
}

const answer = (edges: P[][]) => [{ id: 'JHD', edges: edges.map((e, i) => ({ id: `E${i}`, vertices: e.map(m) })) }]
const shapeOf = (edges: P[][]) => shapeFromEdges(readEdges(answer(edges)), `${D}/${E}/JHD`, 'mv1')!

describe('readEdges', () => {
  it("reads edges as lists of bodies or { bodies }, with points as [x, y, z] or { x, y, z }, in inches", () => {
    const vertices = [[0, 0, 0], [0.0254, 0, 0]]
    expect(readEdges([{ edges: [{ vertices }] }])).toEqual([[[0, 0, 0], [1, 0, 0]]])
    expect(readEdges({ bodies: [{ edges: [{ vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0.0508, z: 0 }] }] }] })).toEqual([[[0, 0, 0], [0, 2, 0]]])
  })

  it('skips what it cannot read', () => {
    expect(readEdges(null)).toEqual([])
    expect(readEdges([{ edges: [{ vertices: [[0, 0, 0]] }, { vertices: [['a', 0, 0], [1, 1, 1]] }] }])).toEqual([])
  })
})

describe('shapeFromEdges', () => {
  // An 18 x 6 in plate, 1/4 in thick, with a #7 hole (0.201 in) and a sharp-cornered 0.2 x 2 in slot.
  const hole = [arc(3, 3, 0.1005, 0, 360, 0, 24)]
  const slot = polygon([[9, 2.9], [11, 2.9], [11, 3.1], [9, 3.1]])
  const sidePlate = plate([polygon([[0, 0], [18, 0], [18, 6], [0, 6]]), hole, slot], 0.25)

  it('measures a plate: thickness, width and length', () => {
    const shape = shapeOf(sidePlate)
    expect(shape).toMatchObject({ onshape_id: `${D}/${E}/JHD`, microversion: 'mv1', axis: 'z', low_in: 0, thickness_in: 0.25, width_in: 6, length_in: 18, pockets: false })
  })

  it('finds the outline: the outside first, then the holes', () => {
    const shape = shapeOf(sidePlate)
    expect(shape.outline).toHaveLength(3)
    // The outside goes counter-clockwise from where it started.
    expect(shape.outline[0]).toEqual([0, 0, 18, 0, 18, 6, 0, 6])
  })

  it('adds up how far the router goes round every loop', () => {
    const around = 2 * (18 + 6) + 2 * (2 + 0.2)
    const circle = 2 * Math.PI * 0.1005
    expect(shapeOf(sidePlate).cut_length_in).toBeCloseTo(around + circle, 1)
  })

  it('finds the smallest hole, the sharp inside corners and the narrowest slot', () => {
    const shape = shapeOf(sidePlate)
    expect(shape.smallest_hole_in).toBeCloseTo(0.201, 3)
    // The slot's four corners: a round bit leaves them rounded.
    expect(shape.sharp_inside_corners).toBe(4)
    expect(shape.narrowest_gap_in).toBeCloseTo(0.2, 3)
    expect(shape.tightest_inside_radius_in).toBeNull()
  })

  it("doesn't count outside corners, or the part's own width, as problems", () => {
    const shape = shapeOf(plate([polygon([[0, 0], [10, 0], [10, 4], [0, 4]])], 0.125))
    expect(shape).toMatchObject({ sharp_inside_corners: 0, narrowest_gap_in: null, smallest_hole_in: null, tightest_inside_radius_in: null })
  })

  it('finds a rounded inside corner and how tight it is', () => {
    // An L shape whose inside corner is rounded with a 0.1 in radius.
    const L: P[][] = [
      [[0, 0, 0], [6, 0, 0]],
      [[6, 0, 0], [6, 2, 0]],
      [[6, 2, 0], [2.1, 2, 0]],
      arc(2.1, 2.1, 0.1, 270, 180, 0),
      [[2, 2.1, 0], [2, 6, 0]],
      [[2, 6, 0], [0, 6, 0]],
      [[0, 6, 0], [0, 0, 0]],
    ]
    const shape = shapeOf(plate([L], 0.25))
    expect(shape.tightest_inside_radius_in).toBeCloseTo(0.1, 3)
    expect(shape.sharp_inside_corners).toBe(0)
  })

  it('counts a sharp inside corner, and finds a slot open on one side', () => {
    // A U shape: a 0.5 in channel cut into a 3 x 4 in block.
    const U = polygon([[0, 0], [3, 0], [3, 4], [1.75, 4], [1.75, 1], [1.25, 1], [1.25, 4], [0, 4]])
    const shape = shapeOf(plate([U], 0.25))
    expect(shape.sharp_inside_corners).toBe(2)
    expect(shape.narrowest_gap_in).toBeCloseTo(0.5, 3)
  })

  it('works for a plate drawn on the Front plane, and notices pockets', () => {
    // The same 18 x 6 plate standing up: its thickness is along y.
    const standing = plate([polygon([[0, 0], [18, 0], [18, 6], [0, 6]])], 0.25).map((e) => e.map(([x, y, z]): P => [x, z, y]))
    // A pocket's floor, part way through.
    standing.push([[2, 0.1, 2], [4, 0.1, 2]])
    const shape = shapeOf(standing)
    expect(shape).toMatchObject({ axis: 'y', thickness_in: 0.25, width_in: 6, length_in: 18, pockets: true })
    expect(shape.outline).toHaveLength(1)
  })

  it('has no outline for edges that never close into a loop, and nothing for no edges', () => {
    expect(shapeOf([[[0, 0, 0], [5, 0, 0]], [[0, 0, 1], [0, 3, 1]]]).outline).toEqual([])
    expect(shapeFromEdges([], 'x', null)).toBeNull()
  })
})

describe('shapes requests', () => {
  it('asks for parts in the linked Part Studio, with their versions', () => {
    expect(onshapeRequest({ kind: 'shapes', url: URL, parts: [{ id: `${D}/${E}/JHD`, known: 'mv1' }, { id: `${D}/${E}/JKD?size=2` }] })).toEqual({
      kind: 'shapes',
      link,
      parts: [
        { onshape_id: `${D}/${E}/JHD`, partId: 'JHD', configuration: null, known: 'mv1' },
        { onshape_id: `${D}/${E}/JKD?size=2`, partId: 'JKD', configuration: 'size=2', known: null },
      ],
    })
  })

  it('refuses parts from another tab, too many parts, or none', () => {
    expect(onshapeRequest({ kind: 'shapes', url: URL, parts: [{ id: `${D}/${'d'.repeat(24)}/JHD` }] })).toHaveProperty('error')
    expect(onshapeRequest({ kind: 'shapes', url: URL, parts: [{ id: `${D}/${E}/../x` }] })).toHaveProperty('error')
    expect(onshapeRequest({ kind: 'shapes', url: URL, parts: [] })).toHaveProperty('error')
    const many = Array.from({ length: MOST_SHAPES + 1 }, (_, i) => ({ id: `${D}/${E}/J${i}D` }))
    expect(onshapeRequest({ kind: 'shapes', url: URL, parts: many })).toHaveProperty('error')
    expect(onshapeRequest({ kind: 'shapes', url: 'https://example.com', parts: [{ id: `${D}/${E}/JHD` }] })).toHaveProperty('error')
  })

  it("asks Onshape for a part's edges, with its configuration", () => {
    expect(paths.edges(link, { partId: 'JHD', configuration: null })).toBe(`/api/v6/parts/d/${D}/w/${W}/e/${E}/partid/JHD/tessellatededges`)
    expect(paths.edges(link, shapeAsk(`${D}/${E}/JKD?size=2 in`, link)!)).toBe(`/api/v6/parts/d/${D}/w/${W}/e/${E}/partid/JKD/tessellatededges?configuration=size%3D2%20in`)
  })

  it("reads each part's version from the Part Studio's parts", () => {
    expect(partVersions([{ partId: 'JHD', microversionId: 'mv1' }, { partId: 'JKD' }, { name: 'no id' }])).toEqual(new Map([['JHD', 'mv1'], ['JKD', '']]))
    expect(partVersions(null)).toEqual(new Map())
  })
})

describe('layout requests', () => {
  it('asks for an assembly from a link', () => {
    expect(onshapeRequest({ kind: 'layout', url: URL })).toEqual({ kind: 'layout', link })
    expect(paths.assembly(link)).toBe(`/api/v6/assemblies/d/${D}/w/${W}/e/${E}?excludeSuppressed=true`)
  })

  // Moved 2 in along x and 1 in along y; then the same, turned a quarter turn.
  const at = (x: number, y: number) => [1, 0, 0, x * 0.0254, 0, 1, 0, y * 0.0254, 0, 0, 1, 0, 0, 0, 0, 1]
  const turned = (x: number, y: number) => [0, -1, 0, x * 0.0254, 1, 0, 0, y * 0.0254, 0, 0, 1, 0, 0, 0, 0, 1]
  const part = (id: string, name: string, partId: string, more = {}) => ({ id, name, type: 'Part', documentId: D, elementId: E, partId, configuration: 'default', ...more })
  const definition = {
    rootAssembly: {
      instances: [
        part('I1', 'Sheet', 'JSD'),
        part('I2', 'Side plate <1>', 'JHD'),
        part('I3', 'Side plate <2>', 'JHD'),
        part('I4', 'Gusset', 'JKD', { configuration: 'size=2' }),
        part('I5', 'Hidden plate', 'JLD'),
        part('I6', 'Screw', 'JMD', { isStandardContent: true }),
        { id: 'A1', name: 'Bracket set', type: 'Assembly', documentId: D, elementId: 'e'.repeat(24), configuration: 'default' },
      ],
      occurrences: [
        { path: ['I1'], transform: at(0, 0) },
        { path: ['I2'], transform: at(1, 1) },
        { path: ['I3'], transform: turned(10, 1) },
        { path: ['I4'], transform: at(20, 3) },
        { path: ['I5'], transform: at(30, 3), hidden: true },
        { path: ['I6'], transform: at(1, 1) },
        { path: ['A1'], transform: at(40, 0) },
        { path: ['A1', 'S1'], transform: at(41, 2) },
        { path: ['I9'], transform: at(0, 0) },
      ],
    },
    subAssemblies: [{ documentId: D, elementId: 'e'.repeat(24), configuration: 'default', instances: [part('S1', 'Bracket', 'JND')] }],
  }

  it('lists every part with where it sits, moves in inches', () => {
    const placements = layoutPlacements(definition)
    expect(placements.map((p) => [p.onshape_id, p.name])).toEqual([
      [`${D}/${E}/JSD`, 'Sheet'],
      [`${D}/${E}/JHD`, 'Side plate <1>'],
      [`${D}/${E}/JHD`, 'Side plate <2>'],
      [`${D}/${E}/JKD?size=2`, 'Gusset'],
      [`${D}/${E}/JND`, 'Bracket'],
    ])
    const [, first, second] = placements
    expect(first.transform[3]).toBeCloseTo(1)
    expect(first.transform[7]).toBeCloseTo(1)
    expect(second.transform.slice(0, 2)).toEqual([0, -1])
    expect(second.transform[3]).toBeCloseTo(10)
  })

  it('copes with an empty or broken answer', () => {
    expect(layoutPlacements(null)).toEqual([])
    expect(layoutPlacements({ rootAssembly: { instances: [part('I1', 'Plate', 'JHD')], occurrences: [{ path: ['I1'], transform: [1, 2, 3] }] } })).toEqual([])
  })
})
