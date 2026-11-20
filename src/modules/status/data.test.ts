// Tests for the Pit checklist's data.ts. They run in demo mode, as Alex (a
// student) unless a test views the app as someone else. Who may do what is
// the database's job too: see supabase/tests/pit-checklist.test.ts.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_ITEM_LENGTH, PRACTICE_KEY, PRACTICE_MATCH, addPitItem, assignPitItem, belongsToSubgroup, canCheck, checkedIds, checksTable, defaultMatch, itemsTable,
  matchProgress, movePitItem, movePitItemTo, myItems, ourMatches, pitSummary, positionBetween, progressByPerson, progressText,
  assignedPeople, suggestedFor, canManagePit, clearPitChecklist, takenOffText, removePitItem, renamePitItem, reorderPitItem, setPitItemCompleted, setPitItemSubgroup, setSubgroupMembers, subgroupMembersStore, uncheckAllPitItems, uncheckedByPerson,
  assignPitItems, assignedText, notInText, usePitSummary, type AssignPlan, type PitCheck, type PitItem,
  COMING_UP, DISPLAY_STALE_MS, QUEUE_AT, clockTime, countdownText, keepPitDisplayFresh, keepScreenAwake, pitDisplay, ratingText, readyText, type PitDisplayInput,
} from './data'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import { ROLES, type Role } from '../../core/roles'
import { membersTable } from '../../core/members'
import {
  STALE_MS, eventTeamsStore, ratingsStore, resetRatings, savedEventTeams, savedSchedule, scheduleStore,
  type Match13Rating, type MatchPrediction, type SavedSchedule, type TbaMatch, type TbaRanking, type TbaTeam,
} from '../scouting/data'
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

  it('skips our match still waiting for its score once a later match has one, like the pit display', () => {
    // Our Qual 3 is under review with no score, and Qual 4 has been scored.
    const late = { ...saved, matches: [tba(3, [1, 2, 3], [4096, 5, 6]), tba(4, [1, 2, 3], [4, 5, 6], 70), tba(5, [4096, 1, 2], [3, 4, 5])] }
    expect(defaultMatch(ourMatches(late)).label).toBe('Qual 5')
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

// ---------------------------------------------------------------------------
// The pit display (#161). pitDisplay() is a plain function with `now` passed
// in, so these tests use a fixed time and made-up schedules.

describe('the pit display', () => {
  // Saturday 14 March 2026, 10:00 AM in Chicago. Qual n is expected n × 8 minutes later.
  const NOW = new Date('2026-03-14T15:00:00Z')
  const T0 = NOW.getTime() / 1000
  const MINUTE = 60

  /** A match from The Blue Alliance: the red and blue teams, and the score once it's played. */
  const qm = (n: number, red: number[], blue: number[], score?: [red: number, blue: number], more: Partial<TbaMatch> = {}): TbaMatch => ({
    key: `2026test_qm${n}`, comp_level: 'qm', set_number: 1, match_number: n, winning_alliance: '', predicted_time: T0 + n * 8 * MINUTE,
    alliances: { red: { score: score?.[0] ?? -1, team_keys: red.map((t) => `frc${t}`) }, blue: { score: score?.[1] ?? -1, team_keys: blue.map((t) => `frc${t}`) } },
    ...more,
  })
  /** Semifinal `set`, after the quals. */
  const sf = (set: number, red: number[], blue: number[], score?: [red: number, blue: number], winner: TbaMatch['winning_alliance'] = '') =>
    qm(100 + set, red, blue, score, { key: `2026test_sf${set}m1`, comp_level: 'sf', set_number: set, match_number: 1, winning_alliance: winner })
  const saved = (matches: TbaMatch[], savedAt = NOW.toISOString()): SavedSchedule => ({ event: '2026test', matches, predictions: [], savedAt })
  const input = (fields: Partial<PitDisplayInput>): PitDisplayInput => ({ schedule: null, status: { loading: false, problem: null }, rankings: [], ratings: [], teams: null, ...fields })
  const ranking = (rank: number, team: number, record: TbaRanking['record'] = { wins: 5, losses: 2, ties: 0 }): TbaRanking => ({ rank, team_key: `frc${team}`, record, matches_played: 7, extra_stats: [] })
  const rating = (team: number, xpEnd: number): Match13Rating => ({ teamNumber: team, xpStart: xpEnd, xpEnd, xAuto: null, xTele: null, xEnd: null, epa: null, opr: null, dpr: null })
  const tbaTeam = (team: number, nickname: string): TbaTeam => ({ key: `frc${team}`, team_number: team, nickname, city: null, state_prov: null, country: null })
  // Intl puts a narrow space before AM and PM; the tests compare plain ones.
  const plain = (text: string) => text.replace(/[  ]/g, ' ')

  // Quals 1 and 2 are played. We're in Qual 1 (red, won 84–71), Qual 3 (blue) and Qual 5 (red).
  const SCHEDULE = [
    qm(1, [4096, 1, 2], [3, 4, 5], [84, 71]),
    qm(2, [1, 2, 3], [4, 5, 6], [60, 50]),
    qm(3, [1, 2, 3], [4096, 5, 6]),
    qm(4, [1, 2, 3], [4, 5, 6]),
    qm(5, [4096, 4, 6], [1, 2, 3]),
  ]
  /** Ten quals, with ours last (Qual 10), and every match up to Qual `lastScored` played. */
  const ourQual10 = (lastScored: number) =>
    saved(Array.from({ length: 10 }, (_, i) => qm(i + 1, i === 9 ? [4096, 1, 2] : [1, 2, 3], [4, 5, 6], i + 1 <= lastScored ? [50, 40] : undefined)))

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('finds our next match: our first one after the last match with a score, with our alliance and partners', () => {
    expect(pitDisplay(input({ schedule: saved(SCHEDULE) }), NOW).next).toMatchObject({ key: '2026test_qm3', label: 'Qual 3', alliance: 'Blue', partners: [5, 6] })
    // The Blue Alliance's order doesn't matter.
    expect(pitDisplay(input({ schedule: saved(SCHEDULE.toReversed()) }), NOW).next?.label).toBe('Qual 3')
    // Qual 3 is still waiting for its score, but Qual 4 has one: Qual 3 counts as played.
    const waiting = SCHEDULE.with(3, qm(4, [1, 2, 3], [4, 5, 6], [70, 60]))
    expect(pitDisplay(input({ schedule: saved(waiting) }), NOW).next).toMatchObject({ label: 'Qual 5', alliance: 'Red', partners: [4, 6] })
    // Once the quals are played, a playoff match of ours is next.
    const playoffs = [qm(1, [4096, 1, 2], [3, 4, 5], [84, 71]), sf(1, [3, 4, 5], [4096, 1, 2])]
    expect(pitDisplay(input({ schedule: saved(playoffs) }), NOW).next).toMatchObject({ label: 'Semifinal 1', alliance: 'Blue' })
  })

  it('counts down to the expected start in minutes, rounded up, then says "Any minute now", or "Time not known yet" with no time', () => {
    const cases: [secondsFromNow: number | null, text: string][] = [
      [18 * MINUTE, '18 min'],
      [17 * MINUTE + 10, '18 min'],
      [30, '1 min'],
      [0, 'Any minute now'],
      [-5 * MINUTE, 'Any minute now'],
      [60 * MINUTE, '1 h'],
      [65 * MINUTE, '1 h 5 min'],
      [null, 'Time not known yet'],
    ]
    for (const [from, text] of cases) expect(countdownText(from === null ? null : T0 + from, NOW), `${from} seconds`).toBe(text)
    // On the display, for our next match: Qual 3, expected 24 minutes from now.
    const next = (qual3: TbaMatch) => pitDisplay(input({ schedule: saved(SCHEDULE.with(2, qual3)) }), NOW).next
    expect(next(SCHEDULE[2])).toMatchObject({ countdown: '24 min', counting: true })
    expect(next(qm(3, [1, 2, 3], [4096, 5, 6], undefined, { predicted_time: T0 - MINUTE }))).toMatchObject({ countdown: 'Any minute now', counting: false })
    expect(next(qm(3, [1, 2, 3], [4096, 5, 6], undefined, { predicted_time: null }))).toMatchObject({ countdown: 'Time not known yet', counting: false })
  })

  it('says when a match is expected, with the day when it is not today', () => {
    const at = (iso: string) => Date.parse(iso) / 1000
    const cases: [time: number | null, text: string][] = [
      [T0 + 42 * MINUTE, '10:42 AM'],
      // Still Saturday in Chicago, though it's Sunday in UTC.
      [at('2026-03-15T04:00:00Z'), '11:00 PM'],
      [at('2026-03-15T14:00:00Z'), 'Sun 9:00 AM'],
      [null, 'Time not known yet'],
    ]
    for (const [time, text] of cases) expect(plain(clockTime(time, NOW, 'America/Chicago')), text).toBe(text)
  })

  it('counts how many matches away ours is, from the last match with a score', () => {
    const cases: [lastScored: number, away: number, awayText: string][] = [[9, 1, 'Up next'], [7, 3, '3 matches away'], [0, 10, '10 matches away']]
    for (const [lastScored, away, awayText] of cases) {
      expect(pitDisplay(input({ schedule: ourQual10(lastScored) }), NOW).next, `Qual ${lastScored} scored`).toMatchObject({ away, awayText })
    }
  })

  it('says Queue now at QUEUE_AT matches away or fewer', () => {
    const cases: [away: number, queueNow: boolean][] = [[QUEUE_AT + 1, false], [QUEUE_AT, true], [1, true]]
    for (const [away, queueNow] of cases) {
      expect(pitDisplay(input({ schedule: ourQual10(10 - away) }), NOW).next, `${away} away`).toMatchObject({ away, queueNow })
    }
  })

  it('says when there is no schedule yet, or we are not on it', () => {
    const show = (fields: Partial<PitDisplayInput>) => pitDisplay(input(fields), NOW)
    expect(show({ schedule: saved([]) })).toMatchObject({ next: null, comingUp: [], noMatch: { text: 'Schedule not out yet' } })
    // Nothing saved on this device: getting it, or why it couldn't.
    expect(show({}).noMatch).toEqual({ text: 'Getting the schedule…', note: null })
    expect(show({ status: { loading: true, problem: 'No connection.' } }).noMatch?.text).toBe('Getting the schedule…')
    expect(show({ status: { loading: false, problem: 'No connection.' } }).noMatch).toEqual({ text: 'No schedule on this device yet', note: expect.stringMatching(/No connection/) })
    expect(show({ schedule: saved([qm(1, [1, 2, 3], [4, 5, 6])]) }).noMatch?.text).toBe("4096 isn't on the schedule")
  })

  it('says "Quals done" after our last qual, with our rank, and shows playoff matches once The Blue Alliance has them', () => {
    const rankings = Array.from({ length: 42 }, (_, i) => ranking(i + 1, i === 5 ? 4096 : 9000 + i))
    const show = (matches: TbaMatch[]) => pitDisplay(input({ schedule: saved(matches), rankings }), NOW)
    const quals = [qm(1, [4096, 1, 2], [3, 4, 5], [84, 71]), qm(2, [1, 2, 3], [4096, 5, 6], [60, 50])]
    expect(show(quals)).toMatchObject({ next: null, noMatch: { text: 'Quals done', note: 'Rank 6 of 42 · 5-2-0' } })
    expect(show([...quals, sf(1, [7, 8, 9], [10, 11, 12])]).noMatch?.text).toBe('Quals done')
    // A playoff match of ours is next, and once it's played we wait for the next one.
    expect(show([...quals, sf(1, [4096, 1, 2], [3, 4, 5])])).toMatchObject({ next: { label: 'Semifinal 1' }, noMatch: null })
    expect(show([...quals, sf(1, [4096, 1, 2], [3, 4, 5], [90, 80], 'red')]).noMatch?.text).toBe('No match scheduled for us yet')
  })

  it('shows each team with its name, rank, record and rating, or "Not ranked yet" and "not rated"', () => {
    const schedule = saved([qm(1, [1, 4096, 2], [3, 4, 5])])
    const view = pitDisplay(input({
      schedule,
      rankings: [ranking(1, 4096), ranking(2, 1, null), ranking(3, 3)],
      ratings: [rating(4096, 48.6), rating(1, 41.7)],
      teams: [tbaTeam(4096, 'Ctrl-Z'), tbaTeam(1, 'Example Robotics')],
    }), NOW)
    expect(view.next?.ours).toEqual([
      { number: 4096, name: 'Ctrl-Z', standing: 'Rank 1 · 5-2-0', rating: '48.6 xP', us: true },
      { number: 1, name: 'Example Robotics', standing: 'Rank 2', rating: '41.7 xP', us: false },
      { number: 2, name: null, standing: 'Not ranked yet', rating: 'not rated', us: false },
    ])
    expect(view.next?.theirs.map((team) => [team.number, team.standing, team.rating])).toEqual([
      [3, 'Rank 3 · 5-2-0', 'not rated'], [4, 'Not ranked yet', 'not rated'], [5, 'Not ranked yet', 'not rated'],
    ])
    // With no team list saved on this device, no names.
    expect(pitDisplay(input({ schedule }), NOW).next?.ours.map((team) => team.name)).toEqual([null, null, null])
    // Statbotics' EPA when Match 13 sent no xP.
    expect(ratingText({ xpEnd: null, epa: 45.2 })).toBe('45.2 EPA')
  })

  it('shows our rank and record, and our last result with our score first', () => {
    const others = Array.from({ length: 41 }, (_, i) => ranking(i + 1, 9000 + i))
    const standing = (rankings: TbaRanking[]) => pitDisplay(input({ rankings }), NOW).standing
    expect(standing([...others, ranking(6, 4096)])).toBe('Rank 6 of 42 · 5-2-0')
    expect(standing([...others, ranking(6, 4096, null)])).toBe('Rank 6 of 42')
    expect(standing(others)).toBe('Not ranked yet')

    const cases: [matches: TbaMatch[], lastResult: string | null][] = [
      [[qm(1, [4096, 1, 2], [3, 4, 5], [84, 71])], 'Qual 1 · Won 84–71'],
      [[qm(1, [1, 2, 3], [4096, 5, 6], [90, 66])], 'Qual 1 · Lost 66–90'],
      [[qm(1, [4096, 1, 2], [3, 4, 5], [70, 70])], 'Qual 1 · Tied 70–70'],
      // The latest of ours with a score.
      [SCHEDULE, 'Qual 1 · Won 84–71'],
      [[...SCHEDULE.slice(0, 2), qm(3, [1, 2, 3], [4096, 5, 6], [90, 66])], 'Qual 3 · Lost 66–90'],
      // A playoff tie broken by a tiebreaker: The Blue Alliance says who won.
      [[sf(1, [3, 4, 5], [4096, 1, 2], [70, 70], 'blue')], 'Semifinal 1 · Won 70–70'],
      [[qm(1, [4096, 1, 2], [3, 4, 5])], null],
    ]
    for (const [matches, lastResult] of cases) expect(pitDisplay(input({ schedule: saved(matches) }), NOW).lastResult, String(lastResult)).toBe(lastResult)
  })

  it('lists our next few matches after this one, with when, our alliance and partners', () => {
    const matches = [2, 4, 6, 8, 10].map((n, i) => (i % 2 === 0 ? qm(n, [4096, 1, 2], [3, 4, 5]) : qm(n, [3, 4, 5], [6, 4096, 7])))
    const view = pitDisplay(input({ schedule: saved(matches) }), NOW)
    expect(view.next?.label).toBe('Qual 2')
    expect(view.comingUp[0]).toEqual({ key: '2026test_qm4', label: 'Qual 4', alliance: 'Blue', time: T0 + 4 * 8 * MINUTE, partners: [6, 7] })
    expect(view.comingUp.map((match) => match.label)).toEqual(['Qual 4', 'Qual 6', 'Qual 8', 'Qual 10'].slice(0, COMING_UP))
  })

  it('says how old the saved schedule is, and makes it stand out once it is too old to trust', () => {
    const savedAgo = (ms: number) => pitDisplay(input({ schedule: saved(SCHEDULE, new Date(NOW.getTime() - ms).toISOString()) }), NOW)
    expect(savedAgo(0)).toMatchObject({ updated: 'Updated just now', stale: false })
    expect(savedAgo(DISPLAY_STALE_MS)).toMatchObject({ updated: expect.stringMatching(/^Updated \d+ minutes ago$/), stale: false })
    expect(savedAgo(DISPLAY_STALE_MS + 60_000)).toMatchObject({ updated: expect.stringMatching(/^Updated \d+ minutes ago\. Times may be out of date: check this device's connection/), stale: true })
    // When the last try says why, it says that instead of blaming the connection.
    const failing = input({ schedule: saved(SCHEDULE, new Date(NOW.getTime() - DISPLAY_STALE_MS - 60_000).toISOString()), status: { loading: false, problem: 'The Blue Alliance is down.' } })
    expect(pitDisplay(failing, NOW).updated).toMatch(/Times may be out of date: The Blue Alliance is down/)
    expect(pitDisplay(input({}), NOW)).toMatchObject({ updated: null, stale: false })
  })

  it('says Ready, or how many checklist items are left, for a match', () => {
    const items = [item('1', ['a']), item('2', []), item('3', []), item('4', [])]
    const cases: [items: PitItem[], checks: PitCheck[], text: string][] = [
      [items, ['1', '2', '3', '4'].map((id) => check(id)), 'Ready'],
      [items, [check('1')], '3 of 4 checklist items left'],
      [[item('1', [])], [], '1 of 1 checklist item left'],
      [[], [], 'No checklist items yet'],
    ]
    for (const [list, checks, text] of cases) expect(readyText(matchProgress(list, checks, 'm1'))).toBe(text)
  })

  it('keeps the schedule, Match 13 ratings and team names up to date while open, until it closes', async () => {
    vi.useFakeTimers({ now: NOW })
    // A stand-in for the browser's window, which the tests don't have.
    const page = new EventTarget()
    vi.stubGlobal('addEventListener', page.addEventListener.bind(page))
    vi.stubGlobal('removeEventListener', page.removeEventListener.bind(page))
    resetRatings()
    eventTeamsStore.reset()
    const loaded = () => ({ schedule: savedSchedule(EVENT_KEY)?.savedAt, ratings: ratingsStore.get().loadedAt, names: savedEventTeams(EVENT_KEY)?.savedAt })

    const stop = keepPitDisplayFresh(EVENT_KEY)
    await vi.advanceTimersByTimeAsync(0)
    expect(loaded()).toEqual({ schedule: '2026-03-14T15:00:00.000Z', ratings: null, names: '2026-03-14T15:00:00.000Z' })

    // Match 13's ratings every 5 minutes (and the schedule every 2).
    await vi.advanceTimersByTimeAsync(STALE_MS)
    expect(loaded()).toEqual({ schedule: '2026-03-14T15:04:00.000Z', ratings: '2026-03-14T15:05:00.000Z', names: '2026-03-14T15:00:00.000Z' })

    // The team names again when the device is back online.
    page.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(loaded().names).toBe('2026-03-14T15:05:00.000Z')

    stop()
    const before = loaded()
    await vi.advanceTimersByTimeAsync(2 * STALE_MS)
    page.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(loaded()).toEqual(before)
    resetRatings()
    eventTeamsStore.reset()
  })

  /** A stand-in for the browser's Screen Wake Lock API and document, which the tests don't have. */
  function fakeWakeLock(refuse = false) {
    interface FakeLock { type: string; released: boolean; release: () => Promise<void> }
    const locks: FakeLock[] = []
    const request = vi.fn(async (type: string) => {
      if (refuse) throw new DOMException('Battery saver is on.', 'NotAllowedError')
      const lock: FakeLock = { type, released: false, release: async () => { lock.released = true } }
      locks.push(lock)
      return lock
    })
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    vi.stubGlobal('navigator', { wakeLock: { request } })
    vi.stubGlobal('document', doc)
    const show = (state: 'visible' | 'hidden') => {
      doc.visibilityState = state
      doc.dispatchEvent(new Event('visibilitychange'))
    }
    return { request, locks, show }
  }
  /** Let the browser's answers arrive. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('keeps the screen on while open, asks again when back on screen, and lets go when it closes', async () => {
    const { request, locks, show } = fakeWakeLock()
    const stop = keepScreenAwake()
    await settle()
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('screen')

    // Hidden, the browser lets go, and it isn't asked for. Back on screen, it's asked for again.
    locks[0].released = true
    show('hidden')
    await settle()
    expect(request).toHaveBeenCalledTimes(1)
    show('visible')
    await settle()
    expect(request).toHaveBeenCalledTimes(2)
    // While it's held, there's no need to ask.
    show('visible')
    await settle()
    expect(request).toHaveBeenCalledTimes(2)

    // Closing the page lets go, and it stops asking.
    stop()
    expect(locks[1].released).toBe(true)
    show('visible')
    await settle()
    expect(request).toHaveBeenCalledTimes(2)

    // Closed before the browser answered (React does this once in development): it lets go when the answer comes.
    keepScreenAwake()()
    await settle()
    expect(locks[2].released).toBe(true)
  })

  it('carries on where the browser has no wake lock, or says no', async () => {
    vi.stubGlobal('navigator', {})
    expect(() => keepScreenAwake()()).not.toThrow()

    const { request, show } = fakeWakeLock(true)
    const stop = keepScreenAwake()
    await settle()
    expect(request).toHaveBeenCalledTimes(1)
    // It tries again next time the page is back on screen.
    show('visible')
    await settle()
    expect(request).toHaveBeenCalledTimes(2)
    stop()
  })
})
