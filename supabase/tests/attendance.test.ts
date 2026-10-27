// Permission rules for attendance. Only mentors and admins can see or
// change any of it: it's personal information about students.
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
})

const TABLES = ['attendance_people', 'attendance_checks', 'attendance_rsvps']

describe('attendance', () => {
  it('can be read by mentors', async () => {
    for (const table of TABLES) expect(await db.as(mentor, `select * from public.${table}`)).toHaveLength(1)
  })

  it("can't be read by students, even about themselves", async () => {
    for (const table of TABLES) expect(await db.as(student, `select * from public.${table}`)).toEqual([])
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
})
