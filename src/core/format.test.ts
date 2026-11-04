import { describe, expect, it } from 'vitest'
import { parseCount, plural, shortDate } from './format'

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

describe('parseCount', () => {
  it('reads a whole number', () => {
    expect(parseCount('25', 1)).toBe(25)
    expect(parseCount(' 7 ', 0)).toBe(7)
  })

  it('gives null for an empty box or something that is not a number', () => {
    expect(parseCount('', 1)).toBeNull()
    expect(parseCount('  ', 1)).toBeNull()
    expect(parseCount('abc', 1)).toBeNull()
  })

  it('raises anything below the minimum to the minimum', () => {
    expect(parseCount('0', 1)).toBe(1)
    expect(parseCount('-3', 0)).toBe(0)
  })

  it('rounds a decimal to the nearest whole number', () => {
    expect(parseCount('2.4', 1)).toBe(2)
    expect(parseCount('2.5', 1)).toBe(3)
  })
})
