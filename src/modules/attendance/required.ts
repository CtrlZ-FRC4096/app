/**
 * Required Mondays. Students have to come to the Monday meetings on the
 * team calendar, unless a mentor marks a Monday not required. Someone who
 * can't make it says so with a reason, and that absence counts as excused
 * straight away: nobody approves it.
 *
 * Coming means checking in with Jibble that day. None of this changes
 * hours or points (points.ts).
 *
 * Plain rules with no data here, tested in required.test.ts. The tables,
 * loading the calendar and sending absences are in data.ts.
 */
import type { Tone } from '../../core/registry'
import { teamDay } from './time'

/** The day of the week that's required: 1 is Monday (0 is Sunday). */
export const REQUIRED_WEEKDAY = 1

/** The database allows the same: see the attendance required Mondays migration. */
export const MAX_ABSENCE_REASON = 300
export const MAX_NOT_REQUIRED_REASON = 200

/** How far ahead to look on the calendar, so people can say they'll miss an upcoming Monday. */
export const DAYS_AHEAD = 28

/** The calendar asks for a year or less at a time. */
const MAX_DAYS = 364

const DAY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

/** The day `days` after (or before, if negative) a day like "2026-01-12". */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Whether a day like "2026-01-12" is a Monday. */
export function isRequiredWeekday(day: string): boolean {
  return new Date(`${day}T12:00:00Z`).getUTCDay() === REQUIRED_WEEKDAY
}

/** The part of a calendar event these rules use (CalendarEvent in src/core/calendar.ts). */
export interface MeetingEvent {
  title: string
  /** A time like 2026-01-12T18:00:00-06:00, or a day for an all-day event. */
  start: string
  allDay: boolean
}

/** A Monday a mentor said isn't required. */
export interface NotRequired {
  day: string
  reason: string
}

/** A Monday with a meeting on the calendar. */
export interface Meeting {
  day: string
  /** The calendar event's title, like "Team meeting". */
  title: string
  required: boolean
  /** Why it isn't required, when a mentor said so. */
  reason: string
}

/**
 * The Mondays in these dates with a meeting on the calendar, in order: each
 * Monday with an event that has a start time. All-day events (like a
 * competition) aren't meetings. A Monday a mentor marked stays in the list,
 * as not required, so they can make it required again.
 */
export function mondayMeetings(events: MeetingEvent[], notRequired: NotRequired[], range: { from?: string; to?: string }): Meeting[] {
  const byDay = new Map<string, Meeting>()
  for (const event of events) {
    if (event.allDay) continue
    const day = teamDay(event.start)
    if (!isRequiredWeekday(day) || byDay.has(day)) continue
    if ((range.from && day < range.from) || (range.to && day > range.to)) continue
    const marked = notRequired.find((n) => n.day === day)
    byDay.set(day, { day, title: event.title, required: !marked, reason: marked?.reason ?? '' })
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
}

/**
 * The dates to ask the calendar for: the dates being counted, plus the next
 * few weeks so people can say they'll miss an upcoming Monday. "All time"
 * goes back a year, just under the most the calendar gives at once.
 */
export function calendarWindow(range: { from?: string; to?: string }, today: string): { from: string; to: string } {
  const to = range.to && range.to < today ? range.to : addDays(today, DAYS_AHEAD)
  const earliest = addDays(to, -MAX_DAYS)
  const from = range.from && range.from > earliest ? range.from : earliest
  return { from, to }
}

export type MondayStatus = 'came' | 'excused' | 'missed' | 'upcoming'

export const MONDAY_LABEL: Record<MondayStatus, string> = { came: 'Came', excused: 'Excused', missed: 'Missed', upcoming: 'Coming up' }
export const MONDAY_TONE: Record<MondayStatus, Tone> = { came: 'ok', excused: 'info', missed: 'crit', upcoming: 'plain' }

/**
 * Someone's status for one required Monday. Today counts as coming up:
 * check-ins are pulled from Slack overnight, so nobody has missed it yet.
 */
export function mondayStatus(came: boolean, excused: boolean, day: string, today: string): MondayStatus {
  if (came) return 'came'
  if (excused) return 'excused'
  return day >= today ? 'upcoming' : 'missed'
}

/** One person's required Mondays. */
export interface RequiredRow<P> {
  person: P
  /** Each required Monday's status, by day. */
  days: Map<string, MondayStatus>
  came: number
  excused: number
  missed: number
}

/**
 * Everyone's status for each required Monday, most missed first. `checks`
 * are check-ins and check-outs; any one that isn't ignored means they came.
 */
export function requiredReport<P extends { id: string; name: string }>(
  people: P[],
  checks: { person_id: string; at: string; ignored: boolean }[],
  absences: { person_id: string; day: string }[],
  mondays: string[],
  today: string,
): RequiredRow<P>[] {
  const wanted = new Set(mondays)
  const came = new Set(checks.filter((c) => !c.ignored).map((c) => `${c.person_id} ${teamDay(c.at)}`).filter((key) => wanted.has(key.split(' ')[1])))
  const away = new Set(absences.map((a) => `${a.person_id} ${a.day}`))
  return people
    .map((person) => {
      const row: RequiredRow<P> = { person, days: new Map(), came: 0, excused: 0, missed: 0 }
      for (const day of mondays) {
        const status = mondayStatus(came.has(`${person.id} ${day}`), away.has(`${person.id} ${day}`), day, today)
        row.days.set(day, status)
        if (status !== 'upcoming') row[status]++
      }
      return row
    })
    .sort((a, b) => b.missed - a.missed || a.person.name.localeCompare(b.person.name))
}

/** What someone fills in to say they can't make it. */
export interface AbsenceInput {
  /** The Monday, like "2026-01-12". */
  day: string
  reason: string
}

/** Why an absence can't be sent, or null if it can. `required` are the required Mondays someone can pick. */
export function checkAbsence(input: AbsenceInput, required: string[]): string | null {
  if (!DAY.test(input.day)) return 'Pick the Monday.'
  if (!required.includes(input.day)) return "That isn't a required Monday. You only need to tell us about required meetings."
  const reason = input.reason.trim()
  if (!reason) return 'Say why you can\'t make it, like "Doctor appointment" or "Family trip".'
  if (reason.length > MAX_ABSENCE_REASON) return `Keep it under ${MAX_ABSENCE_REASON} characters. This is ${reason.length}.`
  return null
}
