/**
 * How close each system, and the whole robot, is to being built (#23).
 * The dashboard on the BOM page (Dashboard.tsx) and the home page tile read
 * these numbers. Nothing here saves anything: it only counts.
 *
 * What counts as done:
 * - A **stage** is finished when it's marked Done. A Done stage counts all of
 *   the part's quantity through it, even if nobody counted them with +.
 * - A **piece** of a Custom part is made when it's through every one of the
 *   part's stages. So a part with 4 through the lathe and 1 through
 *   post-process has 1 of 4 made.
 * - A **Custom part is done** when it has at least one stage and every stage
 *   is marked Done. A Custom part with no stages yet isn't done: its stages
 *   haven't been chosen, so nobody knows what's left to make.
 * - A **COTS part is covered** when Inventory has enough on the shelf for the
 *   whole robot. A part used in more than one system is added up first, by
 *   shortages() in data.ts, so 7 bearings aren't counted as enough for both
 *   the intake (6) and the drivetrain (4).
 *
 * The percent: each part (each line of the BOM) counts the same, and a part
 * that's partly there counts partly. 3 of 4 made counts as 75% of that part;
 * 6 of 8 wheels on the shelf counts as 75% too. Each line counts the same so
 * that 120 rivets don't count for more than the whole intake. Parts removed
 * in Onshape don't count at all.
 */
import { plural } from '../../core/format'
import type { Notice } from '../../core/registry'
import { itemsTable, type Item } from '../inventory/data'
import {
  MACHINES, MACHINE_NAMES, STAGE_NAMES, partsTable, robotsTable, shortageFor, shortages, stationQueue, stepsFor, stepsTable, systemsTable,
  type BomSystem, type Part, type Robot, type Shortage, type Station, type Step,
} from './data'

/** How many parts in a system (or the robot) are still waiting for one stage or machine. */
export interface Waiting {
  /** The page's station filter for it, to show those parts. */
  station: Station
  /** Like "design" or "CNC router". */
  name: string
  /** How many parts (lines, not pieces) have that stage still to do. */
  parts: number
}

/** The numbers for one system, or for the whole robot. */
export interface BuildStats {
  /** How many parts (lines of the BOM), Custom and COTS. */
  parts: number
  custom: number
  cots: number
  /** Custom parts with every stage marked Done. */
  customDone: number
  /** Custom parts with no stages yet. */
  noStages: number
  /** COTS parts with enough on the shelf for the robot. */
  cotsCovered: number
  /** How many parts are waiting at each stage, in the order of the stages. Only stages with some waiting. */
  waiting: Waiting[]
  /** How far along, from 0 to 1, counting quantities. Null when there are no parts to count. */
  progress: number | null
  /** The same for the Custom parts only, and for the COTS parts only. */
  customProgress: number | null
  cotsProgress: number | null
}

/**
 * How many pieces of a Custom part are made: through every one of its
 * stages. `steps` are the part's stages. A stage marked Done counts all of
 * them; otherwise its count does ("1 of 3"). 0 if it has no stages yet.
 */
export function piecesMade(part: Part, steps: Step[]): number {
  if (steps.length === 0) return 0
  const through = steps.map((s) => (s.status === 'done' ? part.quantity : Math.min(Math.max(s.quantity_done, 0), part.quantity)))
  return Math.min(...through)
}

/** Is a Custom part done? It has stages, and every one is marked Done. `steps` are the part's stages. */
export function isPartDone(steps: Step[]): boolean {
  return steps.length > 0 && steps.every((s) => s.status === 'done')
}

/**
 * The stations the dashboard counts, in the order a part goes through them.
 * The process stages are counted by their machine, like the page shows them.
 */
const STATIONS: Station[] = [
  { kind: 'stage', stage: 'design' },
  { kind: 'stage', stage: 'pre' },
  ...MACHINES.map((machine): Station => ({ kind: 'machine', machine })),
  { kind: 'stage', stage: 'post' },
]

/** How a station is named after "waiting for": "design", "pre-process", or a machine like "CNC router". */
function waitingName(station: Station): string {
  if (station.kind === 'stage') return STAGE_NAMES[station.stage].toLowerCase()
  if (station.kind === 'machine') return MACHINE_NAMES[station.machine]
  return 'any stage'
}

/** Like "3 waiting for CNC router". */
export function waitingText(waiting: Waiting): string {
  return `${waiting.parts} waiting for ${waiting.name}`
}

/** The average of some numbers from 0 to 1, or null if there are none. */
const average = (values: number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null)

/**
 * The numbers for one system's parts. `steps` are every stage. `all` is
 * shortages() for the whole robot's parts, so a COTS part two systems share
 * counts the same in both: if the robot has 7 of the 10 it needs, each
 * system's line counts as 70% there.
 */
export function systemStats(parts: Part[], steps: Step[], all: Shortage[]): BuildStats {
  const current = parts.filter((p) => !p.removed_in_onshape)
  const custom = current.filter((p) => p.kind === 'made')
  const cots = current.filter((p) => p.kind === 'cots')

  // How far along each part is, from 0 to 1.
  const customShares = custom.map((p) => piecesMade(p, stepsFor(p, steps)) / p.quantity)
  const cotsShares = cots.map((p) => {
    const line = shortageFor(p, all)
    return line && line.needed > 0 ? Math.min(1, line.on_shelf / line.needed) : 0
  })

  const waiting = STATIONS
    .map((station) => ({ station, name: waitingName(station), parts: stationQueue(custom, steps, station).length }))
    .filter((w) => w.parts > 0)

  return {
    parts: current.length,
    custom: custom.length,
    cots: cots.length,
    customDone: custom.filter((p) => isPartDone(stepsFor(p, steps))).length,
    noStages: custom.filter((p) => stepsFor(p, steps).length === 0).length,
    cotsCovered: cots.filter((p) => shortageFor(p, all)?.short === 0).length,
    waiting,
    progress: average([...customShares, ...cotsShares]),
    customProgress: average(customShares),
    cotsProgress: average(cotsShares),
  }
}

/** The robot's numbers: a total, and each system's. */
export interface RobotStats {
  total: BuildStats
  systems: { system: BomSystem; stats: BuildStats }[]
}

/**
 * The numbers for a robot: its total, then each of its systems in order.
 * `parts` are the robot's parts, `steps` every stage, and `items`
 * Inventory's parts, for what's on the shelf. The total counts every part
 * in the robot, so a big system counts for more than a small one.
 */
export function robotStats(systems: BomSystem[], parts: Part[], steps: Step[], items: Item[]): RobotStats {
  const ids = new Set(systems.map((s) => s.id))
  const mine = parts.filter((p) => ids.has(p.system_id))
  const all = shortages(mine, items)
  return {
    total: systemStats(mine, steps, all),
    systems: systems.map((system) => ({ system, stats: systemStats(mine.filter((p) => p.system_id === system.id), steps, all) })),
  }
}

/**
 * A progress number as a whole percent, like 62. Rounded down, so it only
 * says 100% when everything is done.
 */
export function percent(progress: number | null): number {
  // The tiny extra stops 0.29 × 100 = 28.999… rounding down to 28.
  return Math.floor((progress ?? 0) * 100 + 1e-6)
}

/**
 * The home page tile's status, like "Robot 62% built", for the robot the
 * BOM page opens on (the first one). With more than one robot, it names it.
 */
export function robotSummary(robots: Robot[], systems: BomSystem[], parts: Part[], steps: Step[], items: Item[]): Notice {
  const robot = robots[0]
  if (!robot) return { tone: 'plain', text: 'No robot yet' }
  const own = systems.filter((s) => s.robot_id === robot.id)
  if (own.length === 0) return { tone: 'plain', text: 'No systems yet' }
  const { total } = robotStats(own, parts, steps, items)
  if (total.parts === 0) return { tone: 'plain', text: `${plural(own.length, 'system', 'systems')}, no parts yet` }
  const built = percent(total.progress)
  const name = robots.length > 1 ? `${robot.name}:` : 'Robot'
  return { tone: built === 100 ? 'ok' : 'info', text: `${name} ${built}% built` }
}

/** The home page tile's status. It updates as soon as anyone marks a stage done, or Inventory changes. */
export function useRobotSummary(): Notice {
  return robotSummary(robotsTable.useRows(), systemsTable.useRows(), partsTable.useRows(), stepsTable.useRows(), itemsTable.useRows())
}
