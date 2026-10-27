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
 */
import { useEffect } from 'react'
import { getCalendarEvents, TEAM_TIME_ZONE, type CalendarEvent } from '../../core/calendar'
import type { Notice } from '../../core/registry'
import { createStore, useStore } from '../../core/store'

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

/** "Updated just now", "Updated 5 minutes ago", or "Updated Tue, Nov 3, 4:05 PM". */
export function updatedText(loadedAt: string | null, now: Date = new Date()): string {
  if (!loadedAt) return 'Not loaded yet'
  const minutes = Math.floor((now.getTime() - Date.parse(loadedAt)) / 60_000)
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const at = new Date(loadedAt)
  return `Updated ${dayLabel(chicagoDay(at), chicagoDay(now))}, ${clock(at)}`
}

/** The home page tile's status: the next event. */
export function useCalendarSummary(): Notice {
  const { events, loadedAt, error } = useCalendar()
  const next = nextEvent(events)
  if (next) return { tone: 'info', text: `Next: ${nextEventText(next)}` }
  if (error && !loadedAt) return { tone: 'warn', text: "Couldn't load the team calendar" }
  if (!loadedAt) return { tone: 'plain', text: 'Loading the team calendar…' }
  return { tone: 'plain', text: `Nothing in the next ${WEEKS_AHEAD} weeks` }
}
