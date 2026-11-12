// Permission rules for the Roster module: mentors and admins see and change
// everything; everyone else sees only their own entry, and changes nothing.
// Roster rows point at attendance people, so someone with no app account
// can be on the roster too.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let mentor: string
let admin: string
let mine: string
let theirs: string
let noAccount: string
let mechanical: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  mentor = await db.member('Pat Mentor', 'mentor')
  admin = await db.member('Morgan Admin', 'admin')
  const [{ slack_user_id }] = await db.sql<{ slack_user_id: string }>('select slack_user_id from public.members where id = $1', [student])
  const person = (slack: string | null, name: string) =>
    db.as<{ id: string }>(mentor, 'insert into public.attendance_people (slack_user_id, name) values ($1, $2) returning id', [slack, name])
  ;[{ id: mine }] = await person(slack_user_id, 'Riley Park')
  ;[{ id: theirs }] = await person('U0JORDAN', 'Jordan Kim')
  // A Jibble name that matched no Slack account.
  ;[{ id: noAccount }] = await person(null, 'Drew Morgan')
  ;[{ id: mechanical }] = await db.as<{ id: string }>(mentor, "insert into public.roster_subteams (name, position) values ('Mechanical', 1) returning id")
})

const setActive = (who: string, person: string) =>
  db.as<{ id: string }>(who, 'insert into public.roster_students (person_id, active) values ($1, true) returning id', [person])
const join = (who: string, person: string, main = true) =>
  db.as<{ id: string }>(who, 'insert into public.roster_subteam_members (person_id, subteam_id, main) values ($1, $2, $3) returning id', [person, mechanical, main])

describe('the roster', () => {
  it('is set by mentors and admins, for anyone in attendance, with or without an app account', async () => {
    await setActive(mentor, mine)
    await join(mentor, mine)
    await setActive(admin, noAccount)
    await join(admin, noAccount)
    await db.as(admin, "update public.roster_subteams set name = 'Mech' where id = $1", [mechanical])
    expect(await db.as(mentor, 'select count(*)::int as n from public.roster_students')).toEqual([{ n: 2 }])
    expect(await db.as(admin, 'select name from public.roster_subteams')).toEqual([{ name: 'Mech' }])
  })

  it("can't be changed by students, even their own entry", async () => {
    await expect(db.as(student, "insert into public.roster_subteams (name) values ('Pit crew')")).rejects.toThrow(PERMISSION_DENIED)
    await expect(setActive(student, mine)).rejects.toThrow(PERMISSION_DENIED)
    await expect(join(student, mine)).rejects.toThrow(PERMISSION_DENIED)
    const [entry] = await setActive(mentor, mine)
    expect(await db.as(student, 'update public.roster_students set active = false where id = $1 returning id', [entry.id])).toEqual([])
    expect(await db.as(student, 'delete from public.roster_students where id = $1 returning id', [entry.id])).toEqual([])
  })

  it("shows students only their own entry, and none of the subteams' names", async () => {
    await setActive(mentor, mine)
    await setActive(mentor, theirs)
    await join(mentor, mine)
    await join(mentor, theirs)
    expect(await db.as(student, 'select person_id, active from public.roster_students')).toEqual([{ person_id: mine, active: true }])
    expect(await db.as(student, 'select person_id from public.roster_subteam_members')).toEqual([{ person_id: mine }])
    expect(await db.as(student, 'select id from public.roster_subteams')).toEqual([])
    await db.switchOff(student)
    expect(await db.as(student, 'select id from public.roster_students')).toEqual([])
  })

  it('keeps one entry per person, one main subteam each, and subteam names unique', async () => {
    await setActive(mentor, mine)
    await expect(setActive(mentor, mine)).rejects.toThrow('duplicate key')
    await join(mentor, mine)
    const [{ id: software }] = await db.as<{ id: string }>(mentor, "insert into public.roster_subteams (name) values ('Software') returning id")
    await expect(
      db.as(mentor, 'insert into public.roster_subteam_members (person_id, subteam_id, main) values ($1, $2, true)', [mine, software]),
    ).rejects.toThrow('duplicate key')
    await expect(db.as(mentor, "insert into public.roster_subteams (name) values (' mechanical ')")).rejects.toThrow('duplicate key')
  })

  it("takes people off a subteam when it's removed, and off the roster when they're removed from attendance", async () => {
    await setActive(mentor, theirs)
    await join(mentor, mine)
    await join(mentor, theirs)
    await db.as(mentor, 'delete from public.roster_subteams where id = $1', [mechanical])
    expect(await db.sql('select count(*)::int as n from public.roster_subteam_members')).toEqual([{ n: 0 }])
    await db.as(mentor, 'delete from public.attendance_people where id = $1', [theirs])
    expect(await db.sql('select count(*)::int as n from public.roster_students')).toEqual([{ n: 0 }])
  })
})
