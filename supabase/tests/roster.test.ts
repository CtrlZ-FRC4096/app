// Permission rules for the Roster module: mentors and admins see and change
// everything; everyone else sees only their own entry, and changes nothing.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let other: string
let mentor: string
let admin: string
let mechanical: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  other = await db.member('Jordan Kim')
  mentor = await db.member('Pat Mentor', 'mentor')
  admin = await db.member('Morgan Admin', 'admin')
  ;[{ id: mechanical }] = await db.as<{ id: string }>(mentor, "insert into public.roster_subteams (name, position) values ('Mechanical', 1) returning id")
})

const setActive = (who: string, member: string) =>
  db.as<{ id: string }>(who, 'insert into public.roster_students (member_id, active) values ($1, true) returning id', [member])
const join = (who: string, member: string, main = true) =>
  db.as<{ id: string }>(who, 'insert into public.roster_subteam_members (member_id, subteam_id, main) values ($1, $2, $3) returning id', [member, mechanical, main])

describe('the roster', () => {
  it('is set by mentors and admins: subteams, who is active, and who is on each subteam', async () => {
    await setActive(mentor, student)
    await join(mentor, student)
    await setActive(admin, other)
    await db.as(admin, "update public.roster_subteams set name = 'Mech' where id = $1", [mechanical])
    expect(await db.as(mentor, 'select count(*)::int as n from public.roster_students')).toEqual([{ n: 2 }])
    expect(await db.as(admin, 'select name from public.roster_subteams')).toEqual([{ name: 'Mech' }])
  })

  it("can't be changed by students, even their own entry", async () => {
    await expect(db.as(student, "insert into public.roster_subteams (name) values ('Pit crew')")).rejects.toThrow(PERMISSION_DENIED)
    await expect(setActive(student, student)).rejects.toThrow(PERMISSION_DENIED)
    await expect(join(student, student)).rejects.toThrow(PERMISSION_DENIED)
    const [entry] = await setActive(mentor, student)
    expect(await db.as(student, 'update public.roster_students set active = false where id = $1 returning id', [entry.id])).toEqual([])
    expect(await db.as(student, 'delete from public.roster_students where id = $1 returning id', [entry.id])).toEqual([])
  })

  it("shows students only their own entry, and none of the subteams' names", async () => {
    await setActive(mentor, student)
    await setActive(mentor, other)
    await join(mentor, student)
    await join(mentor, other)
    expect(await db.as(student, 'select member_id, active from public.roster_students')).toEqual([{ member_id: student, active: true }])
    expect(await db.as(student, 'select member_id from public.roster_subteam_members')).toEqual([{ member_id: student }])
    expect(await db.as(student, 'select id from public.roster_subteams')).toEqual([])
    await db.switchOff(student)
    expect(await db.as(student, 'select id from public.roster_students')).toEqual([])
  })

  it('keeps one entry per person, one main subteam each, and subteam names unique', async () => {
    await setActive(mentor, student)
    await expect(setActive(mentor, student)).rejects.toThrow('duplicate key')
    await join(mentor, student)
    const [{ id: software }] = await db.as<{ id: string }>(mentor, "insert into public.roster_subteams (name) values ('Software') returning id")
    await expect(
      db.as(mentor, 'insert into public.roster_subteam_members (member_id, subteam_id, main) values ($1, $2, true)', [student, software]),
    ).rejects.toThrow('duplicate key')
    await expect(db.as(mentor, "insert into public.roster_subteams (name) values (' mechanical ')")).rejects.toThrow('duplicate key')
  })

  it("takes people off a subteam when it's removed", async () => {
    await join(mentor, student)
    await db.as(mentor, 'delete from public.roster_subteams where id = $1', [mechanical])
    expect(await db.sql('select count(*)::int as n from public.roster_subteam_members')).toEqual([{ n: 0 }])
  })
})
