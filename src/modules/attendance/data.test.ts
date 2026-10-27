// Tests for data.ts, in demo mode on the example data. Who can see and
// change attendance is tested in supabase/tests/attendance.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addCheck,
  applyImport,
  checksTable,
  peopleTable,
  planImport,
  removeCheck,
  restoreCheck,
  rsvpsTable,
  setRsvp,
  sheetRows,
  toCsv,
} from './data'
import { buildReport } from './points'
import { teamInstant } from './time'
import type { ParsedDay, SlackUser } from './slack-export'

beforeEach(() => {
  peopleTable.reset()
  checksTable.reset()
  rsvpsTable.reset()
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
