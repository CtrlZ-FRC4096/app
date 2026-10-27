/**
 * Hours and points, worked out the same way as the team's attendance
 * spreadsheet (the Python notebook this replaced).
 *
 * Each meeting day, a person gets points from two things: whether they
 * answered the Slack poll saying they'd come, and how long they stayed
 * (from their Jibble check-ins and check-outs). Everyone starts with
 * BASE_POINTS.
 */
import { teamDay } from './time'

export const BASE_POINTS = 3
/** Staying at least this long counts as a full session. */
export const FULL_SESSION_HOURS = 1.5

export type Rsvp = 'yes' | 'no' | null
type Stay = 'none' | 'short' | 'full'

/** Points for one day, by poll answer and how long they stayed. */
export const POINTS: Record<'yes' | 'no' | 'none', Record<Stay, number>> = {
  // Said they'd come: −1 if they didn't, 1 if they left early, 3 for a full session.
  yes: { none: -1, short: 1, full: 3 },
  // Said they wouldn't: 1 for answering honestly, 2 if they came for a full session anyway.
  no: { none: 1, short: 1, full: 2 },
  // Didn't answer: nothing, unless they came for a full session.
  none: { none: 0, short: 0, full: 1 },
}

export function dayPoints(rsvp: Rsvp, hours: number | null): number {
  const stay: Stay = hours === null ? 'none' : hours < FULL_SESSION_HOURS ? 'short' : 'full'
  return POINTS[rsvp ?? 'none'][stay]
}

export interface Check {
  direction: 'in' | 'out'
  /** ISO instant. */
  at: string
}

export interface Session {
  in: string
  /** Null when they never checked out. */
  out: string | null
}

/**
 * Pair check-ins with check-outs in time order. A second check-in before
 * checking out (a double tap) is ignored, and so is a check-out with no
 * check-in before it.
 */
export function sessions(checks: Check[]): Session[] {
  const sorted = [...checks].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.direction === 'in' ? -1 : 1))
  const result: Session[] = []
  let open: Session | null = null
  for (const check of sorted) {
    if (check.direction === 'in' && !open) {
      open = { in: check.at, out: null }
      result.push(open)
    } else if (check.direction === 'out' && open) {
      open.out = check.at
      open = null
    }
  }
  return result
}

/** Hours across finished sessions, or null if there are none. */
export function hoursOf(list: Session[]): number | null {
  const done = list.filter((s) => s.out !== null)
  if (done.length === 0) return null
  return done.reduce((sum, s) => sum + (Date.parse(s.out!) - Date.parse(s.in)) / 3_600_000, 0)
}

export interface DayRecord {
  day: string
  rsvp: Rsvp
  sessions: Session[]
  hours: number | null
  points: number
  /** Checked in but never out. Their time doesn't count until a mentor adds the check-out. */
  stillIn: boolean
}

export interface PersonReport<P> {
  person: P
  days: Map<string, DayRecord>
  points: number
  hours: number
  /** Days with at least one finished session. */
  daysPresent: number
}

export interface Report<P> {
  /** Every meeting day in range, oldest first. */
  days: string[]
  /** People with any record in range, most points first. */
  rows: PersonReport<P>[]
}

interface ReportPerson {
  id: string
  name: string
}
interface ReportCheck extends Check {
  person_id: string
  ignored: boolean
}
interface ReportRsvp {
  person_id: string
  day: string
  coming: boolean
}

/**
 * The whole report: every person's day-by-day RSVP, sessions, hours and
 * points. A meeting day is any day with a check-in or a poll answer.
 * `from` and `to` (days, inclusive) limit it to part of the season.
 */
export function buildReport<P extends ReportPerson>(
  people: P[],
  checks: ReportCheck[],
  rsvps: ReportRsvp[],
  range: { from?: string; to?: string } = {},
): Report<P> {
  const inRange = (day: string) => (!range.from || day >= range.from) && (!range.to || day <= range.to)
  const checksByKey = new Map<string, ReportCheck[]>()
  const rsvpByKey = new Map<string, boolean>()
  const daySet = new Set<string>()
  const active = new Set<string>()

  for (const check of checks) {
    if (check.ignored) continue
    const day = teamDay(check.at)
    if (!inRange(day)) continue
    const key = `${check.person_id}|${day}`
    checksByKey.set(key, [...(checksByKey.get(key) ?? []), check])
    daySet.add(day)
    active.add(check.person_id)
  }
  for (const rsvp of rsvps) {
    if (!inRange(rsvp.day)) continue
    rsvpByKey.set(`${rsvp.person_id}|${rsvp.day}`, rsvp.coming)
    daySet.add(rsvp.day)
    active.add(rsvp.person_id)
  }

  const days = [...daySet].sort()
  const rows = people
    .filter((person) => active.has(person.id))
    .map((person) => {
      const record = new Map<string, DayRecord>()
      let points = BASE_POINTS
      let hours = 0
      let daysPresent = 0
      for (const day of days) {
        const key = `${person.id}|${day}`
        const answer = rsvpByKey.get(key)
        const rsvp: Rsvp = answer === undefined ? null : answer ? 'yes' : 'no'
        const list = sessions(checksByKey.get(key) ?? [])
        const dayHours = hoursOf(list)
        const dayPts = dayPoints(rsvp, dayHours)
        points += dayPts
        if (dayHours !== null) {
          hours += dayHours
          daysPresent += 1
        }
        record.set(day, { day, rsvp, sessions: list, hours: dayHours, points: dayPts, stillIn: list.some((s) => s.out === null) })
      }
      return { person, days: record, points, hours, daysPresent }
    })
    .sort((a, b) => b.points - a.points || a.person.name.localeCompare(b.person.name))

  return { days, rows }
}
