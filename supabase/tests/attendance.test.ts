// Permission rules for attendance. It's personal information about
// students: mentors and admins see and change all of it, and everyone else
// sees only their own (matched by Slack account) and changes nothing.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let mentor: string
let person: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  mentor = await db.member('Pat Mentor', 'mentor')
  const [row] = await db.as<{ id: string }>(mentor, "insert into public.attendance_people (slack_user_id, name) values ('U0RILEY', 'Riley Park') returning id")
  person = row.id
  await db.as(mentor, "insert into public.attendance_checks (person_id, direction, at, source) values ($1, 'in', '2026-01-09T00:05:00Z', 'jibble')", [person])
  await db.as(mentor, "insert into public.attendance_rsvps (person_id, day, coming, source) values ($1, '2026-01-08', true, 'poll')", [person])
  await db.as(mentor, "insert into public.attendance_periods (name, first_day, last_day) values ('2026 build season', '2026-01-10', '2026-04-18')")
})

const TABLES = ['attendance_people', 'attendance_checks', 'attendance_rsvps', 'attendance_periods']
/** The tables about people. The points periods are only names and dates. */
const PERSONAL = ['attendance_people', 'attendance_checks', 'attendance_rsvps']

describe('attendance', () => {
  it('can be read by mentors', async () => {
    for (const table of TABLES) expect(await db.as(mentor, `select * from public.${table}`)).toHaveLength(1)
  })

  it("can't be read by students about anyone else, though they can see the points periods", async () => {
    // Riley's attendance row has a Slack ID that isn't the student's account.
    for (const table of PERSONAL) expect(await db.as(student, `select * from public.${table}`)).toEqual([])
    expect(await db.as(student, 'select name from public.attendance_periods')).toEqual([{ name: '2026 build season' }])
  })

  it("can't be read by someone who isn't signed in", async () => {
    for (const table of TABLES) await expect(db.as(null, `select * from public.${table}`)).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read by a mentor whose access is switched off", async () => {
    await db.switchOff(mentor)
    for (const table of TABLES) expect(await db.as(mentor, `select * from public.${table}`)).toEqual([])
  })

  it("can't be changed by students", async () => {
    await expect(
      db.as(student, "insert into public.attendance_checks (person_id, direction, at) values ($1, 'out', now())", [person]),
    ).rejects.toThrow(PERMISSION_DENIED)
    expect(await db.as(student, "update public.attendance_rsvps set coming = false returning id")).toEqual([])
    expect(await db.as(student, 'delete from public.attendance_people returning id')).toEqual([])
    await expect(
      db.as(student, "insert into public.attendance_periods (name, first_day) values ('My season', '2026-01-01')"),
    ).rejects.toThrow(PERMISSION_DENIED)
    expect(await db.as(student, "update public.attendance_periods set first_day = '2025-01-01' returning id")).toEqual([])
  })

  it('lets mentors fix check-ins and RSVPs', async () => {
    await db.as(mentor, "insert into public.attendance_checks (person_id, direction, at) values ($1, 'out', '2026-01-09T02:10:00Z')", [person])
    await db.as(mentor, "update public.attendance_checks set ignored = true where direction = 'in'")
    await db.as(mentor, "update public.attendance_rsvps set coming = false, source = 'manual'")
    expect(await db.sql('select direction, ignored, source from public.attendance_checks order by direction')).toEqual([
      { direction: 'in', ignored: true, source: 'jibble' },
      { direction: 'out', ignored: false, source: 'manual' },
    ])
    expect(await db.sql('select coming, source from public.attendance_rsvps')).toEqual([{ coming: false, source: 'manual' }])
  })

  it('keeps one check per person, direction and time, and one RSVP per person per day', async () => {
    await expect(
      db.as(mentor, "insert into public.attendance_checks (person_id, direction, at) values ($1, 'in', '2026-01-09T00:05:00Z')", [person]),
    ).rejects.toThrow('duplicate key')
    await expect(
      db.as(mentor, "insert into public.attendance_rsvps (person_id, day, coming) values ($1, '2026-01-08', false)", [person]),
    ).rejects.toThrow('duplicate key')
  })

  it('removes a person’s check-ins and RSVPs with them', async () => {
    await db.as(mentor, 'delete from public.attendance_people where id = $1', [person])
    expect(await db.sql('select count(*)::int as n from public.attendance_checks')).toEqual([{ n: 0 }])
    expect(await db.sql('select count(*)::int as n from public.attendance_rsvps')).toEqual([{ n: 0 }])
  })

  it('lets mentors save, change and remove points periods', async () => {
    await db.as(mentor, "insert into public.attendance_periods (name, first_day) values ('2026 offseason', '2026-05-01')")
    await db.as(mentor, "update public.attendance_periods set last_day = '2026-12-20' where name = '2026 offseason'")
    await db.as(mentor, "delete from public.attendance_periods where name = '2026 build season'")
    expect(await db.sql("select name, first_day::text, last_day::text from public.attendance_periods")).toEqual([
      { name: '2026 offseason', first_day: '2026-05-01', last_day: '2026-12-20' },
    ])
  })

  it('keeps points periods sensible: an end after the start, and one of each name', async () => {
    await expect(
      db.as(mentor, "insert into public.attendance_periods (name, first_day, last_day) values ('Backwards', '2026-03-01', '2026-02-01')"),
    ).rejects.toThrow('violates check constraint')
    await expect(
      db.as(mentor, "insert into public.attendance_periods (name, first_day) values ('  2026 Build Season ', '2026-01-03')"),
    ).rejects.toThrow('duplicate key')
    await expect(db.as(mentor, "insert into public.attendance_periods (name, first_day) values ('   ', '2026-01-03')")).rejects.toThrow(
      'violates check constraint',
    )
  })
})

describe('your own attendance', () => {
  let other: string

  beforeEach(async () => {
    // Link Riley's attendance row to the student's Slack account, and add someone else.
    const [{ slack_user_id }] = await db.sql<{ slack_user_id: string }>('select slack_user_id from public.members where id = $1', [student])
    await db.sql('update public.attendance_people set slack_user_id = $1 where id = $2', [slack_user_id, person])
    const [row] = await db.as<{ id: string }>(mentor, "insert into public.attendance_people (slack_user_id, name) values ('U0JORDAN', 'Jordan Kim') returning id")
    other = row.id
    await db.as(mentor, "insert into public.attendance_checks (person_id, direction, at, source) values ($1, 'in', '2026-01-09T00:10:00Z', 'jibble')", [other])
    await db.as(mentor, "insert into public.attendance_rsvps (person_id, day, coming, source) values ($1, '2026-01-08', false, 'poll')", [other])
  })

  it('can be read by the person it belongs to, and nobody else’s', async () => {
    expect(await db.as(student, 'select id from public.attendance_people')).toEqual([{ id: person }])
    expect(await db.as(student, 'select person_id from public.attendance_checks')).toEqual([{ person_id: person }])
    expect(await db.as(student, 'select person_id from public.attendance_rsvps')).toEqual([{ person_id: person }])
  })

  it("can't be changed by the person it belongs to", async () => {
    await expect(
      db.as(student, "insert into public.attendance_checks (person_id, direction, at) values ($1, 'out', '2026-01-09T03:00:00Z')", [person]),
    ).rejects.toThrow(PERMISSION_DENIED)
    expect(await db.as(student, 'update public.attendance_rsvps set coming = false returning id')).toEqual([])
    expect(await db.as(student, 'update public.attendance_checks set ignored = true returning id')).toEqual([])
    expect(await db.as(student, "update public.attendance_people set name = 'Someone else' returning id")).toEqual([])
    expect(await db.as(student, 'delete from public.attendance_checks returning id')).toEqual([])
    expect(await db.sql('select count(*)::int as n from public.attendance_checks where person_id = $1 and not ignored', [person])).toEqual([{ n: 1 }])
  })

  it("can't be read once the person's access is switched off", async () => {
    await db.switchOff(student)
    for (const table of TABLES) expect(await db.as(student, `select * from public.${table}`)).toEqual([])
  })

  it('still shows mentors everyone', async () => {
    expect(await db.as(mentor, 'select count(*)::int as n from public.attendance_people')).toEqual([{ n: 2 }])
  })
})
