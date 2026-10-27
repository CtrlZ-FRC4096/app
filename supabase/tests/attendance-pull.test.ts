// The database side of the automatic pull from Slack (private.import_attendance).
import { describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()

const payload = (extra: object = {}) => ({
  newest_message_at: '2026-01-21T02:40:00Z',
  people: [
    { slack_user_id: 'U0DREW', name: 'Drew Morgan' },
    { slack_user_id: 'U0ALEX', name: 'Alex Rivera' },
    { slack_user_id: null, name: 'Mystery Person' },
  ],
  checks: [
    { slack_user_id: 'U0DREW', name: 'Drew Morgan', direction: 'in', at: '2026-01-21T00:05:00Z' },
    { slack_user_id: 'U0DREW', name: 'Drew Morgan', direction: 'out', at: '2026-01-21T02:40:00Z' },
    { slack_user_id: null, name: 'Mystery Person', direction: 'in', at: '2026-01-21T00:10:00Z' },
  ],
  rsvps: [
    { slack_user_id: 'U0DREW', day: '2026-01-20', coming: true },
    { slack_user_id: 'U0ALEX', day: '2026-01-20', coming: false },
  ],
  ...extra,
})

const pull = async (body: object) =>
  (await db.sql<{ people_added: number; checks_added: number; rsvps_changed: number }>(
    'select people_added, checks_added, rsvps_changed from private.import_attendance($1)',
    [body],
  ))[0]

describe('pulling attendance from Slack', () => {
  it('adds people, check-ins and poll answers, and logs the pull', async () => {
    expect(await pull(payload())).toEqual({ people_added: 3, checks_added: 3, rsvps_changed: 2 })
    expect(await db.sql('select count(*)::int as n from public.attendance_checks')).toEqual([{ n: 3 }])
    expect(await db.sql("select newest_message_at::text as at from public.attendance_syncs")).toEqual([{ at: '2026-01-21 02:40:00+00' }])
  })

  it('adds nothing the second time', async () => {
    await pull(payload())
    expect(await pull(payload())).toEqual({ people_added: 0, checks_added: 0, rsvps_changed: 0 })
  })

  it('updates a changed poll answer, but not one a mentor set by hand', async () => {
    await pull(payload())
    await db.sql("update public.attendance_rsvps set coming = true, source = 'manual' where person_id = (select id from public.attendance_people where slack_user_id = 'U0ALEX')")
    const flipped = payload({ rsvps: [{ slack_user_id: 'U0DREW', day: '2026-01-20', coming: false }, { slack_user_id: 'U0ALEX', day: '2026-01-20', coming: false }] })
    expect((await pull(flipped)).rsvps_changed).toBe(1)
    expect(await db.sql('select p.name, r.coming, r.source from public.attendance_rsvps r join public.attendance_people p on p.id = r.person_id order by p.name')).toEqual([
      { name: 'Alex Rivera', coming: true, source: 'manual' },
      { name: 'Drew Morgan', coming: false, source: 'poll' },
    ])
  })

  it("doesn't bring back a check-in a mentor ignored", async () => {
    await pull(payload())
    await db.sql("update public.attendance_checks set ignored = true where direction = 'out'")
    await pull(payload())
    expect(await db.sql("select ignored from public.attendance_checks where direction = 'out'")).toEqual([{ ignored: true }])
  })

  it('keeps someone known only by name as one person', async () => {
    await pull(payload())
    await pull(payload({ people: [{ slack_user_id: null, name: 'mystery person' }], checks: [], rsvps: [] }))
    expect(await db.sql("select count(*)::int as n from public.attendance_people where slack_user_id is null")).toEqual([{ n: 1 }])
  })

  it('can only be run by the database owner, not from the app', async () => {
    const mentor = await db.member('Pat Mentor', 'mentor')
    await expect(db.as(mentor, 'select private.import_attendance($1)', [payload()])).rejects.toThrow(PERMISSION_DENIED)
  })

  it('shows mentors when the last pull happened, and nobody else', async () => {
    await pull(payload())
    const mentor = await db.member('Pat Mentor', 'mentor')
    const student = await db.member('Riley Park')
    expect(await db.as(mentor, 'select checks_added from public.attendance_syncs')).toEqual([{ checks_added: 3 }])
    expect(await db.as(student, 'select * from public.attendance_syncs')).toEqual([])
  })
})
