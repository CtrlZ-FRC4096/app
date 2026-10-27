import { describe, expect, it } from 'vitest'
import { BASE_POINTS, buildReport, dayPoints, hoursOf, sessions } from './points'
import { teamInstant } from './time'

describe('dayPoints matches the old attendance spreadsheet', () => {
  it.each([
    ['yes', null, -1],
    ['yes', 1.0, 1],
    ['yes', 1.5, 3],
    ['no', null, 1],
    ['no', 1.0, 1],
    ['no', 2.0, 2],
    [null, null, 0],
    [null, 1.0, 0],
    [null, 1.5, 1],
  ] as const)('RSVP %s, %s hours → %i', (rsvp, hours, points) => {
    expect(dayPoints(rsvp, hours)).toBe(points)
  })

  it('counts a check-out at the same second as the check-in as staying 0 hours, not as missing', () => {
    expect(dayPoints('yes', 0)).toBe(1)
  })
})

const at = (clock: string) => teamInstant('2026-01-09', clock)
const check = (direction: 'in' | 'out', clock: string) => ({ direction, at: at(clock) })

describe('sessions and hours', () => {
  it('pairs each check-in with the next check-out', () => {
    expect(hoursOf(sessions([check('in', '18:00'), check('out', '20:30')]))).toBeCloseTo(2.5)
  })

  it('handles the double taps from the old notebook example the same way', () => {
    // In: 18:48:32, 19:11:37, 19:12:18, 19:13:12. Out: 18:48:32, 21:05:23. The notebook got 1.9 hours.
    const list = sessions([
      { direction: 'in', at: '2026-01-10T00:48:32Z' },
      { direction: 'out', at: '2026-01-10T00:48:32Z' },
      { direction: 'in', at: '2026-01-10T01:11:37Z' },
      { direction: 'in', at: '2026-01-10T01:12:18Z' },
      { direction: 'in', at: '2026-01-10T01:13:12Z' },
      { direction: 'out', at: '2026-01-10T03:05:23Z' },
    ])
    expect(hoursOf(list)).toBeCloseTo(1.896, 2)
  })

  it('adds up two visits in one day', () => {
    const list = sessions([check('in', '10:00'), check('out', '12:00'), check('in', '13:00'), check('out', '15:30')])
    expect(hoursOf(list)).toBeCloseTo(4.5)
  })

  it('gives no hours to someone who never checked out, and says they are still in', () => {
    const list = sessions([check('in', '18:00')])
    expect(hoursOf(list)).toBeNull()
    expect(list).toEqual([{ in: at('18:00'), out: null }])
  })

  it('ignores a check-out with no check-in before it', () => {
    expect(hoursOf(sessions([check('out', '17:00'), check('in', '18:00'), check('out', '19:00')]))).toBeCloseTo(1)
  })
})

describe('buildReport', () => {
  const people = [
    { id: 'a', name: 'Alex' },
    { id: 'b', name: 'Blake' },
    { id: 'c', name: 'Casey' },
  ]
  const checks = [
    { person_id: 'a', direction: 'in' as const, at: teamInstant('2026-01-08', '18:00'), ignored: false },
    { person_id: 'a', direction: 'out' as const, at: teamInstant('2026-01-08', '20:00'), ignored: false },
    { person_id: 'b', direction: 'in' as const, at: teamInstant('2026-01-09', '18:00'), ignored: false },
    { person_id: 'b', direction: 'out' as const, at: teamInstant('2026-01-09', '18:30'), ignored: true },
  ]
  const rsvps = [
    { person_id: 'a', day: '2026-01-08', coming: true },
    { person_id: 'b', day: '2026-01-08', coming: true },
  ]

  it('scores everyone on every meeting day, starting from the base points', () => {
    const report = buildReport(people, checks, rsvps)
    expect(report.days).toEqual(['2026-01-08', '2026-01-09'])
    // Alex: yes and 2 hours (3) + nothing on the 9th (0). Blake: yes but didn't come (−1) + still in on the 9th (0).
    expect(report.rows.map((r) => [r.person.name, r.points])).toEqual([
      ['Alex', BASE_POINTS + 3],
      ['Blake', BASE_POINTS - 1],
    ])
    expect(report.rows[1].days.get('2026-01-09')?.stillIn).toBe(true)
  })

  it("leaves out people with nothing in range, and ignored check-ins don't count", () => {
    const report = buildReport(people, checks, rsvps)
    expect(report.rows.find((r) => r.person.name === 'Casey')).toBeUndefined()
    expect(report.rows.find((r) => r.person.name === 'Blake')?.hours).toBe(0)
  })

  it('limits the report to a range of days', () => {
    const report = buildReport(people, checks, rsvps, { from: '2026-01-09' })
    expect(report.days).toEqual(['2026-01-09'])
    expect(report.rows.map((r) => r.person.name)).toEqual(['Blake'])
  })

  it('puts a check-in at 11 PM on that day, not the next one', () => {
    const late = [{ person_id: 'c', direction: 'in' as const, at: teamInstant('2026-01-09', '23:00'), ignored: false }]
    expect(buildReport(people, late, []).days).toEqual(['2026-01-09'])
  })
})
