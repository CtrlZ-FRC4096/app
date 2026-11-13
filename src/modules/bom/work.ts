/**
 * BOM work (#16): the stages each person has been given, and giving a whole
 * part to someone at once.
 *
 * - myWork() lists one person's stages, grouped by status, for the "My work"
 *   panel on the BOM page (MyWork.tsx).
 * - workNotices() turns that into the home page's "Needs attention" line,
 *   like "3 stages to do (1 late)".
 * - assignWholePart() gives every stage of a part the same person and due
 *   date, using assignStep() from data.ts for each one.
 *
 * Anyone on the team can assign stages, and move any stage along: the
 * database's rules are in ..._bom_steps.sql and ..._bom_steps_assign.sql.
 */
import { fail, ok, type Result } from '../../core/table'
import { plural } from '../../core/format'
import { useSession } from '../../core/session'
import type { Notice } from '../../core/registry'
import {
  STAGES, assignStep, isOverdue, partsTable, stepsFor, stepsTable, systemsTable, today,
  type Assignment, type BomSystem, type Part, type Step, type StepStatus,
} from './data'

/** One of someone's stages, with the part and system it belongs to. */
export interface WorkItem {
  step: Step
  part: Part
  system: BomSystem
  /** Its due date has passed and it isn't done (isOverdue() in data.ts). */
  late: boolean
}

/** The stages with one status, like every "In progress" one. */
export interface WorkGroup {
  status: StepStatus
  items: WorkItem[]
}

/** The order the groups are shown in: the same order a stage moves through. */
const GROUP_ORDER: StepStatus[] = ['todo', 'in_progress', 'done']

/**
 * Late ones first, then the soonest due date, then those with no due date.
 * Ties go by part number, then by the order of the stages.
 */
function byUrgency(a: WorkItem, b: WorkItem): number {
  if (a.late !== b.late) return a.late ? -1 : 1
  const dueA = a.step.due_date ?? '9999-12-31'
  const dueB = b.step.due_date ?? '9999-12-31'
  if (dueA !== dueB) return dueA.localeCompare(dueB)
  return a.part.part_number.localeCompare(b.part.part_number) || STAGES.indexOf(a.step.stage) - STAGES.indexOf(b.step.stage)
}

/**
 * The stages assigned to one person (`personId`), grouped by status: To do,
 * then In progress, then Done. Groups with nothing in them are left out.
 * Within a group, late stages come first, then by due date (see byUrgency).
 *
 * Stages of parts marked "Removed in Onshape" are left out, because the BOM
 * page doesn't show their stages any more. So are stages whose part or
 * system has been deleted. `day` is today, like 2026-11-13.
 */
export function myWork(personId: string, steps: Step[], parts: Part[], systems: BomSystem[], day: string = today()): WorkGroup[] {
  const items: WorkItem[] = []
  for (const step of steps) {
    if (step.assigned_to !== personId) continue
    const part = parts.find((p) => p.id === step.part_id)
    if (!part || part.removed_in_onshape) continue
    const system = systems.find((s) => s.id === part.system_id)
    if (!system) continue
    items.push({ step, part, system, late: isOverdue(step, day) })
  }
  return GROUP_ORDER
    .map((status) => ({ status, items: items.filter((item) => item.step.status === status).sort(byUrgency) }))
    .filter((group) => group.items.length > 0)
}

/** The stages in these groups that aren't done yet: To do and In progress. */
export function openItems(groups: WorkGroup[]): WorkItem[] {
  return groups.filter((g) => g.status !== 'done').flatMap((g) => g.items)
}

/**
 * The home page's line about someone's work, like "3 stages to do (1 late)".
 * "To do" here means every stage that isn't done, started or not. It's in
 * the warning colour when any are late. Nothing at all when they have none.
 */
export function workNotices(groups: WorkGroup[]): Notice[] {
  const open = openItems(groups)
  if (open.length === 0) return []
  const late = open.filter((item) => item.late).length
  const text = `${plural(open.length, 'stage', 'stages')} to do` + (late > 0 ? ` (${late} late)` : '')
  return [{ tone: late > 0 ? 'warn' : 'info', text }]
}

/** The signed-in person's stages, grouped by status. For the My work panel. */
export function useMyWork(): WorkGroup[] {
  const { id } = useSession()
  return myWork(id, stepsTable.useRows(), partsTable.useRows(), systemsTable.useRows())
}

/** The home page's "Needs attention" line for the signed-in person's stages. Set as useAttention in index.ts. */
export function useMyWorkAttention(): Notice[] {
  return workNotices(useMyWork())
}

/**
 * Give every stage of a part that isn't done the same person and due date
 * (either can be null, to clear it). Done stages keep who did them. Gives how
 * many stages were saved.
 *
 * `steps` is every stage (or just this part's). The assignment is checked
 * once, by the first assignStep(), so a bad one saves nothing.
 */
export async function assignWholePart(part: Part, steps: Step[], assignment: Assignment): Promise<Result<number>> {
  const own = stepsFor(part, steps)
  if (own.length === 0) return fail(`${part.name} has no stages yet. Add them with Add stages first.`)
  const open = own.filter((s) => s.status !== 'done')
  if (open.length === 0) return fail(`Every stage of ${part.name} is done, so there's nothing left to assign.`)
  let saved = 0
  for (const step of open) {
    const result = await assignStep(step, assignment)
    if (!result.ok) {
      return fail(saved === 0 ? result.error : `Saved ${saved} of ${open.length} stages, then: ${result.error} Try again to save the rest.`)
    }
    saved += 1
  }
  return ok(saved)
}
