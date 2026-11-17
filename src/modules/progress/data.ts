/**
 * Build progress data: where each subsystem stands, stage by stage.
 *
 * Moved here from Robot status (#65, step 1). Saved in the build_subsystems
 * table (#65, step 2), made by supabase/migrations/..._build_subsystems.sql,
 * so the grid is shared with the team and survives a reload.
 *
 * Everyone on the team sees the grid. Only student leaders, mentors and
 * admins change it: cells, and adding, renaming, reordering and removing
 * subsystems. The database checks that too; the checks here are so the page
 * can say why straight away.
 */
import { DEMO_PEOPLE } from '../../core/demo'
import { currentUser, isLeader } from '../../core/session'
import { createTable, fail, ok, type Result, type Row } from '../../core/table'

/** The stages, in order across the grid. Not columns in the table, so they can change without a migration. */
export const STAGES = ['Design', 'Built', 'Wired', 'Programmed', 'Tested'] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_STATES = ['Not started', 'In progress', 'Done'] as const
export type StageState = (typeof STAGE_STATES)[number]

/** One row of the build_subsystems table. The fields match its columns. */
export interface Subsystem extends Row {
  name: string
  /** The order on the grid, smallest first. */
  position: number
  /**
   * Each stage's state, by the stage's name. A stage that isn't here is Not
   * started, so a stage added to STAGES later needs no change to old rows.
   */
  stages: Partial<Record<Stage, StageState>>
  /** Who added it. */
  created_by: string | null
}

export const NAME_LIMIT = 60

export const LEADERS_ONLY = 'Ask a student leader or mentor to update build progress.'

function example(id: string, name: string, position: number): Subsystem {
  return {
    id,
    name,
    position,
    stages: { Design: 'Not started', Built: 'Not started', Wired: 'Not started', Programmed: 'Not started', Tested: 'Not started' },
    created_at: '2026-11-01T18:00:00Z',
    created_by: DEMO_PEOPLE.pat,
  }
}

// The six subsystems the grid started with, for demo mode.
const EXAMPLE_SUBSYSTEMS: Subsystem[] = [
  example('00000000-0000-4000-8000-0000000b5001', 'Swerve drivetrain', 1),
  example('00000000-0000-4000-8000-0000000b5002', 'Intake', 2),
  example('00000000-0000-4000-8000-0000000b5003', 'Indexer', 3),
  example('00000000-0000-4000-8000-0000000b5004', 'Shooter', 4),
  example('00000000-0000-4000-8000-0000000b5005', 'Climber', 5),
  example('00000000-0000-4000-8000-0000000b5006', 'Vision', 6),
]

export const subsystemsTable = createTable<Subsystem>('build_subsystems', {
  demo: EXAMPLE_SUBSYSTEMS,
  sort: (a, b) => a.position - b.position || a.name.localeCompare(b.name),
})

/** Every subsystem, in order on the grid. */
export function useSubsystems(): Subsystem[] {
  return subsystemsTable.useRows()
}

/** A stage's state, Not started if it hasn't been set. */
export function stateOf(subsystem: Subsystem, stage: Stage): StageState {
  return subsystem.stages[stage] ?? 'Not started'
}

/** Return a copy with only the selected stage advanced, wrapping Done to Not started. */
export function advanceStage(subsystem: Subsystem, stage: Stage): Subsystem {
  const nextIndex = (STAGE_STATES.indexOf(stateOf(subsystem, stage)) + 1) % STAGE_STATES.length
  return {
    ...subsystem,
    stages: { ...subsystem.stages, [stage]: STAGE_STATES[nextIndex] },
  }
}

/** Why the signed-in person can't change the grid, or null if they can. */
function leaderProblem(): string | null {
  const me = currentUser()
  return me && isLeader(me.role) ? null : LEADERS_ONLY
}

/** Move one cell along: Not started → In progress → Done → Not started. */
export async function changeCell(subsystem: Subsystem, stage: Stage): Promise<Result<Subsystem>> {
  const problem = leaderProblem()
  if (problem) return fail(problem)
  return subsystemsTable.update(subsystem.id, { stages: advanceStage(subsystem, stage).stages })
}

/** Why a subsystem can't have this name, or null if it can. `id` is the one being renamed, if any. */
export function checkName(name: string, subsystems: Subsystem[], id?: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Give the subsystem a name, like Intake.'
  if (trimmed.length > NAME_LIMIT) return `Keep the name under ${NAME_LIMIT} characters.`
  const taken = subsystems.find((s) => s.name.toLowerCase() === trimmed.toLowerCase() && s.id !== id)
  if (taken) return `There's already a subsystem called ${taken.name}.`
  return null
}

/** Add a subsystem at the bottom of the grid, with every stage Not started. */
export async function addSubsystem(name: string): Promise<Result<Subsystem>> {
  const rows = subsystemsTable.rows()
  const problem = leaderProblem() ?? checkName(name, rows)
  if (problem) return fail(problem)
  const position = rows.reduce((max, s) => Math.max(max, s.position), 0) + 1
  return subsystemsTable.insert({ name: name.trim(), position, stages: {} })
}

export async function renameSubsystem(subsystem: Subsystem, name: string): Promise<Result<Subsystem>> {
  const problem = leaderProblem() ?? checkName(name, subsystemsTable.rows(), subsystem.id)
  if (problem) return fail(problem)
  return subsystemsTable.update(subsystem.id, { name: name.trim() })
}

export async function removeSubsystem(subsystem: Subsystem): Promise<Result> {
  const problem = leaderProblem()
  if (problem) return fail(problem)
  return subsystemsTable.remove(subsystem.id)
}

/**
 * Move a subsystem one place up (-1) or down (1) on the grid, by swapping
 * places with its neighbour. Moving the first one up, or the last one down,
 * does nothing.
 */
export async function moveSubsystem(subsystem: Subsystem, direction: -1 | 1): Promise<Result> {
  const problem = leaderProblem()
  if (problem) return fail(problem)
  const rows = subsystemsTable.rows()
  const i = rows.findIndex((s) => s.id === subsystem.id)
  const other = rows[i + direction]
  if (i === -1 || !other) return ok(null)
  // Positions can be equal (two added at once), so give them distinct ones while swapping.
  const [mine, theirs] = subsystem.position === other.position ? [other.position + direction, other.position] : [other.position, subsystem.position]
  const first = await subsystemsTable.update(subsystem.id, { position: mine })
  if (!first.ok) return first
  const second = await subsystemsTable.update(other.id, { position: theirs })
  return second.ok ? ok(null) : second
}
