/**
 * The team calendar, from Google Calendar, for any module: a Calendar
 * page, "Next: Build session, Tue 6 PM" on the home page, event sign-ups.
 *
 * Everything goes through the `calendar` server function
 * (supabase/functions/calendar/), which holds the Google key:
 *
 *   - getCalendarEvents(): events between two times. Anyone on the team.
 *   - addCalendarEvent(), changeCalendarEvent(), removeCalendarEvent():
 *     mentors only. The app only changes and removes events it added
 *     itself (event.fromApp), never ones people made in Google Calendar.
 *
 * In demo mode it uses made-up events instead, and adding, changing and
 * removing only change the demo, until the page reloads.
 */
import { callFunction } from './functions'
import { isMentor } from './roles'
import { currentUser } from './session'
import { fail, ok, type Result } from './table'

/** The team's time zone: event times are shown in it. */
export const TEAM_TIME_ZONE = 'America/Chicago'

/** One event on the team calendar. The same shape is in supabase/functions/calendar/calendar.ts. */
export interface CalendarEvent {
  /** Google Calendar's ID for it. */
  id: string
  title: string
  /** When it starts: a time like 2026-11-03T18:00:00-06:00, or a day like 2026-11-03 for an all-day event. */
  start: string
  /** When it ends. For an all-day event, its last day: a one-day event starts and ends on the same day. */
  end: string
  allDay: boolean
  location: string | null
  description: string | null
  /** Opens it in Google Calendar. */
  url: string | null
  /** Added by the app, so the app can change or remove it. */
  fromApp: boolean
}

/** A new or changed event. */
export interface EventInput {
  title: string
  /** A time with its time zone (new Date(...).toISOString() gives one), or for an all-day event a day like 2026-11-03. */
  start: string
  /** For an all-day event, its last day. */
  end: string
  allDay: boolean
  location?: string | null
  description?: string | null
}

/** The longest each part of an event can be. The server function allows the same. */
export const EVENT_LIMITS = { title: 200, location: 300, description: 4000 }

const DAY_MS = 24 * 60 * 60 * 1000
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Why an event can't be saved, or null if it can. */
export function checkEvent(event: EventInput): string | null {
  const title = event.title.trim()
  if (!title) return 'Give the event a title.'
  if (title.length > EVENT_LIMITS.title) return `Keep the title under ${EVENT_LIMITS.title} characters.`
  if ((event.location?.trim().length ?? 0) > EVENT_LIMITS.location) return `Keep the location under ${EVENT_LIMITS.location} characters.`
  if ((event.description?.trim().length ?? 0) > EVENT_LIMITS.description) return `Keep the description under ${EVENT_LIMITS.description} characters.`
  if (event.allDay) {
    if (!DAY.test(event.start) || !DAY.test(event.end)) return 'Pick the first and last days.'
    if (event.end < event.start) return 'The last day is before the first.'
  } else {
    const start = Date.parse(event.start)
    const end = Date.parse(event.end)
    if (Number.isNaN(start) || Number.isNaN(end)) return 'Pick when it starts and ends.'
    if (end <= start) return 'The event ends before it starts.'
  }
  return null
}

/** The event as the server function wants it: trimmed, with empty parts as null. */
function cleaned(event: EventInput): EventInput {
  return {
    title: event.title.trim(),
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    location: event.location?.trim() || null,
    description: event.description?.trim() || null,
  }
}

/** Events between `from` and `to` (the next 60 days if left out), in order. */
export async function getCalendarEvents(from: Date = new Date(), to: Date = new Date(from.getTime() + 60 * DAY_MS)): Promise<Result<CalendarEvent[]>> {
  const answer = await callFunction<{ events: CalendarEvent[] }>('calendar', { kind: 'events', from: from.toISOString(), to: to.toISOString() }, () => ({
    events: demoEvents(from, to),
  }))
  return answer.ok ? ok(answer.value.events) : answer
}

function mentorsOnly(): string | null {
  const me = currentUser()
  return me && isMentor(me.role) ? null : 'Only mentors can change the team calendar.'
}

const ONLY_APP_EVENTS = 'The app only changes events it added. Change this one in Google Calendar.'

/** Add an event to the team calendar. Mentors only. */
export async function addCalendarEvent(event: EventInput): Promise<Result<CalendarEvent>> {
  const problem = mentorsOnly() ?? checkEvent(event)
  if (problem) return fail(problem)
  const answer = await callFunction<{ event: CalendarEvent }>('calendar', { kind: 'add', event: cleaned(event) }, () => {
    const added = { ...cleaned(event), id: `demo-added-${demoAdded.length + 1}`, url: null, fromApp: true } as CalendarEvent
    demoAdded.push(added)
    return { event: added }
  })
  return answer.ok ? ok(answer.value.event) : answer
}

/** Change an event the app added. Mentors only. */
export async function changeCalendarEvent(event: CalendarEvent, changes: EventInput): Promise<Result<CalendarEvent>> {
  const problem = mentorsOnly() ?? (event.fromApp ? null : ONLY_APP_EVENTS) ?? checkEvent(changes)
  if (problem) return fail(problem)
  const answer = await callFunction<{ event: CalendarEvent }>('calendar', { kind: 'change', id: event.id, event: cleaned(changes) }, () => {
    const changed = { ...event, ...cleaned(changes) } as CalendarEvent
    demoAdded = demoAdded.map((e) => (e.id === event.id ? changed : e))
    return { event: changed }
  })
  return answer.ok ? ok(answer.value.event) : answer
}

/** Remove an event the app added. Mentors only. */
export async function removeCalendarEvent(event: CalendarEvent): Promise<Result> {
  const problem = mentorsOnly() ?? (event.fromApp ? null : ONLY_APP_EVENTS)
  if (problem) return fail(problem)
  const answer = await callFunction('calendar', { kind: 'remove', id: event.id }, () => {
    demoAdded = demoAdded.filter((e) => e.id !== event.id)
    return { removed: true }
  })
  return answer.ok ? ok(null) : answer
}

/** When an event is, for people: "Tue, Nov 3, 6:00 – 9:00 PM", or "Sat, Nov 7" for an all-day one. */
export function eventTime(event: CalendarEvent): string {
  if (event.allDay) {
    const days = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    const first = new Date(`${event.start}T12:00:00Z`)
    return event.start === event.end ? days.format(first) : days.formatRange(first, new Date(`${event.end}T12:00:00Z`))
  }
  const times = new Intl.DateTimeFormat('en-US', { timeZone: TEAM_TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return times.formatRange(new Date(event.start), new Date(event.end))
}

// ---------------------------------------------------------------------------
// Demo mode: made-up events, the same every week. Build sessions on Tuesday
// and Thursday evenings and Saturdays, an outreach night, and a competition.

let demoAdded: CalendarEvent[] = []

/** For tests: forget events added in demo mode. */
export function resetDemoCalendar() {
  demoAdded = []
}

/** A time in Chicago on `day`, like 2026-11-03T18:00:00-06:00. */
function chicagoTime(day: string, hour: number): string {
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: TEAM_TIME_ZONE, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${day}T12:00:00Z`))
    .find((p) => p.type === 'timeZoneName')?.value
  const hours = Number(offset?.replace('GMT', '') || '-6')
  return `${day}T${String(hour).padStart(2, '0')}:00:00${hours < 0 ? '-' : '+'}${String(Math.abs(hours)).padStart(2, '0')}:00`
}

const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

function demoEvents(from: Date, to: Date): CalendarEvent[] {
  const made = (id: string, more: Partial<CalendarEvent>): CalendarEvent => ({
    id, title: '', start: '', end: '', allDay: false, location: null, description: null, url: null, fromApp: false, ...more,
  })
  const events: CalendarEvent[] = []
  const firstDay = new Intl.DateTimeFormat('en-CA', { timeZone: TEAM_TIME_ZONE }).format(from)
  let outreach = false
  let competition = false
  for (let i = 0; i < 400; i++) {
    const day = addDays(firstDay, i)
    if (Date.parse(`${day}T00:00:00Z`) > to.getTime() + DAY_MS) break
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
    if (weekday === 2 || weekday === 4) {
      events.push(made(`demo-${day}-build`, { title: 'Build session', start: chicagoTime(day, 18), end: chicagoTime(day, 21), location: 'The shop' }))
    }
    if (weekday === 6) {
      events.push(made(`demo-${day}-build`, { title: 'Saturday build', start: chicagoTime(day, 10), end: chicagoTime(day, 16), location: 'The shop' }))
    }
    if (weekday === 5 && i >= 7 && !outreach) {
      outreach = true
      events.push(made(`demo-${day}-outreach`, { title: 'Outreach: robot demo at the library', start: chicagoTime(day, 18), end: chicagoTime(day, 20), location: 'Example Public Library' }))
    }
    if (weekday === 5 && i >= 21 && !competition) {
      competition = true
      events.push(made(`demo-${day}-competition`, { title: 'Example Regional (made up)', start: day, end: addDays(day, 2), allDay: true, description: 'Leave from school at 6 AM.' }))
    }
  }
  const startOf = (e: CalendarEvent) => Date.parse(e.allDay ? `${e.start}T00:00:00-06:00` : e.start)
  const endOf = (e: CalendarEvent) => (e.allDay ? Date.parse(`${addDays(e.end, 1)}T00:00:00-06:00`) : Date.parse(e.end))
  return [...events, ...demoAdded]
    .filter((e) => startOf(e) < to.getTime() && endOf(e) > from.getTime())
    .sort((a, b) => startOf(a) - startOf(b))
}
