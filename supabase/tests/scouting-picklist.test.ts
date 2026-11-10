// Permission rules for the Scouting module's shared picklist (#43): signed-in
// members read it; only mentors and admins add, move, mark and remove teams.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let leader: string
let mentor: string
let admin: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  leader = await db.member('Casey Lee', 'leader')
  mentor = await db.member('Pat Mentor', 'mentor')
  admin = await db.member('Sam Admin', 'admin')
})

interface Pick {
  id: string
  team_number: number
  position: number
  status: string
  created_by: string
}

/** Add a team to the 2026test list, the way the app does. */
const add = (person: string, team = 9991, position = 1000) =>
  db.as<Pick>(person, "insert into public.scouting_picklist (event_key, team_number, position) values ('2026test', $1, $2) returning *", [team, position])

describe('the shared picklist', () => {
  it('lets a mentor and an admin add teams, signed with their own id, marked Open', async () => {
    const [first] = await add(mentor, 9991, 1000)
    const [second] = await add(admin, 9992, 2000)
    expect(first).toMatchObject({ team_number: 9991, position: 1000, status: 'Open', created_by: mentor })
    expect(second).toMatchObject({ team_number: 9992, created_by: admin })
  })

  it("doesn't let a student or a student leader add a team", async () => {
    await expect(add(student)).rejects.toThrow(PERMISSION_DENIED)
    await expect(add(leader)).rejects.toThrow(PERMISSION_DENIED)
  })

  it("doesn't let anyone add a team as if someone else added it", async () => {
    await expect(
      db.as(mentor, "insert into public.scouting_picklist (event_key, team_number, position, created_by) values ('2026test', 9991, 1000, $1)", [admin]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('lets every member read the list', async () => {
    await add(mentor, 9991)
    await add(mentor, 9992, 2000)
    expect(await db.as(student, 'select team_number from public.scouting_picklist order by position')).toEqual([{ team_number: 9991 }, { team_number: 9992 }])
  })

  it('lets a mentor and an admin move, mark and remove teams', async () => {
    const [pick] = await add(mentor)
    expect(await db.as(mentor, 'update public.scouting_picklist set position = 500 where id = $1 returning position', [pick.id])).toEqual([{ position: 500 }])
    expect(await db.as(admin, "update public.scouting_picklist set status = 'Picked' where id = $1 returning status", [pick.id])).toEqual([{ status: 'Picked' }])
    expect(await db.as(admin, "update public.scouting_picklist set status = 'Do not pick' where id = $1 returning status", [pick.id])).toEqual([{ status: 'Do not pick' }])
    expect(await db.as(mentor, 'delete from public.scouting_picklist where id = $1 returning id', [pick.id])).toEqual([{ id: pick.id }])
  })

  it("doesn't let a student move, mark or remove a team", async () => {
    const [pick] = await add(mentor)
    expect(await db.as(student, 'update public.scouting_picklist set position = 500 where id = $1 returning id', [pick.id])).toEqual([])
    expect(await db.as(student, "update public.scouting_picklist set status = 'Picked' where id = $1 returning id", [pick.id])).toEqual([])
    expect(await db.as(student, 'delete from public.scouting_picklist where id = $1 returning id', [pick.id])).toEqual([])
    expect(await db.sql('select position, status from public.scouting_picklist')).toEqual([{ position: 1000, status: 'Open' }])
  })

  it("doesn't let even a mentor change which team or event a row is for", async () => {
    const [pick] = await add(mentor)
    await expect(db.as(mentor, 'update public.scouting_picklist set team_number = 1234 where id = $1', [pick.id])).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(admin, "update public.scouting_picklist set event_key = '2026other' where id = $1", [pick.id])).rejects.toThrow(PERMISSION_DENIED)
  })

  it('refuses the same team twice on one event, but allows it on another event', async () => {
    await add(mentor, 9991)
    await expect(add(mentor, 9991, 2000)).rejects.toThrow('unique')
    expect(
      await db.as(mentor, "insert into public.scouting_picklist (event_key, team_number, position) values ('2026other', 9991, 1000) returning team_number"),
    ).toEqual([{ team_number: 9991 }])
  })

  it('refuses a made-up status and a team number of 0', async () => {
    await expect(
      db.as(mentor, "insert into public.scouting_picklist (event_key, team_number, position, status) values ('2026test', 9991, 1000, 'Maybe')"),
    ).rejects.toThrow('check constraint')
    const [pick] = await add(mentor)
    await expect(db.as(mentor, "update public.scouting_picklist set status = 'Maybe' where id = $1", [pick.id])).rejects.toThrow('check constraint')
    await expect(add(mentor, 0)).rejects.toThrow('check constraint')
  })

  it("can't be read or changed by someone who isn't signed in", async () => {
    await add(mentor)
    await expect(db.as(null, 'select * from public.scouting_picklist')).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, 'update public.scouting_picklist set position = 1')).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read or changed by someone whose access is off", async () => {
    const [pick] = await add(mentor)
    await db.switchOff(mentor)
    expect(await db.as(mentor, 'select * from public.scouting_picklist')).toEqual([])
    expect(await db.as(mentor, 'update public.scouting_picklist set position = 1 where id = $1 returning id', [pick.id])).toEqual([])
    await expect(add(mentor, 9992)).rejects.toThrow(PERMISSION_DENIED)
  })
})
