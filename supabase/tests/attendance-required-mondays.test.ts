// Permission rules for required Mondays: anyone says they can't make it for
// their own attendance, only mentors and admins see everyone's, and only
// mentors and admins mark a Monday not required.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let mentor: string
let mine: string
let theirs: string

const MONDAY = '2026-01-12'

const away = (who: string, person: string, day = MONDAY, reason = 'Doctor appointment') =>
  db.as<{ id: string }>(who, 'insert into public.attendance_absences (person_id, day, reason) values ($1, $2, $3) returning id', [person, day, reason])

const notRequired = (who: string, day = MONDAY) =>
  db.as<{ id: string }>(who, "insert into public.attendance_not_required (day, reason) values ($1, 'MLK Day') returning id", [day])

beforeEach(async () => {
  student = await db.member('Riley Park')
  mentor = await db.member('Pat Mentor', 'mentor')
  const [{ slack_user_id }] = await db.sql<{ slack_user_id: string }>('select slack_user_id from public.members where id = $1', [student])
  ;[{ id: mine }] = await db.as<{ id: string }>(mentor, 'insert into public.attendance_people (slack_user_id, name) values ($1, $2) returning id', [slack_user_id, 'Riley Park'])
  ;[{ id: theirs }] = await db.as<{ id: string }>(mentor, "insert into public.attendance_people (slack_user_id, name) values ('U0JORDAN', 'Jordan Kim') returning id")
})

describe("saying you can't make it", () => {
  it('lets people send, see and take back their own, recording who sent it', async () => {
    const [absence] = await away(student, mine)
    expect(await db.as(student, 'select id, created_by from public.attendance_absences')).toEqual([{ id: absence.id, created_by: student }])
    expect(await db.as(student, 'delete from public.attendance_absences where id = $1 returning id', [absence.id])).toEqual([absence])
  })

  it("doesn't let people send, see or take back anyone else's", async () => {
    await expect(away(student, theirs)).rejects.toThrow(PERMISSION_DENIED)
    const [theirAbsence] = await away(mentor, theirs)
    expect(await db.as(student, 'select id from public.attendance_absences')).toEqual([])
    expect(await db.as(student, 'delete from public.attendance_absences where id = $1 returning id', [theirAbsence.id])).toEqual([])
  })

  it("doesn't let anyone change one once it's sent", async () => {
    const [absence] = await away(student, mine)
    await expect(db.as(student, "update public.attendance_absences set reason = 'x' where id = $1", [absence.id])).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(mentor, "update public.attendance_absences set reason = 'x' where id = $1", [absence.id])).rejects.toThrow(PERMISSION_DENIED)
  })

  it('keeps one per person per day, with a reason', async () => {
    await away(student, mine)
    await expect(away(student, mine)).rejects.toThrow('duplicate key')
    await expect(away(student, mine, '2026-01-19', '   ')).rejects.toThrow('violates check constraint')
  })

  it('shows mentors everyone, and lets them remove any', async () => {
    await away(student, mine)
    const [theirAbsence] = await away(mentor, theirs)
    expect(await db.as(mentor, 'select count(*)::int as n from public.attendance_absences')).toEqual([{ n: 2 }])
    expect(await db.as(mentor, 'delete from public.attendance_absences where id = $1 returning id', [theirAbsence.id])).toEqual([theirAbsence])
  })

  it("can't be done or seen by someone whose access is switched off", async () => {
    await away(student, mine)
    await db.switchOff(student)
    expect(await db.as(student, 'select id from public.attendance_absences')).toEqual([])
    await expect(away(student, mine, '2026-01-19')).rejects.toThrow(PERMISSION_DENIED)
  })
})

describe('Mondays that are not required', () => {
  it('are marked and unmarked by mentors only, and seen by everyone on the team', async () => {
    await expect(notRequired(student)).rejects.toThrow(PERMISSION_DENIED)
    const [monday] = await notRequired(mentor)
    expect(await db.as(student, 'select day, reason from public.attendance_not_required')).toEqual([{ day: new Date(`${MONDAY}T00:00:00Z`), reason: 'MLK Day' }])
    expect(await db.as(student, 'delete from public.attendance_not_required where id = $1 returning id', [monday.id])).toEqual([])
    expect(await db.as(mentor, 'delete from public.attendance_not_required where id = $1 returning id', [monday.id])).toEqual([monday])
  })

  it('keeps each day once', async () => {
    await notRequired(mentor)
    await expect(notRequired(mentor)).rejects.toThrow('duplicate key')
  })
})
