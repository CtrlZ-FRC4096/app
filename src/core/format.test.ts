import { describe, expect, it } from 'vitest'
import { plural, shortDate } from './format'

describe('plural', () => {
  it('uses the singular only for exactly one', () => {
    expect(plural(1, 'part', 'parts')).toBe('1 part')
    expect(plural(0, 'part', 'parts')).toBe('0 parts')
  })
})

describe('shortDate', () => {
  it('says Today for today, and month and day otherwise', () => {
    const today = new Date('2026-10-27T12:00:00')
    expect(shortDate('2026-10-27T09:00:00', today)).toBe('Today')
    expect(shortDate('2026-10-14T09:00:00', today)).toBe('Oct 14')
  })
})
