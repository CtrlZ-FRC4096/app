// Tests for data.ts. Run them with `npm test`. They run in demo mode, with
// made-up events. Times are in Chicago: 2026-11-03 is a Tuesday, and Chicago
// is 6 hours behind UTC then.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import type { CalendarEvent } from '../../core/calendar'
import { calendarNow, chicagoDay, dayLabel, eventsByDay, hasEnded, loadEvents, nextEvent, nextEventText, plainText, resetCalendar, timeOfDay, updatedText, useCalendarSummary } from './data'

beforeEach(() => resetCalendar())

// Intl puts thin spaces before AM and PM; the tests compare plain ones.
const plain = (text: string) => text.replace(/[  ]/g, ' ')
const event = (id: string, more: Partial<CalendarEvent>): CalendarEvent => ({
  id, title: 'Build session', start: '2026-11-03T18:00:00-06:00', end: '2026-11-03T21:00:00-06:00', allDay: false, location: null, description: null, url: null, fromApp: false, ...more,
})
// Tuesday, Nov 3, 3 PM in Chicago.
const now = new Date('2026-11-03T21:00:00Z')

describe('dayLabel', () => {
  it('says Today and Tomorrow, then the day', () => {
    expect(dayLabel('2026-11-03', '2026-11-03')).toBe('Today')
    expect(dayLabel('2026-11-04', '2026-11-03')).toBe('Tomorrow')
    expect(dayLabel('2026-11-07', '2026-11-03')).toBe('Sat, Nov 7')
    expect(dayLabel('2027-01-09', '2026-11-03')).toBe('Sat, Jan 9, 2027')
  })

  it("goes by Chicago's day, not the server's", () => {
    // 2 AM UTC on Wednesday is 8 PM Tuesday in Chicago.
    expect(chicagoDay(new Date('2026-11-04T02:00:00Z'))).toBe('2026-11-03')
  })
})

describe('eventsByDay', () => {
  it('lists what is still to come by day, with a competition that already started under today', () => {
    const events = [
      event('thu', { start: '2026-11-05T18:00:00-06:00', end: '2026-11-05T21:00:00-06:00' }),
      event('morning', { title: 'Shop cleanup', start: '2026-11-03T08:00:00-06:00', end: '2026-11-03T09:00:00-06:00' }),
      event('tonight', {}),
      event('regional', { title: 'Example Regional', allDay: true, start: '2026-11-02', end: '2026-11-04' }),
    ]
    expect(eventsByDay(events, now).map((d) => [d.label, d.events.map((e) => e.id)])).toEqual([
      ['Today', ['regional', 'tonight']],
      ['Thu, Nov 5', ['thu']],
    ])
  })

  it('is empty when nothing is coming up', () => {
    expect(eventsByDay([event('morning', { start: '2026-11-03T08:00:00-06:00', end: '2026-11-03T09:00:00-06:00' })], now)).toEqual([])
  })
})

describe('timeOfDay', () => {
  it('writes the times plainly', () => {
    expect(plain(timeOfDay(event('a', {})))).toBe('6 – 9 PM')
    expect(plain(timeOfDay(event('a', { start: '2026-11-07T10:00:00-06:00', end: '2026-11-07T16:00:00-06:00' })))).toBe('10 AM – 4 PM')
    expect(plain(timeOfDay(event('a', { start: '2026-11-03T18:30:00-06:00' })))).toBe('6:30 – 9 PM')
    expect(plain(timeOfDay(event('a', { start: '2026-11-06T22:00:00-06:00', end: '2026-11-07T02:00:00-06:00' })))).toBe('10 PM – Sat, Nov 7, 2 AM')
  })

  it('says All day, and until when', () => {
    expect(timeOfDay(event('a', { allDay: true, start: '2026-11-07', end: '2026-11-07' }))).toBe('All day')
    expect(timeOfDay(event('a', { allDay: true, start: '2027-03-13', end: '2027-03-15' }))).toBe('All day, until Mon, Mar 15')
  })
})

describe('nextEvent and nextEventText', () => {
  it('picks the event happening now, or the next to come', () => {
    const over = event('over', { start: '2026-11-03T08:00:00-06:00', end: '2026-11-03T09:00:00-06:00' })
    const later = event('later', { start: '2026-11-05T18:00:00-06:00', end: '2026-11-05T21:00:00-06:00' })
    expect(nextEvent([later, over, event('tonight', {})], now)?.id).toBe('tonight')
    expect(nextEvent([over], now)).toBeNull()
  })

  it('says when, briefly, for the home page', () => {
    expect(plain(nextEventText(event('a', {}), now))).toBe('Build session, today 6 PM')
    expect(plain(nextEventText(event('a', { start: '2026-11-04T18:00:00-06:00', end: '2026-11-04T21:00:00-06:00' }), now))).toBe('Build session, tomorrow 6 PM')
    expect(plain(nextEventText(event('a', { start: '2026-11-07T10:00:00-06:00', end: '2026-11-07T16:00:00-06:00' }), now))).toBe('Build session, Sat 10 AM')
    expect(plain(nextEventText(event('a', { start: '2026-11-19T18:30:00-06:00', end: '2026-11-19T21:00:00-06:00' }), now))).toBe('Build session, Nov 19, 6:30 PM')
    expect(nextEventText(event('a', { start: '2026-11-03T14:00:00-06:00', end: '2026-11-03T17:00:00-06:00' }), now)).toBe('Build session, now')
    expect(nextEventText(event('a', { title: 'Example Regional', allDay: true, start: '2027-03-13', end: '2027-03-15' }), now)).toBe('Example Regional, Mar 13')
    expect(nextEventText(event('a', { title: 'Example Regional', allDay: true, start: '2026-11-02', end: '2026-11-04' }), now)).toBe('Example Regional, today')
  })

  it('counts an all-day event as over only after its last day', () => {
    expect(hasEnded(event('a', { allDay: true, start: '2026-11-02', end: '2026-11-03' }), now)).toBe(false)
    expect(hasEnded(event('a', { allDay: true, start: '2026-11-01', end: '2026-11-02' }), now)).toBe(true)
  })
})

describe('plainText', () => {
  it('turns a description from Google Calendar into plain text', () => {
    expect(plainText('Bring <b>safety glasses</b> &amp; a laptop.<br>Doors at 5:45')).toBe('Bring safety glasses & a laptop. Doors at 5:45')
    expect(plainText(null)).toBeNull()
    expect(plainText('<br>')).toBeNull()
    expect(plainText('x'.repeat(300))).toHaveLength(200)
  })
})

describe('updatedText', () => {
  it('says how long ago the events loaded', () => {
    expect(updatedText(null, now)).toBe('Not loaded yet')
    expect(updatedText('2026-11-03T20:59:30Z', now)).toBe('Updated just now')
    expect(updatedText('2026-11-03T20:55:00Z', now)).toBe('Updated 5 minutes ago')
    expect(plain(updatedText('2026-11-02T22:05:00Z', now))).toBe('Updated Mon, Nov 2, 4:05 PM')
  })
})

describe('loading', () => {
  it('loads the made-up events in demo mode, and the home page tile shows the next one', async () => {
    await loadEvents()
    expect(calendarNow().events.length).toBeGreaterThan(0)
    expect(calendarNow().error).toBeNull()
    const Tile = () => createElement('p', null, useCalendarSummary().text)
    expect(renderToString(createElement(Tile))).toMatch(/^<p>Next: /)
  })

  it('keeps the last events when loading stops working, and says why', async () => {
    vi.resetModules()
    const getCalendarEvents = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: [event('tonight', {})] })
      .mockResolvedValueOnce({ ok: false, error: "Couldn't reach the server. Check your connection and try again." })
    vi.doMock('../../core/calendar', async (original) => ({ ...(await original<object>()), getCalendarEvents }))
    const fresh = await import('./data')
    fresh.resetCalendar()
    await fresh.loadEvents(now)
    await fresh.loadEvents(now)
    expect(fresh.calendarNow()).toEqual({ events: [event('tonight', {})], loadedAt: now.toISOString(), error: "Couldn't reach the server. Check your connection and try again." })
    vi.doUnmock('../../core/calendar')
    vi.resetModules()
  })
})

afterEach(() => vi.restoreAllMocks())
