// Tests for data.ts. Run them with `npm test`. They run in demo mode, as the
// made-up student unless a test views the app as a mentor. Who may do what is
// the database's job: that's tested in supabase/tests/batteries.test.ts.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setDemoRole } from '../../core/demo'
import {
  STATUSES, TIRED_RESISTANCE_OHMS, addBattery, ago, batteriesTable, changeBattery, checkBattery, checkReading, describeEntry, findBatteries,
  groupByStatus, historyFor, isTired, latestReading, logTable, matchLabel, matchesFor, moveToNext, nextMatch, nextStatus, nextUp, recordReading,
  removeBattery, suggestMatch, useBatterySummary, type Battery,
} from './data'
import { getSchedule, type TbaMatch } from '../scouting/data'

/** Runs a hook the way a page would, and gives back what it returned. */
function runHook<T>(hook: () => T): T {
  let value: T | undefined
  function Component() {
    value = hook()
    return null
  }
  renderToString(createElement(Component))
  return value as T
}

const byName = (name: string) => batteriesTable.rows().find((b) => b.name === name)!
const battery = (name: string, status: string, changedAt: string, retired = false): Battery => ({
  ...batteriesTable.rows()[0], id: name, name, status, status_changed_at: changedAt, retired,
})

beforeEach(() => {
  batteriesTable.reset()
  logTable.reset()
})
afterEach(() => setDemoRole('student'))

describe('the status order', () => {
  it('starts with Charged, and goes round the pit cycle', () => {
    expect(STATUSES.map((s) => s.name)).toEqual(['Charged', 'In the robot', 'Needs charging', 'Charging', 'Resting'])
    expect(nextStatus('Needs charging')).toBe('Charging')
    expect(nextStatus('Charging')).toBe('Resting')
    expect(nextStatus('Resting')).toBe('Charged')
    expect(nextStatus('Charged')).toBe('In the robot')
    expect(nextStatus('In the robot')).toBe('Needs charging')
  })

  it('sends a battery with an old status to Needs charging, so it gets checked', () => {
    expect(nextStatus('On the cart')).toBe('Needs charging')
  })
})

describe('groupByStatus', () => {
  it('groups batteries in use by status, Charged first, with every status shown', () => {
    const groups = groupByStatus(batteriesTable.rows())
    expect(groups.map((g) => g.status)).toEqual(STATUSES.map((s) => s.name))
    expect(groups[0].batteries.map((b) => b.name)).toEqual(['2026-8', '2026-1', '2026-2'])
  })

  it('puts the battery longest in its status first, and leaves out retired ones', () => {
    const groups = groupByStatus([
      battery('A', 'Charged', '2026-11-10T12:00:00Z'),
      battery('B', 'Charged', '2026-11-10T10:00:00Z'),
      battery('Old', 'Charged', '2026-01-01T10:00:00Z', true),
    ])
    expect(groups[0].batteries.map((b) => b.name)).toEqual(['B', 'A'])
  })

  it('still shows a battery whose status is no longer in the list, at the end', () => {
    const groups = groupByStatus([battery('A', 'On the cart', '2026-11-10T12:00:00Z')])
    expect(groups.at(-1)).toMatchObject({ status: 'On the cart', hint: '', batteries: [{ name: 'A' }] })
    expect(groups.find((g) => g.status === 'Charged')!.batteries).toEqual([])
  })
})

describe('ago', () => {
  const now = new Date('2026-11-10T12:00:00Z')
  it('says how long ago, plainly', () => {
    expect(ago('2026-11-10T11:59:40Z', now)).toBe('just now')
    expect(ago('2026-11-10T11:59:00Z', now)).toBe('1 minute ago')
    expect(ago('2026-11-10T11:15:00Z', now)).toBe('45 minutes ago')
    expect(ago('2026-11-10T10:00:00Z', now)).toBe('2 hours ago')
    expect(ago('2026-11-07T12:00:00Z', now)).toBe('3 days ago')
  })
})

describe('moveToNext', () => {
  it('lets a student move a battery to its next status, and records when', async () => {
    const before = Date.now()
    const result = await moveToNext(byName('2026-4'))
    expect(result).toMatchObject({ ok: true, value: { status: 'Charging' } })
    expect(Date.parse(byName('2026-4').status_changed_at)).toBeGreaterThanOrEqual(before)
  })

  it('adds the change to the battery’s history', async () => {
    await moveToNext(byName('2026-4'))
    expect(historyFor(byName('2026-4').id, logTable.rows())[0]).toMatchObject({ kind: 'status', status: 'Charging', match: null })
  })

  it('keeps which match a battery went in the robot for', async () => {
    await moveToNext(byName('2026-1'), ' Qual 12 ')
    expect(matchesFor(byName('2026-1').id, logTable.rows()).map((m) => m.match)).toEqual(['Qual 12', 'Practice 4'])
  })

  it('ignores a match for any other status', async () => {
    await moveToNext(byName('2026-4'), 'Qual 12')
    expect(historyFor(byName('2026-4').id, logTable.rows())[0].match).toBeNull()
  })

  it('refuses a match name that is too long', async () => {
    expect((await moveToNext(byName('2026-1'), 'x'.repeat(41))).ok).toBe(false)
    expect(byName('2026-1').status).toBe('Charged')
  })
})

describe('readings and tired batteries', () => {
  const reading = (minutes: number, resistance_ohms: number | null, voltage: number | null = 12.9) => ({
    ...logTable.rows()[0], id: `r${minutes}`, battery_id: 'b', kind: 'reading' as const, status: null, match: null,
    voltage, resistance_ohms, created_at: new Date(Date.UTC(2026, 10, 10, 12, 0) - minutes * 60_000).toISOString(),
  })

  it('is tired only above the limit, not exactly at it', () => {
    expect(isTired('b', [reading(5, TIRED_RESISTANCE_OHMS + 0.001)])).toBe(true)
    expect(isTired('b', [reading(5, TIRED_RESISTANCE_OHMS)])).toBe(false)
    expect(isTired('b', [])).toBe(false)
  })

  it('goes by the latest internal resistance reading, even if a newer one only has the voltage', () => {
    expect(isTired('b', [reading(5, null), reading(60, 0.03), reading(120, 0.012)])).toBe(true)
    expect(isTired('b', [reading(5, 0.012), reading(60, 0.03)])).toBe(false)
  })

  it('finds the latest reading, and writes it plainly', () => {
    const latest = latestReading(byName('2026-8').id, logTable.rows())!
    expect(describeEntry(latest)).toBe('Reading: 12.8 V, 0.024 Ω')
    expect(latestReading(byName('2026-2').id, logTable.rows())).toBeNull()
  })

  it('checks a reading before saving it, and says what to fix', () => {
    expect(checkReading(12.9, 0.015)).toBeNull()
    expect(checkReading(12.9, null)).toBeNull()
    expect(checkReading(null, null)).toMatch(/Enter the voltage/)
    expect(checkReading(Number.NaN, null)).toMatch(/Check the voltage/)
    expect(checkReading(null, 15)).toMatch(/divide by 1000/)
  })

  it('lets a student record a reading, which can make a battery tired', async () => {
    expect(isTired(byName('2026-2').id, logTable.rows())).toBe(false)
    expect((await recordReading(byName('2026-2'), 12.7, 0.03)).ok).toBe(true)
    expect(isTired(byName('2026-2').id, logTable.rows())).toBe(true)
  })
})

describe('nextUp', () => {
  it('suggests the battery charged longest, leaving out tired ones', () => {
    // 2026-8 has been Charged longest, but reads tired.
    expect(isTired(byName('2026-8').id, logTable.rows())).toBe(true)
    expect(nextUp(batteriesTable.rows(), logTable.rows())?.name).toBe('2026-1')
  })

  it('suggests nothing when no charged battery is fresh', () => {
    const charged = batteriesTable.rows().filter((b) => b.status === 'Charged')
    expect(nextUp(charged.filter((b) => b.name === '2026-8'), logTable.rows())).toBeNull()
  })
})

describe('which match', () => {
  const match = (more: Partial<TbaMatch>): TbaMatch => ({
    key: 'x', comp_level: 'qm', set_number: 1, match_number: 1, winning_alliance: '', predicted_time: null,
    alliances: { red: { score: -1, team_keys: ['frc4096'] }, blue: { score: -1, team_keys: [] } }, ...more,
  })

  it('names matches the way the team says them', () => {
    expect(matchLabel(match({ match_number: 12 }))).toBe('Qual 12')
    expect(matchLabel(match({ comp_level: 'sf', set_number: 2, match_number: 1 }))).toBe('SF 2-1')
  })

  it("finds our next match that hasn't been played", async () => {
    const schedule = await getSchedule()
    if (!schedule.ok) throw new Error(schedule.error)
    expect(nextMatch(schedule.value)).toBe('Qual 3')
    expect(nextMatch(schedule.value, 1234)).toBeNull()
    expect(await suggestMatch()).toBe('Qual 3')
  })
})

describe('findBatteries', () => {
  it('finds a battery by the number on it, ignoring case and spaces', () => {
    expect(findBatteries(batteriesTable.rows(), ' 2026 - 3').map((b) => b.name)).toEqual(['2026-3'])
    expect(findBatteries(batteriesTable.rows(), '').length).toBe(batteriesTable.rows().length)
  })
})

describe('useBatterySummary', () => {
  it('says how many are charged and charging, leaving out retired ones', () => {
    expect(runHook(useBatterySummary)).toEqual({ tone: 'ok', text: '3 charged · 2 charging' })
  })

  it('warns when none are charged', async () => {
    for (const name of ['2026-1', '2026-2', '2026-8']) await batteriesTable.update(byName(name).id, { status: 'In the robot' })
    expect(runHook(useBatterySummary)).toEqual({ tone: 'warn', text: '0 charged · 2 charging' })
  })

  it('says so when there are no batteries', async () => {
    for (const b of batteriesTable.rows()) await batteriesTable.remove(b.id)
    expect(runHook(useBatterySummary)).toEqual({ tone: 'plain', text: 'No batteries yet' })
  })
})

describe('checkBattery', () => {
  it('needs a number on the battery, and a new one', () => {
    expect(checkBattery({ name: ' 2026-9 ', notes: '' }, batteriesTable.rows())).toBeNull()
    expect(checkBattery({ name: '  ', notes: '' }, batteriesTable.rows())).toMatch(/Enter the number/)
    expect(checkBattery({ name: '2026-3', notes: '' }, batteriesTable.rows())).toBe("There's already a battery called 2026-3. Give this one a different number.")
    expect(checkBattery({ name: '2024-5', notes: '' }, batteriesTable.rows())).toMatch(/2024-5 \(retired\)/)
  })

  it("doesn't count the battery being changed as taking its own number", () => {
    expect(checkBattery({ name: '2026-3', notes: 'New note' }, batteriesTable.rows(), byName('2026-3').id)).toBeNull()
  })

  it('refuses notes that are too long', () => {
    expect(checkBattery({ name: '2026-9', notes: 'x'.repeat(501) }, batteriesTable.rows())).toMatch(/under 500/)
  })
})

describe('adding, changing and deleting batteries', () => {
  it("doesn't let a student, and says who can", async () => {
    const count = batteriesTable.rows().length
    expect(await addBattery({ name: '2026-9', notes: '' })).toEqual({ ok: false, error: expect.stringMatching(/Only mentors and admins/) })
    expect((await changeBattery(byName('2026-1'), { name: '2026-1', notes: '', retired: true })).ok).toBe(false)
    expect((await removeBattery(byName('2026-1'))).ok).toBe(false)
    expect(batteriesTable.rows()).toHaveLength(count)
    expect(byName('2026-1').retired).toBe(false)
  })

  it('lets a mentor add a battery, Charged to start with', async () => {
    setDemoRole('mentor')
    expect(await addBattery({ name: ' 2026-9 ', notes: ' New ' })).toMatchObject({ ok: true, value: { name: '2026-9', notes: 'New', status: 'Charged', retired: false } })
  })

  it('lets a mentor rename and retire a battery', async () => {
    setDemoRole('mentor')
    expect((await changeBattery(byName('2026-1'), { name: '2026-10', notes: 'Weak', retired: true })).ok).toBe(true)
    expect(byName('2026-10')).toMatchObject({ notes: 'Weak', retired: true })
  })

  it('lets a mentor delete a battery', async () => {
    setDemoRole('mentor')
    const count = batteriesTable.rows().length
    expect((await removeBattery(byName('2026-1'))).ok).toBe(true)
    expect(batteriesTable.rows()).toHaveLength(count - 1)
  })
})
