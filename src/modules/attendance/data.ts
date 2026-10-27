/**
 * Attendance module data: who said they'd come, when they checked in and
 * out, and the points from both. Mentors and admins only (see the
 * attendance migration in supabase/migrations/).
 *
 * The data comes from the attendance channel's Slack export: Simple Poll
 * answers become RSVPs, and Jibble's "jibbled in/out" messages become
 * check-ins and check-outs (slack-export.ts). Mentors fix mistakes here
 * instead of in code: add a missed check-out, change an RSVP, ignore a
 * wrong check-in. Hours and points are worked out in points.ts.
 */
import { useMemo, useState } from 'react'
import { createTable, fail, ok, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'
import { isLive } from '../../core/supabase'
import type { Notice } from '../../core/registry'
import { buildReport, type DayRecord, type Report } from './points'
import { ago, dayLabel, teamClock, teamDay, teamInstant } from './time'
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
export const syncsTable = createTable<AttendanceSync>('attendance_syncs', {
  demo: [{ id: demoId(0xa4, 1), created_at: '2026-01-16T03:07:00Z', newest_message_at: '2026-01-16T02:52:00Z', people_added: 0, checks_added: 9, rsvps_changed: 1 }],
})

/** The latest automatic pull from Slack, or null if it has never run. */
export function useLastPull(): AttendanceSync | null {
  const syncs = syncsTable.useRows()
  return syncs[syncs.length - 1] ?? null
}

/** Pulls run nightly. Longer than this without one means something stopped. */
const PULL_OVERDUE_HOURS = 36

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

/** The home page tile: how many came to the last meeting. */
export function useAttendanceSummary(): Notice {
  const report = useReport({})
  const last = report.days[report.days.length - 1]
  if (!last) return { tone: 'plain', text: 'No meetings yet' }
  const came = report.rows.filter((row) => row.days.get(last)?.sessions.length).length
  return { tone: 'info', text: `${came} at ${dayLabel(last)}` }
}

/** "Needs attention" on the home page: people who never checked out at the last meeting. */
export function useAttendanceAttention(): Notice[] {
  const report = useReport({})
  const lastPull = useLastPull()
  const [openedAt] = useState(() => Date.now())
  const notices: Notice[] = []
  const last = report.days[report.days.length - 1]
  const stillIn = last ? report.rows.filter((row) => row.days.get(last)?.stillIn).length : 0
  if (stillIn) {
    notices.push({ tone: 'warn', text: `${stillIn} ${stillIn === 1 ? "person didn't" : "people didn't"} check out on ${dayLabel(last)}. Add their check-out so their hours count.` })
  }
  if (isLive && lastPull && openedAt - Date.parse(lastPull.created_at) > PULL_OVERDUE_HOURS * 3_600_000) {
    notices.push({ tone: 'crit', text: `Attendance was last pulled from Slack ${ago(lastPull.created_at, new Date(openedAt))}. Check the "Pull attendance from Slack" workflow in GitHub Actions.` })
  }
  return notices
}

// ---------------------------------------------------------------------------
// Fixing things by hand.

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

export async function addCheck(personId: string, day: string, clock: string, direction: 'in' | 'out'): Promise<Result<AttendanceCheck>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail('Pick a day.')
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

/** A sheet as rows of cells, oldest day first, like the old spreadsheet. */
export function sheetRows(report: Report<AttendancePerson>, sheet: Sheet): string[][] {
  const total = (row: Report<AttendancePerson>['rows'][number]) =>
    sheet === 'points' ? String(row.points) : sheet === 'hours' ? row.hours.toFixed(2) : String(row.daysPresent)
  const totalName = sheet === 'points' ? 'Total' : sheet === 'hours' ? 'Total hours' : 'Days here'
  return [
    ['Name', totalName, ...report.days],
    ...report.rows.map((row) => [row.person.name, total(row), ...report.days.map((day) => cellText(row.days.get(day), sheet))]),
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
