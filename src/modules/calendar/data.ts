/**
 * Calendar module data: the team's Google Calendar.
 *
 * The events live in Google Calendar, not in the app's database, so this
 * module has no table. It reads them with getCalendarEvents() from
 * src/core/calendar.ts, which asks the `calendar` server function (that's
 * where the Google key is). In demo mode it gives made-up events.
 *
 * The last events loaded are kept on this device, so the page and the home
 * page tile share one copy, and they still show with no connection.
 *
 * Student leaders, mentors and admins can add events from the app
 * (addEvent()), change or remove the ones the app added, and turn sign-ups
 * in the app on or off for any event (setSignUps()).
 *
 * Sign-ups come two ways:
 *   - A link, on a "Sign up: https://..." line in the description, for a
 *     Google Form or Slack post. Works for events made in Google Calendar.
 *   - In the app, for any event with sign-ups on (in the form for events
 *     the app added, or Take sign-ups on any event): people tap Sign up,
 *     and everyone sees who's going. Student leaders, mentors
 *     and admins can also sign someone else up or take them off. Those are
 *     kept in the calendar_signups table
 *     (supabase/migrations/..._calendar_signups.sql), one row per person
 *     per event.
 */
import { useEffect } from 'react'
import {
  addCalendarEvent,
  changeCalendarEvent,
  checkEvent,
  getCalendarEvents,
  removeCalendarEvent,
  setEventSignUps,
  TEAM_TIME_ZONE,
  type CalendarEvent,
  type EventInput,
} from '../../core/calendar'
import { DEMO_PEOPLE } from '../../core/demo'
import type { Member } from '../../core/members'
import type { Notice } from '../../core/registry'
import { currentUser, isLeader, type User } from '../../core/session'
import { createStore, useStore } from '../../core/store'
import { createTable, fail, ok, type Fields, type Result, type Row } from '../../core/table'

/** How far ahead the calendar shows. */
export const WEEKS_AHEAD = 8

const DAY_MS = 24 * 60 * 60 * 1000
/** Load again when the events on this device are older than this. */
const STALE_MS = 10 * 60 * 1000

export interface CalendarState {
  events: CalendarEvent[]
  /** When they were loaded, or null if never. */
  loadedAt: string | null
  /** Why the last load didn't work, or null. */
  error: string | null
}

const calendarStore = createStore<CalendarState>('calendar-events', 1, () => ({ events: [], loadedAt: null, error: null }))
const loadingStore = createStore('calendar-loading', 1, () => false, { persist: false })

/** Load the next few weeks of events. If it doesn't work, the last ones loaded stay. */
export async function loadEvents(now: Date = new Date()): Promise<void> {
  if (loadingStore.get()) return
  loadingStore.set(true)
  const result = await getCalendarEvents(now, new Date(now.getTime() + WEEKS_AHEAD * 7 * DAY_MS))
  calendarStore.set((prev) => (result.ok ? { events: result.value, loadedAt: now.toISOString(), error: null } : { ...prev, error: result.error }))
  loadingStore.set(false)
}

/** The events on this device now, for code outside a page. */
export function calendarNow(): CalendarState {
  return calendarStore.get()
}

/** For tests: forget the events on this device. */
export function resetCalendar() {
  calendarStore.reset()
  loadingStore.reset()
}

/** The events, loading them when they're missing or old. */
export function useCalendar(): CalendarState & { loading: boolean } {
  const state = useStore(calendarStore)
  const loading = useStore(loadingStore)
  useEffect(() => {
    const { loadedAt } = calendarStore.get()
    if (!loadedAt || Date.now() - Date.parse(loadedAt) > STALE_MS) void loadEvents()
  }, [])
  return { ...state, loading }
}

// ---------------------------------------------------------------------------
// Working out what to show. Plain functions, tested in data.test.ts.

/** The day it is in Chicago at `date`, like 2026-11-03. */
export function chicagoDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TEAM_TIME_ZONE }).format(date)
}

const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
const startTime = (event: CalendarEvent) => Date.parse(event.allDay ? `${event.start}T00:00:00-06:00` : event.start)

/** Whether an event is over. */
export function hasEnded(event: CalendarEvent, now: Date = new Date()): boolean {
  return event.allDay ? event.end < chicagoDay(now) : Date.parse(event.end) <= now.getTime()
}

/** A day like 2026-11-03 written out: "Tue, Nov 3", or with other options. */
function writeDay(day: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(`${day}T12:00:00Z`))
}

/** "Today", "Tomorrow", or a day like "Tue, Nov 3" (with the year when it isn't this year). */
export function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today'
  if (day === addDays(today, 1)) return 'Tomorrow'
  if (day.slice(0, 4) !== today.slice(0, 4)) return writeDay(day, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  return writeDay(day)
}

export interface DayOfEvents {
  /** Like 2026-11-03. */
  day: string
  /** Like "Today" or "Tue, Nov 3". */
  label: string
  events: CalendarEvent[]
}

/**
 * The events still to come, by day, in order. One that's already going
 * (a competition that started yesterday) shows under today.
 */
export function eventsByDay(events: CalendarEvent[], now: Date = new Date()): DayOfEvents[] {
  const today = chicagoDay(now)
  const days = new Map<string, CalendarEvent[]>()
  for (const event of [...events].sort((a, b) => startTime(a) - startTime(b))) {
    if (hasEnded(event, now)) continue
    const first = event.allDay ? event.start : chicagoDay(new Date(event.start))
    const day = first < today ? today : first
    days.set(day, [...(days.get(day) ?? []), event])
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({ day, label: dayLabel(day, today), events: list }))
}

const clock = (date: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TEAM_TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(date).replace(':00', '')

/** When an event is, on its day: "6 – 9 PM", "All day", or "All day, until Sun, Mar 15". */
export function timeOfDay(event: CalendarEvent): string {
  if (event.allDay) return event.start === event.end ? 'All day' : `All day, until ${writeDay(event.end)}`
  const start = new Date(event.start)
  const end = new Date(event.end)
  if (chicagoDay(start) !== chicagoDay(end)) return `${clock(start)} – ${writeDay(chicagoDay(end))}, ${clock(end)}`
  const [from, to] = [clock(start), clock(end)]
  // "6 – 9 PM" rather than "6 PM – 9 PM", but "11 AM – 2 PM" when it crosses noon.
  return from.slice(-2) === to.slice(-2) ? `${from.slice(0, -3)} – ${to}` : `${from} – ${to}`
}

/** The event happening now, or the next one to come, or null. */
export function nextEvent(events: CalendarEvent[], now: Date = new Date()): CalendarEvent | null {
  return [...events].filter((e) => !hasEnded(e, now)).sort((a, b) => startTime(a) - startTime(b))[0] ?? null
}

/** For the home page tile: "Build session, Tue 6 PM", "Build session, now", or "Example Regional, Mar 13". */
export function nextEventText(event: CalendarEvent, now: Date = new Date()): string {
  const today = chicagoDay(now)
  const day = event.allDay ? event.start : chicagoDay(new Date(event.start))
  const daysAway = (Date.parse(day) - Date.parse(today)) / DAY_MS
  // "today", "tomorrow", "Tue" for this week, then "Nov 19".
  const when =
    daysAway <= 0 ? 'today' :
    daysAway === 1 ? 'tomorrow' :
    daysAway < 7 ? writeDay(day, { weekday: 'short' }) :
    writeDay(day, { month: 'short', day: 'numeric' })
  if (event.allDay) return `${event.title}, ${when}`
  const start = new Date(event.start)
  if (start.getTime() <= now.getTime()) return `${event.title}, now`
  return `${event.title}, ${when}${daysAway < 7 ? '' : ','} ${clock(start)}`
}

/** A description from Google Calendar as plain text, which can have HTML in it, cut to `max` characters. */
export function plainText(text: string | null, max = 200): string | null {
  if (!text) return null
  const plain = text
    .replace(/<br\s*\/?>|<\/p>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  if (!plain) return null
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain
}

// A sign-up link lives in the event's description, on a line like
// "Sign up: https://forms.gle/abc123", so it works for events made in
// Google Calendar. See the README.

const SIGN_UP = /^sign ?up:/i

/** A description split into its lines. Google Calendar marks lines with <br> or <p> as well as new lines. */
const descriptionLines = (description: string) => description.split(/<br\s*\/?>|<\/p>|<\/div>|\n/i)

/** The link on one line of a description if it's a sign-up line with a safe link, or null. */
function signUpLinkOnLine(line: string): string | null {
  const text = plainText(line, Infinity)
  if (!text || !SIGN_UP.test(text)) return null
  // Google Calendar can wrap the link in <a href="...">, and the words shown might not be the link itself.
  const href = /href\s*=\s*["']([^"']*)["']/i.exec(line)?.[1]
  const link = href ? plainText(href, Infinity) : text.replace(SIGN_UP, '').trim().split(' ')[0]
  if (!link) return null
  try {
    const url = new URL(link)
    // Only https links, so a link like "javascript:..." can't run anything when someone taps it.
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** The event's sign-up link, from a "Sign up: https://..." line in its description, or null. */
export function signUpLink(description: string | null): string | null {
  if (!description) return null
  for (const line of descriptionLines(description)) {
    const link = signUpLinkOnLine(line)
    if (link) return link
  }
  return null
}

/** The description to show on the page: like plainText(), without the sign-up line, since that's the Sign up button. */
export function shownDescription(description: string | null, max = 200): string | null {
  if (!description) return null
  return plainText(descriptionLines(description).filter((line) => !signUpLinkOnLine(line)).join('\n'), max)
}

/** "Updated just now", "Updated 5 minutes ago", or "Updated Tue, Nov 3, 4:05 PM". */
export function updatedText(loadedAt: string | null, now: Date = new Date()): string {
  if (!loadedAt) return 'Not loaded yet'
  const minutes = Math.floor((now.getTime() - Date.parse(loadedAt)) / 60_000)
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const at = new Date(loadedAt)
  return `Updated ${dayLabel(chicagoDay(at), chicagoDay(now))}, ${clock(at)}`
}

// ---------------------------------------------------------------------------
// Adding, changing and removing events from the app. The form works in
// Chicago days and clock times; Google Calendar wants times with a time zone.

const wallClock = new Intl.DateTimeFormat('en-US', {
  timeZone: TEAM_TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})

/** The time on Chicago's clocks at `date`, as if that were UTC. */
function chicagoWallClock(date: Date): number {
  const p = Object.fromEntries(wallClock.formatToParts(date).map((part) => [part.type, Number(part.value)]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
}

/** The time, as ISO, of a clock time on a day in Chicago: ('2026-11-03', '18:00') gives 2026-11-04T00:00:00.000Z. */
export function chicagoTime(day: string, clockTime: string): string {
  const [year, month, date] = day.split('-').map(Number)
  const [hour, minute] = clockTime.split(':').map(Number)
  const wanted = Date.UTC(year, month - 1, date, hour, minute)
  // Start from the clock time as if it were UTC, then shift by the difference
  // twice (once more in case the shift crossed a daylight saving change).
  let guess = wanted
  for (let i = 0; i < 2; i++) guess += wanted - chicagoWallClock(new Date(guess))
  return new Date(guess).toISOString()
}

/** The clock time in Chicago at `date`, like "18:00", for a time box. */
export function chicagoClock(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TEAM_TIME_ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(date)
}

/** How people sign up for an event. These are also the words on the form's buttons. */
export type SignUpKind = 'No sign-ups' | 'In the app' | 'With a link'
export const SIGN_UP_KINDS: SignUpKind[] = ['No sign-ups', 'In the app', 'With a link']

/** What's in the Add event form. */
export interface EventForm {
  title: string
  allDay: boolean
  /** The day it's on, or an all-day event's first day. Like 2026-11-03. */
  day: string
  /** An all-day event's last day. */
  lastDay: string
  /** When it starts and ends on its day, like 18:00. Not for all-day events. */
  startClock: string
  endClock: string
  location: string
  description: string
  signUps: SignUpKind
  /** The sign-up link, when signUps is 'With a link'. */
  link: string
}

/** An empty form, for an event today from 6 to 8 PM. */
export function blankEventForm(now: Date = new Date()): EventForm {
  const today = chicagoDay(now)
  return { title: '', allDay: false, day: today, lastDay: today, startClock: '18:00', endClock: '20:00', location: '', description: '', signUps: 'No sign-ups', link: '' }
}

/** The form for changing an event: its sign-up line becomes the link box. */
export function formFromEvent(event: CalendarEvent): EventForm {
  const link = signUpLink(event.description)
  const firstDay = event.allDay ? event.start : chicagoDay(new Date(event.start))
  return {
    title: event.title,
    allDay: event.allDay,
    day: firstDay,
    lastDay: event.allDay ? event.end : firstDay,
    startClock: event.allDay ? '18:00' : chicagoClock(new Date(event.start)),
    endClock: event.allDay ? '20:00' : chicagoClock(new Date(event.end)),
    location: event.location ?? '',
    description: (event.description ?? '').split('\n').filter((line) => !signUpLinkOnLine(line)).join('\n').trim(),
    signUps: event.signUps ? 'In the app' : link ? 'With a link' : 'No sign-ups',
    link: link ?? '',
  }
}

/** The event to save from the form, or what to fix. A sign-up link goes in the description, on its own "Sign up:" line. */
export function eventFromForm(form: EventForm): Result<EventInput> {
  if (!form.day || (form.allDay && !form.lastDay)) return fail(form.allDay ? 'Pick the first and last days.' : 'Pick the day.')
  if (!form.allDay && (!form.startClock || !form.endClock)) return fail('Pick when it starts and ends.')
  let description = form.description.trim()
  if (form.signUps === 'With a link') {
    if (!form.link.trim()) return fail('Paste the sign-up link, like https://forms.gle/abc123.')
    const link = signUpLink(`Sign up: ${form.link.trim()}`)
    if (!link) return fail('The sign-up link has to start with https://. Copy it from the address bar of the form or Slack post.')
    description = description ? `${description}\nSign up: ${link}` : `Sign up: ${link}`
  }
  const event: EventInput = {
    title: form.title,
    allDay: form.allDay,
    start: form.allDay ? form.day : chicagoTime(form.day, form.startClock),
    end: form.allDay ? form.lastDay : chicagoTime(form.day, form.endClock),
    location: form.location,
    description,
    signUps: form.signUps === 'In the app',
  }
  const problem = checkEvent(event)
  return problem ? fail(problem) : ok(event)
}

/** Add an event to the team calendar from the form. Student leaders, mentors and admins. */
export async function addEvent(form: EventForm): Promise<Result<CalendarEvent>> {
  const input = eventFromForm(form)
  if (!input.ok) return input
  const added = await addCalendarEvent(input.value)
  if (added.ok) calendarStore.set((prev) => ({ ...prev, events: [...prev.events, added.value] }))
  return added
}

/** Change an event the app added. Student leaders, mentors and admins. */
export async function changeEvent(event: CalendarEvent, form: EventForm): Promise<Result<CalendarEvent>> {
  const input = eventFromForm(form)
  if (!input.ok) return input
  const changed = await changeCalendarEvent(event, input.value)
  if (changed.ok) calendarStore.set((prev) => ({ ...prev, events: prev.events.map((e) => (e.id === event.id ? changed.value : e)) }))
  return changed
}

/** Remove an event the app added. Student leaders, mentors and admins. */
export async function removeEvent(event: CalendarEvent): Promise<Result> {
  const removed = await removeCalendarEvent(event)
  if (removed.ok) calendarStore.set((prev) => ({ ...prev, events: prev.events.filter((e) => e.id !== event.id) }))
  return removed
}

/**
 * Turn sign-ups in the app on or off for an event, without changing
 * anything else about it: for events made in Google Calendar too. Student
 * leaders, mentors and admins.
 *
 * Turning them off keeps who signed up, hidden, so turning them back on
 * brings the list back. Only events that aren't over can be turned on.
 */
export async function setSignUps(event: CalendarEvent, on: boolean): Promise<Result<CalendarEvent>> {
  if (on && hasEnded(event)) return fail("This event is over, so it can't take sign-ups.")
  const changed = await setEventSignUps(event, on)
  if (changed.ok) calendarStore.set((prev) => ({ ...prev, events: prev.events.map((e) => (e.id === event.id ? changed.value : e)) }))
  return changed
}

/**
 * Whether a student leader, mentor or admin sees Take sign-ups on an event:
 * it isn't over, doesn't take sign-ups in the app yet, and has no sign-up
 * link (two Sign up buttons would be confusing). Stop sign-ups shows on
 * events that take them.
 */
export function canTakeSignUps(event: CalendarEvent, now: Date = new Date()): boolean {
  return !event.signUps && !hasEnded(event, now) && !signUpLink(event.description)
}

// ---------------------------------------------------------------------------
// Sign-ups in the app: the calendar_signups table. The database lets
// everyone on the team see who's signed up, and students add or remove
// only their own sign-up. Student leaders, mentors and admins can sign
// anyone up and take anyone off.

/** One row of the calendar_signups table: one person going to one event. */
export interface SignUp extends Row {
  /** The event's Google Calendar id. */
  event_id: string
  /** Who signed up. Show their name with useMemberNames(). */
  created_by: string
}

// Made-up people signed up for the demo outreach night (src/core/calendar.ts).
const EXAMPLE_SIGN_UPS: SignUp[] = [
  { id: '00000000-0000-4000-8000-0000000ca101', event_id: 'demo-outreach', created_at: '2026-11-01T15:00:00Z', created_by: DEMO_PEOPLE.jordan },
  { id: '00000000-0000-4000-8000-0000000ca102', event_id: 'demo-outreach', created_at: '2026-11-02T01:30:00Z', created_by: DEMO_PEOPLE.pat },
]

export const signUpsTable = createTable<SignUp>('calendar_signups', { demo: EXAMPLE_SIGN_UPS })

/** Every sign-up, first to sign up first. */
export function useSignUps(): SignUp[] {
  return signUpsTable.useRows()
}

/** Who's signed up for an event, first to sign up first. */
export function signUpsFor(signUps: SignUp[], event: CalendarEvent): SignUp[] {
  return signUps.filter((s) => s.event_id === event.id)
}

/** Whether `user` can sign other people up and take them off: student leaders, mentors and admins. */
export function canManageSignUps(user: Pick<User, 'role'>): boolean {
  return isLeader(user.role)
}

/** People a leader could sign up for an event: everyone whose access is on and who isn't signed up yet, by name. */
export function notSignedUp(members: Member[], signUps: SignUp[], event: CalendarEvent): Member[] {
  const going = new Set(signUpsFor(signUps, event).map((s) => s.created_by))
  return members.filter((m) => m.active && !going.has(m.id)).sort((a, b) => a.name.localeCompare(b.name))
}

const signUpOf = (event: CalendarEvent, personId: string) => signUpsTable.rows().find((s) => s.event_id === event.id && s.created_by === personId)

/**
 * Sign up for an event that takes sign-ups in the app: yourself, or, for
 * student leaders, mentors and admins, someone else (`personId`).
 */
export async function signUp(event: CalendarEvent, personId?: string): Promise<Result<SignUp>> {
  const me = currentUser()
  if (!me) return fail('Sign in first.')
  const person = personId ?? me.id
  const isMe = person === me.id
  if (!isMe && !canManageSignUps(me)) return fail('Only student leaders and mentors can sign someone else up. Ask one of them.')
  if (!event.signUps) return fail("This event doesn't take sign-ups in the app.")
  if (hasEnded(event)) return fail('This event is over, so sign-ups are closed.')
  if (signUpOf(event, person)) return fail(isMe ? "You're already signed up." : "They're already signed up.")
  // The database fills in created_by with whoever is signed in; a leader signing someone else up sets it.
  return signUpsTable.insert({ event_id: event.id, created_by: person } as Fields<SignUp>)
}

/**
 * Take back a sign-up: your own, or, for student leaders, mentors and
 * admins, someone else's (`personId`).
 */
export async function cancelSignUp(event: CalendarEvent, personId?: string): Promise<Result> {
  const me = currentUser()
  if (!me) return fail('Sign in first.')
  const person = personId ?? me.id
  const isMe = person === me.id
  if (!isMe && !canManageSignUps(me)) return fail('Only student leaders and mentors can take someone else off. Ask one of them.')
  const row = signUpOf(event, person)
  if (!row) return fail(isMe ? "You aren't signed up for this event." : "They aren't signed up for this event.")
  return signUpsTable.remove(row.id)
}

/** The home page tile's status: the next event, and whether it has a sign-up. */
export function useCalendarSummary(): Notice {
  const { events, loadedAt, error } = useCalendar()
  const next = nextEvent(events)
  if (next) return { tone: 'info', text: `Next: ${nextEventText(next)}${next.signUps || signUpLink(next.description) ? ' · Sign-up open' : ''}` }
  if (error && !loadedAt) return { tone: 'warn', text: "Couldn't load the team calendar" }
  if (!loadedAt) return { tone: 'plain', text: 'Loading the team calendar…' }
  return { tone: 'plain', text: `Nothing in the next ${WEEKS_AHEAD} weeks` }
}
