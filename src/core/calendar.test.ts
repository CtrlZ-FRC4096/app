// Tests for the team calendar (calendar.ts), in demo mode.
import { afterEach, describe, expect, it } from 'vitest'
import { addCalendarEvent, changeCalendarEvent, checkEvent, eventTime, getCalendarEvents, removeCalendarEvent, resetDemoCalendar, type CalendarEvent } from './calendar'
import { setDemoRole } from './demo'

afterEach(() => {
  setDemoRole('student')
  resetDemoCalendar()
})

// Intl puts thin spaces around the dash and before AM/PM; tests compare plain ones.
const plain = (text: string) => text.replace(/[  ]/g, ' ')
const event = (more: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e1', title: 'Build session', start: '2026-11-03T18:00:00-06:00', end: '2026-11-03T21:00:00-06:00', allDay: false, location: null, description: null, url: null, fromApp: false, ...more,
})
const meeting = { title: 'Parent meeting', start: '2026-11-05T01:00:00Z', end: '2026-11-05T02:00:00Z', allDay: false }

describe('eventTime', () => {
  it('shows times in Chicago', () => {
    expect(plain(eventTime(event({})))).toBe('Tue, Nov 3, 6:00 – 9:00 PM')
    expect(plain(eventTime(event({ start: '2026-11-03T23:00:00Z', end: '2026-11-04T01:00:00Z' })))).toBe('Tue, Nov 3, 5:00 – 7:00 PM')
  })

  it('shows days for all-day events', () => {
    expect(eventTime(event({ allDay: true, start: '2026-11-07', end: '2026-11-07' }))).toBe('Sat, Nov 7')
    expect(plain(eventTime(event({ allDay: true, start: '2026-03-13', end: '2026-03-15' })))).toBe('Fri, Mar 13 – Sun, Mar 15')
  })
})

describe('getCalendarEvents', () => {
  it('gives made-up events in demo mode, in order', async () => {
    const from = new Date('2026-11-02T06:00:00Z') // Monday morning in Chicago
    const result = await getCalendarEvents(from, new Date('2026-11-09T06:00:00Z'))
    if (!result.ok) throw new Error(result.error)
    expect(result.value.map((e) => [e.title, plain(eventTime(e))])).toEqual([
      ['Build session', 'Tue, Nov 3, 6:00 – 9:00 PM'],
      ['Build session', 'Thu, Nov 5, 6:00 – 9:00 PM'],
      ['Saturday build', 'Sat, Nov 7, 10:00 AM – 4:00 PM'],
    ])
  })
})

describe('checkEvent', () => {
  it('needs a title, and an end after the start', () => {
    expect(checkEvent(meeting)).toBeNull()
    expect(checkEvent({ ...meeting, title: ' ' })).toBe('Give the event a title.')
    expect(checkEvent({ ...meeting, end: meeting.start })).toBe('The event ends before it starts.')
    expect(checkEvent({ title: 'Kickoff', start: '2027-01-09', end: '2027-01-09', allDay: true })).toBeNull()
    expect(checkEvent({ title: 'Kickoff', start: '2027-01-09', end: '2027-01-08', allDay: true })).toBe('The last day is before the first.')
  })
})

describe('adding, changing and removing', () => {
  it('lets mentors add events, then change and remove them', async () => {
    setDemoRole('mentor')
    const added = await addCalendarEvent({ ...meeting, title: '  Parent meeting ', location: ' ' })
    if (!added.ok) throw new Error(added.error)
    expect(added.value).toMatchObject({ title: 'Parent meeting', location: null, fromApp: true })

    const changed = await changeCalendarEvent(added.value, { ...meeting, title: 'Parent meeting (moved)' })
    expect(changed).toMatchObject({ ok: true, value: { title: 'Parent meeting (moved)' } })
    const week = await getCalendarEvents(new Date('2026-11-04T06:00:00Z'), new Date('2026-11-05T06:00:00Z'))
    expect(week.ok && week.value.map((e) => e.title)).toEqual(['Parent meeting (moved)'])

    expect(await removeCalendarEvent(added.value)).toEqual({ ok: true, value: null })
    const after = await getCalendarEvents(new Date('2026-11-04T06:00:00Z'), new Date('2026-11-05T06:00:00Z'))
    expect(after.ok && after.value).toEqual([])
  })

  it("doesn't let students change the calendar", async () => {
    expect(await addCalendarEvent(meeting)).toEqual({ ok: false, error: 'Only mentors can change the team calendar.' })
  })

  it("leaves events people made in Google Calendar alone", async () => {
    setDemoRole('admin')
    expect(await removeCalendarEvent(event({ fromApp: false }))).toEqual({
      ok: false,
      error: 'The app only changes events it added. Change this one in Google Calendar.',
    })
  })
})
