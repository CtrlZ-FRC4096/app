// Tests for season.ts. Run them with `npm test`.
// The form and saved entries use each counter's key, so keys must be unique.
import { describe, expect, it } from 'vitest'
import { AUTO_MARKS, AUTO_SIDES, COUNTERS, DRIVETRAINS, ENDGAME, FIELD, ROLES } from './season'

describe('season settings', () => {
  it('gives every counter its own key and a label', () => {
    const keys = COUNTERS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const counter of COUNTERS) {
      expect(counter.key.trim()).not.toBe('')
      expect(counter.label.trim()).not.toBe('')
    }
  })

  it('marks fuel missed as lower is better, and fuel scored as higher', () => {
    const lowerIsBetter = (key: string) => COUNTERS.find((c) => c.key === key)?.lowerIsBetter ?? false
    expect(lowerIsBetter('fuelMissed')).toBe(true)
    expect(lowerIsBetter('autoFuel')).toBe(false)
    expect(lowerIsBetter('teleopFuel')).toBe(false)
  })

  it('has endgame choices with no repeats', () => {
    expect(ENDGAME.length).toBeGreaterThan(0)
    expect(new Set(ENDGAME).size).toBe(ENDGAME.length)
  })

  it('has roles with no repeats or blanks', () => {
    expect(ROLES.length).toBeGreaterThan(0)
    expect(new Set(ROLES).size).toBe(ROLES.length)
    for (const role of ROLES) expect(role.trim()).not.toBe('')
  })

  it('has pit form choices with no repeats or blanks', () => {
    for (const list of [DRIVETRAINS, AUTO_SIDES]) {
      expect(list.length).toBeGreaterThan(0)
      expect(new Set(list).size).toBe(list.length)
      for (const choice of list) expect(choice.trim()).not.toBe('')
    }
  })

  // #205: the auto path's marks are saved by key, and the database only takes keys up to 30 characters.
  it('gives every auto mark its own short key, a label and one letter', () => {
    const keys = AUTO_MARKS.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const mark of AUTO_MARKS) {
      expect(mark.key.length, mark.key).toBeGreaterThan(0)
      expect(mark.key.length, mark.key).toBeLessThanOrEqual(30)
      expect(mark.label.trim(), mark.key).not.toBe('')
      expect(mark.letter, mark.key).toHaveLength(1)
    }
  })

  it('keeps every field landmark inside the field', () => {
    for (const l of FIELD.landmarks) {
      const where = l.label ?? `${l.look} at ${l.x}, ${l.y}`
      expect(l.x >= 0 && l.y >= 0 && l.width >= 0 && l.height >= 0, where).toBe(true)
      expect(l.x + l.width <= FIELD.length && l.y + l.height <= FIELD.width, where).toBe(true)
    }
  })
})
