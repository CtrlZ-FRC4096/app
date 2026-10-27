import { describe, expect, it } from 'vitest'
import { ago, dayLabel, teamClock, teamDay, teamInstant } from './time'

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

  it('says how long ago something happened', () => {
    const now = new Date('2026-01-21T12:00:00Z')
    expect(ago('2026-01-21T11:48:00Z', now)).toBe('12 minutes ago')
    expect(ago('2026-01-21T09:00:00Z', now)).toBe('3 hours ago')
    expect(ago('2026-01-18T12:00:00Z', now)).toBe('3 days ago')
  })
})
