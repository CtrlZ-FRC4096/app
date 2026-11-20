// Tests for the Pit checklist's data.ts. They run in demo mode, as Alex (a
// student) unless a test views the app as someone else. Who may do what is
// the database's job too: see supabase/tests/pit-checklist.test.ts.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_ITEM_LENGTH, PRACTICE_KEY, PRACTICE_MATCH, addPitItem, assignPitItem, belongsToSubgroup, canCheck, checkedIds, checksTable, defaultMatch, itemsTable,
  matchProgress, movePitItem, movePitItemTo, myItems, ourMatches, pitSummary, positionBetween, progressByPerson, progressText,
  assignedPeople, suggestedFor, canManagePit, clearPitChecklist, takenOffText, removePitItem, renamePitItem, reorderPitItem, setPitItemCompleted, setPitItemSubgroup, setSubgroupMembers, subgroupMembersStore, uncheckAllPitItems, uncheckedByPerson,
  assignPitItems, assignedText, notInText, usePitSummary, type AssignPlan, type PitCheck, type PitItem,
} from './data'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import { ROLES, type Role } from '../../core/roles'
import { membersTable } from '../../core/members'
import { scheduleStore, type MatchPrediction, type TbaMatch } from '../scouting/data'
import { EVENT_KEY } from '../scouting/season'

const QM3 = `${EVENT_KEY}_qm3`
const texts = () => itemsTable.rows().map((item) => item.text)
const byText = (text: string) => itemsTable.rows().find((item) => item.text === text)!

beforeEach(() => {
  setDemoRole('student')
  membersTable.reset()
  subgroupMembersStore.reset()
  itemsTable.reset()
  checksTable.reset()
  scheduleStore.reset()
})

// Finding someone by name is tested with PeoplePicker, in src/core/members.test.ts.
describe('choosing people for items', () => {
  it('suggests the people already on other items, once each', () => {
    expect(assignedPeople(itemsTable.rows()).sort()).toEqual([DEMO_PEOPLE.alex, DEMO_PEOPLE.jordan, DEMO_PEOPLE.pat].sort())
    expect(assignedPeople([])).toEqual([])
  })

  it('suggests people already on items, and the other subgroups’ members, when the whole team can be chosen', () => {
    // Programming in the example data is Jordan and Morgan; Mechanical isn't set up on this device.
    subgroupMembersStore.set({ Programming: [DEMO_PEOPLE.jordan, DEMO_PEOPLE.morgan] })
    const onItems = [DEMO_PEOPLE.alex, DEMO_PEOPLE.pat, DEMO_PEOPLE.jordan]
    const cases: [string[], string[] | undefined][] = [
      [['Programming'], undefined],
      [['General'], onItems],
      [['Mechanical'], onItems],
      [['General', 'Programming'], [...onItems, DEMO_PEOPLE.morgan]],
    ]
    for (const [subgroups, ids] of cases) expect(suggestedFor(subgroups, itemsTable.rows())?.sort(), subgroups.join(', ')).toEqual(ids?.sort())
  })

  it('says who was taken off when a subgroup they are not in is picked', () => {
    const members = membersTable.rows()
    // Electrical in the example data is Alex and Pat.
    const cases: [string[], string, string][] = [
      [[DEMO_PEOPLE.alex, DEMO_PEOPLE.pat], 'Electrical', ''],
      [[], 'Electrical', ''],
      [[DEMO_PEOPLE.jordan], 'General', ''],
      [[DEMO_PEOPLE.casey], 'Electrical', "You're not in Electrical, so you were taken off."],
      [[DEMO_PEOPLE.jordan, DEMO_PEOPLE.alex], 'Electrical', "Jordan Kim isn't in Electrical, and was taken off."],
      [[DEMO_PEOPLE.jordan, DEMO_PEOPLE.casey], 'Electrical', "Jordan Kim and you aren't in Electrical, and were taken off."],
      [[DEMO_PEOPLE.jordan, DEMO_PEOPLE.morgan, DEMO_PEOPLE.casey], 'Electrical', "Jordan Kim, Morgan Lee and you aren't in Electrical, and were taken off."],
    ]
    for (const [chosen, subgroup, text] of cases) expect(takenOffText(chosen, subgroup, members, DEMO_PEOPLE.casey), `${chosen} → ${subgroup}`).toBe(text)
  })

  it('says who isn’t in a subgroup, by name', () => {
    const members = membersTable.rows()
    const cases: [string[], string][] = [
      [[DEMO_PEOPLE.pat], "Pat Chen isn't in Programming."],
      [[DEMO_PEOPLE.pat, DEMO_PEOPLE.alex], "Pat Chen and Alex Rivera aren't in Programming."],
      [[DEMO_PEOPLE.pat, DEMO_PEOPLE.alex, DEMO_PEOPLE.casey], "Pat Chen, Alex Rivera and Casey Nguyen aren't in Programming."],
      [['someone-no-longer-on-the-team'], "Former member isn't in Programming."],
    ]
    for (const [ids, text] of cases) expect(notInText(ids, 'Programming', members)).toBe(text)
  })

  it('says what Assign people did: who went on how many items, then each skipped item and why', () => {
    const members = membersTable.rows()
    const [batteries, bumpers, , code] = itemsTable.rows()
    const skipCode = { item: code, notIn: [DEMO_PEOPLE.pat] }
    const cases: [AssignPlan, string[], string][] = [
      [{ assign: [batteries, bumpers], skip: [] }, [DEMO_PEOPLE.pat, DEMO_PEOPLE.alex], 'Pat Chen and Alex Rivera are now on 2 items.'],
      [{ assign: [bumpers], skip: [skipCode] }, [DEMO_PEOPLE.pat], "Pat Chen is now on 1 item. Skipped Code deployed: Pat Chen isn't in Programming."],
      [{ assign: [], skip: [skipCode] }, [DEMO_PEOPLE.pat], "Skipped Code deployed: Pat Chen isn't in Programming."],
    ]
    for (const [plan, people, text] of cases) expect(assignedText(plan, people, members)).toBe(text)
  })
})

describe('changing items: student leaders, mentors and admins only', () => {
  it('lets each role do what it may: students only check their own items, and are told who to ask', async () => {
    // Everything that changes the checklist, each tried on fresh example data.
    const first = () => itemsTable.rows()[0]
    const changes: Record<string, () => Promise<{ ok: boolean; error?: string }>> = {
      add: () => addPitItem('Tools packed', [DEMO_PEOPLE.pat]),
      rename: () => renamePitItem(first().id, 'Renamed'),
      assign: () => assignPitItem(first().id, [DEMO_PEOPLE.pat]),
      'assign several items': () => assignPitItems([first().id, itemsTable.rows()[1].id], [DEMO_PEOPLE.pat]),
      'change the subgroup': () => setPitItemSubgroup(first().id, 'General'),
      reorder: () => reorderPitItem(first().id, itemsTable.rows()[2].id),
      'edit subgroup members': () => setSubgroupMembers('Electrical', [DEMO_PEOPLE.pat]),
      remove: () => removePitItem(first().id),
      'uncheck everything': () => uncheckAllPitItems(QM3),
      'clear the list': () => clearPitChecklist(),
      // Nobody is assigned to the safety glasses, so only people who run the checklist can check it.
      "check someone else's item": () => setPitItemCompleted(byText('Safety glasses for everyone in the pit').id, QM3, true),
    }
    const may: Record<Role, boolean> = { student: false, leader: true, mentor: true, admin: true }
    expect(Object.keys(may)).toEqual(ROLES)
    for (const role of ROLES) {
      expect(canManagePit(role), role).toBe(may[role])
      for (const [what, change] of Object.entries(changes)) {
        itemsTable.reset()
        checksTable.reset()
        subgroupMembersStore.reset()
        setDemoRole(role)
        const before = { items: itemsTable.rows(), checks: checksTable.rows() }
        const result = await change()
        expect(result.ok, `${role}: ${what}`).toBe(may[role])
        if (may[role]) continue
        expect(result.error, `${role}: ${what}`).toMatch(/student leader or mentor/)
        expect({ items: itemsTable.rows(), checks: checksTable.rows() }, `${role}: ${what}`).toEqual(before)
      }
    }
  })

  it('lets a student check their own item', async () => {
    expect((await setPitItemCompleted(byText('Robot weighed').id, QM3, true)).ok).toBe(true)
  })

  it('says who to ask, for each thing', async () => {
    const first = itemsTable.rows()[0]
    expect(await renamePitItem(first.id, 'Renamed')).toEqual({ ok: false, error: 'Ask a student leader or mentor to rename this item.' })
    expect(await removePitItem(first.id)).toEqual({ ok: false, error: 'Ask a student leader or mentor to remove checklist items.' })
    expect(await clearPitChecklist()).toEqual({ ok: false, error: 'Ask a student leader or mentor to clear the checklist.' })
  })

  it('adds a trimmed item at the bottom, and refuses blank or oversized items or nobody assigned', async () => {
    setDemoRole('mentor')
    expect(await addPitItem(' \n ', [DEMO_PEOPLE.alex])).toMatchObject({ ok: false, error: /Write a checklist item/ })
    expect((await addPitItem('x'.repeat(MAX_ITEM_LENGTH + 1), [DEMO_PEOPLE.alex])).ok).toBe(false)
    expect((await addPitItem('No one', [])).ok).toBe(false)
    expect((await addPitItem('Inactive', [DEMO_PEOPLE.sam])).ok).toBe(false)
    expect((await addPitItem('  Check tire wear  ', [DEMO_PEOPLE.alex, DEMO_PEOPLE.pat], 'Mechanical')).ok).toBe(false)
    expect(await addPitItem('  Check tire wear  ', [DEMO_PEOPLE.alex], 'Mechanical')).toMatchObject({ ok: true, value: { text: 'Check tire wear', subgroup: 'Mechanical' } })
    expect(texts().at(-1)).toBe('Check tire wear')
  })

  it('renames an item, keeping its assignments, place and checks', async () => {
    setDemoRole('admin')
    const first = itemsTable.rows()[0]
    expect((await renamePitItem(first.id, '  Inspect battery connections  ')).ok).toBe(true)
    expect(itemsTable.rows()[0]).toMatchObject({ ...first, text: 'Inspect battery connections' })
    expect(checkedIds(checksTable.rows(), QM3).has(first.id)).toBe(true)
    expect((await renamePitItem('missing', 'Valid')).ok).toBe(false)
  })

  it('assigns people from the item’s subgroup only, and can leave an item unassigned', async () => {
    setDemoRole('mentor')
    const code = byText('Code deployed')
    expect((await assignPitItem(code.id, [DEMO_PEOPLE.alex])).ok).toBe(false)
    expect((await assignPitItem(code.id, [DEMO_PEOPLE.morgan, DEMO_PEOPLE.jordan])).ok).toBe(true)
    expect(byText('Code deployed').assignee_ids).toEqual([DEMO_PEOPLE.morgan, DEMO_PEOPLE.jordan])
    expect((await assignPitItem(code.id, [])).ok).toBe(true)
    expect(byText('Code deployed').assignee_ids).toEqual([])
  })

  it('changes a subgroup, unassigning people who aren’t in the new one', async () => {
    setDemoRole('mentor')
    const code = byText('Code deployed')
    expect((await setPitItemSubgroup(code.id, 'Electrical')).ok).toBe(true)
    expect(byText('Code deployed')).toMatchObject({ subgroup: 'Electrical', assignee_ids: [] })
    expect((await setPitItemSubgroup(code.id, 'unknown' as 'General')).ok).toBe(false)
  })

  it('keeps an item checked when the people on it change', async () => {
    setDemoRole('leader')
    const batteries = byText('Batteries charged and numbered')
    expect(checkedIds(checksTable.rows(), QM3).has(batteries.id)).toBe(true)
    expect((await assignPitItem(batteries.id, [DEMO_PEOPLE.pat])).ok).toBe(true)
    expect((await assignPitItem(batteries.id, [])).ok).toBe(true)
    expect(byText('Batteries charged and numbered').assignee_ids).toEqual([])
    expect(checkedIds(checksTable.rows(), QM3).has(batteries.id)).toBe(true)
  })

  it('checks only the people being added, so someone already on an item never stops a change', async () => {
    setDemoRole('leader')
    const code = byText('Code deployed')
    // Jordan and Sam are on Code deployed, but on this device Programming is
    // only Morgan now, and Sam's access has been switched off.
    subgroupMembersStore.set((groups) => ({ ...groups, Programming: [DEMO_PEOPLE.morgan] }))
    const cases: [string, string[], boolean][] = [
      ['add Morgan', [DEMO_PEOPLE.jordan, DEMO_PEOPLE.sam, DEMO_PEOPLE.morgan], true],
      ['take Sam off', [DEMO_PEOPLE.jordan], true],
      ["add Alex, who isn't in Programming", [DEMO_PEOPLE.jordan, DEMO_PEOPLE.sam, DEMO_PEOPLE.alex], false],
    ]
    for (const [what, ids, allowed] of cases) {
      await itemsTable.update(code.id, { assignee_ids: [DEMO_PEOPLE.jordan, DEMO_PEOPLE.sam] })
      expect((await assignPitItem(code.id, ids)).ok, what).toBe(allowed)
    }
    // Assign people too: Jordan is on it already, so choosing Jordan doesn't skip it.
    expect(await assignPitItems([code.id], [DEMO_PEOPLE.jordan, DEMO_PEOPLE.morgan])).toMatchObject({ ok: true, value: { skip: [] } })
    expect(byText('Code deployed').assignee_ids).toEqual([DEMO_PEOPLE.jordan, DEMO_PEOPLE.sam, DEMO_PEOPLE.morgan])
  })

  it('gives several items to the same people, keeping who is on them and their checks, and skips items whose subgroup someone chosen isn’t in', async () => {
    setDemoRole('leader')
    // Electrical and Drive team are Alex and Pat; Programming is Jordan and Morgan.
    const [batteries, bumpers, , code, laptop] = itemsTable.rows()
    const peopleOn = () => [batteries, bumpers, code, laptop].map((item) => byText(item.text).assignee_ids)
    // Ticked in any order, one twice: the items go in list order, once each.
    expect(await assignPitItems([laptop.id, code.id, bumpers.id, batteries.id, batteries.id], [DEMO_PEOPLE.pat])).toEqual({
      ok: true, value: { assign: [batteries, bumpers, laptop], skip: [{ item: code, notIn: [DEMO_PEOPLE.pat] }] },
    })
    expect(peopleOn()).toEqual([
      [DEMO_PEOPLE.alex, DEMO_PEOPLE.pat],
      [DEMO_PEOPLE.pat], // Already on it, so not added twice.
      [DEMO_PEOPLE.jordan], // Skipped.
      [DEMO_PEOPLE.alex, DEMO_PEOPLE.pat],
    ])
    expect(checkedIds(checksTable.rows(), QM3).has(batteries.id)).toBe(true)
    // Someone chosen who isn't in the subgroup skips the whole item, even with someone who is.
    const before = peopleOn()
    expect(await assignPitItems([code.id], [DEMO_PEOPLE.morgan, DEMO_PEOPLE.alex])).toEqual({
      ok: true, value: { assign: [], skip: [{ item: code, notIn: [DEMO_PEOPLE.alex] }] },
    })
    expect(peopleOn()).toEqual(before)
  })

  it('needs ticked items still on the list, and active people to add', async () => {
    setDemoRole('leader')
    const batteries = byText('Batteries charged and numbered')
    const before = itemsTable.rows()
    const cases: [string[], string[], RegExp][] = [
      [[], [DEMO_PEOPLE.pat], /Tick at least one item/],
      [['not-an-item'], [DEMO_PEOPLE.pat], /Tick at least one item/],
      [[batteries.id], [], /Choose at least one person/],
      [[batteries.id], [DEMO_PEOPLE.sam], /active team members/],
    ]
    for (const [ids, people, error] of cases) expect(await assignPitItems(ids, people), String(error)).toEqual({ ok: false, error: expect.stringMatching(error) })
    expect(itemsTable.rows()).toEqual(before)
  })

  it('unchecks everything for one match, keeping the items, their people and other matches’ checks', async () => {
    setDemoRole('leader')
    const before = itemsTable.rows()
    await setPitItemCompleted(before[2].id, PRACTICE_KEY, true)
    expect(await uncheckAllPitItems(QM3)).toEqual({ ok: true, value: 2 })
    expect(checkedIds(checksTable.rows(), QM3).size).toBe(0)
    expect(checkedIds(checksTable.rows(), PRACTICE_KEY)).toEqual(new Set([before[2].id]))
    expect(itemsTable.rows()).toEqual(before)
    // Nothing left to uncheck isn't a problem.
    expect(await uncheckAllPitItems(QM3)).toEqual({ ok: true, value: 0 })
  })

  it('clears the list: every item and every check, and says how many items went', async () => {
    setDemoRole('leader')
    expect(await clearPitChecklist()).toEqual({ ok: true, value: 6 })
    expect(itemsTable.rows()).toEqual([])
    expect(checksTable.rows()).toEqual([])
    expect(await clearPitChecklist()).toEqual({ ok: true, value: 0 })
  })

  it('removes an item that is already gone with a message, not a crash', async () => {
    setDemoRole('leader')
    expect(await removePitItem('not-an-item')).toEqual({ ok: false, error: 'That item is no longer on the checklist.' })
  })

  it('deletes an item and its checks', async () => {
    setDemoRole('mentor')
    const first = itemsTable.rows()[0]
    expect((await removePitItem(first.id)).ok).toBe(true)
    expect(itemsTable.rows().some((item) => item.id === first.id)).toBe(false)
    expect(checksTable.rows().some((check) => check.item_id === first.id)).toBe(false)
  })
})

describe('reordering', () => {
  beforeEach(() => setDemoRole('mentor'))

  it('puts a new position halfway between the neighbours, so only the moved item changes', () => {
    expect(positionBetween(1, 2)).toBe(1.5)
    expect(positionBetween(3, undefined)).toBe(4)
    expect(positionBetween(undefined, 1)).toBe(0)
    expect(positionBetween(undefined, undefined)).toBe(0)
  })

  it('drags an item down or up to where another one is', async () => {
    const original = texts()
    const [first, second, , , , last] = itemsTable.rows()
    expect((await reorderPitItem(first.id, last.id)).ok).toBe(true)
    expect(texts()).toEqual([...original.slice(1), original[0]])
    expect((await reorderPitItem(first.id, second.id)).ok).toBe(true)
    expect(texts()).toEqual(original)
    expect((await reorderPitItem('missing', first.id)).ok).toBe(false)
  })

  it('moves one place with the keyboard, and stays put at the ends', async () => {
    const original = texts()
    const [first] = itemsTable.rows()
    expect((await movePitItem(first.id, -1)).ok).toBe(true)
    expect(texts()).toEqual(original)
    await movePitItem(first.id, 1)
    expect(texts()).toEqual([original[1], original[0], ...original.slice(2)])
  })

  it('moves to a typed position, and says which positions there are', async () => {
    const original = texts()
    const [first] = itemsTable.rows()
    expect(await movePitItemTo(first.id, '6')).toEqual({ ok: true, value: null })
    expect(texts()).toEqual([...original.slice(1), original[0]])
    expect((await movePitItemTo(first.id, ' 1 ')).ok).toBe(true)
    expect(texts()).toEqual(original)
    for (const bad of ['0', '7', '', '1.5', 'top']) {
      expect(await movePitItemTo(first.id, bad), bad).toEqual({ ok: false, error: expect.stringMatching(/position from 1 to 6/) })
    }
  })
})

describe('checking items for a match', () => {
  it('lets a student check only their own items, and says who to ask otherwise', async () => {
    const robot = byText('Robot weighed')
    const bumpers = byText('Both bumper colors packed')
    expect(await setPitItemCompleted(robot.id, QM3, true)).toEqual({ ok: true, value: null })
    expect(checkedIds(checksTable.rows(), QM3).has(robot.id)).toBe(true)
    expect(await setPitItemCompleted(bumpers.id, QM3, true)).toEqual({ ok: false, error: expect.stringMatching(/Only people assigned/) })
    expect(checkedIds(checksTable.rows(), QM3).has(bumpers.id)).toBe(false)
  })

  it('lets mentors and admins check any item', async () => {
    setDemoRole('mentor')
    expect((await setPitItemCompleted(byText('Robot weighed').id, QM3, true)).ok).toBe(true)
    setDemoRole('admin')
    expect((await setPitItemCompleted(byText('Safety glasses for everyone in the pit').id, QM3, true)).ok).toBe(true)
    expect(canCheck({ assignee_ids: [] }, { id: 'x', role: 'mentor' })).toBe(true)
    expect(canCheck({ assignee_ids: [] }, { id: 'x', role: 'leader' })).toBe(true)
    expect(canCheck({ assignee_ids: ['x'] }, { id: 'x', role: 'student' })).toBe(true)
    expect(canCheck({ assignee_ids: [] }, { id: 'x', role: 'student' })).toBe(false)
  })

  it('keeps each match separate, so the next match starts fresh', async () => {
    const robot = byText('Robot weighed')
    await setPitItemCompleted(robot.id, QM3, true)
    expect(checkedIds(checksTable.rows(), `${EVENT_KEY}_qm4`).has(robot.id)).toBe(false)
    await setPitItemCompleted(robot.id, PRACTICE_KEY, true)
    expect(checksTable.rows().filter((c) => c.item_id === robot.id).map((c) => c.match_key).sort()).toEqual([QM3, PRACTICE_KEY].sort())
  })

  it('unchecks, and does nothing when it is already that way', async () => {
    const battery = byText('Batteries charged and numbered')
    const count = checksTable.rows().length
    expect((await setPitItemCompleted(battery.id, QM3, true)).ok).toBe(true)
    expect(checksTable.rows()).toHaveLength(count)
    expect((await setPitItemCompleted(battery.id, QM3, false)).ok).toBe(true)
    expect(checkedIds(checksTable.rows(), QM3).has(battery.id)).toBe(false)
    expect((await setPitItemCompleted(battery.id, QM3, false)).ok).toBe(true)
  })
})

// Plain lists for the counting tests, so they don't depend on the example data.
const item = (id: string, assignee_ids: string[]): PitItem => ({ id, text: id, subgroup: 'General', assignee_ids, position: 0, created_at: '', created_by: null })
const check = (item_id: string, match_key = 'm1'): PitCheck => ({ id: `${item_id}-${match_key}`, item_id, match_key, created_at: '', created_by: 'a' })
const PEOPLE = [{ id: 'a', name: 'Alex' }, { id: 'j', name: 'Jordan' }]

describe('progress', () => {
  const items = [item('1', ['a']), item('2', ['a', 'j']), item('3', ['j']), item('4', [])]

  it('says Ready only when every item is checked for the match, otherwise how many are left', () => {
    expect(progressText(matchProgress(items, [check('1')], 'm1'))).toBe('3 of 4 left')
    expect(progressText(matchProgress(items, ['1', '2', '3', '4'].map((id) => check(id)), 'm1'))).toBe('Ready')
    expect(progressText(matchProgress(items, ['1', '2', '3', '4'].map((id) => check(id, 'm2')), 'm1'))).toBe('4 of 4 left')
    expect(progressText(matchProgress([], [], 'm1'))).toBe('No items yet')
  })

  it("gives each person's progress, by name, counting a shared item for both", () => {
    expect(progressByPerson(items, [check('1'), check('2')], 'm1', PEOPLE)).toEqual([
      { id: 'a', name: 'Alex', done: 2, total: 2 },
      { id: 'j', name: 'Jordan', done: 1, total: 2 },
    ])
    expect(progressByPerson([item('1', ['gone'])], [], 'm1', PEOPLE)[0].name).toBe('Former member')
  })

  it('groups what is still to do by who it’s assigned to, with unassigned items first', () => {
    expect(uncheckedByPerson(items, [check('1')], 'm1', PEOPLE).map((g) => [g.name, g.items.map((i) => i.id)])).toEqual([
      ['Unassigned', ['4']],
      ['Alex', ['2']],
      ['Jordan', ['2', '3']],
    ])
    expect(uncheckedByPerson(items, ['1', '2', '3', '4'].map((id) => check(id)), 'm1', PEOPLE)).toEqual([])
  })

  it("lists a student's own items only", () => {
    expect(myItems(items, 'j').map((i) => i.id)).toEqual(['2', '3'])
    expect(myItems(items, 'nobody')).toEqual([])
  })
})

describe('our matches', () => {
  const tba = (n: number, red: number[], blue: number[], score = -1): TbaMatch => ({
    key: `2026test_qm${n}`, comp_level: 'qm', set_number: 1, match_number: n, winning_alliance: '', predicted_time: 1773414000 + n * 480,
    alliances: { red: { score, team_keys: red.map((t) => `frc${t}`) }, blue: { score, team_keys: blue.map((t) => `frc${t}`) } },
  })
  const prediction: MatchPrediction = { key: '2026test_qm3', redWinChance: 0.3, redScore: 70.4, blueScore: 84.2 }
  const saved = {
    event: '2026test',
    matches: [tba(1, [4096, 1, 2], [3, 4, 5], 80), tba(2, [1, 2, 3], [4, 5, 6]), tba(3, [1, 2, 3], [4096, 5, 6]), tba(4, [4096, 1, 2], [3, 4, 5])],
    predictions: [prediction],
    savedAt: '2026-03-13T15:00:00Z',
  }

  it('lists our matches still to play, with our side and Match 13’s prediction, then the practice round', () => {
    const matches = ourMatches(saved)
    expect(matches.map((m) => [m.key, m.label, m.alliance])).toEqual([
      ['2026test_qm3', 'Qual 3', 'Blue'],
      ['2026test_qm4', 'Qual 4', 'Red'],
      [PRACTICE_KEY, 'Practice / no match', null],
    ])
    expect(matches[0].prediction).toBe('Blue 70% · 70–84')
    expect(matches[1].prediction).toBeNull()
  })

  it('picks our next match by default', () => {
    expect(defaultMatch(ourMatches(saved)).label).toBe('Qual 3')
  })

  it('falls back to the practice round with no schedule, or nothing of ours left', () => {
    expect(ourMatches(null)).toEqual([PRACTICE_MATCH])
    expect(defaultMatch(ourMatches(null)).key).toBe(PRACTICE_KEY)
    expect(defaultMatch(ourMatches({ ...saved, matches: [tba(1, [4096, 1, 2], [3, 4, 5], 80)] })).key).toBe(PRACTICE_KEY)
  })
})

describe('the home page summary', () => {
  const qm3 = { ...PRACTICE_MATCH, key: 'm1', label: 'Qual 12' }

  it('says whether we are ready for the next match', () => {
    const items = [item('1', ['a']), item('2', ['j'])]
    expect(pitSummary(items, [check('1')], qm3)).toEqual({ tone: 'warn', text: '1 of 2 left for Qual 12' })
    expect(pitSummary(items, [check('1'), check('2')], qm3)).toEqual({ tone: 'ok', text: 'Ready for Qual 12' })
    expect(pitSummary(items, [], PRACTICE_MATCH)).toEqual({ tone: 'warn', text: '2 of 2 left for practice' })
    expect(pitSummary([], [], qm3)).toEqual({ tone: 'plain', text: 'No pit checklist items yet' })
  })

  it('works on the home page with no schedule saved', () => {
    const Tile = () => createElement('p', null, usePitSummary().text)
    expect(renderToString(createElement(Tile))).toBe('<p>6 of 6 left for practice</p>')
  })
})

describe('subgroup members (on this device)', () => {
  it('lists everyone for General and for a subgroup nobody has set up', () => {
    expect(belongsToSubgroup('anyone', 'General')).toBe(true)
    subgroupMembersStore.set({})
    expect(belongsToSubgroup('anyone', 'Mechanical')).toBe(true)
    subgroupMembersStore.set({ Mechanical: [] })
    expect(belongsToSubgroup('anyone', 'Mechanical')).toBe(false)
  })

  it('lets mentors choose members, and unassigns people taken out', async () => {
    expect((await setSubgroupMembers('Electrical', [DEMO_PEOPLE.pat])).ok).toBe(false)
    setDemoRole('mentor')
    expect((await setSubgroupMembers('Electrical', [DEMO_PEOPLE.sam])).ok).toBe(false)
    expect((await setSubgroupMembers('General', [])).ok).toBe(false)
    expect((await setSubgroupMembers('Electrical', [DEMO_PEOPLE.pat])).ok).toBe(true)
    expect(belongsToSubgroup(DEMO_PEOPLE.alex, 'Electrical')).toBe(false)
    expect(byText('Batteries charged and numbered').assignee_ids).toEqual([])
  })

  it('takes off only people taken out of this device’s list, never when a subgroup is first set up', async () => {
    setDemoRole('mentor')
    subgroupMembersStore.set({}) // A new device: no subgroup set up. Code deployed is Jordan's.
    const code = () => byText('Code deployed').assignee_ids
    expect((await setSubgroupMembers('Programming', [DEMO_PEOPLE.morgan])).ok).toBe(true)
    expect((await setSubgroupMembers('Programming', [DEMO_PEOPLE.morgan, DEMO_PEOPLE.pat])).ok).toBe(true)
    expect(code()).toEqual([DEMO_PEOPLE.jordan])
    expect((await assignPitItem(byText('Code deployed').id, [DEMO_PEOPLE.jordan, DEMO_PEOPLE.morgan])).ok).toBe(true)
    expect((await setSubgroupMembers('Programming', [DEMO_PEOPLE.pat])).ok).toBe(true)
    expect(code()).toEqual([DEMO_PEOPLE.jordan])
  })
})
