// Permission rules for requests for missing hours: anyone asks about their
// own attendance, only mentors and admins see everyone's and decide, and
// approving adds the check-ins and check-outs.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let mentor: string
let mine: string
let theirs: string

// Tue, Jan 13, 2026, 6:00 PM to 8:30 PM Central (UTC−6).
const DAY = '2026-01-13'
const IN = '2026-01-14T00:00:00Z'
const OUT = '2026-01-14T02:30:00Z'

const ask = (who: string, person: string, times: { in_at?: string | null; out_at?: string | null } = { in_at: IN, out_at: OUT }, day = DAY) =>
  db.as<{ id: string }>(
    who,
    'insert into public.attendance_requests (person_id, day, in_at, out_at, note) values ($1, $2, $3, $4, $5) returning id',
    [person, day, times.in_at ?? null, times.out_at ?? null, 'Jibble was down'],
  )

beforeEach(async () => {
  student = await db.member('Riley Park')
  mentor = await db.member('Pat Mentor', 'mentor')
  const [{ slack_user_id }] = await db.sql<{ slack_user_id: string }>('select slack_user_id from public.members where id = $1', [student])
  ;[{ id: mine }] = await db.as<{ id: string }>(mentor, 'insert into public.attendance_people (slack_user_id, name) values ($1, $2) returning id', [slack_user_id, 'Riley Park'])
  ;[{ id: theirs }] = await db.as<{ id: string }>(mentor, "insert into public.attendance_people (slack_user_id, name) values ('U0JORDAN', 'Jordan Kim') returning id")
})

describe('asking for missing hours', () => {
  it('lets people ask about their own attendance, and see their own requests', async () => {
    const [request] = await ask(student, mine)
    expect(await db.as(student, 'select id, status, created_by from public.attendance_requests')).toEqual([{ id: request.id, status: 'pending', created_by: student }])
  })

  it("doesn't let people ask about, or see, anyone else's", async () => {
    await expect(ask(student, theirs)).rejects.toThrow(/row-level security/)
    await ask(mentor, theirs)
    expect(await db.as(student, 'select id from public.attendance_requests')).toEqual([])
  })

  it("doesn't let people approve their own request, even by asking for it approved", async () => {
    await expect(
      db.as(student, "insert into public.attendance_requests (person_id, day, out_at, note, status) values ($1, $2, $3, 'x', 'approved')", [mine, DAY, OUT]),
    ).rejects.toThrow(PERMISSION_DENIED)
    await ask(student, mine)
    expect(await db.as(student, "update public.attendance_requests set status = 'approved' returning id")).toEqual([])
    expect(await db.sql('select count(*)::int as n from public.attendance_checks')).toEqual([{ n: 0 }])
  })

  it('lets people take back a waiting request, but not a decided one', async () => {
    const [first] = await ask(student, mine)
    expect(await db.as(student, 'delete from public.attendance_requests where id = $1 returning id', [first.id])).toEqual([first])
    const [second] = await ask(student, mine)
    await db.as(mentor, "update public.attendance_requests set status = 'declined' where id = $1", [second.id])
    expect(await db.as(student, 'delete from public.attendance_requests where id = $1 returning id', [second.id])).toEqual([])
  })

  it('keeps one waiting request per person per day, with sensible times', async () => {
    await ask(student, mine)
    await expect(ask(student, mine, { out_at: OUT })).rejects.toThrow('duplicate key')
    await expect(ask(student, mine, { in_at: OUT, out_at: IN }, '2026-01-15')).rejects.toThrow('violates check constraint')
    await expect(ask(student, mine, { in_at: null, out_at: null }, '2026-01-15')).rejects.toThrow('violates check constraint')
    // 8:30 PM on Jan 13 isn't on Jan 15.
    await expect(ask(student, mine, { out_at: OUT }, '2026-01-15')).rejects.toThrow('violates check constraint')
  })

  it("can't be done or seen by someone whose access is switched off", async () => {
    await ask(student, mine)
    await db.switchOff(student)
    expect(await db.as(student, 'select id from public.attendance_requests')).toEqual([])
    await expect(ask(student, mine, { out_at: OUT }, '2026-01-15')).rejects.toThrow(/row-level security/)
  })
})

describe('deciding', () => {
  it('shows mentors every request', async () => {
    await ask(student, mine)
    await ask(mentor, theirs)
    expect(await db.as(mentor, 'select count(*)::int as n from public.attendance_requests')).toEqual([{ n: 2 }])
  })

  it('adds the check-in and check-out when a mentor approves, and records who decided', async () => {
    const [request] = await ask(student, mine)
    await db.as(mentor, "update public.attendance_requests set status = 'approved' where id = $1", [request.id])
    expect(await db.sql('select direction, at, source, ignored, created_by from public.attendance_checks order by at')).toEqual([
      { direction: 'in', at: new Date(IN), source: 'manual', ignored: false, created_by: mentor },
      { direction: 'out', at: new Date(OUT), source: 'manual', ignored: false, created_by: mentor },
    ])
    const [decided] = await db.sql<{ decided_by: string; decided_at: Date | null }>('select decided_by, decided_at from public.attendance_requests')
    expect(decided.decided_by).toBe(mentor)
    expect(decided.decided_at).not.toBeNull()
  })

  it('adds only the check-out for a forgotten check-out, and counts a time that was ignored', async () => {
    await db.as(mentor, "insert into public.attendance_checks (person_id, direction, at, source, ignored) values ($1, 'out', $2, 'jibble', true)", [mine, OUT])
    const [request] = await ask(student, mine, { out_at: OUT })
    await db.as(mentor, "update public.attendance_requests set status = 'approved' where id = $1", [request.id])
    expect(await db.sql('select direction, ignored from public.attendance_checks')).toEqual([{ direction: 'out', ignored: false }])
  })

  it('adds nothing when a mentor declines', async () => {
    const [request] = await ask(student, mine)
    await db.as(mentor, "update public.attendance_requests set status = 'declined' where id = $1", [request.id])
    expect(await db.sql('select count(*)::int as n from public.attendance_checks')).toEqual([{ n: 0 }])
    expect(await db.as(student, 'select status from public.attendance_requests')).toEqual([{ status: 'declined' }])
  })

  it('lets mentors correct the times before approving, and decides only once', async () => {
    const [request] = await ask(student, mine)
    await db.as(mentor, "update public.attendance_requests set out_at = '2026-01-14T02:00:00Z' where id = $1", [request.id])
    await db.as(mentor, "update public.attendance_requests set status = 'approved' where id = $1", [request.id])
    expect(await db.sql("select at from public.attendance_checks where direction = 'out'")).toEqual([{ at: new Date('2026-01-14T02:00:00Z') }])
    await expect(db.as(mentor, "update public.attendance_requests set status = 'declined' where id = $1", [request.id])).rejects.toThrow(
      'That request was already approved',
    )
  })

  it("doesn't let mentors change who asked or when they decided", async () => {
    const [request] = await ask(student, mine)
    await expect(db.as(mentor, 'update public.attendance_requests set created_by = $1 where id = $2', [mentor, request.id])).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(mentor, 'update public.attendance_requests set decided_at = now() where id = $1', [request.id])).rejects.toThrow(PERMISSION_DENIED)
  })
})
