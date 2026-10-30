/**
 * The CNC module's measuring and fitting: sizes in inches, where a part from
 * an Onshape layout lands on its sheet, finding room for parts on a sheet,
 * the biggest piece left over, rough router times, and design checks.
 *
 * Nothing here reads or saves rows: data.ts does that, using these.
 *
 * A sheet lies with its long side along x ("length") and its short side
 * along y ("width"), measured from the corner that sits at Onshape's origin
 * in its layout. A box on a sheet is { x, y, length, width }: its corner,
 * then how far it runs along x and along y.
 */

/** Loops of points, each [x0, y0, x1, y1, ...]. The first is the outside; the others are holes. */
export type Loops = number[][]

/** A box on a sheet: its corner, how far it runs along the sheet's length (x), and across its width (y). */
export interface Box {
  x: number
  y: number
  length: number
  width: number
}

/** What geometry needs from a part's saved shape (a row of cnc_shapes). */
export interface ShapeGeometry {
  axis: 'x' | 'y' | 'z'
  low_in: number
  thickness_in: number
  width_in: number
  length_in: number
  outline: Loops
  cut_length_in: number
  smallest_hole_in: number | null
  tightest_inside_radius_in: number | null
  sharp_inside_corners: number
  narrowest_gap_in: number | null
  pockets: boolean
}

/** What geometry needs from a kind of stock (a row of cnc_stock). */
export interface StockGeometry {
  kind: 'plate' | 'tube' | 'bar' | 'other'
  thickness_in: number | null
  sheet_width_in: number | null
  sheet_length_in: number | null
  bit_in: number | null
  feed_ipm: number | null
  depth_per_pass_in: number | null
}

const round = (n: number) => Math.round(n * 1000) / 1000

// ---------------------------------------------------------------------------
// Inches, written and read the way the team does.

/**
 * Read a size someone typed: 0.25, .25, 1/4, 1 1/4, 1-1/4, 1/4", 1/4 in,
 * or millimeters like 6.35 mm. Null if it isn't a size.
 */
export function parseInches(text: string): number | null {
  // Keep enough places that 3/16 stays 0.1875, and reads back as 3/16.
  const round = (n: number) => Math.round(n * 1e6) / 1e6
  const t = text.trim().toLowerCase().replace(/(inches|inch|in\.?|")$/, '').trim()
  const mm = t.match(/^(\d+(?:\.\d+)?|\.\d+)\s*mm$/)
  if (mm) return round(Number(mm[1]) / 25.4)
  const m = t.match(/^(?:(\d+)[\s-]+)?(\d+)\/(\d+)$/)
  if (m) {
    const bottom = Number(m[3])
    return bottom ? round(Number(m[1] ?? 0) + Number(m[2]) / bottom) : null
  }
  if (/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return round(Number(t))
  return null
}

/** A size as people say it: 1/4 in, 1 1/2 in, 0.201 in. Fractions down to 1/64 when they're exact. */
export function inches(n: number): string {
  const whole = Math.floor(n + 1e-9)
  const sixtyFourths = Math.round((n - whole) * 64)
  if (Math.abs(n - whole - sixtyFourths / 64) < 0.0005) {
    if (sixtyFourths === 0) return `${whole} in`
    if (sixtyFourths === 64) return `${whole + 1} in`
    let top = sixtyFourths
    let bottom = 64
    while (top % 2 === 0) {
      top /= 2
      bottom /= 2
    }
    return `${whole ? `${whole} ` : ''}${top}/${bottom} in`
  }
  return `${Number(n.toFixed(3))} in`
}

/** Two sides, like "18 × 6 in". */
export function sizeText(length: number, width: number): string {
  return `${Number(length.toFixed(2))} × ${Number(width.toFixed(2))} in`
}

// ---------------------------------------------------------------------------
// Outlines and boxes.

/** The box round some loops. */
export function boundsOf(loops: Loops): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const loop of loops) {
    for (let i = 0; i + 1 < loop.length; i += 2) {
      minX = Math.min(minX, loop[i]); maxX = Math.max(maxX, loop[i])
      minY = Math.min(minY, loop[i + 1]); maxY = Math.max(maxY, loop[i + 1])
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY }
}

/** Move loops so their box's corner is at 0, 0. */
export function toCorner(loops: Loops): Loops {
  const b = boundsOf(loops)
  if (!b) return []
  return loops.map((loop) => loop.map((n, i) => round(n - (i % 2 ? b.minY : b.minX))))
}

/** Turn loops a quarter turn counter-clockwise, keeping their corner at 0, 0. */
export function quarterTurn(loops: Loops): Loops {
  return toCorner(loops.map((loop) => loop.flatMap((_, i) => (i % 2 ? [] : [-loop[i + 1], loop[i]]))))
}

/** A part's outline lying flat, long side along x, corner at 0, 0. */
export function flatOutline(shape: Pick<ShapeGeometry, 'outline'>): Loops {
  const loops = toCorner(shape.outline)
  const b = boundsOf(loops)
  return b && b.maxY > b.maxX ? quarterTurn(loops) : loops
}

/** An SVG path for loops, with y going up (SVG's goes down), on something `height` tall. */
export function svgPath(loops: Loops, dx = 0, dy = 0, height = 0): string {
  return loops
    .filter((loop) => loop.length >= 6)
    .map((loop) => {
      const points: string[] = []
      for (let i = 0; i + 1 < loop.length; i += 2) points.push(`${round(loop[i] + dx)} ${round(height - (loop[i + 1] + dy))}`)
      return `M${points.join('L')}Z`
    })
    .join('')
}

/** Where a part lands on a sheet from a layout. */
export interface Footprint {
  box: Box
  /** The outline, from the box's corner. */
  outline: Loops
  /** How far it's turned on the sheet, in degrees counter-clockwise. */
  rotation: number
  /** False if the part isn't lying flat on the layout's Top plane. */
  flat: boolean
}

// The two of the part's axes its outline is drawn on, for each thickness
// axis. The same as PLANE in supabase/functions/onshape/shape.ts.
const PLANE: Record<ShapeGeometry['axis'], [number, number]> = { z: [0, 1], x: [1, 2], y: [2, 0] }
const AXIS = { x: 0, y: 1, z: 2 }

/**
 * Where a part sits on its sheet, from its shape and how the layout moves
 * and turns it (16 numbers, a 4 x 4 matrix row by row, the move in inches).
 * The sheet is the layout's Top plane, with its corner at the origin.
 * Null if the part has no outline.
 */
export function footprint(shape: Pick<ShapeGeometry, 'axis' | 'low_in' | 'outline'>, t: number[]): Footprint | null {
  const k = AXIS[shape.axis]
  const [u, v] = PLANE[shape.axis]
  const placed = shape.outline.map((loop) => {
    const out: number[] = []
    for (let i = 0; i + 1 < loop.length; i += 2) {
      const p = [0, 0, 0]
      p[k] = shape.low_in
      p[u] = loop[i]
      p[v] = loop[i + 1]
      out.push(t[0] * p[0] + t[1] * p[1] + t[2] * p[2] + t[3], t[4] * p[0] + t[5] * p[1] + t[6] * p[2] + t[7])
    }
    return out
  })
  const b = boundsOf(placed)
  if (!b) return null
  const degrees = (Math.atan2(t[4 + u], t[u]) * 180) / Math.PI
  return {
    box: { x: round(b.minX), y: round(b.minY), length: round(b.maxX - b.minX), width: round(b.maxY - b.minY) },
    outline: toCorner(placed),
    rotation: Math.round(degrees * 10) / 10 || 0,
    flat: Math.abs(t[8 + k]) > 0.99,
  }
}

// ---------------------------------------------------------------------------
// Finding room on a sheet.

/** Do two boxes overlap, keeping `gap` between them? */
export function overlaps(a: Box, b: Box, gap = 0): boolean {
  return a.x < b.x + b.length + gap - 1e-6 && b.x < a.x + a.length + gap - 1e-6 && a.y < b.y + b.width + gap - 1e-6 && b.y < a.y + a.width + gap - 1e-6
}

/** Is the box on the sheet, at least `margin` from its edges? */
export function onSheet(box: Box, sheet: { length_in: number; width_in: number }, margin = 0): boolean {
  return box.x >= margin - 1e-6 && box.y >= margin - 1e-6 && box.x + box.length <= sheet.length_in - margin + 1e-6 && box.y + box.width <= sheet.width_in - margin + 1e-6
}

/** A spot found for a part: its box, and whether it's turned a quarter turn from lying long side along x. */
export interface Spot {
  box: Box
  turned: boolean
}

/**
 * The first spot a part fits on a sheet, keeping `gap` from what's already
 * taken and `margin` from the edges. It tries from the left end first (and
 * then from the bottom), so what's left over is one big piece at the right
 * end, easy to cut off as a remnant. The part can be turned a quarter turn.
 * Null if it doesn't fit.
 */
export function findSpot(
  sheet: { length_in: number; width_in: number },
  taken: Box[],
  part: { length: number; width: number },
  gap: number,
  margin = gap,
): Spot | null {
  const xs = [margin, ...taken.map((t) => t.x + t.length + gap)]
  const ys = [margin, ...taken.map((t) => t.y + t.width + gap)]
  let best: Spot | null = null
  for (const turned of [false, true]) {
    const length = turned ? part.width : part.length
    const width = turned ? part.length : part.width
    for (const x of xs) {
      if (best && x > best.box.x + 1e-6) continue
      for (const y of ys) {
        const box = { x: round(x), y: round(y), length, width }
        if (!onSheet(box, sheet, margin) || taken.some((t) => overlaps(box, t, gap))) continue
        if (!best || box.x < best.box.x - 1e-6 || (Math.abs(box.x - best.box.x) < 1e-6 && box.y < best.box.y - 1e-6)) best = { box, turned }
      }
    }
  }
  return best
}

/**
 * Spots for several parts in turn, each keeping clear of the ones before.
 * Returns a spot (or null, if it didn't fit) for each part, in order.
 */
export function findSpots(
  sheet: { length_in: number; width_in: number },
  taken: Box[],
  parts: { length: number; width: number }[],
  gap: number,
  margin = gap,
): (Spot | null)[] {
  const now = [...taken]
  return parts.map((part) => {
    const spot = findSpot(sheet, now, part, gap, margin)
    if (spot) now.push(spot.box)
    return spot
  })
}

/**
 * The biggest clear piece of a sheet, keeping `gap` from every cut: a
 * starting size for cutting off a remnant. Null if nothing is clear.
 */
export function biggestClearPiece(sheet: { length_in: number; width_in: number }, taken: Box[], gap: number): Box | null {
  // With many cuts, only the ones nearest the free end matter much, and
  // checking every combination gets slow.
  const cuts = taken.length > 30 ? [...taken].sort((a, b) => b.x + b.length - (a.x + a.length)).slice(0, 30) : taken
  const lefts = [0, ...cuts.map((t) => t.x + t.length + gap)].filter((x) => x < sheet.length_in)
  const rights = [sheet.length_in, ...cuts.map((t) => t.x - gap)].filter((x) => x > 0)
  const bottoms = [0, ...cuts.map((t) => t.y + t.width + gap)].filter((y) => y < sheet.width_in)
  const tops = [sheet.width_in, ...cuts.map((t) => t.y - gap)].filter((y) => y > 0)
  let best: Box | null = null
  for (const x1 of lefts) {
    for (const x2 of rights) {
      if (x2 <= x1) continue
      for (const y1 of bottoms) {
        for (const y2 of tops) {
          if (y2 <= y1) continue
          const area = (x2 - x1) * (y2 - y1)
          if (best && area <= best.length * best.width) continue
          const box = { x: round(x1), y: round(y1), length: round(x2 - x1), width: round(y2 - y1) }
          if (!taken.some((t) => overlaps(box, t))) best = box
        }
      }
    }
  }
  return best
}

/** How much of a sheet the cuts' boxes cover, from 0 to 1. */
export function usedShare(sheet: { length_in: number; width_in: number }, taken: Box[]): number {
  const area = sheet.length_in * sheet.width_in
  if (area <= 0) return 0
  return Math.min(1, taken.reduce((total, t) => total + t.length * t.width, 0) / area)
}

// ---------------------------------------------------------------------------
// Router time and design checks.

/**
 * Roughly how many minutes the router takes for one part: around every
 * loop, once per pass, at the stock's feed. It leaves out pockets, moving
 * between cuts and tool changes, so treat it as a lower bound. Null if the
 * stock has no feed or depth per pass yet.
 */
export function routerMinutes(shape: Pick<ShapeGeometry, 'cut_length_in' | 'thickness_in'>, stock: Pick<StockGeometry, 'feed_ipm' | 'depth_per_pass_in'>): number | null {
  if (!stock.feed_ipm || !stock.depth_per_pass_in || shape.cut_length_in <= 0) return null
  const passes = Math.max(1, Math.ceil(shape.thickness_in / stock.depth_per_pass_in - 1e-6))
  return (shape.cut_length_in * passes) / stock.feed_ipm
}

/** Like "about 6 min", "about 1 h 20 min" or "under a minute". */
export function minutesText(minutes: number): string {
  if (minutes < 1) return 'under a minute'
  const whole = Math.round(minutes)
  if (whole < 60) return `about ${whole} min`
  return `about ${Math.floor(whole / 60)} h${whole % 60 ? ` ${whole % 60} min` : ''}`
}

export interface Check {
  /** crit: it can't be cut as drawn. warn: it can, but check. plain: good to know. */
  tone: 'crit' | 'warn' | 'plain'
  text: string
}

/**
 * Design checks for cutting a part from a kind of plate on the router:
 * the right thickness, small holes and slots the bit can't fit in, inside
 * corners the bit leaves rounded, and whether it fits on a sheet.
 * `sheets` are the sizes of the sheets of that stock on the rack.
 */
export function designChecks(shape: ShapeGeometry, stock: StockGeometry, sheets: { length_in: number; width_in: number }[] = []): Check[] {
  if (stock.kind !== 'plate') return []
  const checks: Check[] = []
  if (shape.outline.length === 0) {
    checks.push({ tone: 'warn', text: "Couldn't find a flat outline. Is the part a flat plate, drawn on one of the three main planes in Onshape?" })
  }
  if (stock.thickness_in && Math.abs(shape.thickness_in - stock.thickness_in) > 0.005) {
    checks.push({ tone: 'crit', text: `The part is ${inches(shape.thickness_in)} thick, but this stock is ${inches(stock.thickness_in)}.` })
  }

  const bit = stock.bit_in
  if (bit) {
    if (shape.narrowest_gap_in !== null && shape.narrowest_gap_in < bit - 0.001) {
      checks.push({ tone: 'crit', text: `A slot or gap ${inches(shape.narrowest_gap_in)} wide is narrower than the ${inches(bit)} bit, so it can't be cut.` })
    }
    if (shape.smallest_hole_in !== null && shape.smallest_hole_in < bit - 0.001) {
      checks.push({ tone: 'warn', text: `Holes as small as ${inches(shape.smallest_hole_in)} are smaller than the ${inches(bit)} bit. Drill them, or spot them on the router and drill after.` })
    }
    if (shape.tightest_inside_radius_in !== null && shape.tightest_inside_radius_in < bit / 2 - 0.001) {
      checks.push({ tone: 'warn', text: `Rounded inside corners as tight as ${inches(shape.tightest_inside_radius_in)} radius: the ${inches(bit)} bit leaves ${inches(bit / 2)}.` })
    }
    if (shape.sharp_inside_corners > 0) {
      const n = shape.sharp_inside_corners
      checks.push({ tone: 'warn', text: `${n} sharp inside ${n === 1 ? 'corner' : 'corners'}: the bit leaves ${n === 1 ? 'it' : 'them'} rounded to ${inches(bit / 2)}. Add dogbones where another part has to fit in.` })
    }
  }

  const full = stock.sheet_length_in && stock.sheet_width_in ? [{ length_in: stock.sheet_length_in, width_in: stock.sheet_width_in }] : []
  const sizes = [...full, ...sheets]
  const fits = (s: { length_in: number; width_in: number }) =>
    (shape.length_in <= s.length_in && shape.width_in <= s.width_in) || (shape.length_in <= s.width_in && shape.width_in <= s.length_in)
  if (sizes.length && !sizes.some(fits)) {
    const biggest = [...sizes].sort((a, b) => b.length_in * b.width_in - a.length_in * a.width_in)[0]
    checks.push({ tone: 'crit', text: `At ${sizeText(shape.length_in, shape.width_in)}, it won't fit on a ${sizeText(biggest.length_in, biggest.width_in)} sheet.` })
  }
  if (shape.pockets) checks.push({ tone: 'plain', text: "Has pockets or steps that don't go all the way through. The time estimate only counts the through cuts." })
  return checks
}

// ---------------------------------------------------------------------------
// Matching parts to stock, and naming sheets.

const SAME_WORD: Record<string, string> = { aluminium: 'aluminum', al: 'aluminum', alu: 'aluminum', poly: 'polycarbonate', pc: 'polycarbonate', lexan: 'polycarbonate', sheet: 'plate', tubing: 'tube', rod: 'bar' }
const NOT_WORDS = new Set(['in', 'inch', 'x', 'thick', 'wall', 'and', 'with', 'of'])

/** The words and sizes in a material, like "6061 aluminum, 1/4 in plate" → 6061, aluminum, 0.25, plate. */
export function materialWords(text: string): Set<string> {
  const words = new Set<string>()
  const t = text.toLowerCase().replace(/(\d)\s*"/g, '$1 ').replace(/(\d)(in|mm)\b/g, '$1 $2')
  for (const m of t.matchAll(/(\d+[\s-]+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+|[a-z]+)/g)) {
    const word = m[1]
    if (/\d/.test(word)) {
      const n = parseInches(word)
      if (n !== null) words.add(String(n))
    } else if (!NOT_WORDS.has(word)) {
      words.add(SAME_WORD[word] ?? word)
    }
  }
  return words
}

/**
 * The stock a part is most likely cut from, going by its material in the
 * BOM: the one sharing the most words and sizes. Null if none share at
 * least two, or two share the same most.
 */
export function guessStock<S extends { id: string; name: string; material: string; thickness_in: number | null }>(material: string | null, stocks: S[]): S | null {
  if (!material) return null
  const wanted = materialWords(material)
  const scored = stocks
    .map((stock) => {
      const has = materialWords(`${stock.name} ${stock.material} ${stock.thickness_in ?? ''}`)
      return { stock, score: [...wanted].filter((w) => has.has(w)).length }
    })
    .sort((a, b) => b.score - a.score)
  const [first, second] = scored
  if (!first || first.score < 2 || (second && second.score === first.score)) return null
  return first.stock
}

const CODE_START: [RegExp, string][] = [
  [/alumin/, 'AL'], [/poly ?carb|lexan|\bpc\b/, 'PC'], [/steel/, 'ST'], [/delrin|acetal|pom/, 'DL'], [/hdpe|polyethylene/, 'HD'],
  [/carbon/, 'CF'], [/g10|fr4|garolite/, 'GL'], [/ply|wood|birch/, 'PW'], [/acrylic/, 'AC'], [/nylon/, 'NY'], [/abs/, 'AB'],
]

/** A short code for a stock's sheet IDs: AL250 for 1/4 in aluminum, PC125 for 1/8 in polycarbonate. */
export function suggestCode(material: string, thickness: number | null): string {
  const m = material.toLowerCase()
  const start = CODE_START.find(([pattern]) => pattern.test(m))?.[1] ?? (m.replace(/[^a-z]/g, '').slice(0, 2).toUpperCase() || 'ST')
  if (!thickness) return start
  const thousandths = Math.round(thickness * 1000)
  return `${start}${thousandths < 100 ? String(thousandths).padStart(3, '0') : thousandths}`.slice(0, 8)
}

/** The next sheet ID for a stock: AL250-008 after AL250-007. */
export function nextLabel(code: string, labels: string[]): string {
  const start = `${code}-`
  const used = labels.filter((l) => l.startsWith(start)).map((l) => Number(l.slice(start.length))).filter(Number.isInteger)
  return `${start}${String(Math.max(0, ...used) + 1).padStart(3, '0')}`
}
