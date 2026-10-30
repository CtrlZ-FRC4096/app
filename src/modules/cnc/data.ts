/**
 * CNC module data (issues #54, #55 and #56): what needs cutting on the
 * router, the stock it's cut from, the sheets on the rack, and where every
 * part came out of each sheet, so each sheet has a digital twin.
 *
 *   stockTable   Kinds of stock, like "1/4 in aluminum plate", with router
 *                settings. Mentors manage these.
 *   jobsTable    The CNC board: parts from the BOM to cut, how many, and
 *                To cut → Cutting → Cut. Anyone adds and moves them.
 *   shapesTable  Each part's size and outline, read from Onshape and kept,
 *                so the team's yearly Onshape API calls aren't spent twice.
 *   sheetsTable  The real sheets, each with an ID like AL250-007.
 *   cutsTable    Where parts were cut (or are planned) on each sheet.
 *
 * Shapes and layouts come from Onshape through the `onshape` server
 * function (supabase/functions/onshape/), which holds the team's keys.
 * geometry.ts does the measuring and fitting. The tables are made by
 * supabase/migrations/..._cnc.sql, which also has who can do what.
 */
import { callFunction } from '../../core/functions'
import { createTable, fail, ok, type Fields, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'
import { isMentor } from '../../core/roles'
import { currentUser } from '../../core/session'
import { isLive } from '../../core/supabase'
import { plural } from '../../core/format'
import type { Notice } from '../../core/registry'
import { isOnshapeLink, partsTable, systemsTable, type BomSystem, type Part } from '../bom/data'
import {
  findSpots, flatOutline, footprint, guessStock, inches, nextLabel, onSheet, parseInches, quarterTurn, sizeText,
  type Box, type Loops, type ShapeGeometry, type Spot, type StockGeometry,
} from './geometry'

// ---------------------------------------------------------------------------
// The rows.

export type StockKind = 'plate' | 'tube' | 'bar' | 'other'

/** One row of cnc_stock: a kind of stock, like "1/4 in aluminum plate". Sizes in inches. */
export interface Stock extends Row, StockGeometry {
  kind: StockKind
  name: string
  /** The start of each sheet's ID: AL250 in AL250-007. */
  code: string
  material: string
  /** A plate's thickness, or a tube's wall. */
  thickness_in: number | null
  /** A full sheet's size when bought. */
  sheet_width_in: number | null
  sheet_length_in: number | null
  /** Router settings: bit diameter, feed in inches a minute, and how deep each pass goes. */
  bit_in: number | null
  feed_ipm: number | null
  depth_per_pass_in: number | null
  created_by: string | null
}

export type JobStatus = 'to_cut' | 'cutting' | 'cut'

/** One row of cnc_jobs: a part on the CNC board. */
export interface Job extends Row {
  part_id: string
  stock_id: string | null
  quantity: number
  status: JobStatus
  note: string | null
  /** When the status last changed, and who changed it. The database fills these in. */
  status_at: string
  status_by: string | null
  created_by: string | null
}

/** One row of cnc_shapes: a part's shape, read from Onshape. See supabase/functions/onshape/shape.ts. */
export interface Shape extends Row, ShapeGeometry {
  part_id: string
  onshape_id: string
  /** The part's version in Onshape when it was read. */
  microversion: string | null
  read_at: string
  read_by: string | null
  created_by: string | null
}

export type SheetStatus = 'new' | 'partly_used' | 'scrap'

/** One row of cnc_sheets: a real sheet on the rack. Length runs along x, width along y. */
export interface Sheet extends Row {
  label: string
  stock_id: string
  width_in: number
  length_in: number
  location: string | null
  status: SheetStatus
  /** An Onshape assembly with parts laid out on the sheet, to read cuts from. */
  onshape_url: string | null
  /** The sheet this one was cut from, for a leftover piece. */
  parent_id: string | null
  note: string | null
  layout_read_at: string | null
  created_by: string | null
}

export type CutStatus = 'planned' | 'cut'

/** One row of cnc_sheet_cuts: where a part was cut (or is planned) on a sheet. */
export interface Cut extends Row {
  sheet_id: string
  job_id: string | null
  part_id: string | null
  /** The part's name when it was cut. */
  name: string
  /** The corner of the part's box, from the sheet's corner. */
  x_in: number
  y_in: number
  /** How far the box runs across the sheet's width (y), and along its length (x). */
  width_in: number
  length_in: number
  rotation_deg: number
  /** The part's outline from the box's corner, if it's known. */
  outline: Loops | null
  source: 'onshape' | 'manual'
  status: CutStatus
  /** When it was cut, and by whom. The database fills these in. */
  cut_at: string | null
  cut_by: string | null
  created_by: string | null
}

export const STATUS_LABEL: Record<JobStatus, string> = { to_cut: 'To cut', cutting: 'Cutting', cut: 'Cut' }
export const STATUS_TONE = { to_cut: 'plain', cutting: 'warn', cut: 'ok' } as const
export const SHEET_STATUS_LABEL: Record<SheetStatus, string> = { new: 'New', partly_used: 'Partly used', scrap: 'Scrap' }
export const SHEET_STATUS_TONE = { new: 'info', partly_used: 'plain', scrap: 'warn' } as const
export const STOCK_KINDS: StockKind[] = ['plate', 'tube', 'bar', 'other']
export const KIND_LABEL: Record<StockKind, string> = { plate: 'Plate', tube: 'Tube', bar: 'Bar', other: 'Other' }

/** How far apart parts go on a sheet, and from its edges, in inches. */
export const EDGE_MARGIN = 0.5
export function spacing(stock: Pick<Stock, 'bit_in'> | undefined): number {
  return Math.max(0.25, 2 * (stock?.bit_in ?? 0.125))
}

// ---------------------------------------------------------------------------
// Example data, made up. The BOM's example parts are what's being cut.

const demoPart = (number: string) => partsTable.demoRows.find((p) => p.part_number === number)!
const SIDE_PLATE = demoPart('4096-26-INT-001')
const BELLYPAN = demoPart('4096-26-DRV-001')
const FRAME_RAIL = demoPart('4096-26-DRV-002')

const id = (n: string) => `00000000-0000-4000-8000-0000000c${n}`
const STOCK = { al125: id('0001'), al250: id('0002'), pc125: id('0003'), pc250: id('0004'), tube: id('0005') }
const JOB = { done: id('1001'), spare: id('1002'), bellypan: id('1003'), rails: id('1004') }
const SHEET = { al250a: id('3001'), al250b: id('3002'), al125a: id('3003'), al125b: id('3004'), pc125: id('3005') }
const AT = (day: string, time = '22:00:00') => `2026-10-${day}T${time}Z`

const stock = (key: keyof typeof STOCK, fields: Omit<Stock, 'id' | 'created_at' | 'created_by'>): Stock => ({ id: STOCK[key], ...fields, created_at: AT('20'), created_by: DEMO_PEOPLE.pat })
const plate = (name: string, code: string, material: string, thickness: number, bit: number, feed: number, depth: number) =>
  ({ kind: 'plate' as const, name, code, material, thickness_in: thickness, sheet_width_in: 24, sheet_length_in: 48, bit_in: bit, feed_ipm: feed, depth_per_pass_in: depth })

const EXAMPLE_STOCK: Stock[] = [
  stock('al125', plate('1/8 in aluminum plate', 'AL125', '6061 aluminum', 0.125, 0.125, 40, 0.03)),
  stock('al250', plate('1/4 in aluminum plate', 'AL250', '6061 aluminum', 0.25, 0.25, 60, 0.06)),
  stock('pc125', plate('1/8 in polycarbonate plate', 'PC125', 'Polycarbonate', 0.125, 0.125, 120, 0.125)),
  stock('pc250', plate('1/4 in polycarbonate plate', 'PC250', 'Polycarbonate', 0.25, 0.25, 100, 0.125)),
  stock('tube', {
    kind: 'tube', name: '2 x 1 in aluminum tube, 1/16 in wall', code: 'AT2X1', material: '6063 aluminum', thickness_in: 0.0625,
    sheet_width_in: null, sheet_length_in: null, bit_in: 0.125, feed_ipm: 40, depth_per_pass_in: 0.0625,
  }),
]

const job = (key: keyof typeof JOB, part: Part, stockKey: keyof typeof STOCK, quantity: number, status: JobStatus, made: string, by: string, note: string | null = null, changed = made, changedBy = by): Job => ({
  id: JOB[key], part_id: part.id, stock_id: STOCK[stockKey], quantity, status, note, status_at: changed, status_by: changedBy, created_at: made, created_by: by,
})

const EXAMPLE_JOBS: Job[] = [
  job('done', SIDE_PLATE, 'al250', 2, 'cut', AT('26', '23:00:00'), DEMO_PEOPLE.sam, null, AT('27', '23:10:00'), DEMO_PEOPLE.jordan),
  job('spare', SIDE_PLATE, 'al250', 1, 'to_cut', AT('28', '22:30:00'), DEMO_PEOPLE.alex, 'Spare for competition'),
  job('bellypan', BELLYPAN, 'pc125', 1, 'cutting', AT('28', '23:00:00'), DEMO_PEOPLE.pat, null, AT('29', '22:00:00'), DEMO_PEOPLE.jordan),
  job('rails', FRAME_RAIL, 'tube', 4, 'to_cut', AT('29', '23:30:00'), DEMO_PEOPLE.sam),
]

// The example side plate: 18 x 6 in, 1/4 in thick, with four #7 holes for
// rivets, two bearing holes and a lightening slot with sharp corners.
const circle = (cx: number, cy: number, r: number, n = 16) =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((-2 * Math.PI * i) / n), cy + r * Math.sin((-2 * Math.PI * i) / n)]).flat().map((v) => Math.round(v * 1000) / 1000)
const SIDE_PLATE_OUTLINE: Loops = [
  [0, 0, 18, 0, 18, 6, 0, 6],
  circle(0.75, 0.75, 0.1005), circle(17.25, 0.75, 0.1005), circle(17.25, 5.25, 0.1005), circle(0.75, 5.25, 0.1005),
  circle(3, 3, 0.5625, 32), circle(15, 3, 0.5625, 32),
  [5.5, 2.25, 5.5, 3.75, 12.5, 3.75, 12.5, 2.25],
]

const EXAMPLE_SHAPES: Shape[] = [
  {
    id: id('2001'), part_id: SIDE_PLATE.id, onshape_id: SIDE_PLATE.onshape_id!, microversion: 'example-1',
    axis: 'z', low_in: 0, thickness_in: 0.25, width_in: 6, length_in: 18, outline: SIDE_PLATE_OUTLINE,
    cut_length_in: 74.594, smallest_hole_in: 0.201, tightest_inside_radius_in: null, sharp_inside_corners: 4, narrowest_gap_in: 1.5, pockets: false,
    read_at: AT('26', '23:01:00'), read_by: DEMO_PEOPLE.sam, created_at: AT('26', '23:01:00'), created_by: DEMO_PEOPLE.sam,
  },
]

// A made-up Onshape assembly with parts laid out on sheet AL250-001.
const EXAMPLE_LAYOUT = 'https://cad.onshape.com/documents/0000000000000000000000a1/w/0000000000000000000000b1/e/0000000000000000000000d1'

const sheet = (key: keyof typeof SHEET, label: string, stockKey: keyof typeof STOCK, length: number, width: number, status: SheetStatus, location: string, more: Partial<Sheet> = {}): Sheet => ({
  id: SHEET[key], label, stock_id: STOCK[stockKey], width_in: width, length_in: length, location, status,
  onshape_url: null, parent_id: null, note: null, layout_read_at: null, created_at: AT('20', '22:05:00'), created_by: DEMO_PEOPLE.pat, ...more,
})

const EXAMPLE_SHEETS: Sheet[] = [
  sheet('al125a', 'AL125-001', 'al125', 48, 24, 'scrap', 'Scrap bin', { note: 'Used up. The good piece left is AL125-002.' }),
  sheet('al125b', 'AL125-002', 'al125', 20, 12, 'new', 'Remnant shelf', { parent_id: SHEET.al125a, created_at: AT('22') }),
  sheet('al250a', 'AL250-001', 'al250', 48, 24, 'partly_used', 'Rack A, slot 1', { onshape_url: EXAMPLE_LAYOUT, layout_read_at: AT('27', '22:00:00') }),
  sheet('al250b', 'AL250-002', 'al250', 48, 24, 'new', 'Rack A, slot 2'),
  sheet('pc125', 'PC125-001', 'pc125', 48, 24, 'new', 'Rack B'),
]

const sidePlateCut = (n: string, y: number): Cut => ({
  id: id(n), sheet_id: SHEET.al250a, job_id: JOB.done, part_id: SIDE_PLATE.id, name: SIDE_PLATE.name,
  x_in: 0.5, y_in: y, width_in: 6, length_in: 18, rotation_deg: 0, outline: flatOutline({ outline: SIDE_PLATE_OUTLINE }),
  source: 'onshape', status: 'cut', cut_at: AT('27', '23:10:00'), cut_by: DEMO_PEOPLE.jordan, created_at: AT('27', '22:00:00'), created_by: DEMO_PEOPLE.jordan,
})

const EXAMPLE_CUTS: Cut[] = [
  sidePlateCut('4001', 0.5),
  sidePlateCut('4002', 7),
  {
    id: id('4003'), sheet_id: SHEET.pc125, job_id: JOB.bellypan, part_id: BELLYPAN.id, name: BELLYPAN.name,
    x_in: 0.5, y_in: 0.5, width_in: 22, length_in: 27, rotation_deg: 0, outline: null,
    source: 'manual', status: 'planned', cut_at: null, cut_by: null, created_at: AT('29', '21:50:00'), created_by: DEMO_PEOPLE.jordan,
  },
]

export const stockTable = createTable<Stock>('cnc_stock', { demo: EXAMPLE_STOCK, sort: (a, b) => a.name.localeCompare(b.name) })
export const jobsTable = createTable<Job>('cnc_jobs', { demo: EXAMPLE_JOBS })
export const shapesTable = createTable<Shape>('cnc_shapes', { demo: EXAMPLE_SHAPES })
export const sheetsTable = createTable<Sheet>('cnc_sheets', { demo: EXAMPLE_SHEETS, sort: (a, b) => a.label.localeCompare(b.label) })
export const cutsTable = createTable<Cut>('cnc_sheet_cuts', { demo: EXAMPLE_CUTS })

const now = () => new Date().toISOString()
const me = () => currentUser()?.id ?? null
const text = (value: string) => value.trim() || null

// ---------------------------------------------------------------------------
// Stock.

/** What someone types in to add or change a kind of stock. Sizes are typed as text, like 1/4. */
export interface NewStock {
  kind: StockKind
  name: string
  code: string
  material: string
  thickness: string
  sheetLength: string
  sheetWidth: string
  bit: string
  feed: string
  depthPerPass: string
}

/** A stock's fields as the form shows them. */
export function stockForm(s?: Stock): NewStock {
  const show = (n: number | null | undefined) => (n == null ? '' : String(n))
  return {
    kind: s?.kind ?? 'plate', name: s?.name ?? '', code: s?.code ?? '', material: s?.material ?? '', thickness: show(s?.thickness_in),
    sheetLength: show(s?.sheet_length_in), sheetWidth: show(s?.sheet_width_in), bit: show(s?.bit_in), feed: show(s?.feed_ipm), depthPerPass: show(s?.depth_per_pass_in),
  }
}

/** The stock's columns from what was typed, or why it won't do. `others` are the other kinds of stock. */
export function readStock(input: NewStock, others: Stock[]): Result<Omit<Fields<Stock>, never>> {
  const name = input.name.trim()
  const code = input.code.trim().toUpperCase()
  const material = input.material.trim()
  if (!name) return fail('Name the stock the way the team says it, like "1/4 in aluminum plate".')
  if (name.length > 100) return fail(`Keep the name under 100 characters. This one is ${name.length}.`)
  if (others.some((s) => s.name.toLowerCase() === name.toLowerCase())) return fail(`There's already stock called ${name}.`)
  if (!/^[A-Z0-9]{2,8}$/.test(code)) return fail('The code is 2 to 8 capital letters and numbers, like AL250. It starts each sheet\'s ID.')
  if (others.some((s) => s.code === code)) return fail(`${code} is already another stock's code. Pick another.`)
  if (!material) return fail('Add the material, like "6061 aluminum".')
  if (material.length > 100) return fail(`Keep the material under 100 characters. This one is ${material.length}.`)

  const sizes: [keyof NewStock, string, number][] = [
    ['thickness', input.kind === 'tube' ? 'wall thickness' : 'thickness', 12], ['sheetLength', 'sheet length', 240], ['sheetWidth', 'sheet width', 240],
    ['bit', 'bit size', 2], ['depthPerPass', 'depth per pass', 12],
  ]
  const read: Partial<Record<keyof NewStock, number | null>> = {}
  for (const [field, label, most] of sizes) {
    const typed = input[field].trim()
    const n = typed ? parseInches(typed) : null
    if (typed && (n === null || n <= 0 || n >= most)) return fail(`The ${label} needs to be a size in inches, like 1/4 or 0.25.`)
    read[field] = n
  }
  const feedTyped = input.feed.trim()
  const feed = feedTyped ? Number(feedTyped) : null
  if (feedTyped && !(feed! > 0 && feed! < 2000)) return fail('The feed is in inches a minute, like 60.')
  if ((read.sheetLength === null) !== (read.sheetWidth === null)) return fail('Give both sides of a full sheet, or neither.')
  const [width, length] = [read.sheetWidth ?? null, read.sheetLength ?? null].sort((a, b) => (a ?? 0) - (b ?? 0))
  return ok({
    kind: input.kind, name, code, material, thickness_in: read.thickness ?? null,
    sheet_width_in: width, sheet_length_in: length, bit_in: read.bit ?? null, feed_ipm: feed, depth_per_pass_in: read.depthPerPass ?? null,
  })
}

export async function addStock(input: NewStock): Promise<Result<Stock>> {
  const fields = readStock(input, stockTable.rows())
  return fields.ok ? stockTable.insert(fields.value) : fields
}

export async function changeStock(stock: Stock, input: NewStock): Promise<Result<Stock>> {
  const fields = readStock(input, stockTable.rows().filter((s) => s.id !== stock.id))
  return fields.ok ? stockTable.update(stock.id, fields.value) : fields
}

/** Delete a kind of stock. Mentors only, and not while it has sheets. Its jobs go back to "No stock picked". */
export async function removeStock(stock: Stock): Promise<Result> {
  const user = currentUser()
  if (!user || !isMentor(user.role)) return fail('Only a mentor can delete stock.')
  const sheets = sheetsTable.rows().filter((s) => s.stock_id === stock.id)
  if (sheets.length) return fail(`${stock.name} still has ${plural(sheets.length, 'sheet', 'sheets')}. Delete those first, or keep it.`)
  const result = await stockTable.remove(stock.id)
  if (result.ok && !isLive) {
    for (const j of jobsTable.rows().filter((j) => j.stock_id === stock.id)) await jobsTable.update(j.id, { stock_id: null })
  }
  return result
}

// ---------------------------------------------------------------------------
// The CNC board.

/** A job with everything the board shows about it. */
export interface BoardJob {
  job: Job
  part: Part | undefined
  system: BomSystem | undefined
  stock: Stock | undefined
  shape: Shape | undefined
}

/** One stock's column on the board. `stock` is undefined for jobs with no stock picked yet. */
export interface BoardGroup {
  stock: Stock | undefined
  jobs: BoardJob[]
}

const STATUS_ORDER: Record<JobStatus, number> = { cutting: 0, to_cut: 1, cut: 2 }

function boardJob(job: Job, parts: Part[], systems: BomSystem[], stocks: Stock[], shapes: Shape[]): BoardJob {
  const part = parts.find((p) => p.id === job.part_id)
  return {
    job,
    part,
    system: systems.find((s) => s.id === part?.system_id),
    stock: stocks.find((s) => s.id === job.stock_id),
    shape: shapes.find((s) => s.part_id === job.part_id),
  }
}

/**
 * Jobs still to cut or being cut, grouped by stock in the stock's order,
 * with "no stock picked" last. In each group, what's being cut comes first,
 * then the oldest.
 */
export function boardGroups(jobs: Job[], parts: Part[], systems: BomSystem[], stocks: Stock[], shapes: Shape[]): BoardGroup[] {
  const open = jobs
    .filter((j) => j.status !== 'cut')
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.created_at.localeCompare(b.created_at))
    .map((j) => boardJob(j, parts, systems, stocks, shapes))
  const groups: BoardGroup[] = stocks.map((stock) => ({ stock, jobs: open.filter((b) => b.job.stock_id === stock.id) }))
  groups.push({ stock: undefined, jobs: open.filter((b) => !b.stock) })
  return groups.filter((g) => g.jobs.length > 0)
}

/** Jobs cut in the last `days` days, newest first. */
export function cutLately(jobs: Job[], parts: Part[], systems: BomSystem[], stocks: Stock[], shapes: Shape[], today = new Date(), days = 14): BoardJob[] {
  const since = today.getTime() - days * 86_400_000
  return jobs
    .filter((j) => j.status === 'cut' && Date.parse(j.status_at) >= since)
    .sort((a, b) => b.status_at.localeCompare(a.status_at))
    .map((j) => boardJob(j, parts, systems, stocks, shapes))
}

export function useBoard(): { groups: BoardGroup[]; lately: BoardJob[] } {
  const jobs = jobsTable.useRows()
  const parts = partsTable.useRows()
  const systems = systemsTable.useRows()
  const stocks = stockTable.useRows()
  const shapes = shapesTable.useRows()
  return { groups: boardGroups(jobs, parts, systems, stocks, shapes), lately: cutLately(jobs, parts, systems, stocks, shapes) }
}

/** Why a quantity won't do, or null if it will. */
export function checkQuantity(quantity: number): string | null {
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 999 ? null : 'The quantity needs to be a whole number from 1 to 999.'
}

/**
 * Put a made part on the CNC board. If it's already waiting on the same
 * stock, the quantity is added to that job instead of making another.
 */
export async function addJob(part: Part, quantity: number, stockId: string | null, note = ''): Promise<Result<{ job: Job; added: boolean }>> {
  if (part.kind !== 'made') return fail(`${part.name} is bought, not made, so it doesn't go on the CNC board.`)
  const problem = checkQuantity(quantity)
  if (problem) return fail(problem)
  if (note.trim().length > 300) return fail(`Keep the note under 300 characters. This one is ${note.trim().length}.`)
  const waiting = jobsTable.rows().find((j) => j.part_id === part.id && j.stock_id === stockId && j.status === 'to_cut')
  if (waiting) {
    const total = waiting.quantity + quantity
    if (total > 999) return fail('That would make more than 999 waiting. Change the quantity on the board instead.')
    const result = await jobsTable.update(waiting.id, { quantity: total })
    return result.ok ? ok({ job: result.value, added: false }) : result
  }
  const fields = { part_id: part.id, stock_id: stockId, quantity, status: 'to_cut' as const, note: text(note) }
  const row = isLive ? fields : { ...fields, status_at: now(), status_by: me() }
  const result = await jobsTable.insert(row as Fields<Job>)
  return result.ok ? ok({ job: result.value, added: true }) : result
}

/** Move a job along. Marking it cut also records the cuts planned for it on sheets. */
export async function setJobStatus(job: Job, status: JobStatus): Promise<Result<Job>> {
  if (status === job.status) return ok(job)
  if (isLive) return jobsTable.update(job.id, { status })
  // Example data: do what the database's triggers do.
  const result = await jobsTable.update(job.id, { status, status_at: now(), status_by: me() })
  if (result.ok && status === 'cut') {
    for (const cut of cutsTable.rows().filter((c) => c.job_id === job.id && c.status === 'planned')) await markCut(cut)
  }
  return result
}

/** Change how many, which stock, or the note. */
export async function changeJob(job: Job, changes: { quantity: number; stock_id: string | null; note: string }): Promise<Result<Job>> {
  const problem = checkQuantity(changes.quantity)
  if (problem) return fail(problem)
  if (changes.note.trim().length > 300) return fail(`Keep the note under 300 characters. This one is ${changes.note.trim().length}.`)
  return jobsTable.update(job.id, { quantity: changes.quantity, stock_id: changes.stock_id, note: text(changes.note) })
}

/** Take a job off the board. Mentors only: the database enforces this too. */
export async function removeJob(job: Job): Promise<Result> {
  const user = currentUser()
  if (!user || !isMentor(user.role)) return fail('Only a mentor can take a job off the board. Mark it cut, or ask a mentor.')
  const result = await jobsTable.remove(job.id)
  if (result.ok && !isLive) {
    for (const cut of cutsTable.rows().filter((c) => c.job_id === job.id)) await cutsTable.update(cut.id, { job_id: null })
  }
  return result
}

/** Every kind of stock, by name. */
export function useStock(): Stock[] {
  return stockTable.useRows()
}

/** The stock a part is probably cut from, going by its material in the BOM. */
export function likelyStock(part: Pick<Part, 'material'>, stocks: Stock[]): Stock | null {
  return guessStock(part.material, stocks)
}

/** How many of each part are on the board, waiting or being cut, by part id. */
export function useOnBoard(): Map<string, number> {
  const counts = new Map<string, number>()
  for (const job of jobsTable.useRows()) {
    if (job.status !== 'cut') counts.set(job.part_id, (counts.get(job.part_id) ?? 0) + job.quantity)
  }
  return counts
}

/** The made parts that can go on the board, by part number. Parts removed in Onshape are left out. */
export function useMadeParts(): Part[] {
  return partsTable.useRows().filter((p) => p.kind === 'made' && !p.removed_in_onshape)
}

// ---------------------------------------------------------------------------
// Shapes from Onshape.

/** One part's shape, as the onshape server function sends it. The same shape is in supabase/functions/onshape/shape.ts. */
export type OnshapeShape = Omit<Shape, keyof Row | 'part_id' | 'read_at' | 'read_by' | 'created_by'>

/** What the onshape server function sends back for a `shapes` request. */
export interface OnshapeShapes {
  shapes: OnshapeShape[]
  unchanged: string[]
  missing: string[]
}

/** The most parts one request reads. The same as MOST_SHAPES in supabase/functions/onshape/onshape.ts. */
const MOST_SHAPES = 25

/** Can this part's shape be read from Onshape? Only parts imported from Onshape know which part they are. */
export function canReadShape(part: Part | undefined): part is Part & { onshape_id: string; onshape_url: string } {
  return Boolean(part?.onshape_id && part.onshape_url)
}

/** Save a shape for a part: a new row, or the part's row updated. */
async function saveShape(part: Part, shape: OnshapeShape): Promise<Result<Shape>> {
  const existing = shapesTable.rows().find((s) => s.part_id === part.id)
  if (existing) return shapesTable.update(existing.id, isLive ? shape : { ...shape, read_at: now(), read_by: me() })
  const row = isLive ? { part_id: part.id, ...shape } : { part_id: part.id, ...shape, read_at: now(), read_by: me() }
  return shapesTable.insert(row as Fields<Shape>)
}

/**
 * Read parts' shapes from Onshape and save them. Parts read before are
 * only read again if they've changed in Onshape. Each Part Studio costs one
 * of the team's yearly Onshape API calls, plus one per part read.
 */
export async function readShapes(parts: Part[]): Promise<Result<string>> {
  const readable = parts.filter(canReadShape)
  if (readable.length === 0) return fail('These parts were typed in, so there\'s no Onshape part to read. Import their system from Onshape in the BOM first.')
  const byStudio = new Map<string, typeof readable>()
  for (const part of readable) byStudio.set(part.onshape_url, [...(byStudio.get(part.onshape_url) ?? []), part])

  let calls = 0
  let read = 0
  let unchanged = 0
  let missing = 0
  for (const [url, studioParts] of byStudio) {
    for (let i = 0; i < studioParts.length; i += MOST_SHAPES) {
      const chunk = studioParts.slice(i, i + MOST_SHAPES)
      const known = (part: Part) => shapesTable.rows().find((s) => s.part_id === part.id && s.onshape_id === part.onshape_id)?.microversion ?? null
      const body = { kind: 'shapes', url, parts: chunk.map((p) => ({ id: p.onshape_id, known: known(p) })) }
      const answer = await callFunction<OnshapeShapes>('onshape', body, () => exampleShapes(chunk.map((p) => ({ id: p.onshape_id, known: known(p) }))))
      if (!answer.ok) return answer
      calls += 1 + answer.value.shapes.length
      for (const shape of answer.value.shapes) {
        for (const part of chunk.filter((p) => p.onshape_id === shape.onshape_id)) {
          const saved = await saveShape(part, shape)
          if (!saved.ok) return saved
          read += 1
        }
      }
      unchanged += answer.value.unchanged.length
      missing += answer.value.missing.length
    }
  }
  const said = [read ? `Read ${plural(read, 'part', 'parts')} from Onshape` : 'Nothing new to read from Onshape']
  if (unchanged) said.push(`${plural(unchanged, 'part hasn’t', 'parts haven’t')} changed`)
  if (missing) said.push(`${plural(missing, 'part isn’t', 'parts aren’t')} in Onshape any more`)
  return ok(`${said.join('. ')}. That used ${plural(calls, 'Onshape API call', 'Onshape API calls')}.`)
}

/** What the example Onshape answers for shapes: the example side plate, which hasn't changed. */
function exampleShapes(parts: { id: string; known: string | null }[]): OnshapeShapes {
  const answer: OnshapeShapes = { shapes: [], unchanged: [], missing: [] }
  const [example] = EXAMPLE_SHAPES
  for (const part of parts) {
    if (part.id !== example.onshape_id) answer.missing.push(part.id)
    else if (part.known === example.microversion) answer.unchanged.push(part.id)
    else answer.shapes.push(shapeFields(example))
  }
  return answer
}

function shapeFields(shape: Shape): OnshapeShape {
  const { id: _id, created_at: _c, created_by: _b, part_id: _p, read_at: _r, read_by: _rb, ...fields } = shape
  return fields
}

// ---------------------------------------------------------------------------
// Sheets.

/** What someone types in to add or change a sheet. */
export interface NewSheet {
  label: string
  stock_id: string
  length: string
  width: string
  location: string
  onshape_url: string
  note: string
}

/** The sheet's columns from what was typed, or why it won't do. `others` are the other sheets. */
export function readSheet(input: NewSheet, others: Sheet[]): Result<Pick<Sheet, 'label' | 'stock_id' | 'width_in' | 'length_in' | 'location' | 'onshape_url' | 'note'>> {
  const label = input.label.trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(label)) return fail('The ID is capital letters, numbers and dashes, like AL250-007. Write the same on the sheet.')
  if (others.some((s) => s.label === label)) return fail(`${label} is already another sheet's ID.`)
  if (!input.stock_id) return fail('Pick the stock this sheet is.')
  const a = parseInches(input.length)
  const b = parseInches(input.width)
  if (a === null || b === null || a <= 0 || b <= 0 || a > 240 || b > 240) return fail('Give the sheet\'s two sides in inches, like 48 and 24.')
  const location = input.location.trim()
  if (location.length > 100) return fail(`Keep the location under 100 characters. This one is ${location.length}.`)
  const link = input.onshape_url.trim()
  if (link && !isOnshapeLink(link)) return fail('That isn\'t a link to an Onshape tab. Open the layout assembly in Onshape and copy the address: https://cad.onshape.com/documents/…/w/…/e/…')
  const note = input.note.trim()
  if (note.length > 300) return fail(`Keep the note under 300 characters. This one is ${note.length}.`)
  // The long side is the length, along x.
  return ok({ label, stock_id: input.stock_id, length_in: Math.max(a, b), width_in: Math.min(a, b), location: location || null, onshape_url: link || null, note: note || null })
}

/** A new sheet's form, with the next free ID and the stock's full sheet size filled in. */
export function sheetForm(stock: Stock | undefined, sheets: Sheet[]): NewSheet {
  return {
    label: stock ? nextLabel(stock.code, sheets.map((s) => s.label)) : '',
    stock_id: stock?.id ?? '',
    length: stock?.sheet_length_in ? String(stock.sheet_length_in) : '',
    width: stock?.sheet_width_in ? String(stock.sheet_width_in) : '',
    location: '',
    onshape_url: '',
    note: '',
  }
}

export async function addSheet(input: NewSheet, parentId: string | null = null): Promise<Result<Sheet>> {
  const fields = readSheet(input, sheetsTable.rows())
  if (!fields.ok) return fields
  const row = { ...fields.value, status: 'new' as const, parent_id: parentId }
  return sheetsTable.insert((isLive ? row : { ...row, layout_read_at: null }) as Fields<Sheet>)
}

export async function changeSheet(sheet: Sheet, input: NewSheet): Promise<Result<Sheet>> {
  const fields = readSheet({ ...input, stock_id: sheet.stock_id }, sheetsTable.rows().filter((s) => s.id !== sheet.id))
  if (!fields.ok) return fields
  const { stock_id: _same, ...changes } = fields.value
  return sheetsTable.update(sheet.id, changes)
}

export async function setSheetStatus(sheet: Sheet, status: SheetStatus): Promise<Result<Sheet>> {
  return sheetsTable.update(sheet.id, { status })
}

/** Delete a sheet and its cuts. Mentors only: the database enforces this too. */
export async function removeSheet(sheet: Sheet): Promise<Result> {
  const user = currentUser()
  if (!user || !isMentor(user.role)) return fail('Only a mentor can delete a sheet. Mark it scrap instead.')
  const result = await sheetsTable.remove(sheet.id)
  if (result.ok && !isLive) {
    for (const cut of cutsTable.rows().filter((c) => c.sheet_id === sheet.id)) await cutsTable.remove(cut.id)
  }
  return result
}

/**
 * Cut a leftover piece off a sheet and give it its own ID, so it can be
 * found and used. Usually what's left of the old sheet is scrap.
 */
export async function splitRemnant(sheet: Sheet, input: NewSheet, restIsScrap: boolean): Promise<Result<Sheet>> {
  const added = await addSheet({ ...input, stock_id: sheet.stock_id }, sheet.id)
  if (!added.ok) return added
  if (restIsScrap) {
    const scrapped = await setSheetStatus(sheet, 'scrap')
    if (!scrapped.ok) return scrapped
  }
  return added
}

/** A sheet with what's been cut and planned on it. */
export interface SheetView {
  sheet: Sheet
  stock: Stock | undefined
  cuts: Cut[]
  /** The sheet it was cut from, for a leftover piece. */
  parent: Sheet | undefined
}

export function useSheetViews(): SheetView[] {
  const sheets = sheetsTable.useRows()
  const stocks = stockTable.useRows()
  const cuts = cutsTable.useRows()
  return sheets.map((sheet) => ({
    sheet,
    stock: stocks.find((s) => s.id === sheet.stock_id),
    cuts: cuts.filter((c) => c.sheet_id === sheet.id),
    parent: sheets.find((s) => s.id === sheet.parent_id),
  }))
}

/** A cut's box on its sheet. */
export const boxOf = (cut: Pick<Cut, 'x_in' | 'y_in' | 'length_in' | 'width_in'>): Box => ({ x: cut.x_in, y: cut.y_in, length: cut.length_in, width: cut.width_in })

// ---------------------------------------------------------------------------
// Cuts.

/** The columns someone sends for a new cut. */
type NewCut = Omit<Cut, keyof Row | 'cut_at' | 'cut_by' | 'created_by'>

async function insertCuts(rows: NewCut[]): Promise<Result<Cut[]>> {
  if (isLive) return cutsTable.insertMany(rows as Fields<Cut>[])
  // Example data: do what the database's triggers do.
  const added = await cutsTable.insertMany(rows.map((r) => ({ ...r, cut_at: r.status === 'cut' ? now() : null, cut_by: r.status === 'cut' ? me() : null })))
  if (added.ok) await markSheetsUsed(rows)
  return added
}

async function markSheetsUsed(rows: Pick<Cut, 'sheet_id' | 'status'>[]) {
  for (const sheetId of new Set(rows.filter((r) => r.status === 'cut').map((r) => r.sheet_id))) {
    const sheet = sheetsTable.rows().find((s) => s.id === sheetId)
    if (sheet?.status === 'new') await sheetsTable.update(sheet.id, { status: 'partly_used' })
  }
}

/** What someone types in to record a cut by hand. Sizes as text, in inches. */
export interface ManualCut {
  /** A job on the board, a part, or neither (then name it). */
  jobId: string
  partId: string
  name: string
  x: string
  y: string
  length: string
  width: string
  turned: boolean
  status: CutStatus
}

/**
 * Record a cut by hand: where it is on the sheet (from the sheet's corner)
 * and how big. If the part has a shape from Onshape and the size matches,
 * its outline is drawn too.
 */
export async function addManualCut(sheet: Sheet, input: ManualCut): Promise<Result<Cut>> {
  const job = jobsTable.rows().find((j) => j.id === input.jobId)
  const part = partsTable.rows().find((p) => p.id === (job?.part_id ?? input.partId))
  const name = (part?.name ?? input.name).trim()
  if (!name) return fail('Pick the part, or name what was cut.')
  if (name.length > 100) return fail(`Keep the name under 100 characters. This one is ${name.length}.`)
  const [x, y, length, width] = [input.x, input.y, input.length, input.width].map(parseInches)
  if (x === null || y === null) return fail('Give where the part is: how far from the sheet\'s corner along its length (x) and its width (y), in inches.')
  if (length === null || width === null || length <= 0 || width <= 0) return fail('Give the part\'s size along the sheet\'s length and width, in inches.')
  const box = { x, y, length, width }
  if (!onSheet(box, sheet)) return fail(`That runs off the sheet, which is ${sizeText(sheet.length_in, sheet.width_in)}. Check where it is, and its size.`)

  const shape = shapesTable.rows().find((s) => s.part_id === part?.id)
  let outline: Loops | null = null
  if (shape?.outline.length) {
    const flat = flatOutline(shape)
    const fitted = input.turned ? quarterTurn(flat) : flat
    const matches = Math.abs(length - (input.turned ? shape.width_in : shape.length_in)) < 0.05 && Math.abs(width - (input.turned ? shape.length_in : shape.width_in)) < 0.05
    if (matches) outline = fitted
  }
  const added = await insertCuts([{
    sheet_id: sheet.id, job_id: job?.id ?? null, part_id: part?.id ?? null, name, x_in: x, y_in: y, width_in: width, length_in: length,
    rotation_deg: input.turned ? 90 : 0, outline, source: 'manual', status: input.status,
  }])
  return added.ok ? ok(added.value[0]) : added
}

/** Mark a planned cut as cut. */
export async function markCut(cut: Cut): Promise<Result<Cut>> {
  if (cut.status === 'cut') return ok(cut)
  if (isLive) return cutsTable.update(cut.id, { status: 'cut' })
  const result = await cutsTable.update(cut.id, { status: 'cut', cut_at: now(), cut_by: me() })
  if (result.ok) await markSheetsUsed([result.value])
  return result
}

/** Can this person delete this cut? Anyone can delete a planned cut or one they recorded; mentors any. The database checks the same. */
export function canRemoveCut(cut: Cut, user: { id: string; role: Parameters<typeof isMentor>[0] } | null): boolean {
  return Boolean(user && (cut.status === 'planned' || cut.created_by === user.id || isMentor(user.role)))
}

export async function removeCut(cut: Cut): Promise<Result> {
  if (!canRemoveCut(cut, currentUser())) return fail('Only whoever recorded a cut, or a mentor, can delete it.')
  return cutsTable.remove(cut.id)
}

// ---------------------------------------------------------------------------
// Reading a sheet's layout from Onshape.

/** Where one part sits in a layout assembly, as the onshape server function sends it. See onshape.ts there. */
export interface OnshapePlacement {
  onshape_id: string
  name: string
  /** 16 numbers, a 4 x 4 matrix row by row; the move is in inches. */
  transform: number[]
}

/** The BOM part an Onshape part is: the same part, or if a configuration is written differently, the only part with that ID. */
export function partForOnshape(onshapeId: string, parts: Part[]): Part | undefined {
  const current = parts.filter((p) => p.onshape_id && !p.removed_in_onshape)
  const exact = current.find((p) => p.onshape_id === onshapeId)
  if (exact) return exact
  const bare = (id: string) => id.split('?')[0]
  const same = current.filter((p) => bare(p.onshape_id!) === bare(onshapeId))
  return same.length === 1 ? same[0] : undefined
}

export interface LayoutPlan {
  /** Planned cuts to save. */
  cuts: NewCut[]
  /** Parts in the layout that weren't planned, and why. */
  skipped: { name: string; why: string }[]
}

/**
 * Turn a layout's placements into planned cuts on a sheet. Each part is
 * matched to the BOM, placed using its shape, and given to a job on the
 * board for the sheet's stock that still needs that many. Parts already cut,
 * or planned by hand, in the same spot are skipped. Doesn't save anything.
 */
export function planLayout(sheet: Sheet, placements: OnshapePlacement[], parts: Part[], jobs: Job[], shapes: Shape[], cuts: Cut[]): LayoutPlan {
  const plan: LayoutPlan = { cuts: [], skipped: [] }
  // How many more cuts each open job can take: its quantity, less what's planned or cut on other sheets.
  const room = new Map(
    jobs
      .filter((j) => j.status !== 'cut')
      .map((j) => [j.id, j.quantity - cuts.filter((c) => c.job_id === j.id && !(c.sheet_id === sheet.id && c.source === 'onshape' && c.status === 'planned')).length]),
  )
  for (const placement of placements) {
    const part = partForOnshape(placement.onshape_id, parts)
    if (!part) {
      plan.skipped.push({ name: placement.name, why: "isn't a part in the BOM (the sheet itself, or a part from another document)" })
      continue
    }
    const shape = shapes.find((s) => s.part_id === part.id)
    const spot = shape ? footprint(shape, placement.transform) : null
    if (!spot) {
      plan.skipped.push({ name: placement.name, why: "has no shape from Onshape, so there's no knowing where it is" })
      continue
    }
    if (!spot.flat) {
      plan.skipped.push({ name: placement.name, why: "isn't lying flat on the layout's Top plane" })
      continue
    }
    if (!onSheet(spot.box, sheet)) {
      plan.skipped.push({ name: placement.name, why: "is off the sheet. Put the sheet's corner at the layout's origin" })
      continue
    }
    // Already cut, or planned by hand, in the same spot. (What was planned from Onshape before is replaced.)
    const already = cuts.find(
      (c) => c.sheet_id === sheet.id && !(c.source === 'onshape' && c.status === 'planned') && c.part_id === part.id && Math.abs(c.x_in - spot.box.x) < 0.05 && Math.abs(c.y_in - spot.box.y) < 0.05,
    )
    if (already) {
      plan.skipped.push({ name: placement.name, why: already.status === 'cut' ? 'is already cut there' : 'is already planned there' })
      continue
    }
    const job =
      jobs.find((j) => j.part_id === part.id && j.stock_id === sheet.stock_id && (room.get(j.id) ?? 0) > 0) ??
      jobs.find((j) => j.part_id === part.id && (room.get(j.id) ?? 0) > 0)
    if (job) room.set(job.id, room.get(job.id)! - 1)
    plan.cuts.push({
      sheet_id: sheet.id, job_id: job?.id ?? null, part_id: part.id, name: part.name.slice(0, 100),
      x_in: spot.box.x, y_in: spot.box.y, width_in: spot.box.width, length_in: spot.box.length,
      rotation_deg: spot.rotation, outline: spot.outline, source: 'onshape', status: 'planned',
    })
  }
  return plan
}

/**
 * Read where parts are laid out on a sheet in its Onshape assembly, and
 * save them as planned cuts (replacing what was planned from Onshape
 * before). When a part's job is marked cut, its planned cuts become cuts.
 * Costs one Onshape API call, plus reading any shapes not read before.
 */
export async function readLayout(sheet: Sheet): Promise<Result<{ planned: number; skipped: LayoutPlan['skipped']; shapes: string | null }>> {
  if (!sheet.onshape_url) return fail('Add the sheet\'s Onshape layout link first: Change sheet, then paste the assembly\'s address.')
  const answer = await callFunction<{ placements: OnshapePlacement[] }>('onshape', { kind: 'layout', url: sheet.onshape_url }, () => exampleLayout(sheet))
  if (!answer.ok) return answer
  const { placements } = answer.value

  const parts = partsTable.rows()
  const unread = [...new Set(placements.map((p) => partForOnshape(p.onshape_id, parts)).filter((p): p is Part => Boolean(p)))].filter(
    (p) => !shapesTable.rows().some((s) => s.part_id === p.id),
  )
  let shapes: string | null = null
  if (unread.length) {
    const read = await readShapes(unread)
    if (!read.ok) return read
    shapes = read.value
  }

  const plan = planLayout(sheet, placements, parts, jobsTable.rows(), shapesTable.rows(), cutsTable.rows())
  for (const old of cutsTable.rows().filter((c) => c.sheet_id === sheet.id && c.source === 'onshape' && c.status === 'planned')) {
    const removed = await cutsTable.remove(old.id)
    if (!removed.ok) return removed
  }
  const added = await insertCuts(plan.cuts)
  if (!added.ok) return added
  const noted = await sheetsTable.update(sheet.id, { layout_read_at: now() })
  if (!noted.ok) return noted
  return ok({ planned: plan.cuts.length, skipped: plan.skipped, shapes })
}

/** The example layout: the sheet, the two side plates already cut, and the spare side plate below them. */
function exampleLayout(sheet: Sheet): { placements: OnshapePlacement[] } {
  if (sheet.onshape_url !== EXAMPLE_LAYOUT) return { placements: [] }
  const at = (x: number, y: number) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, 0, 0, 0, 0, 1]
  const plate = (n: number, y: number) => ({ onshape_id: SIDE_PLATE.onshape_id!, name: `Side plate <${n}>`, transform: at(0.5, y) })
  return {
    placements: [
      { onshape_id: '0000000000000000000000a1/0000000000000000000000c2/JSD', name: 'Sheet 48 x 24', transform: at(0, 0) },
      plate(1, 0.5),
      plate(2, 7),
      plate(3, 13.5),
    ],
  }
}

// ---------------------------------------------------------------------------
// Finding room on a sheet.

export interface RoomPlan {
  /** Where each waiting part could go. */
  spots: { job: Job; part: Part; shape: Shape; spot: Spot }[]
  /** Waiting parts that don't fit, and how many. */
  noRoom: { job: Job; part: Part; count: number }[]
  /** Waiting parts with no shape from Onshape yet, so no size. */
  noShape: { job: Job; part: Part | undefined }[]
}

/**
 * Where the parts waiting on the board for this sheet's stock could go on
 * it, around what's already cut or planned. Bigger parts are placed first.
 * Doesn't save anything.
 */
export function planRoom(sheet: Sheet, stock: Stock | undefined, jobs: Job[], parts: Part[], shapes: Shape[], cuts: Cut[]): RoomPlan {
  const plan: RoomPlan = { spots: [], noRoom: [], noShape: [] }
  const waiting: { job: Job; part: Part; shape: Shape; count: number }[] = []
  for (const job of jobs.filter((j) => j.stock_id === sheet.stock_id && j.status !== 'cut')) {
    const count = job.quantity - cuts.filter((c) => c.job_id === job.id).length
    if (count <= 0) continue
    const part = parts.find((p) => p.id === job.part_id)
    const shape = shapes.find((s) => s.part_id === job.part_id)
    if (!part || !shape) plan.noShape.push({ job, part })
    else waiting.push({ job, part, shape, count })
  }
  waiting.sort((a, b) => b.shape.length_in * b.shape.width_in - a.shape.length_in * a.shape.width_in)

  const taken = cuts.filter((c) => c.sheet_id === sheet.id).map(boxOf)
  const gap = spacing(stock)
  for (const w of waiting) {
    const sizes = Array.from({ length: w.count }, () => ({ length: w.shape.length_in, width: w.shape.width_in }))
    const found = findSpots(sheet, taken, sizes, gap, Math.max(gap, EDGE_MARGIN))
    let missing = 0
    for (const spot of found) {
      if (!spot) {
        missing += 1
        continue
      }
      taken.push(spot.box)
      plan.spots.push({ job: w.job, part: w.part, shape: w.shape, spot })
    }
    if (missing) plan.noRoom.push({ job: w.job, part: w.part, count: missing })
  }
  return plan
}

/** Save the spots found as planned cuts, so the next person sees the room is spoken for. */
export async function saveRoomPlan(sheet: Sheet, spots: RoomPlan['spots']): Promise<Result<Cut[]>> {
  if (spots.length === 0) return fail('Nothing to plan: no waiting parts fit.')
  return insertCuts(
    spots.map(({ job, part, shape, spot }) => ({
      sheet_id: sheet.id, job_id: job.id, part_id: part.id, name: part.name.slice(0, 100),
      x_in: spot.box.x, y_in: spot.box.y, width_in: spot.box.width, length_in: spot.box.length,
      rotation_deg: spot.turned ? 90 : 0, outline: shape.outline.length ? (spot.turned ? quarterTurn(flatOutline(shape)) : flatOutline(shape)) : null,
      source: 'manual', status: 'planned',
    })),
  )
}

/** Which sheets of a job's stock have room for one of its part, in ID order. */
export function sheetsWithRoom(shape: Shape | undefined, stock: Stock | undefined, sheets: Sheet[], cuts: Cut[]): Sheet[] {
  if (!shape || !stock || stock.kind !== 'plate') return []
  const gap = spacing(stock)
  return sheets.filter((sheet) => {
    if (sheet.stock_id !== stock.id || sheet.status === 'scrap') return false
    const taken = cuts.filter((c) => c.sheet_id === sheet.id).map(boxOf)
    return findSpots(sheet, taken, [{ length: shape.length_in, width: shape.width_in }], gap, Math.max(gap, EDGE_MARGIN))[0] !== null
  })
}

// ---------------------------------------------------------------------------
// The home page.

/** The home page tile's status, like "5 parts to cut · 1 cutting". */
export function cncSummary(jobs: Job[]): Notice {
  const count = (status: JobStatus) => jobs.filter((j) => j.status === status).reduce((total, j) => total + j.quantity, 0)
  const toCut = count('to_cut')
  const cutting = count('cutting')
  if (!toCut && !cutting) return { tone: 'plain', text: 'Nothing waiting to cut' }
  return { tone: 'info', text: [toCut && `${plural(toCut, 'part', 'parts')} to cut`, cutting && `${cutting} cutting`].filter(Boolean).join(' · ') }
}

export function useCncSummary(): Notice {
  return cncSummary(jobsTable.useRows())
}

/** A stock's thickness, like "1/4 in thick", for showing next to it. */
export function thicknessText(stock: Pick<Stock, 'kind' | 'thickness_in'>): string | null {
  if (!stock.thickness_in) return null
  return `${inches(stock.thickness_in)} ${stock.kind === 'tube' ? 'wall' : 'thick'}`
}
