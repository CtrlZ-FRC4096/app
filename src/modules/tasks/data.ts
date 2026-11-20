/**
 * Task board (#157): general jobs for students that aren't on the BOM or the
 * pit checklist, like "Sort the hardware bins", grouped by subteam.
 *
 * The tasks are in the team database (supabase/migrations/..._tasks.sql),
 * so everyone sees the same board. Student leaders, mentors and admins add,
 * edit, assign, delete and move any task. Students move the tasks assigned
 * to them along (To do → In progress → Done) and change nothing else. The
 * database refuses anything else; the checks here are so the page can say
 * why straight away.
 *
 * This file only imports from src/core, not other modules: whatever the
 * module's index.ts imports from here (the home page hooks) ends up in the
 * app's main download, so it's kept small. That's why today() and isDay()
 * are small copies of the BOM's.
 */
import { createTable, fail, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'
import { plural } from '../../core/format'
import { membersTable, nameMatches, type Member } from '../../core/members'
import { currentUser, isLeader, useSession, type Role } from '../../core/session'
import type { Notice } from '../../core/registry'

/** The subteams, in the board's order. The same names as the pit checklist's PIT_SUBGROUPS, so the team names them the same everywhere. */
export const SUBTEAMS = ['General', 'Mechanical', 'Electrical', 'Programming', 'Drive team'] as const
export type Subteam = typeof SUBTEAMS[number]

/** Whether some text is one of the subteams. (SUBTEAMS.includes() won't take a plain string.) */
export function isSubteam(value: string): value is Subteam {
  return (SUBTEAMS as readonly string[]).includes(value)
}

/** The subteam filter's first option: every subteam. */
export const ALL = 'All'

export type TaskStatus = 'todo' | 'in_progress' | 'done'
const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done']
export const STATUS_NAMES: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' }

/** The database allows the same: see the checks on the title and details columns. */
export const TITLE_LIMIT = 120
export const DETAILS_LIMIT = 1000

/** One row of the tasks table. The fields match its columns. */
export interface Task extends Row {
  title: string
  /** Optional: '' when there are none. */
  details: string
  /** Usually one of SUBTEAMS. A plain string, so a task whose subteam is taken off the list still shows. */
  subteam: string
  /** Who it's for: members' ids. Empty means nobody yet. */
  assignee_ids: string[]
  /** Like 2026-11-20, or null for no due date. */
  due_date: string | null
  status: TaskStatus
  /** When it was marked done. The database sets it; empty unless the task is done. */
  done_at: string | null
  /** Who added it. Show their name with useMemberNames(). */
  created_by: string | null
}

/** What a student leader fills in on the Add a task form. */
export interface TaskFields {
  title: string
  details: string
  subteam: string
  assignee_ids: string[]
  /** '' or null for no due date. */
  due_date: string | null
}

// ---------------------------------------------------------------------------
// Dates. "Today" is the date on the person's own device, as in the BOM.

/** Today's date where the person is, like 2026-11-19. */
export function today(now: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

/** The day `days` after `day` (before, if it's negative), like 2026-11-21. */
function dayFrom(day: string, days: number): string {
  // Noon, so changing to or from daylight saving time can't move the day.
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + days)
  return today(date)
}

/** Is this a real day written like 2026-11-20? */
function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
}

/** Late: it isn't done and its due date has passed. Due today isn't late yet. */
export function isLate(task: Pick<Task, 'status' | 'due_date'>, day: string = today()): boolean {
  return task.status !== 'done' && task.due_date !== null && task.due_date < day
}

/** A due date as it's written on the page: "Due today", "Due Nov 20", or nothing with no due date. */
export function dueText(due_date: string | null, day: string = today()): string {
  if (!due_date) return ''
  if (due_date === day) return 'Due today'
  // Noon, so the day is the same in every time zone the team could be in.
  return 'Due ' + new Date(`${due_date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The soonest due date first, tasks with no due date last, then oldest first. */
function bySoonestDue(a: Task, b: Task): number {
  const dueA = a.due_date ?? '9999-12-31'
  const dueB = b.due_date ?? '9999-12-31'
  return dueA.localeCompare(dueB) || a.created_at.localeCompare(b.created_at)
}

/** The most recently done first. */
function byNewestDone(a: Task, b: Task): number {
  return (b.done_at ?? '').localeCompare(a.done_at ?? '') || b.created_at.localeCompare(a.created_at)
}

// ---------------------------------------------------------------------------
// Example tasks for demo mode, for made-up people. Due dates are counted from
// the day the page first loads, so there's always one late and one due today.

const DEMO_DAY = today()

function example(n: number, title: string, subteam: Subteam, assignee_ids: string[], dueInDays: number | null, status: TaskStatus, details = ''): Task {
  const due_date = dueInDays === null ? null : dayFrom(DEMO_DAY, dueInDays)
  return {
    id: `00000000-0000-4000-8000-0000000a5${String(n).padStart(3, '0')}`,
    title,
    details,
    subteam,
    assignee_ids,
    due_date,
    status,
    // The example tasks that are done were done on their due day.
    done_at: status === 'done' ? `${due_date ?? DEMO_DAY}T20:00:00Z` : null,
    created_at: '2026-11-10T18:00:00Z',
    created_by: DEMO_PEOPLE.casey,
  }
}

const { alex, jordan, casey } = DEMO_PEOPLE

const EXAMPLE_TASKS: Task[] = [
  example(1, 'Re-crimp the PDH connectors', 'Electrical', [alex], -2, 'in_progress', 'Use the red ferrules in the electrical drawer.'),
  example(2, 'Put the new drill bits away', 'General', [alex], 0, 'todo'),
  example(3, 'Sort the hardware bins', 'General', [alex, jordan], 3, 'todo', 'Bolts by length, then nuts and washers by size.'),
  example(4, 'Update the drive code README', 'Programming', [jordan], null, 'todo'),
  example(5, 'Replace the worn intake belts', 'Mechanical', [], 5, 'todo'),
  example(6, 'Write the driver practice plan', 'Drive team', [casey], 1, 'in_progress'),
  example(7, 'Label the spare motor controllers', 'Electrical', [jordan], -4, 'done'),
  example(8, 'Sweep the shop floor', 'General', [alex], -1, 'done'),
]

export const tasksTable = createTable<Task>('tasks', { demo: EXAMPLE_TASKS, sort: bySoonestDue })

/** Every task, soonest due first. */
export function useTasks(): Task[] {
  return tasksTable.useRows()
}

/** The signed-in person's unfinished tasks, soonest due first. For My tasks. */
export function useMyTasks(): Task[] {
  return myTasks(useTasks(), useSession().id)
}

// ---------------------------------------------------------------------------
// Rules

/** One person's unfinished tasks, soonest due first (so late ones come first), no due date last. */
export function myTasks(tasks: Task[], personId: string): Task[] {
  return tasks.filter((task) => task.status !== 'done' && task.assignee_ids.includes(personId)).sort(bySoonestDue)
}

/** Whether someone adds, edits, assigns and deletes tasks: student leaders, mentors and admins. */
export function canManageTasks(role: Role): boolean {
  return isLeader(role)
}

/** Whether someone may move a task along: the people it's for, and student leaders, mentors and admins. */
export function canMoveAlong(task: Pick<Task, 'assignee_ids'>, user: { id: string; role: Role }): boolean {
  return canManageTasks(user.role) || task.assignee_ids.includes(user.id)
}

/** The status after this one, or null when it's done. */
export function nextStatus(status: TaskStatus): TaskStatus | null {
  return STATUSES[STATUSES.indexOf(status) + 1] ?? null
}

/** The status before this one, or null at To do. */
export function previousStatus(status: TaskStatus): TaskStatus | null {
  return STATUSES[STATUSES.indexOf(status) - 1] ?? null
}

/**
 * Why a task can't be saved like this, or null if it can. `members` is the
 * whole team. `already` is who was on the task before an edit: they may stay
 * even if their access has been switched off since.
 */
export function checkTask(fields: TaskFields, members: Member[], already: string[] = []): string | null {
  const title = fields.title.trim()
  if (!title) return 'Say what needs doing first.'
  if (title.length > TITLE_LIMIT) return `Keep the task under ${TITLE_LIMIT} characters. Put the rest in Details.`
  if (fields.details.trim().length > DETAILS_LIMIT) return `Keep the details under ${DETAILS_LIMIT} characters.`
  if (!isSubteam(fields.subteam)) return 'Pick a subteam from the list.'
  for (const id of fields.assignee_ids) {
    if (already.includes(id)) continue
    const member = members.find((m) => m.id === id)
    if (!member) return "One of the people isn't on the team any more. Take them off and pick someone else."
    if (!member.active) return `${member.name}'s access is switched off, so they can't be given tasks. Take them off.`
  }
  if (fields.due_date && !isDay(fields.due_date)) return 'Pick the due date from the calendar, or leave it empty.'
  return null
}

/** The tasks whose title, details or people's names contain the search, ignoring capitals. An empty search keeps everything. */
export function findTasks(tasks: Task[], search: string, nameOf: (id: string) => string): Task[] {
  if (!search.trim()) return tasks
  return tasks.filter(
    (task) => nameMatches(task.title, search) || nameMatches(task.details, search) || task.assignee_ids.some((id) => nameMatches(nameOf(id), search)),
  )
}

export interface BoardSection {
  subteam: string
  /** To do and In progress, in the table's order (soonest due first). */
  open: Task[]
  /** Done, the most recently done first. */
  done: Task[]
}

/**
 * The board: one section for each subteam, in order, even empty ones. With
 * `show` set to one subteam, only that section. When showing every subteam,
 * a task whose subteam isn't in SUBTEAMS any more gets a section at the end,
 * so no task ever disappears.
 */
export function boardSections(tasks: Task[], show: string = ALL): BoardSection[] {
  const names: string[] = show === ALL ? [...SUBTEAMS] : [show]
  if (show === ALL) {
    for (const task of tasks) if (!names.includes(task.subteam)) names.push(task.subteam)
  }
  return names.map((subteam) => {
    const mine = tasks.filter((task) => task.subteam === subteam)
    return { subteam, open: mine.filter((task) => task.status !== 'done'), done: mine.filter((task) => task.status === 'done').sort(byNewestDone) }
  })
}

// ---------------------------------------------------------------------------
// Changing tasks. Each checks first, so the page can say what's wrong.

const MISSING = 'That task is no longer on the board.'
const findTask = (id: string) => tasksTable.rows().find((task) => task.id === id)

/** Null for a student leader, mentor or admin; otherwise who to ask, like "Ask a student leader or mentor to add tasks." */
function leaderProblem(what: string): string | null {
  const user = currentUser()
  return user && canManageTasks(user.role) ? null : `Ask a student leader or mentor to ${what}.`
}

/** Trims the text, lists each person once, and saves an empty due date as none. */
function tidy(fields: TaskFields): TaskFields {
  return {
    title: fields.title.trim(),
    details: fields.details.trim(),
    subteam: fields.subteam,
    assignee_ids: [...new Set(fields.assignee_ids)],
    due_date: fields.due_date || null,
  }
}

/** Add a task, at To do. Student leaders, mentors and admins only. */
export async function addTask(fields: TaskFields): Promise<Result<Task>> {
  const problem = leaderProblem('add tasks') ?? checkTask(fields, membersTable.rows())
  if (problem) return fail(problem)
  return tasksTable.insert({ ...tidy(fields), status: 'todo', done_at: null })
}

/** Change a task's title, details, subteam, people or due date. Its status stays. Student leaders, mentors and admins only. */
export async function editTask(id: string, fields: TaskFields): Promise<Result<Task>> {
  const notLeader = leaderProblem('edit tasks')
  if (notLeader) return fail(notLeader)
  const task = findTask(id)
  if (!task) return fail(MISSING)
  const problem = checkTask(fields, membersTable.rows(), task.assignee_ids)
  if (problem) return fail(problem)
  return tasksTable.update(id, tidy(fields))
}

/** Delete a task. Student leaders, mentors and admins only. */
export async function removeTask(id: string): Promise<Result> {
  const problem = leaderProblem('delete tasks')
  if (problem) return fail(problem)
  if (!findTask(id)) return fail(MISSING)
  return tasksTable.remove(id)
}

/** Why the signed-in person can't move this task, or null if they can. */
function moveProblem(task: Task | undefined): string | null {
  if (!task) return MISSING
  const user = currentUser()
  if (!user) return 'Sign in first.'
  if (!canMoveAlong(task, user)) return 'Only the people this task is for can move it along. Ask a student leader or mentor if it should be yours.'
  return null
}

function setStatus(id: string, status: TaskStatus): Promise<Result<Task>> {
  // The database sets done_at to its own time; this is for demo mode.
  return tasksTable.update(id, { status, done_at: status === 'done' ? new Date().toISOString() : null })
}

/** Move a task one step along: To do → In progress → Done. */
export async function moveAlong(id: string): Promise<Result<Task>> {
  const task = findTask(id)
  const problem = moveProblem(task)
  if (problem || !task) return fail(problem ?? MISSING)
  const next = nextStatus(task.status)
  if (!next) return fail(`“${task.title}” is already done.`)
  return setStatus(id, next)
}

/** Move a task one step back, to undo a mis-tap: Done → In progress → To do. */
export async function moveBack(id: string): Promise<Result<Task>> {
  const task = findTask(id)
  const problem = moveProblem(task)
  if (problem || !task) return fail(problem ?? MISSING)
  const previous = previousStatus(task.status)
  if (!previous) return fail(`“${task.title}” hasn't been started yet.`)
  return setStatus(id, previous)
}

// ---------------------------------------------------------------------------
// The home page

/**
 * The home page tile: "3 tasks for you · 1 due today", in the warning colour
 * if any are late. With none of your own, student leaders, mentors and admins
 * see how many tasks are open on the board.
 */
export function taskSummary(tasks: Task[], me: { id: string; role: Role }, day: string = today()): Notice {
  const mine = myTasks(tasks, me.id)
  if (mine.length > 0) {
    const dueToday = mine.filter((task) => task.due_date === day).length
    const late = mine.some((task) => isLate(task, day))
    return { tone: late ? 'warn' : 'info', text: plural(mine.length, 'task', 'tasks') + ' for you' + (dueToday > 0 ? ` · ${dueToday} due today` : '') }
  }
  if (!canManageTasks(me.role)) return { tone: 'plain', text: 'Nothing assigned to you' }
  const open = tasks.filter((task) => task.status !== 'done').length
  return { tone: 'plain', text: open > 0 ? plural(open, 'open task', 'open tasks') : 'No open tasks' }
}

export function useTaskSummary(role: Role): Notice {
  return taskSummary(useTasks(), { id: useSession().id, role })
}

/** "Needs attention" on the home page: your own late tasks, as one line. */
export function taskNotices(tasks: Task[], personId: string, day: string = today()): Notice[] {
  const late = myTasks(tasks, personId).filter((task) => isLate(task, day))
  if (late.length === 0) return []
  if (late.length === 1) return [{ tone: 'warn', text: `Late: ${late[0].title}` }]
  return [{ tone: 'warn', text: `${late.length} of your tasks are late` }]
}

export function useTaskAttention(): Notice[] {
  return taskNotices(useTasks(), useSession().id)
}
