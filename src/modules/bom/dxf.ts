/**
 * A DXF file for the CNC router or laser (#24), made from a part's flat
 * outline: the outside, and its holes. The CNC module reads that outline
 * from Onshape once and keeps it (cnc_shapes), so making a DXF uses no
 * Onshape API calls of its own.
 *
 * Onshape sends curves as many short straight lines. A hole whose points all
 * sit on one circle is written as a real circle, so CAM can drill or bore it
 * as a hole. Everything else is written as a closed outline of straight
 * lines, close enough to the real curve to cut.
 *
 * The file is a plain DXF (the old R12 kind, which every CAM program reads)
 * in inches. Pockets (cuts that don't go all the way through) aren't in an
 * outline, so a part with pockets needs its STEP too.
 */

/** Loops of points in inches, each [x0, y0, x1, y1, ...]. The first is the outside; the others are holes. */
export type Loops = number[][]

/** A hole that's a circle: its center and radius, in inches. */
export interface Circle {
  x: number
  y: number
  r: number
}

/** How far a point can be from the circle and still count as on it, in inches. */
const ON_CIRCLE = 0.002

/** A loop with fewer points than this is a polygon, not a circle Onshape cut into pieces. */
const FEWEST_CIRCLE_POINTS = 8

/**
 * The circle a loop of points is, or null if it isn't one: every point the
 * same distance from their middle, give or take ON_CIRCLE.
 */
export function circleOf(loop: number[]): Circle | null {
  const n = loop.length / 2
  if (n < FEWEST_CIRCLE_POINTS) return null
  let x = 0
  let y = 0
  for (let i = 0; i < n; i += 1) {
    x += loop[2 * i]
    y += loop[2 * i + 1]
  }
  x /= n
  y /= n
  const distances = Array.from({ length: n }, (_, i) => Math.hypot(loop[2 * i] - x, loop[2 * i + 1] - y))
  const r = distances.reduce((a, b) => a + b, 0) / n
  if (r <= 0 || distances.some((d) => Math.abs(d - r) > ON_CIRCLE)) return null
  return { x, y, r }
}

/** A number as DXF writes it: up to 6 places, no extra zeros. */
const num = (n: number) => String(Math.round(n * 1e6) / 1e6)

/** DXF is pairs of lines: a code, then its value. */
const pairs = (...items: (string | number)[]) => items.map(String).join('\n')

/**
 * The text of a DXF file for a flat outline, in inches. The outside is
 * always an outline; holes that are circles are circles.
 */
export function outlineToDxf(loops: Loops): string {
  const entities: string[] = []
  loops.forEach((loop, i) => {
    const circle = i > 0 ? circleOf(loop) : null
    if (circle) {
      entities.push(pairs(0, 'CIRCLE', 8, 'HOLES', 10, num(circle.x), 20, num(circle.y), 30, 0, 40, num(circle.r)))
      return
    }
    // A closed POLYLINE (flag 1) with a VERTEX for each point, then SEQEND.
    const layer = i === 0 ? 'OUTSIDE' : 'HOLES'
    const vertices: string[] = []
    for (let p = 0; p < loop.length; p += 2) vertices.push(pairs(0, 'VERTEX', 8, layer, 10, num(loop[p]), 20, num(loop[p + 1]), 30, 0))
    entities.push(pairs(0, 'POLYLINE', 8, layer, 66, 1, 70, 1, ...vertices.flatMap((v) => v.split('\n')), 0, 'SEQEND', 8, layer))
  })
  return [
    // $INSUNITS 1 says inches to programs that read it; others ask on import.
    pairs(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 1, 0, 'ENDSEC'),
    pairs(0, 'SECTION', 2, 'ENTITIES'),
    ...entities,
    pairs(0, 'ENDSEC', 0, 'EOF'),
  ].join('\n') + '\n'
}
