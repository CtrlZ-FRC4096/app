// Tests for data.ts. Run them with `npm test`. They run in demo mode, with
// made-up events. Times are in Chicago: 2026-11-03 is a Tuesday, and Chicago
// is 6 hours behind UTC then.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { addCalendarEvent, resetDemoCalendar, type CalendarEvent } from '../../core/calendar'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import { membersTable } from '../../core/members'
import CalendarPage from './CalendarPage'
import {
  addEvent,
  blankEventForm,
  calendarNow,
  canManageSignUps,
  canTakeSignUps,
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
  notSignedUp,
  plainText,
  removeEvent,
  resetCalendar,
  setSignUps,
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
  it("says Today and Tomorrow, then the day, going by Chicago's day, not the server's", () => {
    expect(dayLabel('2026-11-03', '2026-11-03')).toBe('Today')
    expect(dayLabel('2026-11-04', '2026-11-03')).toBe('Tomorrow')
    expect(dayLabel('2026-11-07', '2026-11-03')).toBe('Sat, Nov 7')
    expect(dayLabel('2027-01-09', '2026-11-03')).toBe('Sat, Jan 9, 2027')
    // 2 AM UTC on Wednesday is 8 PM Tuesday in Chicago.
    expect(chicagoDay(new Date('2026-11-04T02:00:00Z'))).toBe('2026-11-03')
  })
})

describe('eventsByDay', () => {
  it('lists what is still to come by day, with a competition that already started under today, or nothing', () => {
    const morning = event('morning', { title: 'Shop cleanup', start: '2026-11-03T08:00:00-06:00', end: '2026-11-03T09:00:00-06:00' })
    const events = [
      event('thu', { start: '2026-11-05T18:00:00-06:00', end: '2026-11-05T21:00:00-06:00' }),
      morning,
      event('tonight', {}),
      event('regional', { title: 'Example Regional', allDay: true, start: '2026-11-02', end: '2026-11-04' }),
    ]
    expect(eventsByDay(events, now).map((d) => [d.label, d.events.map((e) => e.id)])).toEqual([
      ['Today', ['regional', 'tonight']],
      ['Thu, Nov 5', ['thu']],
    ])
    expect(eventsByDay([morning], now)).toEqual([])
  })
})

describe('timeOfDay', () => {
  it('writes the times plainly, even past midnight, and says All day, and until when', () => {
    expect(plain(timeOfDay(event('a', {})))).toBe('6 – 9 PM')
    expect(plain(timeOfDay(event('a', { start: '2026-11-07T10:00:00-06:00', end: '2026-11-07T16:00:00-06:00' })))).toBe('10 AM – 4 PM')
    expect(plain(timeOfDay(event('a', { start: '2026-11-03T18:30:00-06:00' })))).toBe('6:30 – 9 PM')
    expect(plain(timeOfDay(event('a', { start: '2026-11-06T22:00:00-06:00', end: '2026-11-07T02:00:00-06:00' })))).toBe('10 PM – Sat, Nov 7, 2 AM')
    expect(timeOfDay(event('a', { allDay: true, start: '2026-11-07', end: '2026-11-07' }))).toBe('All day')
    expect(timeOfDay(event('a', { allDay: true, start: '2027-03-13', end: '2027-03-15' }))).toBe('All day, until Mon, Mar 15')
  })
})

describe('nextEvent and nextEventText', () => {
  it('picks the event happening now, or the next to come, with an all-day event over only after its last day', () => {
    const over = event('over', { start: '2026-11-03T08:00:00-06:00', end: '2026-11-03T09:00:00-06:00' })
    const later = event('later', { start: '2026-11-05T18:00:00-06:00', end: '2026-11-05T21:00:00-06:00' })
    expect(nextEvent([later, over, event('tonight', {})], now)?.id).toBe('tonight')
    expect(nextEvent([over], now)).toBeNull()
    expect(hasEnded(event('a', { allDay: true, start: '2026-11-02', end: '2026-11-03' }), now)).toBe(false)
    expect(hasEnded(event('a', { allDay: true, start: '2026-11-01', end: '2026-11-02' }), now)).toBe(true)
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
  it('finds the link on a "Sign up:" line, however it is written, and however Google Calendar wraps it', () => {
    const found: [string, string, string][] = [
      ['on its own line', 'Robot demo at the library.\nSign up: https://forms.gle/abc123', 'https://forms.gle/abc123'],
      ['in lower case, with no space', 'signup: https://forms.gle/abc123', 'https://forms.gle/abc123'],
      ['in capitals, with words after', 'SIGN UP:https://forms.gle/abc123 by Friday', 'https://forms.gle/abc123'],
      ['wrapped in HTML', 'Bring a laptop.<br>Sign up: <a href="https://forms.gle/abc123">https://forms.gle/abc123</a>', 'https://forms.gle/abc123'],
      [
        'wrapped in HTML, with different words shown',
        '<p>Bring a laptop.</p><p>Sign up: <a href="https://example.com/form?a=1&amp;b=2" target="_blank">the form</a></p>',
        'https://example.com/form?a=1&b=2',
      ],
      ['after a non-breaking space', 'Sign up:&nbsp;<a href="https://forms.gle/abc123">https://forms.gle/abc123</a>', 'https://forms.gle/abc123'],
      // Pasted from Google Docs or Gmail. Still https, and the redirect takes people to the form.
      [
        'in a Google redirect',
        'Sign up: <a href="https://www.google.com/url?q=https://forms.gle/abc123&amp;sa=D">https://forms.gle/abc123</a>',
        'https://www.google.com/url?q=https://forms.gle/abc123&sa=D',
      ],
    ]
    for (const [label, description, link] of found) expect(signUpLink(description), label).toBe(link)
  })

  it('is null with no sign-up line, or an http or javascript link, so a bad link never becomes a button', () => {
    const none: [string, string | null][] = [
      ['no description', null],
      ['no sign-up line', 'Leave from school at 6 AM.'],
      ['no link', 'Sign up:'],
      ['a line that only mentions signing up', 'Remember to sign up: https://forms.gle/abc123'], // only a line that starts with "Sign up:" counts
      ['an http link', 'Sign up: http://forms.gle/abc123'],
      ['a javascript link', 'Sign up: javascript:alert(1)'],
      ['a javascript link shown as https', 'Sign up: <a href="javascript:alert(1)">https://forms.gle/abc123</a>'],
    ]
    for (const [label, description] of none) expect(signUpLink(description), label).toBeNull()
  })
})

describe('shownDescription', () => {
  it('leaves out the sign-up line, since the Sign up button has the link, but keeps one whose link was ignored', () => {
    expect(shownDescription('Robot demo at the library.\nSign up: https://forms.gle/abc123\nWear your team shirt.')).toBe('Robot demo at the library. Wear your team shirt.')
    expect(shownDescription('Bring a laptop.<br>Sign up: <a href="https://forms.gle/abc123">https://forms.gle/abc123</a>')).toBe('Bring a laptop.')
    expect(shownDescription('Sign up: https://forms.gle/abc123')).toBeNull()
    // So nothing goes missing.
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
    const tile = renderToString(createElement(Tile))
    expect(tile).toMatch(/^<p>Next: /)
    // The next made-up event has no sign-up.
    expect(tile).not.toContain('Sign-up open')
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
  // Only student leaders and mentors can add events, so this views the app as a mentor to add it, then as a student again.
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

  // The build session has no link, so this also checks that it gets no button.
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
  it('turn a day and clock time in Chicago into a time and back, in winter and summer', () => {
    expect(chicagoTime('2026-11-03', '18:00')).toBe('2026-11-04T00:00:00.000Z')
    expect(chicagoTime('2026-07-04', '18:30')).toBe('2026-07-04T23:30:00.000Z')
    // The day the clocks go forward: 3:30 AM is already daylight time.
    expect(chicagoTime('2026-03-08', '03:30')).toBe('2026-03-08T08:30:00.000Z')
    // The clock time, for the time box.
    expect(chicagoClock(new Date('2026-11-04T00:00:00Z'))).toBe('18:00')
    expect(chicagoClock(new Date('2026-07-04T14:05:00Z'))).toBe('09:05')
  })
})

describe('the event form', () => {
  const form = (more: Partial<EventForm>): EventForm => ({ ...blankEventForm(new Date('2026-11-03T21:00:00Z')), title: 'Parent meeting', startClock: '19:00', endClock: '20:00', ...more })

  it('starts on today, from 6 to 8 PM, with no sign-ups, and turns into an event, with times in Chicago', () => {
    expect(blankEventForm(now)).toMatchObject({ day: '2026-11-03', lastDay: '2026-11-03', startClock: '18:00', endClock: '20:00', signUps: 'No sign-ups' })
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

const tonight = (title: string): EventForm => ({ ...blankEventForm(), title, startClock: '23:00', endClock: '23:30' })
const outreach = event('demo-outreach', { title: 'Outreach', start: '2099-11-13T18:00:00-06:00', end: '2099-11-13T20:00:00-06:00', fromApp: true, signUps: true })
const going = () => signUpsFor(signUpsTable.rows(), outreach).map((s) => s.created_by)

describe('adding, changing and removing events', () => {
  it('lets a student leader add an event, which shows straight away, then change and remove it', async () => {
    setDemoRole('leader')
    const added = await addEvent(tonight('Pizza after build'))
    if (!added.ok) throw new Error(added.error)
    expect(added.value).toMatchObject({ addedBy: DEMO_PEOPLE.casey, fromApp: true })
    expect(calendarNow().events.map((e) => e.title)).toContain('Pizza after build')

    expect(await changeEvent(added.value, tonight('Pizza after build (moved)'))).toMatchObject({ ok: true })
    expect(calendarNow().events.map((e) => e.title)).toEqual(['Pizza after build (moved)'])
    expect(await removeEvent(added.value)).toEqual({ ok: true, value: null })
    expect(calendarNow().events).toEqual([])
  })

  it("doesn't change anything when the form has a problem", async () => {
    setDemoRole('leader')
    expect(await addEvent(tonight(''))).toEqual({ ok: false, error: 'Give the event a title.' })
    expect(calendarNow().events).toEqual([])
  })

  it('shows Add event, Change, Remove and Edit list only to student leaders and mentors', async () => {
    await loadEvents()
    // The made-up outreach night was added from the app, and takes sign-ups in the app.
    const student = renderToString(createElement(CalendarPage))
    for (const button of ['Add event', 'Change', 'Remove', 'Edit list']) expect(student).not.toContain(`>${button}<`)
    for (const role of ['leader', 'mentor'] as const) {
      setDemoRole(role)
      const page = renderToString(createElement(CalendarPage))
      for (const button of ['Add event', 'Change', 'Remove', 'Edit list']) expect(page.match(new RegExp(`>${button}<`, 'g'))).toHaveLength(1)
    }
  })
})

describe('signing up in the app', () => {
  it('lets you sign up, once, and take it back, listing who signed up for each event', async () => {
    expect(going()).toEqual([DEMO_PEOPLE.jordan, DEMO_PEOPLE.pat])
    expect(signUpsFor(signUpsTable.rows(), { ...outreach, id: 'other' })).toEqual([])
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

  it('lets a student leader, mentor or admin sign someone else up and take them off', async () => {
    for (const role of ['leader', 'mentor', 'admin'] as const) expect(canManageSignUps({ role }), role).toBe(true)
    setDemoRole('leader')
    expect(await signUp(outreach, DEMO_PEOPLE.alex)).toMatchObject({ ok: true, value: { created_by: DEMO_PEOPLE.alex } })
    expect(going()).toEqual([DEMO_PEOPLE.jordan, DEMO_PEOPLE.pat, DEMO_PEOPLE.alex])
    expect(await signUp(outreach, DEMO_PEOPLE.alex)).toEqual({ ok: false, error: "They're already signed up." })

    expect(await cancelSignUp(outreach, DEMO_PEOPLE.jordan)).toEqual({ ok: true, value: null })
    expect(going()).toEqual([DEMO_PEOPLE.pat, DEMO_PEOPLE.alex])
    expect(await cancelSignUp(outreach, DEMO_PEOPLE.jordan)).toEqual({ ok: false, error: "They aren't signed up for this event." })
  })

  it("offers a leader everyone who isn't signed up yet and whose access is on, by name", () => {
    const names = notSignedUp(membersTable.rows(), signUpsTable.rows(), outreach).map((m) => m.name)
    // Jordan and Pat are signed up; Sam's access is off.
    expect(names).toEqual(['Alex Rivera', 'Casey Nguyen', 'Morgan Lee'])
  })
})

// The database refuses these too (supabase/tests/calendar.test.ts and
// calendar-signups.test.ts). Here, a student is told who to ask.
describe('only student leaders and mentors', () => {
  it('add events, and sign someone else up or take them off: a student is told who to ask, and nothing changes', async () => {
    expect(canManageSignUps({ role: 'student' })).toBe(false)
    const tries: [string, () => Promise<unknown>][] = [
      ['add events', () => addEvent(tonight('Pizza after build'))],
      ['sign someone else up', () => signUp(outreach, DEMO_PEOPLE.morgan)],
      ['take someone else off', () => cancelSignUp(outreach, DEMO_PEOPLE.jordan)],
      ['turn sign-ups on or off', () => setSignUps(outreach, false)],
    ]
    for (const [doing, attempt] of tries) {
      expect(await attempt(), doing).toEqual({ ok: false, error: expect.stringContaining(`Only student leaders and mentors can ${doing}`) })
    }
    expect(calendarNow().events).toEqual([])
    expect(going()).toEqual([DEMO_PEOPLE.jordan, DEMO_PEOPLE.pat])
    // Signing yourself up is the same as leaving the person out.
    expect(await signUp(outreach, DEMO_PEOPLE.alex)).toMatchObject({ ok: true })
  })
})

describe('sign-ups on any event (#159)', () => {
  /** A made-up build session, made in Google Calendar: no sign-ups, no link. */
  const madeInGoogle = () => {
    const found = calendarNow().events.find((e) => !e.fromApp && !e.signUps && !signUpLink(e.description))
    if (!found) throw new Error('No made-up build session')
    return found
  }
  const loadedOutreach = () => calendarNow().events.find((e) => e.id === 'demo-outreach')!

  it('lets a student leader take sign-ups on an event made in Google Calendar, changing nothing else, so students can sign up', async () => {
    await loadEvents()
    const build = madeInGoogle()
    setDemoRole('leader')
    expect(await setSignUps(build, true)).toEqual({ ok: true, value: { ...build, signUps: true } })
    // Still on after loading the events again.
    await loadEvents()
    expect(calendarNow().events.find((e) => e.id === build.id)).toEqual({ ...build, signUps: true })
    setDemoRole('student')
    expect(await signUp({ ...build, signUps: true })).toMatchObject({ ok: true })
  })

  it('keeps who signed up when sign-ups stop, hidden, and brings them back when they start again', async () => {
    await loadEvents()
    setDemoRole('leader')
    expect(await setSignUps(loadedOutreach(), false)).toMatchObject({ ok: true, value: { signUps: false } })
    setDemoRole('student')
    expect(renderToString(createElement(CalendarPage))).not.toContain('Going (2)')
    expect(await signUp(loadedOutreach())).toEqual({ ok: false, error: expect.stringContaining("doesn't take sign-ups") })
    expect(going()).toEqual([DEMO_PEOPLE.jordan, DEMO_PEOPLE.pat])

    setDemoRole('leader')
    expect(await setSignUps(loadedOutreach(), true)).toMatchObject({ ok: true })
    expect(renderToString(createElement(CalendarPage))).toContain('Going (2)')
  })

  it("doesn't take sign-ups on an event that's over", async () => {
    setDemoRole('leader')
    const over = event('g-over', { start: '2020-11-03T18:00:00-06:00', end: '2020-11-03T21:00:00-06:00' })
    expect(await setSignUps(over, true)).toEqual({ ok: false, error: expect.stringContaining('over') })
  })

  it('offers Take sign-ups on events still to come without sign-ups in the app or a sign-up link', () => {
    const cases: [string, CalendarEvent, boolean][] = [
      ['made in Google Calendar', event('a', {}), true],
      ['already taking them', event('b', { signUps: true }), false],
      ['over', event('c', { end: '2026-11-03T14:00:00-06:00', start: '2026-11-03T12:00:00-06:00' }), false],
      ['with a sign-up link', event('d', { description: 'Sign up: https://forms.gle/abc123' }), false],
    ]
    for (const [what, e, offered] of cases) expect(canTakeSignUps(e, now), what).toBe(offered)
  })

  it('shows Take sign-ups and Stop sign-ups only to student leaders and mentors', async () => {
    await loadEvents()
    const student = renderToString(createElement(CalendarPage))
    expect(student).not.toContain('>Take sign-ups<')
    expect(student).not.toContain('>Stop sign-ups<')
    for (const role of ['leader', 'mentor'] as const) {
      setDemoRole(role)
      const page = renderToString(createElement(CalendarPage))
      expect(page, role).toContain('>Take sign-ups<')
      // Only the made-up outreach night takes sign-ups in the app.
      expect(page.match(/>Stop sign-ups</g), role).toHaveLength(1)
    }
  })
})

describe('useCalendarSummary', () => {
  it('says "Sign-up open" when the next event has a sign-up link, or takes sign-ups in the app', async () => {
    const soon = { start: '2099-11-03T18:00:00-06:00', end: '2099-11-03T21:00:00-06:00' }
    const kinds: [string, Partial<CalendarEvent>][] = [
      ['a sign-up link', { ...soon, description: 'Sign up: https://forms.gle/abc123' }],
      ['sign-ups in the app', { ...soon, fromApp: true, signUps: true }],
    ]
    for (const [kind, more] of kinds) {
      vi.resetModules()
      const getCalendarEvents = vi.fn().mockResolvedValue({ ok: true, value: [event('outreach', more)] })
      vi.doMock('../../core/calendar', async (original) => ({ ...(await original<object>()), getCalendarEvents }))
      const fresh = await import('./data')
      fresh.resetCalendar()
      await fresh.loadEvents()
      expect(renderToString(createElement(() => createElement('p', null, fresh.useCalendarSummary().text))), kind).toMatch(/· Sign-up open<\/p>$/)
      vi.doUnmock('../../core/calendar')
      vi.resetModules()
    }
    // With none, it doesn't: see "loads the made-up events" above.
  })
})

afterEach(() => vi.restoreAllMocks())
