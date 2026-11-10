// Permission rules for the Calendar module's sign-ups table
// (supabase/migrations/..._calendar_signups.sql): anyone on the team can see
// who's signed up, students sign only themselves up and take back only
// their own sign-up, and student leaders, mentors and admins can sign
// anyone up and take anyone off.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let other: string
let leader: string
let mentor: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  other = await db.member('Casey Brooks')
  leader = await db.member('Drew Leader', 'leader')
  mentor = await db.member('Pat Mentor', 'mentor')
})

const signUpSomeone = (by: string, person: string, eventId = 'abc123') =>
  db.as<{ id: string; created_by: string }>(by, 'insert into public.calendar_signups (event_id, created_by) values ($1, $2) returning *', [eventId, person])

const signUp = (person: string, eventId = 'abc123_20261113T000000Z') =>
  db.as<{ id: string; event_id: string; created_by: string }>(person, 'insert into public.calendar_signups (event_id) values ($1) returning *', [eventId])
const takeBack = (person: string, id: string) => db.as<{ id: string }>(person, 'delete from public.calendar_signups where id = $1 returning id', [id])

describe('calendar sign-ups', () => {
  it('lets a member sign up, as themselves', async () => {
    const [row] = await signUp(student)
    expect(row).toMatchObject({ event_id: 'abc123_20261113T000000Z', created_by: student })
  })

  it("doesn't let a student sign someone else up", async () => {
    await expect(signUpSomeone(student, other)).rejects.toThrow(PERMISSION_DENIED)
  })

  it('lets student leaders and mentors sign someone else up', async () => {
    expect(await signUpSomeone(leader, student)).toMatchObject([{ created_by: student }])
    expect(await signUpSomeone(mentor, other)).toMatchObject([{ created_by: other }])
  })

  it("doesn't let someone sign up twice for the same event, but they can sign up for others", async () => {
    await signUp(student, 'abc123')
    await expect(signUp(student, 'abc123')).rejects.toThrow('duplicate key')
    await signUp(student, 'def456')
    await signUp(other, 'abc123')
  })

  it("refuses event ids that aren't Google Calendar ids", async () => {
    await expect(signUp(student, '')).rejects.toThrow('check constraint')
    await expect(signUp(student, '../acl')).rejects.toThrow('check constraint')
    await expect(signUp(student, 'x'.repeat(1025))).rejects.toThrow('check constraint')
  })

  it("lets everyone on the team see who's signed up", async () => {
    await signUp(student)
    await signUp(mentor)
    for (const person of [student, other, mentor]) {
      expect(await db.as(person, 'select created_by from public.calendar_signups')).toHaveLength(2)
    }
  })

  it("lets students take back their own sign-up but not someone else's", async () => {
    const [row] = await signUp(student)
    expect(await takeBack(other, row.id)).toEqual([])
    expect(await takeBack(student, row.id)).toEqual([{ id: row.id }])
  })

  it("lets student leaders and mentors take anyone's sign-up back", async () => {
    const [riley] = await signUp(student)
    const [casey] = await signUp(other)
    expect(await takeBack(leader, riley.id)).toEqual([{ id: riley.id }])
    expect(await takeBack(mentor, casey.id)).toEqual([{ id: casey.id }])
  })

  it("doesn't let a student leader whose access is off sign anyone up or take anyone off", async () => {
    const [row] = await signUp(student)
    await db.switchOff(leader)
    await expect(signUpSomeone(leader, other)).rejects.toThrow(PERMISSION_DENIED)
    expect(await takeBack(leader, row.id)).toEqual([])
  })

  it("can't be changed, even by a mentor", async () => {
    const [row] = await signUp(student)
    await expect(db.as(student, "update public.calendar_signups set event_id = 'other' where id = $1", [row.id])).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(mentor, 'update public.calendar_signups set created_by = $2 where id = $1', [row.id, mentor])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read or added by someone who isn't signed in", async () => {
    await signUp(student)
    await expect(db.as(null, 'select * from public.calendar_signups')).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, "insert into public.calendar_signups (event_id) values ('abc123')")).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read, added or taken back by someone whose access is off", async () => {
    const [row] = await signUp(student)
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.calendar_signups')).toEqual([])
    await expect(signUp(student, 'def456')).rejects.toThrow(PERMISSION_DENIED)
    expect(await takeBack(student, row.id)).toEqual([])
  })
})
