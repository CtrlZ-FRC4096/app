import { describe, expect, it } from 'vitest'
import { dayLabel, teamClock, teamDay, teamInstant } from './time'

describe('team time (Central)', () => {
  it('puts an evening check-in on that evening, even though it is already the next day in UTC', () => {
    // 6:09 PM Central on Jan 9 is 00:09 UTC on Jan 10.
    expect(teamInstant('2026-01-09', '18:09')).toBe('2026-01-10T00:09:00.000Z')
    expect(teamDay('2026-01-10T00:09:00Z')).toBe('2026-01-09')
    expect(teamClock('2026-01-10T00:09:00Z')).toBe('18:09')
  })

  it('uses daylight saving time in summer', () => {
    expect(teamInstant('2026-06-02', '18:00')).toBe('2026-06-02T23:00:00.000Z')
    expect(teamClock('2026-06-02T23:00:00Z')).toBe('18:00')
  })

  it('reads times the database sends back with an offset', () => {
    expect(teamDay('2026-01-10T00:09:00+00:00')).toBe('2026-01-09')
  })

  it('labels days for people', () => {
    expect(dayLabel('2026-01-09')).toBe('Fri, Jan 9')
  })
})
