// Tests for data.ts, in demo mode on the example data. Who can see and
// change the roster is tested in supabase/tests/roster.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { setDemoRole } from '../../core/demo'
import { membersTable } from '../../core/members'
import {
  activeRosterIds, addSubteam, MECHANICAL, removeSubteam, renameSubteam, rosterEntries, setActive, setMainSubteam, setOnSubteam, SOFTWARE,
  STRATEGY, studentsTable, subteamMembersTable, subteamsTable, ELECTRICAL,
} from './data'

beforeEach(() => {
  subteamsTable.reset()
  studentsTable.reset()
  subteamMembersTable.reset()
  setDemoRole('mentor')
})
afterEach(() => setDemoRole('student'))

const roster = () => rosterEntries(membersTable.rows(), studentsTable.rows(), subteamMembersTable.rows())
const entry = (name: string) => roster().find((e) => e.member.name === name)!
const member = (name: string) => membersTable.rows().find((m) => m.name === name)!

describe('the roster', () => {
  it('lists students and student leaders with access on, A to Z, with their subteams, main one first', () => {
    // Pat is a mentor and Morgan an admin; Sam's access is switched off.
    expect(roster().map((e) => [e.member.name, e.active, e.subteams, e.main])).toEqual([
      ['Alex Rivera', true, [MECHANICAL, SOFTWARE], MECHANICAL],
      ['Casey Nguyen', true, [SOFTWARE, STRATEGY], SOFTWARE],
      ['Jordan Kim', true, [ELECTRICAL], ELECTRICAL],
    ])
  })

  it('tells anyone but mentors and admins who can change it', async () => {
    // The database refuses them too (supabase/tests/roster.test.ts).
    setDemoRole('leader')
    expect(await setActive(member('Jordan Kim'), false)).toMatchObject({ ok: false, error: /Only mentors and admins/ })
  })

  it('marks someone active or not, and counts only active members with access on as active', async () => {
    const sam = member('Sam Ortiz')
    expect(await setActive(member('Jordan Kim'), false)).toEqual({ ok: true, value: null })
    // Sam has no roster row yet: this adds one. Sam's access is off, so Sam still doesn't count.
    expect(await setActive(sam, true)).toEqual({ ok: true, value: null })
    expect(studentsTable.rows().some((s) => s.member_id === sam.id && s.active)).toBe(true)
    const active = activeRosterIds(membersTable.rows(), studentsTable.rows())
    expect([...active].map((id) => membersTable.rows().find((m) => m.id === id)!.name).sort()).toEqual(['Alex Rivera', 'Casey Nguyen'])
  })

  it("makes someone's first subteam their main one, and the next one main when it's taken away", async () => {
    const jordan = member('Jordan Kim')
    await setOnSubteam(jordan, SOFTWARE, true)
    expect(entry('Jordan Kim')).toMatchObject({ subteams: [ELECTRICAL, SOFTWARE], main: ELECTRICAL })
    await setOnSubteam(jordan, ELECTRICAL, false)
    expect(entry('Jordan Kim')).toMatchObject({ subteams: [SOFTWARE], main: SOFTWARE })
    await setOnSubteam(jordan, SOFTWARE, false)
    await setOnSubteam(jordan, STRATEGY, true)
    expect(entry('Jordan Kim')).toMatchObject({ subteams: [STRATEGY], main: STRATEGY })
  })

  it('switches the main subteam, only to one they are on', async () => {
    const alex = member('Alex Rivera')
    expect(await setMainSubteam(alex, STRATEGY)).toMatchObject({ ok: false, error: /isn't on that subteam/ })
    expect(await setMainSubteam(alex, SOFTWARE)).toEqual({ ok: true, value: null })
    expect(entry('Alex Rivera')).toMatchObject({ subteams: [SOFTWARE, MECHANICAL], main: SOFTWARE })
    expect(subteamMembersTable.rows().filter((s) => s.member_id === alex.id && s.main)).toHaveLength(1)
  })

  it('adds, renames and removes subteams, with a name no other subteam has', async () => {
    const added = await addSubteam(' Business ')
    expect(added.ok && added.value).toMatchObject({ name: 'Business', position: 5 })
    expect(await addSubteam(' mechanical ')).toMatchObject({ ok: false, error: /already a subteam/ })
    expect(await addSubteam('  ')).toMatchObject({ ok: false, error: /Give the subteam a name/ })
    const software = subteamsTable.rows().find((s) => s.id === SOFTWARE)!
    expect((await renameSubteam(software, 'Programming')).ok).toBe(true)
    // Removing it takes Alex and Casey off; Casey's main moves to Strategy.
    expect(await removeSubteam({ ...software, name: 'Programming' })).toEqual({ ok: true, value: null })
    expect(subteamsTable.rows().map((s) => s.name)).toEqual(['Electrical', 'Mechanical', 'Strategy', 'Business'])
    expect(entry('Alex Rivera')).toMatchObject({ subteams: [MECHANICAL], main: MECHANICAL })
    expect(entry('Casey Nguyen')).toMatchObject({ subteams: [STRATEGY], main: STRATEGY })
  })

  it('shows mentors everyone on the roster, with the subteams', async () => {
    const { default: RosterPage } = await import('./RosterPage')
    const page = renderToString(createElement(RosterPage)).replace(/<[^>]*>/g, '')
    for (const text of ['Alex Rivera', 'Casey Nguyen', 'Student leader', 'Jordan Kim', 'Electrical', 'Mechanical', 'Software', 'Strategy', '3active of 3']) {
      expect(page, text).toContain(text)
    }
    expect(page).not.toContain('Sam Ortiz')
  })
})
