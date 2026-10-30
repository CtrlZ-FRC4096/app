/**
 * Attendance module data: who said they'd come, when they checked in and
 * out, and the points from both. Mentors and admins see everyone's;
 * everyone else sees only their own, matched by their Slack account (see
 * the attendance migrations in supabase/migrations/).
 *
 * The data comes from the attendance channel's Slack export: Simple Poll
 * answers become RSVPs, and Jibble's "jibbled in/out" messages become
 * check-ins and check-outs (slack-export.ts). Mentors fix mistakes here
 * instead of in code: add a missed check-out, change an RSVP, ignore a
 * wrong check-in. Hours and points are worked out in points.ts.
 */
import { useMemo, useState } from 'react'
import { createTable, fail, ok, type Fields, type Result, type Row } from '../../core/table'
import { createStore, useStore } from '../../core/store'
import { DEMO_PEOPLE } from '../../core/demo'
import { isLive } from '../../core/supabase'
import { membersTable, type Member } from '../../core/members'
import { isMentor, type Role } from '../../core/roles'
import { currentUser, useSession } from '../../core/session'
import { plural } from '../../core/format'
import type { Notice } from '../../core/registry'
import { BASE_POINTS, buildReport, type DayRecord, type PersonReport, type Report } from './points'
import { countRange, type CountRange, type Counting, type Period } from './periods'
import { checkRequest, type HoursRequestInput, type RequestStatus } from './requests'
import { dayLabel, teamClock, teamDay, teamInstant, today } from './time'
import { nameKey, resolve, slackKey, type ParsedDay, type SlackUser } from './slack-export'

export interface AttendancePerson extends Row {
  slack_user_id: string | null
  name: string
  /** Hidden people (mentors, parents) stay in the data but not in the tables. */
  hidden: boolean
  created_by: string | null
}

export interface AttendanceCheck extends Row {
  person_id: string
  direction: 'in' | 'out'
  /** ISO instant. */
  at: string
  source: 'jibble' | 'manual'
  /** An imported check a mentor has ignored. Kept so importing again doesn't bring it back. */
  ignored: boolean
  created_by: string | null
}

export interface AttendanceRsvp extends Row {
  person_id: string
  /** The meeting day, like "2026-01-09". */
  day: string
  coming: boolean
  source: 'poll' | 'manual'
  created_by: string | null
}

/** The dates points are counted over, like "2027 build season" (see periods.ts). */
export interface AttendancePeriod extends Row, Period {
  created_by: string | null
}

/** Someone asking for hours Jibble missed, for a mentor to approve or decline (see requests.ts). */
export interface AttendanceRequest extends Row {
  person_id: string
  /** The meeting day, like "2026-01-13". */
  day: string
  /** ISO instants, or null for one Jibble already has. */
  in_at: string | null
  out_at: string | null
  note: string
  status: RequestStatus
  /** Who asked. */
  created_by: string | null
  decided_at: string | null
  decided_by: string | null
}

/** One automatic pull from the Slack channel (see sync.ts). */
export interface AttendanceSync extends Row {
  newest_message_at: string | null
  people_added: number
  checks_added: number
  rsvps_changed: number
}

// ---------------------------------------------------------------------------
// Example data: made-up people and five meetings, covering each kind of day.

const DEMO_DAYS = ['2026-01-06', '2026-01-08', '2026-01-10', '2026-01-13', '2026-01-15']
const DEMO_CREATED = '2026-01-20T00:00:00Z'

// For each person: per meeting day, their poll answer (y, n or -) and sessions ("18:05-20:30", or "18:10-" if they never checked out).
const DEMO_PATTERN: [name: string, slack: string, hidden: boolean, days: [string, string[]][]][] = [
  ['Alex Rivera', 'U0DEMO0001', false, [['y', ['18:05-20:30']], ['y', ['18:00-20:45']], ['n', []], ['y', ['18:02-20:15']], ['y', ['18:10-']]]],
  ['Jordan Kim', 'U0DEMO0004', false, [['y', ['18:01-20:40']], ['y', ['18:00-19:00']], ['y', []], ['-', ['18:20-20:30']], ['n', ['18:00-20:00']]]],
  ['Sam Ortiz', 'U0DEMO0005', false, [['n', []], ['n', []], ['-', []], ['y', ['18:00-20:30']], ['y', ['18:05-20:35']]]],
  ['Casey Nguyen', 'U0DEMO0006', false, [['-', ['18:00-20:00']], ['-', ['18:15-20:30']], ['y', ['10:00-12:00', '13:00-15:30']], ['y', ['18:00-21:00']], ['y', ['18:00-20:50']]]],
  ['Taylor Brooks', 'U0DEMO0007', false, [['y', []], ['y', []], ['n', []], ['y', ['18:30-19:15']], ['-', []]]],
  ['Quinn Patel', 'U0DEMO0008', false, [['-', []], ['-', []], ['-', []], ['-', ['18:00-20:00']], ['-', ['18:00-20:10']]]],
  ['Pat Chen', 'U0DEMO0002', true, [['-', ['17:45-21:00']], ['-', ['17:50-21:00']], ['-', ['09:45-15:45']], ['-', ['17:45-21:00']], ['-', ['17:45-21:00']]]],
]

const demoId = (table: number, n: number) => `00000000-0000-4000-8000-${table.toString(16).padStart(4, '0')}${n.toString(16).padStart(8, '0')}`

const DEMO_PEOPLE_ROWS: AttendancePerson[] = []
const DEMO_CHECKS: AttendanceCheck[] = []
const DEMO_RSVPS: AttendanceRsvp[] = []
DEMO_PATTERN.forEach(([name, slack, hidden, days], p) => {
  const person = demoId(0xa1, p + 1)
  DEMO_PEOPLE_ROWS.push({ id: person, slack_user_id: slack, name, hidden, created_at: DEMO_CREATED, created_by: DEMO_PEOPLE.pat })
  days.forEach(([answer, sessions], d) => {
    const day = DEMO_DAYS[d]
    if (answer !== '-') {
      DEMO_RSVPS.push({ id: demoId(0xa3, DEMO_RSVPS.length + 1), person_id: person, day, coming: answer === 'y', source: 'poll', created_at: DEMO_CREATED, created_by: DEMO_PEOPLE.pat })
    }
    for (const session of sessions) {
      const [start, end] = session.split('-')
      for (const [direction, clock] of [['in', start], ['out', end]] as const) {
        if (!clock) continue
        DEMO_CHECKS.push({ id: demoId(0xa2, DEMO_CHECKS.length + 1), person_id: person, direction, at: teamInstant(day, clock), source: 'jibble', ignored: false, created_at: DEMO_CREATED, created_by: DEMO_PEOPLE.pat })
      }
    }
  })
})

export const peopleTable = createTable<AttendancePerson>('attendance_people', { demo: DEMO_PEOPLE_ROWS, sort: (a, b) => a.name.localeCompare(b.name) })
export const checksTable = createTable<AttendanceCheck>('attendance_checks', { demo: DEMO_CHECKS, sort: (a, b) => Date.parse(a.at) - Date.parse(b.at) })
export const rsvpsTable = createTable<AttendanceRsvp>('attendance_rsvps', { demo: DEMO_RSVPS, sort: (a, b) => a.day.localeCompare(b.day) })
export const periodsTable = createTable<AttendancePeriod>('attendance_periods', {
  demo: [
    { id: demoId(0xa5, 1), name: '2026 preseason', first_day: '2026-01-01', last_day: '2026-01-09', created_at: DEMO_CREATED, created_by: DEMO_PEOPLE.pat },
    { id: demoId(0xa5, 2), name: '2026 build season', first_day: '2026-01-10', last_day: null, created_at: DEMO_CREATED, created_by: DEMO_PEOPLE.pat },
  ],
  sort: (a, b) => b.first_day.localeCompare(a.first_day) || a.name.localeCompare(b.name),
})
export const syncsTable = createTable<AttendanceSync>('attendance_syncs', {
  demo: [{ id: demoId(0xa4, 1), created_at: '2026-01-16T03:07:00Z', newest_message_at: '2026-01-16T02:52:00Z', people_added: 0, checks_added: 9, rsvps_changed: 1 }],
})

// Alex forgot to check out on Jan 15, Jordan's Jibble didn't work at the
// Jan 10 Saturday build, and a mentor declined one of Sam's.
export const requestsTable = createTable<AttendanceRequest>('attendance_requests', {
  demo: [
    {
      id: demoId(0xa6, 1), person_id: demoId(0xa1, 3), day: '2026-01-06', in_at: teamInstant('2026-01-06', '18:00'), out_at: teamInstant('2026-01-06', '20:00'),
      note: 'I was at the robot demo at the library.', status: 'declined', created_at: '2026-01-07T02:00:00Z', created_by: DEMO_PEOPLE.sam,
      decided_at: '2026-01-07T15:00:00Z', decided_by: DEMO_PEOPLE.pat,
    },
    {
      id: demoId(0xa6, 2), person_id: demoId(0xa1, 2), day: '2026-01-10', in_at: teamInstant('2026-01-10', '10:00'), out_at: teamInstant('2026-01-10', '15:00'),
      note: "Jibble wasn't working at the Saturday build.", status: 'pending', created_at: '2026-01-11T01:00:00Z', created_by: DEMO_PEOPLE.jordan,
      decided_at: null, decided_by: null,
    },
    {
      id: demoId(0xa6, 3), person_id: demoId(0xa1, 1), day: '2026-01-15', in_at: null, out_at: teamInstant('2026-01-15', '20:40'),
      note: 'Forgot to check out after the meeting.', status: 'pending', created_at: '2026-01-16T14:00:00Z', created_by: DEMO_PEOPLE.alex,
      decided_at: null, decided_by: null,
    },
  ],
})

/** The latest automatic pull from Slack, or null if it has never run. */
export function useLastPull(): AttendanceSync | null {
  const syncs = syncsTable.useRows()
  return syncs[syncs.length - 1] ?? null
}

// ---------------------------------------------------------------------------
// Reading.

export function useAttendance() {
  return { people: peopleTable.useRows(), checks: checksTable.useRows(), rsvps: rsvpsTable.useRows() }
}

/** The report for part of the season. Hidden people are left out unless asked for. */
export function useReport(range: { from?: string; to?: string }, showHidden = false): Report<AttendancePerson> {
  const { people, checks, rsvps } = useAttendance()
  const { from, to } = range
  return useMemo(
    () => buildReport(showHidden ? people : people.filter((p) => !p.hidden), checks, rsvps, { from, to }),
    [people, checks, rsvps, from, to, showHidden],
  )
}

// What the tab counts points over. It lasts while the app is open, so going
// to another tab and back keeps it; reloading goes back to today's period.
const countingStore = createStore<Counting>('attendance-counting', 1, () => null, { persist: false })

/**
 * The dates the tab counts points over, and a way to change them. It opens
 * on the most recent period mentors saved (see latestPeriod in periods.ts);
 * anyone can switch to another period, all time, or dates they pick.
 */
export function useCountRange(): CountRange<AttendancePeriod> & { set: (next: Counting) => void } {
  const periods = periodsTable.useRows()
  const counting = useStore(countingStore)
  const [day] = useState(today)
  return { ...countRange(counting, periods, day), set: countingStore.set }
}

// ---------------------------------------------------------------------------
// Your own attendance. Everyone sees this, students included. In the team
// database, students can only read their own rows anyway; in demo mode
// every row is there, so this picks out yours.

/** The signed-in person's attendance row: the one with their Slack account, or null if there isn't one yet. */
export function findMyPerson(people: AttendancePerson[], members: Member[], userId: string): AttendancePerson | null {
  const slack = members.find((m) => m.id === userId)?.slack_user_id
  return (slack && people.find((p) => p.slack_user_id === slack)) || null
}

/**
 * Your own attendance over part of the season: your row of the report
 * (points, hours and each of your days), or null when you have nothing in
 * these dates. Days you have no record for score 0, so these are the same
 * numbers the mentors' sheets show for you.
 */
export function useMyAttendance(range: { from?: string; to?: string }): { person: AttendancePerson | null; row: PersonReport<AttendancePerson> | null } {
  const { id } = useSession()
  const { people, checks, rsvps } = useAttendance()
  const members = membersTable.useRows()
  const person = findMyPerson(people, members, id)
  const { from, to } = range
  const row = useMemo(() => {
    if (!person) return null
    const mine = { checks: checks.filter((c) => c.person_id === person.id), rsvps: rsvps.filter((r) => r.person_id === person.id) }
    return buildReport([person], mine.checks, mine.rsvps, { from, to }).rows[0] ?? null
  }, [person, checks, rsvps, from, to])
  return { person, row }
}

/** The most recent points period, as dates, for the home page. */
function useTodaysPeriod(): { from?: string; to?: string } {
  const periods = periodsTable.useRows()
  const [day] = useState(today)
  const { from, to } = countRange(null, periods, day)
  return { from, to }
}

/**
 * The home page tile. Mentors: how many came to the last meeting. Everyone
 * else: their own points and hours this period.
 */
export function useAttendanceSummary(role: Role): Notice {
  const report = useReport({})
  const mine = useMyAttendance(useTodaysPeriod())
  if (!isMentor(role)) {
    if (!mine.person) return { tone: 'plain', text: 'No attendance for you yet' }
    const points = mine.row?.points ?? BASE_POINTS
    return { tone: 'info', text: `You: ${plural(points, 'point', 'points')} · ${(mine.row?.hours ?? 0).toFixed(1)} hours` }
  }
  const last = report.days[report.days.length - 1]
  if (!last) return { tone: 'plain', text: 'No meetings yet' }
  const came = report.rows.filter((row) => row.days.get(last)?.sessions.length).length
  return { tone: 'info', text: `${came} at ${dayLabel(last)}` }
}

// ---------------------------------------------------------------------------
// Requests for missing hours. Anyone asks about their own attendance; mentors
// and admins see everyone's at the bottom of the tab and decide.

/** Your requests, newest first. */
export function useMyRequests(): AttendanceRequest[] {
  const { id } = useSession()
  const people = peopleTable.useRows()
  const members = membersTable.useRows()
  const requests = requestsTable.useRows()
  const person = findMyPerson(people, members, id)
  return person ? requests.filter((r) => r.person_id === person.id).sort((a, b) => b.created_at.localeCompare(a.created_at)) : []
}

/** Requests waiting for a mentor, oldest first. */
export function useWaitingRequests(): AttendanceRequest[] {
  return requestsTable.useRows().filter((r) => r.status === 'pending')
}

/** Requests decided lately, newest first. */
export function useDecidedRequests(limit = 5): AttendanceRequest[] {
  const requests = requestsTable.useRows()
  return requests
    .filter((r) => r.status !== 'pending')
    .sort((a, b) => (b.decided_at ?? '').localeCompare(a.decided_at ?? ''))
    .slice(0, limit)
}

/** Ask for hours Jibble missed, for `person` (your own attendance row). */
export async function requestHours(person: AttendancePerson, input: HoursRequestInput): Promise<Result<AttendanceRequest>> {
  const problem = checkRequest(input, today())
  if (problem) return fail(problem)
  if (requestsTable.rows().some((r) => r.person_id === person.id && r.day === input.day && r.status === 'pending')) {
    return fail(`You already asked about ${dayLabel(input.day)}. Take that request back first to change it.`)
  }
  const fields = {
    person_id: person.id,
    day: input.day,
    in_at: input.inClock ? teamInstant(input.day, input.inClock) : null,
    out_at: input.outClock ? teamInstant(input.day, input.outClock) : null,
    note: input.note.trim(),
  }
  // The team database fills in the status and the rest, and doesn't let
  // anyone set them; demo mode needs them here.
  const row = isLive ? fields : { ...fields, status: 'pending' as const, decided_at: null, decided_by: null }
  return requestsTable.insert(row as Fields<AttendanceRequest>)
}

/** Take back a request that's still waiting. */
export async function cancelRequest(request: AttendanceRequest): Promise<Result> {
  if (request.status !== 'pending') return fail('A mentor already decided that one.')
  return requestsTable.remove(request.id)
}

/**
 * Approve or decline a request (mentors and admins). Approving adds its
 * times as check-ins and check-outs made by hand. In the team database a
 * trigger does that in the same step (see the requests migration); demo
 * mode does the same here.
 */
export async function decideRequest(request: AttendanceRequest, approve: boolean): Promise<Result<AttendanceRequest>> {
  const me = currentUser()
  if (!me || !isMentor(me.role)) return fail('Only mentors and admins can approve requests.')
  if (request.status !== 'pending') return fail(`That request was already ${request.status}.`)
  const status = approve ? 'approved' : 'declined'
  if (isLive) return requestsTable.update(request.id, { status })

  const result = await requestsTable.update(request.id, { status, decided_at: new Date().toISOString(), decided_by: me.id })
  if (!result.ok || !approve) return result
  for (const [direction, at] of [['in', request.in_at], ['out', request.out_at]] as const) {
    if (!at) continue
    const same = checksTable.rows().find((c) => c.person_id === request.person_id && c.direction === direction && Date.parse(c.at) === Date.parse(at))
    const added = same
      ? await checksTable.update(same.id, { ignored: false })
      : await checksTable.insert({ person_id: request.person_id, direction, at, source: 'manual', ignored: false })
    if (!added.ok) return added
  }
  return result
}

// ---------------------------------------------------------------------------
// Fixing things by hand.

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

export async function addCheck(personId: string, day: string, clock: string, direction: 'in' | 'out'): Promise<Result<AttendanceCheck>> {
  if (!DAY.test(day)) return fail('Pick a day.')
  if (!CLOCK.test(clock)) return fail('Enter a time like 18:30.')
  const at = teamInstant(day, clock)
  const same = checksTable.rows().some((c) => c.person_id === personId && c.direction === direction && Date.parse(c.at) === Date.parse(at))
  if (same) return fail(`There's already a check-${direction} at ${clock} that day.`)
  return checksTable.insert({ person_id: personId, direction, at, source: 'manual', ignored: false })
}

/** Take a wrong check-in or check-out out of the hours. Imported ones are kept but ignored, so importing again doesn't bring them back. */
export async function removeCheck(check: AttendanceCheck): Promise<Result> {
  if (check.source === 'manual') return checksTable.remove(check.id)
  const result = await checksTable.update(check.id, { ignored: true })
  return result.ok ? ok(null) : result
}

export async function restoreCheck(check: AttendanceCheck): Promise<Result> {
  const result = await checksTable.update(check.id, { ignored: false })
  return result.ok ? ok(null) : result
}

/** Set someone's answer for a day by hand. Importing again won't change it. Null removes it. */
export async function setRsvp(personId: string, day: string, answer: 'yes' | 'no' | null): Promise<Result> {
  const existing = rsvpsTable.rows().find((r) => r.person_id === personId && r.day === day)
  if (answer === null) return existing ? rsvpsTable.remove(existing.id) : ok(null)
  const coming = answer === 'yes'
  const result = existing
    ? await rsvpsTable.update(existing.id, { coming, source: 'manual' })
    : await rsvpsTable.insert({ person_id: personId, day, coming, source: 'manual' })
  return result.ok ? ok(null) : result
}

export async function setHidden(person: AttendancePerson, hidden: boolean): Promise<Result> {
  const result = await peopleTable.update(person.id, { hidden })
  return result.ok ? ok(null) : result
}

/** Add a points period, or change one when given its id. */
export async function savePeriod(fields: Fields<AttendancePeriod>, id?: string): Promise<Result<AttendancePeriod>> {
  const name = fields.name.trim()
  const last_day = fields.last_day || null
  if (!name) return fail('Give the period a name, like "2027 build season".')
  if (name.length > 80) return fail('Keep the name to 80 characters.')
  if (!DAY.test(fields.first_day)) return fail('Pick its first day.')
  if (last_day && !DAY.test(last_day)) return fail('Pick its last day, or leave it empty if the period is still going.')
  if (last_day && last_day < fields.first_day) return fail('The last day is before the first day.')
  const same = periodsTable.rows().find((p) => p.id !== id && p.name.trim().toLowerCase() === name.toLowerCase())
  if (same) return fail(`There's already a period called "${same.name}".`)
  const period = { name, first_day: fields.first_day, last_day }
  return id ? periodsTable.update(id, period) : periodsTable.insert(period)
}

/** Remove a points period. The meetings in it stay. */
export function removePeriod(id: string): Promise<Result> {
  return periodsTable.remove(id)
}

/** A person's check-ins and check-outs on one day, including ignored ones, in time order. */
export function checksOn(checks: AttendanceCheck[], personId: string, day: string): AttendanceCheck[] {
  return checks.filter((c) => c.person_id === personId && teamDay(c.at) === day)
}

// ---------------------------------------------------------------------------
// Importing a Slack export.

export interface ImportPlan {
  days: number
  newPeople: { key: string; slack_user_id: string | null; name: string }[]
  newChecks: { key: string; direction: 'in' | 'out'; at: string }[]
  newRsvps: { key: string; day: string; coming: boolean }[]
  changedRsvps: { id: string; coming: boolean }[]
  /** Check-ins already imported before. */
  alreadyThere: number
  /** Poll answers a mentor has set by hand, which the import leaves alone. */
  keptManual: number
  /** Jibble names matched to someone by a similar name, to double-check. */
  similar: { jibble: string; slack: string }[]
  /** Jibble names that matched nobody. They're added as new people, by name. */
  unmatched: string[]
}

const checkKey = (personKey: string, direction: string, at: string) => `${personKey}|${direction}|${Date.parse(at)}`

/** Work out what importing would add or change, without changing anything. */
export function planImport(
  users: SlackUser[],
  days: ParsedDay[],
  existing: { people: AttendancePerson[]; checks: AttendanceCheck[]; rsvps: AttendanceRsvp[] },
): ImportPlan {
  const found = resolve(users, days)
  const keyOfPerson = new Map(existing.people.map((p) => [p.id, p.slack_user_id ? slackKey(p.slack_user_id) : nameKey(p.name)]))
  const known = new Set(keyOfPerson.values())

  const seen = new Set(existing.checks.map((c) => checkKey(keyOfPerson.get(c.person_id) ?? c.person_id, c.direction, c.at)))
  const newChecks: ImportPlan['newChecks'] = []
  let alreadyThere = 0
  for (const check of found.checks) {
    const id = checkKey(check.key, check.direction, check.at)
    if (seen.has(id)) alreadyThere += 1
    else {
      seen.add(id)
      newChecks.push(check)
    }
  }

  const rsvpByKey = new Map(existing.rsvps.map((r) => [`${keyOfPerson.get(r.person_id) ?? r.person_id}|${r.day}`, r]))
  const newRsvps: ImportPlan['newRsvps'] = []
  const changedRsvps: ImportPlan['changedRsvps'] = []
  let keptManual = 0
  for (const answer of found.rsvps) {
    const current = rsvpByKey.get(`${answer.key}|${answer.day}`)
    if (!current) newRsvps.push(answer)
    else if (current.coming !== answer.coming) {
      if (current.source === 'manual') keptManual += 1
      else changedRsvps.push({ id: current.id, coming: answer.coming })
    }
  }

  return {
    days: found.days.size,
    newPeople: [...found.people].filter(([key]) => !known.has(key)).map(([key, p]) => ({ key, ...p })),
    newChecks,
    newRsvps,
    changedRsvps,
    alreadyThere,
    keptManual,
    similar: found.similar,
    unmatched: found.unmatched,
  }
}

/** Make the changes a plan describes. */
export async function applyImport(plan: ImportPlan): Promise<Result<string>> {
  const idByKey = new Map<string, string>()
  for (const person of peopleTable.rows()) idByKey.set(person.slack_user_id ? slackKey(person.slack_user_id) : nameKey(person.name), person.id)

  const people = await peopleTable.insertMany(plan.newPeople.map(({ slack_user_id, name }) => ({ slack_user_id, name, hidden: false })))
  if (!people.ok) return people
  for (const person of people.value) idByKey.set(person.slack_user_id ? slackKey(person.slack_user_id) : nameKey(person.name), person.id)

  const checks = await checksTable.insertMany(
    plan.newChecks.map((c) => ({ person_id: idByKey.get(c.key)!, direction: c.direction, at: c.at, source: 'jibble' as const, ignored: false })),
  )
  if (!checks.ok) return checks
  const rsvps = await rsvpsTable.insertMany(plan.newRsvps.map((r) => ({ person_id: idByKey.get(r.key)!, day: r.day, coming: r.coming, source: 'poll' as const })))
  if (!rsvps.ok) return rsvps
  for (const change of plan.changedRsvps) {
    const result = await rsvpsTable.update(change.id, { coming: change.coming })
    if (!result.ok) return result
  }
  return ok(
    `Imported ${plan.newChecks.length} check-ins and check-outs and ${plan.newRsvps.length + plan.changedRsvps.length} poll answers, with ${plan.newPeople.length} new people.`,
  )
}

// ---------------------------------------------------------------------------
// Showing and downloading.

export type Sheet = 'points' | 'hours' | 'checks' | 'rsvps'

/** What the sheets can be sorted by: a name, or a total. */
export type SortBy = 'name' | 'points' | 'hours' | 'days'

/** Each sheet starts sorted by its own total: Points by points, Hours by hours, the others by days here. */
export const SHEET_SORT: Record<Sheet, SortBy> = { points: 'points', hours: 'hours', checks: 'days', rsvps: 'days' }

/** Rows sorted most first (names A to Z), with ties in name order. */
export function sortRows<R extends { person: { name: string }; points: number; hours: number; daysPresent: number }>(rows: R[], by: SortBy): R[] {
  const value = (row: R) => (by === 'points' ? row.points : by === 'hours' ? row.hours : by === 'days' ? row.daysPresent : 0)
  return [...rows].sort((a, b) => value(b) - value(a) || a.person.name.localeCompare(b.person.name))
}

/** What a day's cell shows on each sheet. */
export function cellText(record: DayRecord | undefined, sheet: Sheet): string {
  if (!record) return ''
  switch (sheet) {
    case 'points':
      return String(record.points)
    case 'hours':
      return record.hours === null ? (record.stillIn ? '?' : '') : record.hours.toFixed(2)
    case 'checks':
      return record.sessions.map((s) => `${teamClock(s.in)}–${s.out ? teamClock(s.out) : '?'}`).join(', ')
    case 'rsvps':
      return record.rsvp === 'yes' ? 'Yes' : record.rsvp === 'no' ? 'No' : ''
  }
}

/** A sheet as rows of cells, oldest day first, like the old spreadsheet, with every total: points, hours and days here. */
export function sheetRows(report: Report<AttendancePerson>, sheet: Sheet): string[][] {
  return [
    ['Name', 'Points', 'Hours', 'Days here', ...report.days],
    ...report.rows.map((row) => [
      row.person.name,
      String(row.points),
      row.hours.toFixed(2),
      String(row.daysPresent),
      ...report.days.map((day) => cellText(row.days.get(day), sheet)),
    ]),
  ]
}

/** Rows of cells as CSV text that Excel and Google Sheets open. */
export function toCsv(rows: string[][]): string {
  const cell = (value: string) => {
    // Stop a name like "=HYPERLINK(...)" from running as a formula.
    const safe = /^[=+\-@]/.test(value) && Number.isNaN(Number(value)) ? `'${value}` : value
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
