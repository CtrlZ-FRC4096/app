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
  addMonths,
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
  monthGrid,
  nextEvent,
  nextEventText,
  notSignedUp,
  plainText,
  removeEvent,
  resetCalendar,
  setSignUps,
  shownDescription,
  signUp,
  signUpButtonText,
  signUpLinks,
  SIGN_UP_KINDS,
  signUpsFor,
  signUpsTable,
  thisMonth,
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

describe('monthGrid', () => {
  // Every square of a month, Sunday to Saturday, with today being Tue, Nov 3.
  const squares = (month: string, events: CalendarEvent[] = []) => monthGrid(month, events, null, now).weeks.flat()

  it('lays out a month in weeks from Sunday, with each event on each of its days in Chicago, and 2 titles and "+2 more" on a busy day', () => {
    // [month, its first square, its last square, weeks]
    const shapes: [string, string, string, number][] = [
      ['2026-11', '2026-11-01', '2026-12-05', 5], // starts on a Sunday
      ['2026-12', '2026-11-29', '2027-01-02', 5], // starts on a Tuesday
      ['2027-01', '2026-12-27', '2027-02-06', 6], // starts on a Friday
      ['2026-02', '2026-02-01', '2026-02-28', 4], // 28 days from a Sunday
    ]
    for (const [month, first, last, weeks] of shapes) {
      const grid = monthGrid(month, [], null, now)
      const all = grid.weeks.flat()
      expect([all[0].day, all.at(-1)?.day, grid.weeks.length, grid.weeks.every((w) => w.length === 7)], month).toEqual([first, last, weeks, true])
    }
    const nov = squares('2026-11', [
      event('regional', { title: 'Example Regional', allDay: true, start: '2026-11-06', end: '2026-11-08' }),
      // 11 PM in Chicago is 5 AM the next day in UTC, the time zone the checks run in on GitHub.
      event('late', { title: 'Late build', start: '2026-11-05T23:00:00-06:00', end: '2026-11-06T00:00:00-06:00' }),
      event('overnight', { title: 'Lock-in', start: '2026-11-13T22:00:00-06:00', end: '2026-11-14T02:00:00-06:00' }),
      event('trip', { title: 'Team trip', allDay: true, start: '2026-11-01', end: '2026-11-04' }),
      event('over', { title: 'Shop cleanup', start: '2026-11-03T08:00:00-06:00', end: '2026-11-03T09:00:00-06:00' }),
      ...['09', '12', '15', '18'].map((hour, i) => event(`busy-${i}`, { title: `Meeting ${i + 1}`, start: `2026-11-10T${hour}:00:00-06:00`, end: `2026-11-10T${hour}:30:00-06:00` })),
      ...['09', '12', '15'].map((hour, i) => event(`three-${i}`, { title: `Meeting ${'ABC'[i]}`, start: `2026-11-11T${hour}:00:00-06:00`, end: `2026-11-11T${hour}:30:00-06:00` })),
    ])
    const on = (day: string) => nov.find((d) => d.day === day)!
    // [what, day, the titles it shows, how many more]
    const cases: [string, string, string[], number][] = [
      ['nothing on a past day, even a trip that was on', '2026-11-02', [], 0],
      ['today: the trip still going, not the event that ended this morning', '2026-11-03', ['Team trip'], 0],
      ['the last day of an all-day event is included', '2026-11-04', ['Team trip'], 0],
      ['an 11 PM event on its day in Chicago', '2026-11-05', ['11 PM Late build'], 0],
      ['and not the next day, though it ends at midnight', '2026-11-06', ['Example Regional'], 0],
      ['a competition on each of its days', '2026-11-08', ['Example Regional'], 0],
      ['a busy day', '2026-11-10', ['9 AM Meeting 1', '12 PM Meeting 2'], 2],
      ['but 3 events all show', '2026-11-11', ['9 AM Meeting A', '12 PM Meeting B', '3 PM Meeting C'], 0],
      ['an event past midnight, with its time on its first day', '2026-11-13', ['10 PM Lock-in'], 0],
      ['and just its title on the next', '2026-11-14', ['Lock-in'], 0],
    ]
    for (const [what, day, titles, more] of cases) expect([on(day).shown.map((e) => plain(e.label)), on(day).more], what).toEqual([titles, more])
    expect(on('2026-11-10').events).toHaveLength(4)
    expect(nov.filter((d) => d.isToday).map((d) => d.day)).toEqual(['2026-11-03'])
    expect([on('2026-11-30').inMonth, on('2026-12-01').inMonth]).toEqual([true, false])
  })

  it('goes to the day the list shows each event under', () => {
    const nov = squares('2026-11', [
      event('regional', { title: 'Example Regional', allDay: true, start: '2026-11-06', end: '2026-11-08' }),
      event('sat', { title: 'Saturday build', start: '2026-11-07T10:00:00-06:00', end: '2026-11-07T16:00:00-06:00' }),
      event('trip', { title: 'Team trip', allDay: true, start: '2026-11-01', end: '2026-11-04' }),
    ])
    const on = (day: string) => nov.find((d) => d.day === day)!
    // [what, day, where tapping the day goes, where tapping each of its events goes]
    const taps: [string, string, string | null, string[]][] = [
      ['a trip that started before today, listed under today', '2026-11-04', '2026-11-03', ['2026-11-03']],
      ['a day with its own event, and the competition that started the day before', '2026-11-07', '2026-11-07', ['2026-11-06', '2026-11-07']],
      ["a competition's last day, listed under its first", '2026-11-08', '2026-11-06', ['2026-11-06']],
      ['a day with nothing on', '2026-11-09', null, []],
    ]
    for (const [what, day, goesTo, eventsGoTo] of taps) expect([on(day).listDay, on(day).events.map((e) => e.listDay)], what).toEqual([goesTo, eventsGoTo])
  })

  it("moves a month at a time, and says when past days are empty or a month's events aren't all loaded", () => {
    expect([addMonths('2026-12', 1), addMonths('2027-01', -1), addMonths('2026-11', -11)]).toEqual(['2027-01', '2026-12', '2025-12'])
    // Loaded at 3 PM on Nov 3, 8 weeks ahead: every event through Dec 28.
    const sunday = new Date('2026-11-01T18:00:00Z')
    // [what, month, now, when the events were loaded, the note]
    const notes: [string, string, Date, string | null, RegExp | null][] = [
      ['this month, with past days', '2026-11', now, null, /^Events before today aren't shown\.$/],
      ['a month that starts today, all loaded', '2026-11', sunday, null, null],
      ['past the 8 weeks', '2026-12', now, null, /^Events after Dec 28 aren't loaded/],
      ['loaded 2 days earlier', '2026-12', now, '2026-11-01T21:00:00Z', /^Events after Dec 26/],
      ['loaded a month ago, so both', '2026-11', now, '2026-10-01T15:00:00Z', /before today.*after Nov 25/],
      ['a past month', '2026-10', now, null, /before today/],
    ]
    for (const [what, month, at, loadedAt, note] of notes) {
      const found = monthGrid(month, [], loadedAt, at).note
      if (note) expect(found, what).toMatch(note)
      else expect(found, what).toBeNull()
    }
  })

  it('shows this month below the list, with today marked', async () => {
    await loadEvents()
    const page = renderToString(createElement(CalendarPage))
    const { title } = monthGrid(thisMonth(), [])
    expect(page.indexOf(`>${title}<`)).toBeGreaterThan(page.lastIndexOf('class="row-list"'))
    expect(page).toContain('aria-current="date"')
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

// Two sign-up links as a bulleted list, the way Google Calendar saves one typed straight after some text.
const bulletedList =
  'Bring your badge.<ul><li>Sign up (Travel): <a href="https://forms.gle/travel">https://forms.gle/travel</a></li><li>Sign up (Hotel): <a href="https://forms.gle/hotel">https://forms.gle/hotel</a></li></ul>'

describe('signUpLinks', () => {
  it('finds every "Sign up:" line, in order, with its name, however Google Calendar wraps it, and drops unsafe links', () => {
    const form = 'https://forms.gle/abc123'
    const cases: [string, string | null, { name: string; link: string }[]][] = [
      ['no description', null, []],
      ['no sign-up line', 'Leave from school at 6 AM.', []],
      ['no link', 'Sign up:', []],
      // Only a line that starts with "Sign up" counts.
      ['a line that only mentions signing up', `Remember to sign up: ${form}`, []],
      ['one, on its own line', `Robot demo at the library.\nSign up: ${form}`, [{ name: '', link: form }]],
      ['in lower case, with no space', `signup: ${form}`, [{ name: '', link: form }]],
      ['in capitals, with words after', `SIGN UP:${form} by Friday`, [{ name: '', link: form }]],
      [
        'several, with and without names, in order',
        'Sign up (Travel): https://forms.gle/travel\nBring your badge.\nsign up ( Hotel ):https://forms.gle/hotel\nSign up: https://forms.gle/other',
        [{ name: 'Travel', link: 'https://forms.gle/travel' }, { name: 'Hotel', link: 'https://forms.gle/hotel' }, { name: '', link: 'https://forms.gle/other' }],
      ],
      ['wrapped in HTML', `Bring a laptop.<br>Sign up (Drivers): <a href="${form}">${form}</a>`, [{ name: 'Drivers', link: form }]],
      [
        'wrapped in HTML, with different words shown',
        '<p>Bring a laptop.</p><p>Sign up: <a href="https://example.com/form?a=1&amp;b=2" target="_blank">the form</a></p>',
        [{ name: '', link: 'https://example.com/form?a=1&b=2' }],
      ],
      ['after a non-breaking space', `Sign up:&nbsp;<a href="${form}">${form}</a>`, [{ name: '', link: form }]],
      // Pasted from Google Docs or Gmail. Still https, and the redirect takes people to the form.
      [
        'in a Google redirect',
        `Sign up: <a href="https://www.google.com/url?q=${form}&amp;sa=D">${form}</a>`,
        [{ name: '', link: `https://www.google.com/url?q=${form}&sa=D` }],
      ],
      // A bad link never becomes a button; the others on the event still do.
      ['an http link, dropped', `Sign up (Hotel): http://forms.gle/hotel\nSign up (Travel): ${form}`, [{ name: 'Travel', link: form }]],
      ['a javascript link', 'Sign up: javascript:alert(1)', []],
      ['a javascript link shown as https', `Sign up: <a href="javascript:alert(1)">${form}</a>`, []],
      // A bulleted or numbered list in Google Calendar: each <li> is its own line, so no link goes missing.
      ['as a bulleted list, straight after text', bulletedList, [{ name: 'Travel', link: 'https://forms.gle/travel' }, { name: 'Hotel', link: 'https://forms.gle/hotel' }]],
      ['as a numbered list', `<ol><li>Sign up (Travel): ${form}</li><li>Sign up: ${form}</li></ol>`, [{ name: 'Travel', link: form }, { name: '', link: form }]],
    ]
    for (const [label, description, links] of cases) expect(signUpLinks(description), label).toEqual(links)
  })

  it('names each button after its link, or just "Sign up"', () => {
    expect(signUpButtonText({ name: 'Hotel', link: 'https://forms.gle/hotel' })).toBe('Sign up: Hotel')
    expect(signUpButtonText({ name: '', link: 'https://forms.gle/abc123' })).toBe('Sign up')
  })
})

describe('shownDescription', () => {
  it('leaves out every sign-up line, since the Sign up buttons have the links, but keeps one whose link was ignored', () => {
    expect(shownDescription('Robot demo at the library.\nSign up: https://forms.gle/abc123\nWear your team shirt.')).toBe('Robot demo at the library. Wear your team shirt.')
    expect(shownDescription('Sign up (Travel): https://forms.gle/travel\nBring your badge.\nSign up (Hotel): https://forms.gle/hotel')).toBe('Bring your badge.')
    expect(shownDescription('Bring a laptop.<br>Sign up: <a href="https://forms.gle/abc123">https://forms.gle/abc123</a>')).toBe('Bring a laptop.')
    expect(shownDescription(bulletedList)).toBe('Bring your badge.')
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
      description: 'Bring your team shirt.\nSign up (Travel): https://forms.gle/travel\nSign up: https://forms.gle/abc123',
    })
    setDemoRole('student')
    expect(result).toMatchObject({ ok: true })
    await loadEvents()
  }

  // The build session has no link, so this also checks that it gets no button.
  it('shows a Sign up button for each link, only on the event with links, and not the sign-up lines', async () => {
    await addOutreachWithSignUp()
    const outreach = calendarNow().events.find((e) => e.title === 'Outreach: robot demo (made up)')!
    const page = await pageWith([event('build', { start: '2099-11-03T18:00:00-06:00', end: '2099-11-03T21:00:00-06:00' }), outreach])
    expect(page).toContain('Outreach: robot demo (made up)')
    expect(page).toContain('Build session')
    // Two buttons: "Sign up: Travel" for the named link, and plain "Sign up" for the other.
    expect(page).toContain('>Sign up: Travel<')
    expect(page.match(/>Sign up</g)).toHaveLength(1)
    expect(page).toContain('href="https://forms.gle/travel" target="_blank"')
    expect(page).toContain('href="https://forms.gle/abc123" target="_blank"')
    expect(page).toContain('Bring your team shirt.')
    expect(page).not.toContain('Sign up (Travel):')
    expect(page).not.toContain('Sign up: https')
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

  it('puts each sign-up link on its own "Sign up:" line, in order, with its name, skipping empty rows', () => {
    const links = (...rows: [string, string][]) => rows.map(([name, link]) => ({ name, link }))
    const cases: [Partial<EventForm>, string][] = [
      [{ links: links(['', ' https://forms.gle/abc123 ']), description: 'Bring your team shirt.' }, 'Bring your team shirt.\nSign up: https://forms.gle/abc123'],
      [{ links: links(['', 'https://forms.gle/abc123']) }, 'Sign up: https://forms.gle/abc123'],
      [
        { links: links([' Travel ', 'https://forms.gle/travel'], ['', ''], ['Hotel', 'https://forms.gle/hotel']) },
        'Sign up (Travel): https://forms.gle/travel\nSign up (Hotel): https://forms.gle/hotel',
      ],
    ]
    for (const [more, description] of cases) expect(eventFromForm(form({ signUps: 'With a link', ...more }))).toMatchObject({ ok: true, value: { description, signUps: false } })
    // In-app sign-ups leave any link rows out.
    expect(eventFromForm(form({ signUps: 'In the app', links: links(['', 'https://forms.gle/abc123']) }))).toMatchObject({ value: { description: '', signUps: true } })
  })

  it('says what to fix', () => {
    expect(eventFromForm(form({ title: ' ' }))).toEqual({ ok: false, error: 'Give the event a title.' })
    expect(eventFromForm(form({ day: '' }))).toEqual({ ok: false, error: 'Pick the day.' })
    expect(eventFromForm(form({ endClock: '' }))).toEqual({ ok: false, error: 'Pick when it starts and ends.' })
    expect(eventFromForm(form({ endClock: '18:00' }))).toEqual({ ok: false, error: 'The event ends before it starts.' })
    expect(eventFromForm(form({ allDay: true, day: '2027-03-12', lastDay: '2027-03-11' }))).toEqual({ ok: false, error: 'The last day is before the first.' })
    const link = (name: string, link: string) => ({ name, link })
    const linkProblems: [EventForm['links'], RegExp][] = [
      [[link('', '')], /Paste the sign-up link/],
      [[link('Hotel', '')], /link for "Hotel"/],
      [[link('', 'http://forms.gle/abc123')], /sign-up link has to start with https:/],
      [[link('Hotel', 'javascript:alert(1)')], /"Hotel" link has to start with https:/],
      [[link('Hotel (main)', 'https://forms.gle/hotel')], /brackets/],
      [[link('x'.repeat(41), 'https://forms.gle/hotel')], /under 40/],
      [Array.from({ length: 6 }, (_, i) => link(`Form ${i}`, `https://forms.gle/${i}`)), /up to 5/],
    ]
    for (const [links, error] of linkProblems) expect(eventFromForm(form({ signUps: 'With a link', links })), String(error)).toMatchObject({ ok: false, error: expect.stringMatching(error) })
    // A "Sign up:" line typed into Details would skip the checks above, so it's refused whichever kind of sign-up is picked.
    const typedLine = 'Bring water.\nSign up (Drivers): https://forms.gle/drivers'
    for (const signUps of SIGN_UP_KINDS) {
      expect(eventFromForm(form({ signUps, links: [link('', 'https://forms.gle/abc123')], description: typedLine })), signUps).toMatchObject({ ok: false, error: expect.stringMatching(/not in Details/) })
    }
  })

  it('fills the Change form back in from the event, with its sign-up links and names in order', () => {
    for (const filled of [
      form({ location: 'The shop', description: 'Bring your team shirt.', signUps: 'With a link', links: [{ name: '', link: 'https://forms.gle/abc123' }] }),
      form({
        signUps: 'With a link',
        links: [{ name: 'Travel', link: 'https://forms.gle/travel' }, { name: 'Hotel', link: 'https://forms.gle/hotel' }, { name: '', link: 'https://forms.gle/other' }],
      }),
      form({ signUps: 'In the app' }),
      form({ allDay: true, day: '2027-03-12', lastDay: '2027-03-14', startClock: '18:00', endClock: '20:00' }),
    ]) {
      const saved = eventFromForm(filled)
      if (!saved.ok) throw new Error(saved.error)
      const { location, description, signUps, ...rest } = saved.value
      expect(formFromEvent(event('e1', { ...rest, location: location || null, description: description || null, signUps: !!signUps, fromApp: true }))).toEqual(filled)
    }
    // Changed on the Google Calendar website, so its lines are HTML. The links become the rows and leave Details, so saving doesn't add them twice,
    // and the empty lines the list leaves behind don't push the rest of Details out of sight.
    for (const [description, details] of [
      ['Bring your badge.<br>Sign up (Travel): <a href="https://forms.gle/travel">https://forms.gle/travel</a><br>Sign up (Hotel): <a href="https://forms.gle/hotel">https://forms.gle/hotel</a>', 'Bring your badge.'],
      [bulletedList, 'Bring your badge.'],
      [`${bulletedList}Meet at 6.`, 'Bring your badge.\n\nMeet at 6.'],
    ]) {
      const changing = formFromEvent(event('e2', { fromApp: true, description }))
      expect(changing, description).toMatchObject({ description: details, signUps: 'With a link', links: signUpLinks(description) })
      const resaved = eventFromForm(changing)
      if (!resaved.ok) throw new Error(resaved.error)
      expect(signUpLinks(resaved.value.description ?? null), description).toEqual(signUpLinks(description))
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
    const found = calendarNow().events.find((e) => !e.fromApp && !e.signUps && signUpLinks(e.description).length === 0)
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
