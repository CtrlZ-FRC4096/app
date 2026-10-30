// Tests for data.ts, in demo mode on the example data. Who can see and
// change attendance is tested in supabase/tests/attendance.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { setDemoRole } from '../../core/demo'
import { membersTable } from '../../core/members'
import {
  addCheck,
  cancelRequest,
  countingFor,
  decideRequest,
  findMyPerson,
  requestHours,
  requestsTable,
  sortRows,
  useAttendanceAttention,
  useAttendanceSummary,
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
import { dayLabel, teamInstant } from './time'
import type { ParsedDay, SlackUser } from './slack-export'

beforeEach(() => {
  peopleTable.reset()
  checksTable.reset()
  rsvpsTable.reset()
  periodsTable.reset()
  requestsTable.reset()
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
    expect(rows[0]).toEqual(['Name', 'Points', 'Hours', 'Days here', '2026-01-06', '2026-01-08', '2026-01-10', '2026-01-13', '2026-01-15'])
    // Alex: 12 points; 2.42 + 2.75 + 2.22 hours over the 3 days with a check-out.
    expect(rows.find((r) => r[0] === 'Alex Rivera')).toEqual(['Alex Rivera', '12', '7.38', '3', '3', '3', '1', '3', '-1'])
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

describe('sorting', () => {
  const names = (by: Parameters<typeof sortRows>[1]) => sortRows(report().rows, by).map((r) => r.person.name)

  it('puts the most first for points, hours and days here, and names A to Z', () => {
    const rows = report().rows
    for (const by of ['points', 'hours', 'days'] as const) {
      const value = (r: (typeof rows)[number]) => (by === 'points' ? r.points : by === 'hours' ? r.hours : r.daysPresent)
      const sorted = sortRows(rows, by)
      for (let i = 1; i < sorted.length; i++) expect(value(sorted[i - 1])).toBeGreaterThanOrEqual(value(sorted[i]))
    }
    expect(names('name')).toEqual([...names('name')].sort((a, b) => a.localeCompare(b)))
  })

  it('sorts by hours differently from points', () => {
    // Without hidden people, as the sheets open. Casey has the most of both; Jordan
    // is fourth on points (9) but second on hours (7.8).
    const shown = buildReport(peopleTable.rows().filter((p) => !p.hidden), checksTable.rows(), rsvpsTable.rows()).rows
    expect(sortRows(shown, 'points').slice(0, 3).map((r) => r.person.name)).toEqual(['Casey Nguyen', 'Alex Rivera', 'Sam Ortiz'])
    expect(sortRows(shown, 'hours').slice(0, 3).map((r) => r.person.name)).toEqual(['Casey Nguyen', 'Jordan Kim', 'Alex Rivera'])
  })
})

describe('your own attendance', () => {
  afterEach(() => setDemoRole('student'))

  it('finds your attendance by your Slack account', () => {
    const members = membersTable.rows()
    const alex = members.find((m) => m.name === 'Alex Rivera')!
    const morgan = members.find((m) => m.name === 'Morgan Lee')!
    expect(findMyPerson(peopleTable.rows(), members, alex.id)?.name).toBe('Alex Rivera')
    // Morgan has never checked in, so there's nothing to find.
    expect(findMyPerson(peopleTable.rows(), members, morgan.id)).toBeNull()
    expect(findMyPerson(peopleTable.rows(), members, 'not-a-member')).toBeNull()
  })

  it("gives everyone the same numbers from their own rows as the mentors' sheets show", () => {
    for (const range of [{}, { from: '2026-01-10' }]) {
      const team = buildReport(peopleTable.rows(), checksTable.rows(), rsvpsTable.rows(), range)
      for (const row of team.rows) {
        const own = buildReport(
          [row.person],
          checksTable.rows().filter((c) => c.person_id === row.person.id),
          rsvpsTable.rows().filter((r) => r.person_id === row.person.id),
          range,
        ).rows[0]
        expect([own.points, own.hours, own.daysPresent]).toEqual([row.points, row.hours, row.daysPresent])
      }
    }
  })

  const home = (hook: () => string) => renderToString(createElement(() => createElement('p', null, hook())))

  it("shows students their own points and hours this period on the home page, and nobody else's", () => {
    setDemoRole('student')
    // Alex, in the 2026 build season: 6 points, and 2.2 hours (Jan 13; Jan 15 has no check-out).
    expect(home(() => useAttendanceSummary('student').text)).toBe('<p>You: 6 points · 2.2 hours</p>')
    expect(home(() => useAttendanceAttention('student').map((n) => n.text).join(' | '))).toBe(
      `<p>You didn&#x27;t check out on ${dayLabel('2026-01-15')}. Ask a mentor to add your check-out so your hours count.</p>`,
    )
  })

  it('still shows mentors how many came to the last meeting', () => {
    setDemoRole('mentor')
    expect(home(() => useAttendanceSummary('mentor').text)).toMatch(/^<p>\d+ at /)
  })
})

describe('requests for missing hours', () => {
  afterEach(() => setDemoRole('student'))
  const request = (name: string) => requestsTable.rows().find((r) => r.person_id === person(name).id && r.status === 'pending')!
  const season = (name: string) => buildReport(peopleTable.rows(), checksTable.rows(), rsvpsTable.rows(), { from: '2026-01-10' }).rows.find((r) => r.person.name === name)!

  it('lets people ask about a day, once at a time', async () => {
    const asked = await requestHours(person('Alex Rivera'), { day: '2026-01-13', inClock: '', outClock: '20:45', note: ' Left late ' })
    expect(asked.ok && asked.value).toMatchObject({ day: '2026-01-13', in_at: null, out_at: teamInstant('2026-01-13', '20:45'), note: 'Left late', status: 'pending' })
    // Alex already has one waiting for Jan 15.
    expect(await requestHours(person('Alex Rivera'), { day: '2026-01-15', inClock: '', outClock: '20:40', note: 'Again' })).toEqual({
      ok: false,
      error: `You already asked about ${dayLabel('2026-01-15')}. Take that request back first to change it.`,
    })
    expect(await requestHours(person('Alex Rivera'), { day: '2026-01-14', inClock: '', outClock: '', note: 'x' })).toMatchObject({ ok: false })
  })

  it('lets people take back a waiting request, but not a decided one', async () => {
    expect(await cancelRequest(request('Alex Rivera'))).toEqual({ ok: true, value: null })
    const declined = requestsTable.rows().find((r) => r.status === 'declined')!
    expect(await cancelRequest(declined)).toEqual({ ok: false, error: 'A mentor already decided that one.' })
  })

  it("adds the hours when a mentor approves, so the person's points update", async () => {
    // Alex forgot to check out on Jan 15: −1 that day, so 6 points this season.
    expect(season('Alex Rivera').points).toBe(6)
    setDemoRole('mentor')
    const approved = await decideRequest(request('Alex Rivera'), true)
    expect(approved.ok && approved.value).toMatchObject({ status: 'approved', decided_by: expect.any(String) })
    // 18:10 to 20:40 is a full session: 3 points instead of −1.
    expect(season('Alex Rivera').points).toBe(10)
    expect(season('Alex Rivera').hours).toBeCloseTo(2.2167 + 2.5, 3)
  })

  it('adds nothing when a mentor declines, and decides only once', async () => {
    setDemoRole('admin')
    const before = checksTable.rows().length
    const jordan = request('Jordan Kim')
    expect(await decideRequest(jordan, false)).toMatchObject({ ok: true, value: { status: 'declined' } })
    expect(checksTable.rows()).toHaveLength(before)
    const again = requestsTable.rows().find((r) => r.id === jordan.id)!
    expect(await decideRequest(again, true)).toEqual({ ok: false, error: 'That request was already declined.' })
  })

  it("doesn't let students approve", async () => {
    expect(await decideRequest(request('Alex Rivera'), true)).toEqual({ ok: false, error: 'Only mentors and admins can approve requests.' })
  })
})

describe('which dates are counted', () => {
  afterEach(() => setDemoRole('student'))

  it('lets only mentors and admins pick them; everyone else sees the period that includes today', () => {
    expect(countingFor('mentor', { kind: 'all' })).toEqual({ kind: 'all' })
    expect(countingFor('admin', { kind: 'custom', from: '2026-01-01', to: '' })).toEqual({ kind: 'custom', from: '2026-01-01', to: '' })
    expect(countingFor('student', { kind: 'all' })).toBeNull()
  })

  it('shows the date controls to mentors and admins only', async () => {
    const { default: AttendancePage } = await import('./AttendancePage')
    setDemoRole('student')
    const student = renderToString(createElement(AttendancePage))
    expect(student).not.toContain('Count points over')
    expect(student).toContain('2026 build season')
    setDemoRole('mentor')
    expect(renderToString(createElement(AttendancePage))).toContain('Count points over')
  })
})
