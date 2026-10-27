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

/** Made in our shop, or COTS (bought "commercial off the shelf"). */
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

/** The choices in the page's Made / COTS filter. */
export const PART_FILTERS = ['All', 'Made', 'COTS'] as const
export type PartFilter = (typeof PART_FILTERS)[number]

/** How a part's kind is written on the page. */
export function kindLabel(kind: PartKind): string {
  return kind === 'made' ? 'Made' : 'COTS'
}

/** Only the parts the filter asks for. */
export function filterParts(parts: Part[], filter: PartFilter): Part[] {
  if (filter === 'Made') return parts.filter((p) => p.kind === 'made')
  if (filter === 'COTS') return parts.filter((p) => p.kind === 'cots')
  return parts
}

/**
 * How many parts are made and how many are COTS. Each part counts once,
 * whatever its quantity. Parts removed in Onshape don't count.
 */
export function countParts(parts: Part[]): { made: number; cots: number } {
  const current = parts.filter((p) => !p.removed_in_onshape)
  const made = current.filter((p) => p.kind === 'made').length
  return { made, cots: current.length - made }
}

/** Like "12 made, 31 COTS". */
export function partCountText(parts: Part[]): string {
  const { made, cots } = countParts(parts)
  return `${made} made, ${cots} COTS`
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
