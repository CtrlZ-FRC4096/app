// Tests for choosing people in PeoplePicker (src/core/ui.tsx), used by the
// Pit checklist and Training's "Sign people off" form.
import { describe, expect, it } from 'vitest'
import { nameMatches, pickablePeople } from './members'

describe('finding someone to add', () => {
  const people = [
    { id: 'a', name: 'Alex Rivera' },
    { id: 'b', name: 'Jordan Lee' },
    { id: 'c', name: 'Pat Morgan' },
  ]
  const ids = (found: { id: string }[]) => found.map((p) => p.id)

  it('narrows by any part of a name, ignoring capitals and spaces at the ends, showing everyone for an empty search', () => {
    const searches: [string, string[]][] = [
      ['', ['a', 'b', 'c']],
      ['   ', ['a', 'b', 'c']],
      ['lee', ['b']],
      [' MORG ', ['c']],
      ['r', ['a', 'b', 'c']],
      ['zzz', []],
    ]
    for (const [search, found] of searches) expect(ids(pickablePeople(people, [], search)), `"${search}"`).toEqual(found)
    expect(nameMatches('Alex Rivera', 'x r')).toBe(true)
    expect(nameMatches('Alex Rivera', 'zzz')).toBe(false)
  })

  it('leaves out people already chosen: they show above the box as name tags', () => {
    expect(ids(pickablePeople(people, ['a'], ''))).toEqual(['b', 'c'])
    expect(ids(pickablePeople(people, ['c'], 'r'))).toEqual(['a', 'b'])
    expect(ids(pickablePeople(people, ['a', 'b', 'c'], ''))).toEqual([])
  })

  it('for the whole team, lists only suggested people until a name is typed, then anyone, suggested first', () => {
    expect(ids(pickablePeople(people, [], '', ['c']))).toEqual(['c'])
    expect(ids(pickablePeople(people, [], '', []))).toEqual([])
    expect(ids(pickablePeople(people, [], 'r', ['c']))).toEqual(['c', 'a', 'b'])
    expect(ids(pickablePeople(people, ['c'], '', ['c']))).toEqual([])
    expect(ids(pickablePeople(people, [], 'lee', ['c']))).toEqual(['b'])
  })
})
