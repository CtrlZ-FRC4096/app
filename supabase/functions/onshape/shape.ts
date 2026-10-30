/**
 * A part's shape for the CNC router, worked out from its edges in Onshape
 * (issues #55 and #56). Kept apart from index.ts so supabase/tests can test
 * it: plain TypeScript, no Deno.
 *
 * Onshape sends every edge of the part as a line of points. From those:
 *
 * - Size: the part's box. Its thinnest side is the thickness, and the other
 *   two are the width and length. So a plate drawn on any of the three main
 *   planes works.
 * - Outline: the edges on the bottom face, joined into loops. The biggest
 *   loop is the outside; the others are holes. These are what the router
 *   cuts all the way through.
 * - Cut length: how far the router travels around all the loops once.
 * - Design checks: the smallest round hole, the tightest inside corner and
 *   the narrowest slot, which the app compares with each stock's bit.
 *   Walking each loop with the part on the left, a turn to the right is an
 *   inside corner: the round bit can't make it sharper than its own radius.
 * - Edges that are neither on the bottom, the top, or straight up and down
 *   are pockets or steps, which the time estimate leaves out.
 *
 * Onshape works in meters; everything here is inches.
 */

/** A part's shape, as the app saves it in cnc_shapes. Sizes in inches. */
export interface OnshapeShape {
  /** Which Onshape part: document, tab, part and configuration. */
  onshape_id: string
  /** The part's version in Onshape when it was read, to tell when it changes. */
  microversion: string | null
  /** Which of the part's own axes is its thickness. */
  axis: 'x' | 'y' | 'z'
  /** Where the bottom face is along that axis. */
  low_in: number
  thickness_in: number
  /** The shorter side, then the longer. */
  width_in: number
  length_in: number
  /**
   * Loops of points on the bottom face, each [u0, v0, u1, v1, ...] in the
   * part's own coordinates (see PLANE). The first is the outside.
   */
  outline: number[][]
  cut_length_in: number
  /** The smallest round hole's diameter, or null if there are none. */
  smallest_hole_in: number | null
  /** The smallest radius of a rounded inside corner, or null if there are none. */
  tightest_inside_radius_in: number | null
  /** Inside corners with no rounding at all. */
  sharp_inside_corners: number
  /** The narrowest straight-sided slot or gap, or null if there are none. */
  narrowest_gap_in: number | null
  /** Pockets or steps that don't go all the way through. */
  pockets: boolean
}

export type Axis = OnshapeShape['axis']
type P3 = [number, number, number]
type P2 = [number, number]

const INCH = 0.0254
/** How close two points must be to count as the same, in inches. */
const TOL = 0.002
/** Turns sharper than this between two edges are corners, not smooth joins. */
const CORNER = (15 * Math.PI) / 180

/**
 * The two axes the outline is drawn on, for each thickness axis. They go
 * round in order (x, y, z, x, ...), so looking down the thickness axis,
 * counter-clockwise stays counter-clockwise.
 */
export const PLANE: Record<Axis, [number, number]> = { z: [0, 1], x: [1, 2], y: [2, 0] }
const AXES: Axis[] = ['x', 'y', 'z']

/** A 3D point in meters from Onshape, as [x, y, z] or { x, y, z }, in inches. */
function point(value: unknown): P3 | null {
  const v = value as Record<string, unknown> | unknown[] | null
  const xyz = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.x, v.y, v.z] : []
  if (xyz.length < 3 || !xyz.slice(0, 3).every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return [(xyz[0] as number) / INCH, (xyz[1] as number) / INCH, (xyz[2] as number) / INCH]
}

/**
 * Each part's edges in Onshape's tessellatededges answer, by part ID, each
 * edge a line of points in inches. Onshape has sent this both as a list of
 * bodies and as { bodies }, so both are read. A body with no ID is "".
 */
export function readBodies(answer: unknown): Map<string, P3[][]> {
  const a = answer as { bodies?: unknown } | unknown[] | null
  const bodies = Array.isArray(a) ? a : Array.isArray(a?.bodies) ? (a.bodies as unknown[]) : []
  const parts = new Map<string, P3[][]>()
  for (const body of bodies as { id?: unknown; edges?: unknown[] }[]) {
    const id = typeof body?.id === 'string' ? body.id : ''
    const edges = parts.get(id) ?? []
    for (const edge of (body?.edges ?? []) as { vertices?: unknown[] }[]) {
      const points = (edge?.vertices ?? []).map(point).filter((p): p is P3 => p !== null)
      if (points.length >= 2) edges.push(points)
    }
    parts.set(id, edges)
  }
  return parts
}

/** Every edge in a tessellatededges answer, whichever part it's on. */
export function readEdges(answer: unknown): P3[][] {
  return [...readBodies(answer).values()].flat()
}

const near = (a: P2, b: P2) => Math.abs(a[0] - b[0]) < TOL && Math.abs(a[1] - b[1]) < TOL
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]]
const cross = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0]
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1]
const size = (a: P2) => Math.hypot(a[0], a[1])
const round = (n: number) => Math.round(n * 1000) / 1000

/** A loop: its edges in order, each a line of points going the loop's way round. */
type Loop = P2[][]

/** A loop's points in order, each once: the last isn't the first again. */
function loopPoints(loop: Loop): P2[] {
  const points = loop.flatMap((edge, i) => (i === 0 ? edge : edge.slice(1))).filter((p, i, all) => i === 0 || !near(p, all[i - 1]))
  return points.length > 1 && near(points[0], points[points.length - 1]) ? points.slice(0, -1) : points
}

/** Twice the area inside a loop: more than 0 if it goes counter-clockwise. */
function area(points: P2[]): number {
  let total = 0
  for (let i = 0; i < points.length; i += 1) total += cross(points[i], points[(i + 1) % points.length])
  return total / 2
}

function length(points: P2[]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) total += size(sub(points[i], points[i - 1]))
  return total
}

const reverse = (loop: Loop): Loop => [...loop].reverse().map((edge) => [...edge].reverse())

/** Join edges end to end into closed loops. Edges that don't close a loop are left out. */
function joinLoops(edges: P2[][]): Loop[] {
  const loops: Loop[] = []
  const left = edges.filter((e) => length(e) > TOL)
  while (left.length) {
    const first = left.shift()!
    const loop: Loop = [first]
    const start = first[0]
    let end = first[first.length - 1]
    while (!near(start, end)) {
      const i = left.findIndex((e) => near(e[0], end) || near(e[e.length - 1], end))
      if (i < 0) break
      const [next] = left.splice(i, 1)
      const edge = near(next[0], end) ? next : [...next].reverse()
      loop.push(edge)
      end = edge[edge.length - 1]
    }
    if (near(start, end)) loops.push(loop)
  }
  return loops
}

/** The radius of the circle through three points, or Infinity if they're in a line. */
function radius(a: P2, b: P2, c: P2): number {
  const ab = size(sub(a, b))
  const bc = size(sub(b, c))
  const ca = size(sub(c, a))
  const twiceArea = Math.abs(cross(sub(b, a), sub(c, a)))
  return twiceArea < 1e-9 ? Infinity : (ab * bc * ca) / (2 * twiceArea)
}

/** How much a line of points turns, adding up each bend: less than 0 for right. */
function turning(points: P2[]): number {
  let total = 0
  for (let i = 2; i < points.length; i += 1) {
    const d1 = sub(points[i - 1], points[i - 2])
    const d2 = sub(points[i], points[i - 1])
    total += Math.atan2(cross(d1, d2), dot(d1, d2))
  }
  return total
}

/** Is the point inside the loop? (Counting crossings of a line out to the right.) */
function inside(p: P2, points: P2[]): boolean {
  let yes = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) yes = !yes
  }
  return yes
}

/** The design-check measurements for a set of loops, outside first and going counter-clockwise, holes clockwise. */
function measure(loops: Loop[]) {
  const outline = loops.map(loopPoints)
  const inMaterial = (p: P2) => inside(p, outline[0]) && !outline.slice(1).some((hole) => inside(p, hole))
  let smallestHole: number | null = null
  let tightest: number | null = null
  let sharp = 0
  const lines: { a: P2; b: P2 }[] = []

  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 1) {
      const edge = loop[i]
      // The corner where this edge meets the next one.
      const next = loop[(i + 1) % loop.length]
      const into = sub(edge[edge.length - 1], edge[edge.length - 2])
      const out = sub(next[1], next[0])
      if (loop.length > 1 && Math.atan2(cross(into, out), dot(into, out)) < -CORNER) sharp += 1

      if (edge.length === 2) {
        lines.push({ a: edge[0], b: edge[1] })
        continue
      }
      // A curved edge turning right is a rounded inside corner (or a round hole).
      if (turning(edge) >= 0) continue
      const closed = loop.length === 1 && near(edge[0], edge[edge.length - 1])
      const third = Math.floor(edge.length / 3)
      const r = closed ? radius(edge[0], edge[third], edge[2 * third]) : radius(edge[0], edge[Math.floor(edge.length / 2)], edge[edge.length - 1])
      if (!Number.isFinite(r)) continue
      if (closed) smallestHole = Math.min(smallestHole ?? Infinity, 2 * r)
      else tightest = Math.min(tightest ?? Infinity, r)
    }
  }

  // Slots: two straight edges facing each other, going opposite ways, with
  // nothing but air between them.
  let gap: number | null = null
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const { a, b } = lines[i]
      const { a: c, b: d } = lines[j]
      const along = sub(b, a)
      const span = size(along)
      const other = sub(d, c)
      if (dot(along, other) > -Math.cos((3 * Math.PI) / 180) * span * size(other)) continue
      const unit: P2 = [along[0] / span, along[1] / span]
      // The right of this edge is the air side; the other edge must be there.
      const right: P2 = [unit[1], -unit[0]]
      const distance = dot(sub(c, a), right)
      if (distance <= TOL) continue
      // Where the two edges overlap, looking along this one.
      const from = Math.max(0, Math.min(dot(sub(c, a), unit), dot(sub(d, a), unit)))
      const to = Math.min(span, Math.max(dot(sub(c, a), unit), dot(sub(d, a), unit)))
      if (to - from <= TOL) continue
      const middle = (from + to) / 2
      const between: P2 = [a[0] + unit[0] * middle + (right[0] * distance) / 2, a[1] + unit[1] * middle + (right[1] * distance) / 2]
      if (inMaterial(between)) continue
      gap = Math.min(gap ?? Infinity, distance)
    }
  }

  return {
    cut: outline.reduce((total, points) => total + length([...points, points[0]]), 0),
    smallestHole,
    tightest,
    sharp,
    gap,
  }
}

/** Keep a loop to a sensible number of points, so a detailed part still saves. */
function thin(points: P2[], most = 2000): P2[] {
  if (points.length <= most) return points
  const step = Math.ceil(points.length / most)
  return points.filter((_, i) => i % step === 0)
}

/**
 * A part's shape from its edges (in inches, from readEdges), or null if
 * Onshape sent no edges.
 */
export function shapeFromEdges(edges: P3[][], onshapeId: string, microversion: string | null): OnshapeShape | null {
  const all = edges.flat()
  if (all.length === 0) return null
  const low = [0, 1, 2].map((k) => Math.min(...all.map((p) => p[k])))
  const high = [0, 1, 2].map((k) => Math.max(...all.map((p) => p[k])))
  const extent = high.map((h, k) => h - low[k])
  // The thinnest side is the thickness. On a tie, z (a plate drawn on Top).
  const k = [2, 0, 1].reduce((best, k) => (extent[k] < extent[best] - TOL ? k : best), 2)
  const axis = AXES[k]
  const [u, v] = PLANE[axis]
  const sides = [extent[u], extent[v]].sort((a, b) => a - b)

  const bottom: P2[][] = []
  let pockets = false
  for (const edge of edges) {
    const flat = edge.map((p): P2 => [p[u], p[v]])
    if (edge.every((p) => Math.abs(p[k] - low[k]) < TOL)) bottom.push(flat)
    else if (edge.every((p) => Math.abs(p[k] - high[k]) < TOL)) continue
    else if (flat.every((p) => near(p, flat[0]))) continue // straight up and down
    else pockets = true
  }

  // The outside goes counter-clockwise and holes clockwise, so the part is always on the left.
  const loops = joinLoops(bottom).sort((a, b) => Math.abs(area(loopPoints(b))) - Math.abs(area(loopPoints(a))))
  const oriented = loops.map((loop, i) => {
    const ccw = area(loopPoints(loop)) > 0
    return (i === 0) === ccw ? loop : reverse(loop)
  })
  const m = oriented.length ? measure(oriented) : null

  return {
    onshape_id: onshapeId,
    microversion,
    axis,
    low_in: round(low[k]),
    thickness_in: round(extent[k]),
    width_in: round(sides[0]),
    length_in: round(sides[1]),
    outline: oriented.map((loop) => thin(loopPoints(loop)).flatMap(([x, y]) => [round(x), round(y)])),
    cut_length_in: round(m?.cut ?? 0),
    smallest_hole_in: m?.smallestHole == null ? null : round(m.smallestHole),
    tightest_inside_radius_in: m?.tightest == null ? null : round(m.tightest),
    sharp_inside_corners: m?.sharp ?? 0,
    narrowest_gap_in: m?.gap == null ? null : round(m.gap),
    pockets,
  }
}
