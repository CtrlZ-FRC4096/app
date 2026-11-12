// Tests for the rules for required Mondays (required.ts).
import { describe, expect, it } from 'vitest'
import { calendarWindow, checkAbsence, MAX_ABSENCE_REASON, mondayMeetings, mondayStatus, requiredReport } from './required'
import { teamInstant } from './time'

// Mondays in January 2026: the 5th, 12th, 19th and 26th.
const event = (day: string, title = 'Team meeting', clock = '18:00') => ({ title, start: teamInstant(day, clock), allDay: false })

describe('mondayMeetings', () => {
  it('finds each Monday with a meeting on the calendar, once, in the dates asked for', () => {
    const events = [
      event('2026-01-19'),
      event('2026-01-05'),
      event('2026-01-05', 'Mentor meeting', '20:00'),
      event('2026-01-06', 'Build session'),
      { title: 'Example Regional', start: '2026-01-12', allDay: true },
      event('2026-01-26'),
    ]
    expect(mondayMeetings(events, [], { to: '2026-01-20' }).map((m) => [m.day, m.title])).toEqual([
      ['2026-01-05', 'Team meeting'],
      ['2026-01-19', 'Team meeting'],
    ])
  })

  it("keeps a Monday a mentor marked, as not required with the reason", () => {
    const meetings = mondayMeetings([event('2026-01-12'), event('2026-01-19')], [{ day: '2026-01-19', reason: 'MLK Day' }], {})
    expect(meetings.map((m) => [m.day, m.required, m.reason])).toEqual([
      ['2026-01-12', true, ''],
      ['2026-01-19', false, 'MLK Day'],
    ])
  })

  it('reads a late-evening meeting as that Monday in Central time', () => {
    // 11:30 PM Central on Monday is already Tuesday in UTC.
    expect(mondayMeetings([event('2026-01-12', 'Late meeting', '23:30')], [], {}).map((m) => m.day)).toEqual(['2026-01-12'])
  })
})

describe('calendarWindow', () => {
  it('covers the dates counted and the next 4 weeks, never more than a year', () => {
    const cases: [{ from?: string; to?: string }, { from: string; to: string }][] = [
      [{ from: '2026-01-10' }, { from: '2026-01-10', to: '2026-02-17' }],
      [{ from: '2025-09-01', to: '2025-12-20' }, { from: '2025-09-01', to: '2025-12-20' }],
      [{ from: '2026-01-10', to: '2026-04-18' }, { from: '2026-01-10', to: '2026-02-17' }],
      [{}, { from: '2025-02-18', to: '2026-02-17' }],
      [{ from: '2020-01-01' }, { from: '2025-02-18', to: '2026-02-17' }],
    ]
    for (const [range, expected] of cases) expect(calendarWindow(range, '2026-01-20')).toEqual(expected)
  })
})

describe('mondayStatus', () => {
  it('counts a check-in first, then an absence, and today as coming up', () => {
    const today = '2026-01-12'
    const cases: [came: boolean, excused: boolean, day: string, expected: string][] = [
      [true, true, '2026-01-05', 'came'],
      [false, true, '2026-01-05', 'excused'],
      [false, false, '2026-01-05', 'missed'],
      [false, false, today, 'upcoming'],
      [false, true, '2026-01-19', 'excused'],
      [false, false, '2026-01-19', 'upcoming'],
    ]
    for (const [came, excused, day, expected] of cases) expect(mondayStatus(came, excused, day, today)).toBe(expected)
  })
})

describe('requiredReport', () => {
  it("counts each person's Mondays, most missed first, ignoring ignored check-ins", () => {
    const people = [
      { id: 'a', name: 'Alex' },
      { id: 'b', name: 'Blair' },
      { id: 'c', name: 'Casey' },
    ]
    const checks = [
      { person_id: 'a', at: teamInstant('2026-01-05', '18:00'), ignored: false },
      { person_id: 'a', at: teamInstant('2026-01-12', '18:00'), ignored: false },
      { person_id: 'b', at: teamInstant('2026-01-05', '18:00'), ignored: true },
      { person_id: 'c', at: teamInstant('2026-01-06', '18:00'), ignored: false },
    ]
    const absences = [{ person_id: 'c', day: '2026-01-12' }]
    const rows = requiredReport(people, checks, absences, ['2026-01-05', '2026-01-12', '2026-01-19'], '2026-01-15')
    expect(rows.map((r) => [r.person.name, r.came, r.excused, r.missed])).toEqual([
      ['Blair', 0, 0, 2],
      ['Casey', 0, 1, 1],
      ['Alex', 2, 0, 0],
    ])
    expect([...rows[1].days.values()]).toEqual(['missed', 'excused', 'upcoming'])
  })
})

describe('checkAbsence', () => {
  it('needs a required Monday and a reason', () => {
    const required = ['2026-01-12', '2026-01-26']
    const ok = { day: '2026-01-12', reason: 'Doctor appointment' }
    expect(checkAbsence(ok, required)).toBeNull()
    expect(checkAbsence({ ...ok, day: '' }, required)).toMatch(/Pick the Monday/)
    expect(checkAbsence({ ...ok, day: '2026-01-19' }, required)).toMatch(/isn't a required Monday/)
    expect(checkAbsence({ ...ok, reason: '  ' }, required)).toMatch(/Say why/)
    expect(checkAbsence({ ...ok, reason: 'x'.repeat(MAX_ABSENCE_REASON + 1) }, required)).toMatch(/under 300/)
  })
})
