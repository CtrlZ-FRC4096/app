// Tests for data.ts, in demo mode on the example data. Who can see and
// change attendance is tested in supabase/tests/attendance.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addCheck,
  applyImport,
  checksTable,
  peopleTable,
  periodsTable,
  planImport,
  removeCheck,
  removePeriod,
  restoreCheck,
  rsvpsTable,
  savePeriod,
  setRsvp,
  sheetRows,
  toCsv,
} from './data'
import { buildReport } from './points'
import { countRange } from './periods'
import { teamInstant } from './time'
import type { ParsedDay, SlackUser } from './slack-export'

beforeEach(() => {
  peopleTable.reset()
  checksTable.reset()
  rsvpsTable.reset()
  periodsTable.reset()
})

const existing = () => ({ people: peopleTable.rows(), checks: checksTable.rows(), rsvps: rsvpsTable.rows() })
const person = (name: string) => peopleTable.rows().find((p) => p.name === name)!
const report = () => buildReport(peopleTable.rows(), checksTable.rows(), rsvpsTable.rows())

describe('the example data', () => {
  it('scores each example person the way the old spreadsheet would', () => {
    const points = Object.fromEntries(report().rows.map((r) => [r.person.name, r.points]))
    // Alex: 3 + 3 + 1 + 3, then −1 on Jan 15 (said yes, checked in, never out: no hours yet), + base 3.
    expect(points['Alex Rivera']).toBe(12)
    // Taylor: −1 − 1 + 1 + 1 + 0 + base 3.
    expect(points['Taylor Brooks']).toBe(3)
  })
})

describe('fixing things by hand', () => {
  it('adds a missed check-out, so the hours count', async () => {
    const alex = person('Alex Rivera')
    expect(report().rows.find((r) => r.person.id === alex.id)?.days.get('2026-01-15')?.hours).toBeNull()
    expect((await addCheck(alex.id, '2026-01-15', '20:40', 'out')).ok).toBe(true)
    expect(report().rows.find((r) => r.person.id === alex.id)?.days.get('2026-01-15')?.hours).toBeCloseTo(2.5)
  })

  it('refuses a time that isn’t a time, and the same check twice', async () => {
    const alex = person('Alex Rivera')
    expect(await addCheck(alex.id, '2026-01-15', '8pm', 'out')).toEqual({ ok: false, error: 'Enter a time like 18:30.' })
    expect((await addCheck(alex.id, '2026-01-15', '18:10', 'in')).ok).toBe(false)
  })

  it('ignores an imported check instead of deleting it, and can bring it back', async () => {
    const check = checksTable.rows().find((c) => c.source === 'jibble')!
    await removeCheck(check)
    expect(checksTable.rows().find((c) => c.id === check.id)?.ignored).toBe(true)
    await restoreCheck({ ...check, ignored: true })
    expect(checksTable.rows().find((c) => c.id === check.id)?.ignored).toBe(false)
  })

  it('deletes a check a mentor added by hand', async () => {
    const added = await addCheck(person('Sam Ortiz').id, '2026-01-10', '12:00', 'in')
    if (!added.ok) throw new Error(added.error)
    await removeCheck(added.value)
    expect(checksTable.rows().some((c) => c.id === added.value.id)).toBe(false)
  })

  it('sets, changes and clears an RSVP by hand', async () => {
    const quinn = person('Quinn Patel')
    await setRsvp(quinn.id, '2026-01-13', 'yes')
    expect(rsvpsTable.rows().find((r) => r.person_id === quinn.id)).toMatchObject({ coming: true, source: 'manual' })
    await setRsvp(quinn.id, '2026-01-13', null)
    expect(rsvpsTable.rows().some((r) => r.person_id === quinn.id)).toBe(false)
  })
})

describe('importing a Slack export', () => {
  const users: SlackUser[] = [
    { id: 'U0DEMO0001', name: 'Alex Rivera', deleted: false, bot: false },
    { id: 'U0NEW00001', name: 'Drew Morgan', deleted: false, bot: false },
  ]
  const day = (clockIn: string, clockOut: string): ParsedDay => ({
    checks: [
      { name: 'Drew Morgan', slackUserId: null, direction: 'in', at: teamInstant('2026-01-20', clockIn) },
      { name: 'Drew Morgan', slackUserId: null, direction: 'out', at: teamInstant('2026-01-20', clockOut) },
      { name: 'Someone Unknown', slackUserId: null, direction: 'in', at: teamInstant('2026-01-20', clockIn) },
    ],
    polls: [{ at: teamInstant('2026-01-20', '09:00'), yes: ['U0NEW00001'], no: ['U0DEMO0001'] }],
  })

  it('plans new people, check-ins and answers, and flags names it couldn’t match', () => {
    const plan = planImport(users, [day('18:00', '20:00')], existing())
    expect(plan.newPeople.map((p) => p.name).sort()).toEqual(['Drew Morgan', 'Someone Unknown'])
    expect(plan.newChecks).toHaveLength(3)
    expect(plan.newRsvps).toHaveLength(2)
    expect(plan.unmatched).toEqual(['Someone Unknown'])
    expect(plan.days).toBe(1)
  })

  it('adds nothing the second time the same export is imported', async () => {
    const first = await applyImport(planImport(users, [day('18:00', '20:00')], existing()))
    expect(first.ok).toBe(true)
    const again = planImport(users, [day('18:00', '20:00')], existing())
    expect([again.newPeople.length, again.newChecks.length, again.newRsvps.length, again.changedRsvps.length]).toEqual([0, 0, 0, 0])
    expect(again.alreadyThere).toBe(3)
  })

  it('updates changed poll answers, but never one a mentor set by hand', async () => {
    await applyImport(planImport(users, [day('18:00', '20:00')], existing()))
    const alex = person('Alex Rivera')
    await setRsvp(alex.id, '2026-01-20', 'yes')
    const changed: ParsedDay = { checks: [], polls: [{ at: teamInstant('2026-01-20', '10:00'), yes: ['U0DEMO0001'], no: ['U0NEW00001'] }] }
    const plan = planImport(users, [changed], existing())
    expect(plan.changedRsvps).toHaveLength(1)
    expect(plan.keptManual).toBe(0)
    const flipped: ParsedDay = { checks: [], polls: [{ at: teamInstant('2026-01-20', '11:00'), yes: [], no: ['U0DEMO0001'] }] }
    expect(planImport(users, [flipped], existing()).keptManual).toBe(1)
  })

  it('keeps an ignored check-in ignored when importing again', async () => {
    await applyImport(planImport(users, [day('18:00', '20:00')], existing()))
    const check = checksTable.rows().find((c) => Date.parse(c.at) === Date.parse(teamInstant('2026-01-20', '20:00')))!
    await removeCheck(check)
    expect(planImport(users, [day('18:00', '20:00')], existing()).newChecks).toHaveLength(0)
  })
})

describe('downloads', () => {
  it('makes a points sheet with a row per person and a column per meeting day', () => {
    const rows = sheetRows(report(), 'points')
    expect(rows[0]).toEqual(['Name', 'Total', '2026-01-06', '2026-01-08', '2026-01-10', '2026-01-13', '2026-01-15'])
    expect(rows.find((r) => r[0] === 'Alex Rivera')).toEqual(['Alex Rivera', '12', '3', '3', '1', '3', '-1'])
  })

  it('writes CSV that spreadsheets open safely', () => {
    expect(toCsv([['Name', 'Note'], ['=cmd()', 'a, "b"'], ['Ann', '-1']])).toBe('Name,Note\r\n\'=cmd(),"a, ""b"""\r\nAnn,-1\r\n')
  })
})

describe('points periods', () => {
  const period = (name: string) => periodsTable.rows().find((p) => p.name === name)!

  it('counts only the meetings in a period, starting everyone again from the base points', () => {
    const build = period('2026 build season')
    const { from, to } = countRange({ kind: 'period', id: build.id }, periodsTable.rows(), '2026-02-01')
    const season = buildReport(peopleTable.rows(), checksTable.rows(), rsvpsTable.rows(), { from, to })
    expect(season.days).toEqual(['2026-01-10', '2026-01-13', '2026-01-15'])
    // Alex: +1 on Jan 10 (said no, didn't come), +3, then −1 on Jan 15 (never checked out), + base 3. Jan 6 and 8 don't count.
    expect(season.rows.find((r) => r.person.name === 'Alex Rivera')?.points).toBe(6)
  })

  it('opens on the period that includes today', () => {
    expect(countRange(null, periodsTable.rows(), '2026-01-08').period?.name).toBe('2026 preseason')
    expect(countRange(null, periodsTable.rows(), '2026-10-27').period?.name).toBe('2026 build season')
  })

  it('saves, changes and removes a period', async () => {
    const added = await savePeriod({ name: '  2026 offseason ', first_day: '2026-05-01', last_day: null })
    expect(added.ok && added.value).toMatchObject({ name: '2026 offseason', first_day: '2026-05-01', last_day: null })
    const id = period('2026 offseason').id
    expect((await savePeriod({ name: '2026 offseason', first_day: '2026-05-01', last_day: '2026-12-20' }, id)).ok).toBe(true)
    expect(period('2026 offseason').last_day).toBe('2026-12-20')
    expect((await removePeriod(id)).ok).toBe(true)
    expect(periodsTable.rows().map((p) => p.name)).toEqual(['2026 build season', '2026 preseason'])
  })

  it('refuses a period without a name or first day, ending before it starts, or named like another', async () => {
    const error = async (fields: { name: string; first_day: string; last_day: string | null }, id?: string) => {
      const result = await savePeriod(fields, id)
      return result.ok ? null : result.error
    }
    expect(await error({ name: ' ', first_day: '2026-05-01', last_day: null })).toMatch(/name/)
    expect(await error({ name: 'Fall', first_day: '', last_day: null })).toMatch(/first day/)
    expect(await error({ name: 'Fall', first_day: '2026-09-01', last_day: '2026-08-01' })).toMatch(/before the first day/)
    expect(await error({ name: '2026 BUILD SEASON', first_day: '2026-09-01', last_day: null })).toMatch(/already a period/)
    // Keeping its own name while changing its dates is fine.
    const build = period('2026 build season')
    expect(await error({ name: '2026 build season', first_day: '2026-01-10', last_day: '2026-04-18' }, build.id)).toBeNull()
  })
})
