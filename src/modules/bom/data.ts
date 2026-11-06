/**
 * BOM module data: robots, the systems they're made of, and the parts in
 * each system.
 *
 * Parts are typed in, or imported from the system's Onshape assembly or
 * Part Studio through the `onshape` server function, which holds the team's
 * Onshape keys (see onshape.ts for how an import is worked out).
 *
 * The tables are made in the team database by
 * supabase/migrations/..._bom.sql. Anyone on the team can add and change
 * robots, systems and parts, delete parts, and import from Onshape. Only
 * mentors can delete a system, because that deletes every part in it too
 * (..._bom_members_edit.sql).
 *
 * Made parts have stages (Design, Pre-process, Process 1 and 2,
 * Post-process), each with a status and how many are through it
 * (..._bom_steps.sql).
 */
import { callFunction } from '../../core/functions'
import { createTable, fail, ok, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'
import { isMentor } from '../../core/roles'
import { currentUser } from '../../core/session'
import { isLive } from '../../core/supabase'
import { plural } from '../../core/format'
import type { Notice } from '../../core/registry'
import type { OnshapeBom, OnshapeImportPlan } from './onshape'
import type { Item } from '../inventory/data'
import type { PurchaseItem, StatusKey } from '../purchasing/data'

/** One row of bom_robots. */
export interface Robot extends Row {
  name: string
  created_by: string | null
}

/** One row of bom_systems: a part of the robot, such as Intake. */
export interface BomSystem extends Row {
  robot_id: string
  name: string
  /** The short code used in part numbers, such as INT. */
  code: string
  /** A link to the system's assembly or Part Studio in Onshape, to import its parts from. */
  onshape_url: string | null
  /** When its parts were last imported from Onshape. */
  onshape_imported_at: string | null
  created_by: string | null
}

/**
 * Custom (made in our shop), or COTS (bought "commercial off the shelf").
 * The database stores custom parts as 'made'; the page calls them Custom.
 */
export type PartKind = 'made' | 'cots'

/** One row of bom_parts. */
export interface Part extends Row {
  system_id: string
  /** Like 4096-26-INT-001. */
  part_number: string
  name: string
  revision: string | null
  kind: PartKind
  /** Made parts only, such as "6061 aluminum, 1/4 in plate". */
  material: string | null
  quantity: number
  /** COTS parts only. */
  vendor: string | null
  vendor_part_number: string | null
  onshape_url: string | null
  /** Which Onshape part this is, for parts imported from Onshape. Null for parts typed in. */
  onshape_id: string | null
  /** No longer in the system's Onshape assembly. Kept, not deleted, so its history stays. */
  removed_in_onshape: boolean
  created_by: string | null
}

// Example data. The ids are fixed so the rows can point at each other.
const ROBOT = '00000000-0000-4000-8000-0000000b0001'
const INTAKE = '00000000-0000-4000-8000-0000000b0101'
const DRIVETRAIN = '00000000-0000-4000-8000-0000000b0102'
const CREATED = { created_at: '2026-10-20T18:00:00Z', created_by: DEMO_PEOPLE.pat }

const EXAMPLE_ROBOTS: Robot[] = [{ id: ROBOT, name: '2026 competition robot', ...CREATED }]

// A made-up Onshape document, so the example Intake can show importing.
const EXAMPLE_DOC = 'https://cad.onshape.com/documents/0000000000000000000000a1/w/0000000000000000000000b1'

const EXAMPLE_SYSTEMS: BomSystem[] = [
  { id: INTAKE, robot_id: ROBOT, name: 'Intake', code: 'INT', onshape_url: `${EXAMPLE_DOC}/e/0000000000000000000000c1`, onshape_imported_at: '2026-10-20T18:05:00Z', ...CREATED },
  { id: DRIVETRAIN, robot_id: ROBOT, name: 'Drivetrain', code: 'DRV', onshape_url: null, onshape_imported_at: null, ...CREATED, created_at: '2026-10-20T18:01:00Z' },
]

let partCount = 0
function made(system_id: string, part_number: string, name: string, revision: string, material: string, quantity: number): Part {
  partCount += 1
  return {
    id: `00000000-0000-4000-8000-0000000b1${String(partCount).padStart(3, '0')}`,
    system_id, part_number, name, revision, kind: 'made', material, quantity,
    vendor: null, vendor_part_number: null, onshape_url: null, onshape_id: null, removed_in_onshape: false, ...CREATED,
  }
}
function cots(system_id: string, part_number: string, name: string, vendor: string, vendor_part_number: string, quantity: number): Part {
  partCount += 1
  return {
    id: `00000000-0000-4000-8000-0000000b1${String(partCount).padStart(3, '0')}`,
    system_id, part_number, name, revision: null, kind: 'cots', material: null, quantity,
    vendor, vendor_part_number, onshape_url: null, onshape_id: null, removed_in_onshape: false, ...CREATED,
  }
}

const EXAMPLE_PARTS: Part[] = [
  made(INTAKE, '4096-26-INT-001', 'Intake side plate', 'B', '6061 aluminum, 1/4 in plate', 2),
  made(INTAKE, '4096-26-INT-002', 'Roller shaft', 'A', '1/2 in hex aluminum bar', 3),
  made(INTAKE, '4096-26-INT-003', 'Pivot spacer', 'A', 'Nylon 6/6 rod, 3/4 in', 4),
  cots(INTAKE, '4096-26-INT-004', 'Brushless motor', 'REV Robotics', 'EXAMPLE-NEO-01', 2),
  cots(INTAKE, '4096-26-INT-005', 'Compliant wheel, 2 in', 'AndyMark', 'EXAMPLE-CW-2', 8),
  cots(INTAKE, '4096-26-INT-006', 'Flanged bearing, 1/2 in hex', 'WCP', 'EXAMPLE-BRG-12', 6),
  made(DRIVETRAIN, '4096-26-DRV-001', 'Bellypan', 'C', 'Polycarbonate, 1/8 in sheet', 1),
  made(DRIVETRAIN, '4096-26-DRV-002', 'Frame rail', 'B', '2 x 1 in aluminum tube, 1/16 in wall', 4),
  cots(DRIVETRAIN, '4096-26-DRV-003', 'Swerve module', 'Swerve Drive Specialties', 'EXAMPLE-MK-4', 4),
  cots(DRIVETRAIN, '4096-26-DRV-004', 'Drive motor', 'WCP', 'EXAMPLE-KR-60', 8),
  cots(DRIVETRAIN, '4096-26-DRV-005', 'Absolute encoder', 'CTR Electronics', 'EXAMPLE-ENC-1', 4),
  cots(DRIVETRAIN, '4096-26-DRV-006', 'Rivet, 3/16 in', 'McMaster-Carr', 'EXAMPLE-RIV-316', 120),
]

// The example Intake was imported from the made-up Onshape assembly: each
// of its parts says which Onshape part it is. (The Drivetrain was typed in.)
const EXAMPLE_PART_STUDIO = `${EXAMPLE_DOC}/e/0000000000000000000000c2`
const exampleOnshapeId = (n: number) => `0000000000000000000000a1/0000000000000000000000c2/J${n}D`
EXAMPLE_PARTS.filter((p) => p.system_id === INTAKE).forEach((part, i) => {
  part.onshape_id = exampleOnshapeId(i + 1)
  part.onshape_url = EXAMPLE_PART_STUDIO
})

export const robotsTable = createTable<Robot>('bom_robots', { demo: EXAMPLE_ROBOTS })
// Version 2: systems and parts gained their Onshape import columns.
export const systemsTable = createTable<BomSystem>('bom_systems', { demo: EXAMPLE_SYSTEMS, version: 2 })
export const partsTable = createTable<Part>('bom_parts', {
  demo: EXAMPLE_PARTS,
  version: 2,
  sort: (a, b) => a.part_number.localeCompare(b.part_number),
})

/** Every robot, oldest first. */
export function useRobots(): Robot[] {
  return robotsTable.useRows()
}

/** The systems in one robot, in the order they were added. */
export function useSystems(robotId: string | undefined): BomSystem[] {
  return systemsTable.useRows().filter((s) => s.robot_id === robotId)
}

/** The parts in one system, by part number. */
export function useParts(systemId: string | undefined): Part[] {
  return partsTable.useRows().filter((p) => p.system_id === systemId)
}

/** The choices in the page's Custom / COTS filter. */
export const PART_FILTERS = ['All', 'Custom', 'COTS'] as const
export type PartFilter = (typeof PART_FILTERS)[number]

/** How a part's kind is written on the page. */
export function kindLabel(kind: PartKind): string {
  return kind === 'made' ? 'Custom' : 'COTS'
}

/** Only the parts the filter asks for. */
export function filterParts(parts: Part[], filter: PartFilter): Part[] {
  if (filter === 'Custom') return parts.filter((p) => p.kind === 'made')
  if (filter === 'COTS') return parts.filter((p) => p.kind === 'cots')
  return parts
}

/**
 * How many parts are custom and how many are COTS. Each part counts once,
 * whatever its quantity. Parts removed in Onshape don't count.
 */
export function countParts(parts: Part[]): { made: number; cots: number } {
  const current = parts.filter((p) => !p.removed_in_onshape)
  const made = current.filter((p) => p.kind === 'made').length
  return { made, cots: current.length - made }
}

/** Like "12 custom, 31 COTS". */
export function partCountText(parts: Part[]): string {
  const { made, cots } = countParts(parts)
  return `${made} custom, ${cots} COTS`
}

/** The start of this season's part numbers: team and year. */
export const PART_NUMBER_PREFIX = '4096-26'

/**
 * The next free part number in a system, like 4096-26-INT-007: one more
 * than the highest number already used there.
 */
export function nextPartNumber(system: BomSystem, parts: Part[]): string {
  const start = `${PART_NUMBER_PREFIX}-${system.code}-`
  const used = parts
    .filter((p) => p.part_number.startsWith(start))
    .map((p) => Number(p.part_number.slice(start.length)))
    .filter(Number.isInteger)
  const next = Math.max(0, ...used) + 1
  return start + String(next).padStart(3, '0')
}

// ---------------------------------------------------------------------------
// Stock on the shelf, from Inventory.

/** How a part number is compared: without capitals or spaces, so "rev-11-1850" and "REV-11-1850" match. */
const sameNumber = (number: string) => number.replace(/\s+/g, '').toLowerCase()

/**
 * The Inventory part a COTS part is, if Inventory has it: the one with the
 * same vendor part number. Vendor names are matched only when more than one
 * Inventory part has that number, since the team types them differently
 * ("REV" and "REV Robotics"). Made parts, and COTS parts with no vendor part
 * number, are never in Inventory.
 */
export function shelfItem(part: Part, items: Item[]): Item | undefined {
  if (part.kind !== 'cots' || !part.vendor_part_number?.trim()) return undefined
  const number = sameNumber(part.vendor_part_number)
  const found = items.filter((item) => sameNumber(item.vendor_part_number) === number)
  if (found.length <= 1) return found[0]
  const vendor = (part.vendor ?? '').trim().toLowerCase()
  return found.find((item) => item.vendor.trim().toLowerCase() === vendor)
}

/** Purchasing statuses that mean the order is over: it arrived, or isn't happening. */
const ORDER_OVER: StatusKey[] = ['received', 'in_shop', 'cancelled']

/**
 * What the BOM shows under a COTS part about the shelf, like
 * "On the shelf: 2 · Bin B1 · Missing 1". If the part has a request in
 * Purchasing that's still going, it says how many are being ordered
 * instead: "On the shelf: 2 · Bin B1 · Ordering 3". Null for custom parts.
 */
export function shelfText(part: Part, items: Item[], request?: PurchaseItem): string | null {
  if (part.kind !== 'cots') return null
  const item = shelfItem(part, items)
  const shelf = item ? `On the shelf: ${item.quantity} · ${item.location}` : 'Not in Inventory'
  if (request && !ORDER_OVER.includes(request.status)) return `${shelf} · Ordering ${request.quantity}`
  const missing = part.quantity - (item?.quantity ?? 0)
  return missing > 0 ? `${shelf} · Missing ${missing}` : shelf
}

// ---------------------------------------------------------------------------
// Robots and systems.

/** Why a robot name won't do, or null if it will. */
export function checkRobotName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Name the robot, like "2027 competition robot".'
  if (trimmed.length > 100) return `Keep the robot's name under 100 characters. This one is ${trimmed.length}.`
  return null
}

export async function addRobot(name: string): Promise<Result<Robot>> {
  const problem = checkRobotName(name)
  if (problem) return fail(problem)
  return robotsTable.insert({ name: name.trim() })
}

export async function renameRobot(robot: Robot, name: string): Promise<Result<Robot>> {
  const problem = checkRobotName(name)
  if (problem) return fail(problem)
  return robotsTable.update(robot.id, { name: name.trim() })
}

/** What someone types in to add or change a system. The Onshape link can be left empty. */
export interface NewSystem {
  name: string
  code: string
  onshape_url: string
}

/**
 * Why a system can't be saved, or null if it can. `others` are the other
 * systems in the same robot: names and codes can't repeat within a robot.
 */
export function checkSystem(system: NewSystem, others: BomSystem[]): string | null {
  const name = system.name.trim()
  const code = system.code.trim().toUpperCase()
  if (!name) return 'Name the system, like Intake.'
  if (name.length > 100) return `Keep the system's name under 100 characters. This one is ${name.length}.`
  if (!/^[A-Z]{2,4}$/.test(code)) return 'The code is 2 to 4 letters, like INT. It goes in part numbers.'
  if (others.some((s) => s.name.toLowerCase() === name.toLowerCase())) return `There's already a system called ${name}.`
  if (others.some((s) => s.code === code)) return `${code} is already another system's code. Pick another.`
  const link = system.onshape_url.trim()
  if (link && !isOnshapeLink(link)) {
    return "That isn't a link to an Onshape tab. Open the system's assembly (or Part Studio) in Onshape and copy the address: https://cad.onshape.com/documents/…/w/…/e/…"
  }
  return null
}

/** Is this a link to a tab (an assembly or Part Studio) on cad.onshape.com? The onshape server function checks the same. */
export function isOnshapeLink(url: string): boolean {
  return /^https:\/\/cad\.onshape\.com\/documents\/[0-9a-f]{24}\/[wvm]\/[0-9a-f]{24}\/e\/[0-9a-f]{24}\/?(?:[?#].*)?$/.test(url.trim())
}

const systemFields = (system: NewSystem) => ({
  name: system.name.trim(),
  code: system.code.trim().toUpperCase(),
  onshape_url: system.onshape_url.trim() || null,
})

export async function addSystem(robotId: string, system: NewSystem): Promise<Result<BomSystem>> {
  const problem = checkSystem(system, systemsTable.rows().filter((s) => s.robot_id === robotId))
  if (problem) return fail(problem)
  return systemsTable.insert({ robot_id: robotId, ...systemFields(system), onshape_imported_at: null })
}

/** Change a system's name, code or Onshape link. Its parts keep their part numbers. */
export async function changeSystem(system: BomSystem, changes: NewSystem): Promise<Result<BomSystem>> {
  const others = systemsTable.rows().filter((s) => s.robot_id === system.robot_id && s.id !== system.id)
  const problem = checkSystem(changes, others)
  if (problem) return fail(problem)
  return systemsTable.update(system.id, systemFields(changes))
}

/** Delete a system and every part in it. Mentors only: the database enforces this too. */
export async function removeSystem(system: BomSystem): Promise<Result> {
  const user = currentUser()
  if (!user || !isMentor(user.role)) return fail('Only a mentor can delete a system, because it deletes every part in it.')
  const result = await systemsTable.remove(system.id)
  // The database deletes the parts with the system. Example data has to do it here.
  if (result.ok && !isLive) {
    for (const part of partsTable.rows().filter((p) => p.system_id === system.id)) await partsTable.remove(part.id)
  }
  return result
}

// ---------------------------------------------------------------------------
// Parts.

/** What someone types in to add or change a part. Text can be left empty where it isn't needed. */
export interface NewPart {
  system_id: string
  part_number: string
  name: string
  revision: string
  kind: PartKind
  material: string
  quantity: number
  vendor: string
  vendor_part_number: string
}

// The database has the same limits: see the checks in the bom migration.
const LIMITS = { part_number: 40, name: 100, revision: 10, material: 100, vendor: 100, vendor_part_number: 100 }

/**
 * Why a part can't be saved, or null if it can. `parts` is every part, to
 * check the number isn't taken; `id` is the part being changed, if it is
 * one. Parts imported from Onshape can have no material or vendor yet.
 */
export function checkPart(part: NewPart, parts: Part[], id?: string, imported = false): string | null {
  const partNumber = part.part_number.trim()
  if (!partNumber) return 'Add a part number, like 4096-26-INT-001.'
  if (parts.some((p) => p.part_number === partNumber && p.id !== id)) return `${partNumber} is already used. Pick another number.`
  if (!part.name.trim()) return 'Add a name for the part.'
  if (!imported && part.kind === 'made' && !part.material.trim()) return 'Add the material, like "6061 aluminum, 1/4 in plate".'
  if (!imported && part.kind === 'cots' && !part.vendor.trim()) return 'Add the vendor you buy it from, like WCP or REV Robotics.'
  if (!Number.isInteger(part.quantity) || part.quantity < 1) return 'The quantity needs to be a whole number, 1 or more.'
  const names = { part_number: 'part number', name: 'name', revision: 'revision', material: 'material', vendor: 'vendor', vendor_part_number: 'vendor part number' }
  for (const [field, limit] of Object.entries(LIMITS) as [keyof typeof LIMITS, number][]) {
    const length = part[field].trim().length
    if (length > limit) return `Keep the ${names[field]} under ${limit} characters. This one is ${length}.`
  }
  return null
}

/** The columns saved for a part. Made parts keep only the material; COTS parts keep only the vendor details. */
function partFields(part: NewPart) {
  const text = (value: string) => value.trim() || null
  const made = part.kind === 'made'
  return {
    part_number: part.part_number.trim(),
    name: part.name.trim(),
    revision: text(part.revision),
    kind: part.kind,
    material: made ? text(part.material) : null,
    quantity: part.quantity,
    vendor: made ? null : text(part.vendor),
    vendor_part_number: made ? null : text(part.vendor_part_number),
  }
}

/** Add a part. Anyone on the team can add, change and delete parts. */
export async function addPart(part: NewPart): Promise<Result<Part>> {
  const problem = checkPart(part, partsTable.rows())
  if (problem) return fail(problem)
  return partsTable.insert({ system_id: part.system_id, ...partFields(part), onshape_url: null, onshape_id: null, removed_in_onshape: false })
}

/** Change a part. It stays in its system. The next import from Onshape updates what Onshape has. */
export async function changePart(part: Part, changes: NewPart): Promise<Result<Part>> {
  const problem = checkPart(changes, partsTable.rows(), part.id, Boolean(part.onshape_id))
  if (problem) return fail(problem)
  return partsTable.update(part.id, partFields(changes))
}

export async function removePart(part: Part): Promise<Result> {
  return partsTable.remove(part.id)
}

// ---------------------------------------------------------------------------
// Stages: what a made part goes through before it's on the robot (#15).
// Made by ..._bom_steps.sql. Anyone on the team can add and remove stages,
// move a stage along and count parts through it.

export type Stage = 'design' | 'pre' | 'process1' | 'process2' | 'post'
/** In order. A part only has the stages it needs. */
export const STAGES: Stage[] = ['design', 'pre', 'process1', 'process2', 'post']
export const STAGE_NAMES: Record<Stage, string> = {
  design: 'Design',
  pre: 'Pre-process',
  process1: 'Process 1',
  process2: 'Process 2',
  post: 'Post-process',
}
/** What each stage is for, to show when choosing them. */
export const STAGE_HINTS: Record<Stage, string> = {
  design: 'CAD',
  pre: 'Cutting stock to size, or CAM',
  process1: 'A machine',
  process2: 'A second machine',
  post: 'Deburring, tapping, finishing',
}

export type Machine = 'cnc_router' | 'lathe' | 'mill' | '3d_printer' | 'laser' | 'hand_tools'
export const MACHINES: Machine[] = ['cnc_router', 'lathe', 'mill', '3d_printer', 'laser', 'hand_tools']
export const MACHINE_NAMES: Record<Machine, string> = {
  cnc_router: 'CNC router',
  lathe: 'Lathe',
  mill: 'Mill',
  '3d_printer': '3D printer',
  laser: 'Laser',
  hand_tools: 'Hand tools',
}

/** Only the process stages use a machine. The database checks the same. */
export const isProcess = (stage: Stage) => stage === 'process1' || stage === 'process2'

export type StepStatus = 'todo' | 'in_progress' | 'done'
const STATUSES: StepStatus[] = ['todo', 'in_progress', 'done']
export const STATUS_NAMES: Record<StepStatus, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' }

/** One row of bom_steps: one stage of one made part. */
export interface Step extends Row {
  part_id: string
  stage: Stage
  /** For the process stages only. */
  machine: Machine | null
  status: StepStatus
  /** How many of the part's quantity are through this stage. */
  quantity_done: number
  created_by: string | null
}

// Example stages for the example made parts (ids from made() above).
const SIDE_PLATE = '00000000-0000-4000-8000-0000000b1001'
const ROLLER_SHAFT = '00000000-0000-4000-8000-0000000b1002'
const PIVOT_SPACER = '00000000-0000-4000-8000-0000000b1003'
const BELLYPAN = '00000000-0000-4000-8000-0000000b1007'
const FRAME_RAIL = '00000000-0000-4000-8000-0000000b1008'

let stepCount = 0
function step(part_id: string, stage: Stage, status: StepStatus, quantity_done: number, machine: Machine | null = null): Step {
  stepCount += 1
  return { id: `00000000-0000-4000-8000-0000000b2${String(stepCount).padStart(3, '0')}`, part_id, stage, machine, status, quantity_done, ...CREATED }
}

const EXAMPLE_STEPS: Step[] = [
  // Intake side plate (2): designed and CAMed, one routed so far.
  step(SIDE_PLATE, 'design', 'done', 2),
  step(SIDE_PLATE, 'pre', 'done', 2),
  step(SIDE_PLATE, 'process1', 'in_progress', 1, 'cnc_router'),
  step(SIDE_PLATE, 'post', 'todo', 0),
  // Roller shaft (3): cut to length, then turned on the lathe.
  step(ROLLER_SHAFT, 'design', 'done', 3),
  step(ROLLER_SHAFT, 'pre', 'done', 3),
  step(ROLLER_SHAFT, 'process1', 'in_progress', 1, 'lathe'),
  // Pivot spacer (4): printed, then reamed by hand.
  step(PIVOT_SPACER, 'design', 'done', 4),
  step(PIVOT_SPACER, 'process1', 'done', 4, '3d_printer'),
  step(PIVOT_SPACER, 'post', 'in_progress', 2),
  // Bellypan (1): still being designed.
  step(BELLYPAN, 'design', 'in_progress', 0),
  step(BELLYPAN, 'process1', 'todo', 0, 'cnc_router'),
  // Frame rail (4): milled, then holes routed.
  step(FRAME_RAIL, 'design', 'done', 4),
  step(FRAME_RAIL, 'pre', 'done', 4),
  step(FRAME_RAIL, 'process1', 'done', 4, 'mill'),
  step(FRAME_RAIL, 'process2', 'in_progress', 2, 'cnc_router'),
  step(FRAME_RAIL, 'post', 'todo', 0),
]

const byStage = (a: { stage: Stage }, b: { stage: Stage }) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage)

export const stepsTable = createTable<Step>('bom_steps', { demo: EXAMPLE_STEPS, sort: byStage })

/** Every stage of every part, in stage order. */
export function useSteps(): Step[] {
  return stepsTable.useRows()
}

/** One part's stages, in order. */
export function stepsFor(part: Part, steps: Step[]): Step[] {
  return steps.filter((s) => s.part_id === part.id)
}

/** How a stage is written on the page: its machine for the process stages, like "CNC router". */
export function stepName(step: Step): string {
  return step.machine ? MACHINE_NAMES[step.machine] : STAGE_NAMES[step.stage]
}

const partOf = (step: Step) => partsTable.rows().find((p) => p.id === step.part_id)

/** Count one more (+1) or one fewer (−1) through a stage: never below 0 or above the part's quantity. */
export async function changeDone(step: Step, by: 1 | -1): Promise<Result<Step>> {
  const part = partOf(step)
  if (!part) return fail('That part has been deleted.')
  const next = step.quantity_done + by
  if (next < 0) return fail(`None are through ${stepName(step)} yet.`)
  if (next > part.quantity) return fail(`All ${part.quantity} are already through ${stepName(step)}. The robot needs ${part.quantity}.`)
  return stepsTable.update(step.id, { quantity_done: next })
}

/** Move a stage on: to do → in progress → done. */
export async function advance(step: Step): Promise<Result<Step>> {
  const at = STATUSES.indexOf(step.status)
  if (at === STATUSES.length - 1) return fail(`${stepName(step)} is already done.`)
  return stepsTable.update(step.id, { status: STATUSES[at + 1] })
}

/** Move a stage back one, to undo a mistake: done → in progress → to do. */
export async function moveBack(step: Step): Promise<Result<Step>> {
  const at = STATUSES.indexOf(step.status)
  if (at === 0) return fail(`${stepName(step)} hasn't started yet.`)
  return stepsTable.update(step.id, { status: STATUSES[at - 1] })
}

/** Why a part can't be given this stage, or null if it can. `steps` are the part's stages. */
export function checkStep(part: Part, stage: Stage, machine: Machine | null, steps: Step[]): string | null {
  if (part.kind !== 'made') return 'Only custom parts have stages. COTS parts are bought ready.'
  if (steps.some((s) => s.stage === stage)) return `${part.name} already has ${STAGE_NAMES[stage]}.`
  if (isProcess(stage) && !machine) return `Pick the machine for ${STAGE_NAMES[stage]}.`
  return null
}

/** Give a made part a stage. */
export async function addStep(part: Part, stage: Stage, machine: Machine | null): Promise<Result<Step>> {
  const problem = checkStep(part, stage, machine, stepsFor(part, stepsTable.rows()))
  if (problem) return fail(problem)
  return stepsTable.insert({ part_id: part.id, stage, machine: isProcess(stage) ? machine : null, status: 'todo', quantity_done: 0 })
}

/** Take a stage off a part, with its progress. */
export async function removeStep(step: Step): Promise<Result> {
  return stepsTable.remove(step.id)
}

/**
 * The page's station filter: every made part, the parts still waiting for
 * one stage, or still waiting for one machine. "Waiting" means that stage
 * isn't done yet.
 */
export type Station = { kind: 'all' } | { kind: 'stage'; stage: Stage } | { kind: 'machine'; machine: Machine }

export function stationName(station: Station): string {
  if (station.kind === 'stage') return `Waiting for ${STAGE_NAMES[station.stage].toLowerCase()}`
  if (station.kind === 'machine') return `${MACHINE_NAMES[station.machine]} only`
  return 'Every stage'
}

/** The parts with a stage at this station that isn't done, and those stages. */
export function stationQueue(parts: Part[], steps: Step[], station: Station): { part: Part; steps: Step[] }[] {
  return parts
    .filter((p) => p.kind === 'made')
    .map((part) => {
      const own = stepsFor(part, steps)
      if (station.kind === 'all') return { part, steps: own }
      const waiting = own.filter((s) =>
        s.status !== 'done' && (station.kind === 'stage' ? s.stage === station.stage : s.machine === station.machine),
      )
      return { part, steps: waiting }
    })
    .filter((q) => station.kind === 'all' || q.steps.length > 0)
}

// ---------------------------------------------------------------------------
// Importing from Onshape. planOnshapeImport() in onshape.ts works out what changes.

/**
 * Read a system's parts from Onshape, through the onshape server function.
 * Each call costs two of the team's yearly Onshape API calls, so only call
 * it when someone asks to import. In demo mode it answers with example parts.
 */
export function getOnshapeBom(system: BomSystem): Promise<Result<OnshapeBom>> {
  if (!system.onshape_url) {
    return Promise.resolve(fail(`Add ${system.name}'s Onshape link first: Change system, then paste the assembly's address.`))
  }
  return callFunction<OnshapeBom>('onshape', { kind: 'bom', url: system.onshape_url }, () => exampleOnshapeBom(system))
}

/** Make the changes an import plan lists, and note when the system was imported. */
export async function applyOnshapeImport(system: BomSystem, plan: OnshapeImportPlan): Promise<Result<string>> {
  const added = await partsTable.insertMany(plan.add)
  if (!added.ok) return added
  for (const { part, changes } of plan.change) {
    const result = await partsTable.update(part.id, changes)
    if (!result.ok) return result
  }
  for (const part of plan.removed) {
    const result = await partsTable.update(part.id, { removed_in_onshape: true })
    if (!result.ok) return result
  }
  const result = await systemsTable.update(system.id, { onshape_imported_at: new Date().toISOString() })
  if (!result.ok) return result
  const changed = plan.change.filter((c) => c.what.length > 0).length
  return ok(`Imported ${system.name}: ${plan.add.length} added, ${changed} changed, ${plan.removed.length} marked removed in Onshape.`)
}

/**
 * What the example Intake's made-up Onshape assembly has now: the side
 * plate's quantity changed, the pivot spacer is gone, and a roller and
 * standard screws were added.
 */
function exampleOnshapeBom(system: BomSystem): OnshapeBom {
  if (system.id !== INTAKE) return { name: `${system.name} assembly`, kind: 'assembly', lines: [] }
  const line = (n: number, name: string, quantity: number, more: Partial<OnshapeBom['lines'][number]> = {}) => ({
    onshape_id: exampleOnshapeId(n), name, part_number: null, revision: null, quantity, material: null, vendor: null, standard: false, url: EXAMPLE_PART_STUDIO, ...more,
  })
  return {
    name: 'Intake assembly',
    kind: 'assembly',
    lines: [
      line(1, 'Intake side plate', 3, { part_number: '4096-26-INT-001', revision: 'B', material: '6061 aluminum, 1/4 in plate' }),
      line(2, 'Roller shaft', 3, { part_number: '4096-26-INT-002', revision: 'A', material: '1/2 in hex aluminum bar' }),
      line(4, 'Brushless motor', 2, { vendor: 'REV Robotics', part_number: 'EXAMPLE-NEO-01' }),
      line(5, 'Compliant wheel, 2 in', 8, { vendor: 'AndyMark', part_number: 'EXAMPLE-CW-2' }),
      line(6, 'Flanged bearing, 1/2 in hex', 6, { vendor: 'WCP', part_number: 'EXAMPLE-BRG-12' }),
      line(7, 'Intake roller', 2, { material: 'Polycarbonate tube, 1.5 in' }),
      line(8, 'Socket head cap screw #10-32 x 0.5', 24, { standard: true, part_number: 'EXAMPLE-SHCS-1032' }),
    ],
  }
}

/** The home page tile's status, like "2 systems · 43 parts". Parts removed in Onshape don't count. */
export function bomSummary(systems: BomSystem[], parts: Part[]): Notice {
  if (systems.length === 0) return { tone: 'plain', text: 'No systems yet' }
  const current = parts.filter((p) => !p.removed_in_onshape)
  return { tone: 'info', text: `${plural(systems.length, 'system', 'systems')} · ${plural(current.length, 'part', 'parts')}` }
}

export function useBomSummary(): Notice {
  return bomSummary(systemsTable.useRows(), partsTable.useRows())
}
