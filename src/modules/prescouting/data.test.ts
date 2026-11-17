// Tests for sending old Prescouting links to Scouting's Prescouting tab (#184).
import { describe, expect, it } from 'vitest'
import { movedHref } from './data'

describe('old prescouting links', () => {
  it('go to the same place in the Prescouting tab', () => {
    const cases: [string[], string][] = [
      [[], '#/scouting/prescouting'],
      [['2026ilch', '9991'], '#/scouting/prescouting/2026ilch/9991'],
    ]
    for (const [rest, expected] of cases) expect(movedHref(rest)).toBe(expected)
  })
})
