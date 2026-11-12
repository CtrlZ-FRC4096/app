// Tests for data.ts, in demo mode on the example data. Who can see and
// change the roster is tested in supabase/tests/roster.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { setDemoRole } from '../../core/demo'
import { membersTable, type Member } from '../../core/members'
import { peopleTable } from '../attendance/data'
import {
  activeRosterIds, addSubteam, ELECTRICAL, MECHANICAL, removeSubteam, renameSubteam, rosterEntries, setActive, setMainSubteam, setOnSubteam,
  SOFTWARE, STRATEGY, studentsTable, subteamMembersTable, subteamsTable,
} from './data'

beforeEach(() => {
  subteamsTable.reset()
  studentsTable.reset()
  subteamMembersTable.reset()
  peopleTable.reset()
  setDemoRole('mentor')
})
afterEach(() => setDemoRole('student'))

const roster = (members: Member[] = membersTable.rows()) => rosterEntries(peopleTable.rows(), members, studentsTable.rows(), subteamMembersTable.rows())
const entry = (name: string) => roster().find((e) => e.name === name)!
const activeNames = () => peopleTable.rows().filter((p) => activeRosterIds(studentsTable.rows()).has(p.id)).map((p) => p.name)

describe('the roster', () => {
  it('lists everyone in attendance who is not hidden, with or without an app account, A to Z, main subteam first', () => {
    // Pat is hidden in Attendance. Taylor and Quinn have no app account.
    expect(roster().map((e) => [e.name, e.active, e.subteams, e.member?.name ?? null])).toEqual([
      ['Alex Rivera', true, [MECHANICAL, SOFTWARE], 'Alex Rivera'],
      ['Casey Nguyen', true, [SOFTWARE, STRATEGY], 'Casey Nguyen'],
      ['Jordan Kim', true, [ELECTRICAL], 'Jordan Kim'],
      ['Quinn Patel', true, [], null],
      ['Sam Ortiz', false, [], 'Sam Ortiz'],
      ['Taylor Brooks', true, [MECHANICAL], null],
    ])
  })

  it('also lists students who have signed in but are not in attendance yet, and adds them to attendance when they are set', async () => {
    const newcomer: Member = { ...membersTable.rows()[0], id: 'new-member', slack_user_id: 'U0NEW00001', name: 'Robin Diaz', role: 'student', active: true }
    const mentor: Member = { ...newcomer, id: 'new-mentor', slack_user_id: 'U0NEW00002', name: 'Lee Mentor', role: 'mentor' }
    const robin = roster([...membersTable.rows(), newcomer, mentor]).find((e) => e.name === 'Robin Diaz')!
    expect(robin).toMatchObject({ key: 'member:new-member', person: null, active: false })
    expect(roster([...membersTable.rows(), newcomer, mentor]).some((e) => e.name === 'Lee Mentor')).toBe(false)
    expect(await setActive(robin, true)).toEqual({ ok: true, value: null })
    expect(peopleTable.rows().find((p) => p.slack_user_id === 'U0NEW00001')).toMatchObject({ name: 'Robin Diaz', hidden: false })
    expect(activeNames()).toContain('Robin Diaz')
  })

  it('tells anyone but mentors and admins who can change it', async () => {
    // The database refuses them too (supabase/tests/roster.test.ts).
    setDemoRole('leader')
    expect(await setActive(entry('Jordan Kim'), false)).toMatchObject({ ok: false, error: /Only mentors and admins/ })
  })

  it('marks someone active or not, adding their roster row the first time', async () => {
    expect(await setActive(entry('Jordan Kim'), false)).toEqual({ ok: true, value: null })
    expect(await setActive(entry('Sam Ortiz'), true)).toEqual({ ok: true, value: null })
    expect(activeNames()).toEqual(['Alex Rivera', 'Casey Nguyen', 'Quinn Patel', 'Sam Ortiz', 'Taylor Brooks'])
  })

  it("makes someone's first subteam their main one, and the next one main when it's taken away", async () => {
    await setOnSubteam(entry('Jordan Kim'), SOFTWARE, true)
    expect(entry('Jordan Kim')).toMatchObject({ subteams: [ELECTRICAL, SOFTWARE], main: ELECTRICAL })
    await setOnSubteam(entry('Jordan Kim'), ELECTRICAL, false)
    expect(entry('Jordan Kim')).toMatchObject({ subteams: [SOFTWARE], main: SOFTWARE })
    // Quinn has no app account and no subteam yet.
    await setOnSubteam(entry('Quinn Patel'), STRATEGY, true)
    expect(entry('Quinn Patel')).toMatchObject({ subteams: [STRATEGY], main: STRATEGY })
  })

  it('switches the main subteam, only to one they are on', async () => {
    expect(await setMainSubteam(entry('Alex Rivera'), STRATEGY)).toMatchObject({ ok: false, error: /isn't on that subteam/ })
    expect(await setMainSubteam(entry('Alex Rivera'), SOFTWARE)).toEqual({ ok: true, value: null })
    expect(entry('Alex Rivera')).toMatchObject({ subteams: [SOFTWARE, MECHANICAL], main: SOFTWARE })
    expect(subteamMembersTable.rows().filter((s) => s.person_id === entry('Alex Rivera').person!.id && s.main)).toHaveLength(1)
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
    for (const text of ['Alex Rivera', 'Student leader', 'Taylor Brooks', 'No app account', 'Sam Ortiz', 'Access off', 'Electrical', 'Strategy', '5active of 6']) {
      expect(page, text).toContain(text)
    }
    // Pat is hidden in Attendance.
    expect(page).not.toContain('Pat Chen')
  })
})
