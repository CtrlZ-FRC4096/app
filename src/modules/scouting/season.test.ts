// Tests for season.ts. Run them with `npm test`.
// The form and saved entries use each counter's key, so keys must be unique.
import { describe, expect, it } from 'vitest'
import { AUTO_SIDES, COUNTERS, DRIVETRAINS, ENDGAME, ROLES } from './season'

describe('season settings', () => {
  it('gives every counter its own key and a label', () => {
    const keys = COUNTERS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const counter of COUNTERS) {
      expect(counter.key.trim()).not.toBe('')
      expect(counter.label.trim()).not.toBe('')
    }
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
})
