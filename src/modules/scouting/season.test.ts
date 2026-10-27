// Tests for season.ts. Run them with `npm test`.
// The form and saved entries use each counter's key, so keys must be unique.
import { describe, expect, it } from 'vitest'
import { COUNTERS, ENDGAME } from './season'

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
})
