// Tests for data.ts. Run them with `npm test`. They run in demo mode, with
// made-up events. Times are in Chicago: 2026-11-03 is a Tuesday, and Chicago
// is 6 hours behind UTC then.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { addCalendarEvent, resetDemoCalendar, type CalendarEvent } from '../../core/calendar'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import CalendarPage from './CalendarPage'
import {
  addEvent,
  blankEventForm,
  calendarNow,
  cancelSignUp,
  changeEvent,
  chicagoClock,
  chicagoDay,
  chicagoTime,
  dayLabel,
  eventFromForm,
  eventsByDay,
  formFromEvent,
  hasEnded,
  loadEvents,
  nextEvent,
  nextEventText,
  plainText,
  removeEvent,
  resetCalendar,
  shownDescription,
  signUp,
  signUpLink,
  signUpsFor,
  signUpsTable,
  timeOfDay,
  updatedText,
  useCalendarSummary,
  type EventForm,
} from './data'

beforeEach(() => {
  resetCalendar()
  resetDemoCalendar()
  signUpsTable.reset()
  setDemoRole('student')
})

// Intl puts thin spaces before AM and PM; the tests compare plain ones.
const plain = (text: string) => text.replace(/[  ]/g, ' ')
const event = (id: string, more: Partial<CalendarEvent>): CalendarEvent => ({
  id, title: 'Build session', start: '2026-11-03T18:00:00-06:00', end: '2026-11-03T21:00:00-06:00', allDay: false, location: null, description: null, url: null, fromApp: false, addedBy: null, signUps: false, ...more,
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

describe('signUpLink', () => {
  it('finds a "Sign up:" line, in upper or lower case, with or without the space', () => {
    expect(signUpLink('Robot demo at the library.\nSign up: https://forms.gle/abc123')).toBe('https://forms.gle/abc123')
    expect(signUpLink('signup: https://forms.gle/abc123')).toBe('https://forms.gle/abc123')
    expect(signUpLink('SIGN UP:https://forms.gle/abc123 by Friday')).toBe('https://forms.gle/abc123')
  })

  it('finds a link Google Calendar wrapped in HTML, even when the words shown are different', () => {
    expect(signUpLink('Bring a laptop.<br>Sign up: <a href="https://forms.gle/abc123">https://forms.gle/abc123</a>')).toBe('https://forms.gle/abc123')
    expect(signUpLink('<p>Bring a laptop.</p><p>Sign up: <a href="https://example.com/form?a=1&amp;b=2" target="_blank">the form</a></p>')).toBe('https://example.com/form?a=1&b=2')
  })

  it('handles what Google Calendar adds: a non-breaking space, and links wrapped in a Google redirect', () => {
    expect(signUpLink('Sign up:&nbsp;<a href="https://forms.gle/abc123">https://forms.gle/abc123</a>')).toBe('https://forms.gle/abc123')
    // Pasted from Google Docs or Gmail. Still https, and the redirect takes people to the form.
    expect(signUpLink('Sign up: <a href="https://www.google.com/url?q=https://forms.gle/abc123&amp;sa=D">https://forms.gle/abc123</a>')).toBe('https://www.google.com/url?q=https://forms.gle/abc123&sa=D')
  })

  it('ignores http and javascript links, so a bad link never becomes a button', () => {
    expect(signUpLink('Sign up: http://forms.gle/abc123')).toBeNull()
    expect(signUpLink('Sign up: javascript:alert(1)')).toBeNull()
    expect(signUpLink('Sign up: <a href="javascript:alert(1)">https://forms.gle/abc123</a>')).toBeNull()
  })

  it('is null with no sign-up line', () => {
    expect(signUpLink(null)).toBeNull()
    expect(signUpLink('Leave from school at 6 AM.')).toBeNull()
    expect(signUpLink('Sign up:')).toBeNull()
    // Only a line that starts with "Sign up:" counts.
    expect(signUpLink('Remember to sign up: https://forms.gle/abc123')).toBeNull()
  })
})

describe('shownDescription', () => {
  it('leaves out the sign-up line, since the Sign up button has the link', () => {
    expect(shownDescription('Robot demo at the library.\nSign up: https://forms.gle/abc123\nWear your team shirt.')).toBe('Robot demo at the library. Wear your team shirt.')
    expect(shownDescription('Bring a laptop.<br>Sign up: <a href="https://forms.gle/abc123">https://forms.gle/abc123</a>')).toBe('Bring a laptop.')
    expect(shownDescription('Sign up: https://forms.gle/abc123')).toBeNull()
  })

  it('keeps a sign-up line whose link was ignored, so nothing goes missing', () => {
    expect(shownDescription('Sign up: http://forms.gle/abc123')).toBe('Sign up: http://forms.gle/abc123')
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

describe('sign-ups in demo mode', () => {
  // A made-up event tomorrow with a sign-up line, next to the demo build sessions, which have none.
  // Only mentors can add events, so this views the app as a mentor to add it, then as a student again.
  async function addOutreachWithSignUp() {
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
    setDemoRole('mentor')
    const result = await addCalendarEvent({
      title: 'Outreach: robot demo (made up)',
      start: start.toISOString(),
      end: new Date(start.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      allDay: false,
      description: 'Bring your team shirt.\nSign up: https://forms.gle/abc123',
    })
    setDemoRole('student')
    expect(result).toMatchObject({ ok: true })
    await loadEvents()
  }

  it('shows a Sign up button only on the event with a link, and not the sign-up line', async () => {
    await addOutreachWithSignUp()
    const outreach = calendarNow().events.find((e) => e.title === 'Outreach: robot demo (made up)')!
    const page = await pageWith([event('build', { start: '2099-11-03T18:00:00-06:00', end: '2099-11-03T21:00:00-06:00' }), outreach])
    expect(page).toContain('Outreach: robot demo (made up)')
    expect(page).toContain('Build session')
    expect(page.match(/>Sign up</g)).toHaveLength(1)
    expect(page).toContain('href="https://forms.gle/abc123" target="_blank"')
    expect(page).toContain('Bring your team shirt.')
    expect(page).not.toContain('Sign up:')
  })

  it('shows no Sign up button when no event has a link', async () => {
    expect(await pageWith([event('build', { start: '2099-11-03T18:00:00-06:00', end: '2099-11-03T21:00:00-06:00' })])).not.toMatch(/>Sign up</)
  })

  it('shows the made-up events with both kinds of sign-up, and who is going', async () => {
    await loadEvents()
    const page = renderToString(createElement(CalendarPage))
    expect(page).toContain('href="https://example.com/regional-sign-up"')
    expect(page).toContain('Going (2): Jordan Kim, Pat Chen')
    expect(page.match(/>Sign up</g)).toHaveLength(2)
  })
})

/** The Calendar page with only these events on the calendar. */
async function pageWith(events: CalendarEvent[]): Promise<string> {
  vi.resetModules()
  const getCalendarEvents = vi.fn().mockResolvedValue({ ok: true, value: events })
  vi.doMock('../../core/calendar', async (original) => ({ ...(await original<object>()), getCalendarEvents }))
  const fresh = await import('./data')
  const { default: Page } = await import('./CalendarPage')
  fresh.resetCalendar()
  await fresh.loadEvents()
  const page = renderToString(createElement(Page))
  vi.doUnmock('../../core/calendar')
  vi.resetModules()
  return page
}

describe('chicagoTime and chicagoClock', () => {
  it('turns a day and clock time in Chicago into a time, in winter and summer', () => {
    expect(chicagoTime('2026-11-03', '18:00')).toBe('2026-11-04T00:00:00.000Z')
    expect(chicagoTime('2026-07-04', '18:30')).toBe('2026-07-04T23:30:00.000Z')
    // The day the clocks go forward: 3:30 AM is already daylight time.
    expect(chicagoTime('2026-03-08', '03:30')).toBe('2026-03-08T08:30:00.000Z')
  })

  it('gives the clock time in Chicago, for the time box', () => {
    expect(chicagoClock(new Date('2026-11-04T00:00:00Z'))).toBe('18:00')
    expect(chicagoClock(new Date('2026-07-04T14:05:00Z'))).toBe('09:05')
  })
})

describe('the event form', () => {
  const form = (more: Partial<EventForm>): EventForm => ({ ...blankEventForm(new Date('2026-11-03T21:00:00Z')), title: 'Parent meeting', startClock: '19:00', endClock: '20:00', ...more })

  it('starts on today, from 6 to 8 PM, with no sign-ups', () => {
    expect(blankEventForm(now)).toMatchObject({ day: '2026-11-03', lastDay: '2026-11-03', startClock: '18:00', endClock: '20:00', signUps: 'No sign-ups' })
  })

  it('turns the form into an event, with times in Chicago', () => {
    expect(eventFromForm(form({ location: ' The shop ' }))).toEqual({
      ok: true,
      value: { title: 'Parent meeting', allDay: false, start: '2026-11-04T01:00:00.000Z', end: '2026-11-04T02:00:00.000Z', location: ' The shop ', description: '', signUps: false },
    })
    expect(eventFromForm(form({ allDay: true, day: '2027-03-12', lastDay: '2027-03-14' }))).toMatchObject({ ok: true, value: { allDay: true, start: '2027-03-12', end: '2027-03-14' } })
  })

  it('puts a sign-up link on its own "Sign up:" line, and turns on sign-ups in the app', () => {
    expect(eventFromForm(form({ signUps: 'With a link', link: ' https://forms.gle/abc123 ', description: 'Bring your team shirt.' }))).toMatchObject({
      ok: true, value: { description: 'Bring your team shirt.\nSign up: https://forms.gle/abc123', signUps: false },
    })
    expect(eventFromForm(form({ signUps: 'With a link', link: 'https://forms.gle/abc123' }))).toMatchObject({ value: { description: 'Sign up: https://forms.gle/abc123' } })
    expect(eventFromForm(form({ signUps: 'In the app', link: 'https://forms.gle/abc123' }))).toMatchObject({ value: { description: '', signUps: true } })
  })

  it('says what to fix', () => {
    expect(eventFromForm(form({ title: ' ' }))).toEqual({ ok: false, error: 'Give the event a title.' })
    expect(eventFromForm(form({ day: '' }))).toEqual({ ok: false, error: 'Pick the day.' })
    expect(eventFromForm(form({ endClock: '' }))).toEqual({ ok: false, error: 'Pick when it starts and ends.' })
    expect(eventFromForm(form({ endClock: '18:00' }))).toEqual({ ok: false, error: 'The event ends before it starts.' })
    expect(eventFromForm(form({ allDay: true, day: '2027-03-12', lastDay: '2027-03-11' }))).toEqual({ ok: false, error: 'The last day is before the first.' })
    expect(eventFromForm(form({ signUps: 'With a link', link: '' }))).toMatchObject({ ok: false, error: expect.stringMatching(/Paste the sign-up link/) })
    expect(eventFromForm(form({ signUps: 'With a link', link: 'http://forms.gle/abc123' }))).toMatchObject({ ok: false, error: expect.stringMatching(/https:/) })
    expect(eventFromForm(form({ signUps: 'With a link', link: 'javascript:alert(1)' }))).toMatchObject({ ok: false, error: expect.stringMatching(/https:/) })
  })

  it('fills the Change form back in from the event, with the sign-up line in the link box', () => {
    for (const filled of [
      form({ location: 'The shop', description: 'Bring your team shirt.', signUps: 'With a link', link: 'https://forms.gle/abc123' }),
      form({ signUps: 'In the app' }),
      form({ allDay: true, day: '2027-03-12', lastDay: '2027-03-14', startClock: '18:00', endClock: '20:00' }),
    ]) {
      const saved = eventFromForm(filled)
      if (!saved.ok) throw new Error(saved.error)
      const { location, description, signUps, ...rest } = saved.value
      expect(formFromEvent(event('e1', { ...rest, location: location || null, description: description || null, signUps: !!signUps, fromApp: true }))).toEqual(filled)
    }
  })
})

describe('adding, changing and removing events', () => {
  const tonight = (title: string): EventForm => ({ ...blankEventForm(), title, startClock: '23:00', endClock: '23:30' })

  it('lets a student add an event, which shows straight away, then change and remove it', async () => {
    const added = await addEvent(tonight('Pizza after build'))
    if (!added.ok) throw new Error(added.error)
    expect(added.value).toMatchObject({ addedBy: DEMO_PEOPLE.alex, fromApp: true })
    expect(calendarNow().events.map((e) => e.title)).toContain('Pizza after build')

    expect(await changeEvent(added.value, tonight('Pizza after build (moved)'))).toMatchObject({ ok: true })
    expect(calendarNow().events.map((e) => e.title)).toEqual(['Pizza after build (moved)'])
    expect(await removeEvent(added.value)).toEqual({ ok: true, value: null })
    expect(calendarNow().events).toEqual([])
  })

  it("doesn't change anything when the form has a problem", async () => {
    expect(await addEvent(tonight(''))).toEqual({ ok: false, error: 'Give the event a title.' })
    expect(calendarNow().events).toEqual([])
  })

  it("shows Change and Remove only to who added the event, and mentors", async () => {
    await loadEvents()
    // The made-up outreach night was added by Pat, a mentor.
    expect(renderToString(createElement(CalendarPage))).not.toMatch(/>Change</)
    setDemoRole('mentor')
    expect(renderToString(createElement(CalendarPage)).match(/>Change</g)).toHaveLength(1)
  })
})

describe('signing up in the app', () => {
  const outreach = event('demo-outreach', { title: 'Outreach', start: '2099-11-13T18:00:00-06:00', end: '2099-11-13T20:00:00-06:00', fromApp: true, signUps: true })
  const going = () => signUpsFor(signUpsTable.rows(), outreach).map((s) => s.created_by)

  it('lets you sign up, once, and take it back', async () => {
    expect(going()).toEqual([DEMO_PEOPLE.jordan, DEMO_PEOPLE.pat])
    expect(await signUp(outreach)).toMatchObject({ ok: true, value: { event_id: 'demo-outreach', created_by: DEMO_PEOPLE.alex } })
    expect(going()).toEqual([DEMO_PEOPLE.jordan, DEMO_PEOPLE.pat, DEMO_PEOPLE.alex])
    expect(await signUp(outreach)).toEqual({ ok: false, error: "You're already signed up." })

    expect(await cancelSignUp(outreach)).toEqual({ ok: true, value: null })
    expect(going()).toEqual([DEMO_PEOPLE.jordan, DEMO_PEOPLE.pat])
    expect(await cancelSignUp(outreach)).toEqual({ ok: false, error: "You aren't signed up for this event." })
  })

  it("doesn't sign you up for events without sign-ups in the app, or ones that are over", async () => {
    expect(await signUp({ ...outreach, signUps: false })).toEqual({ ok: false, error: "This event doesn't take sign-ups in the app." })
    expect(await signUp({ ...outreach, start: '2020-11-13T18:00:00-06:00', end: '2020-11-13T20:00:00-06:00' })).toEqual({ ok: false, error: 'This event is over, so sign-ups are closed.' })
  })

  it('lists who signed up for one event only', () => {
    expect(signUpsFor(signUpsTable.rows(), { ...outreach, id: 'other' })).toEqual([])
  })
})

describe('useCalendarSummary', () => {
  const tile = () => renderToString(createElement(() => createElement('p', null, useCalendarSummary().text)))

  it('says "Sign-up open" when the next event has a sign-up link', async () => {
    vi.resetModules()
    const getCalendarEvents = vi.fn().mockResolvedValue({ ok: true, value: [event('outreach', { start: '2099-11-03T18:00:00-06:00', end: '2099-11-03T21:00:00-06:00', description: 'Sign up: https://forms.gle/abc123' })] })
    vi.doMock('../../core/calendar', async (original) => ({ ...(await original<object>()), getCalendarEvents }))
    const fresh = await import('./data')
    fresh.resetCalendar()
    await fresh.loadEvents()
    expect(renderToString(createElement(() => createElement('p', null, fresh.useCalendarSummary().text)))).toMatch(/· Sign-up open<\/p>$/)
    vi.doUnmock('../../core/calendar')
    vi.resetModules()
  })

  it('says "Sign-up open" when the next event takes sign-ups in the app', async () => {
    vi.resetModules()
    const getCalendarEvents = vi.fn().mockResolvedValue({ ok: true, value: [event('outreach', { start: '2099-11-03T18:00:00-06:00', end: '2099-11-03T21:00:00-06:00', fromApp: true, signUps: true })] })
    vi.doMock('../../core/calendar', async (original) => ({ ...(await original<object>()), getCalendarEvents }))
    const fresh = await import('./data')
    fresh.resetCalendar()
    await fresh.loadEvents()
    expect(renderToString(createElement(() => createElement('p', null, fresh.useCalendarSummary().text)))).toMatch(/· Sign-up open<\/p>$/)
    vi.doUnmock('../../core/calendar')
    vi.resetModules()
  })

  it("doesn't when it has none", async () => {
    await loadEvents()
    expect(tile()).not.toContain('Sign-up open')
  })
})

afterEach(() => vi.restoreAllMocks())
