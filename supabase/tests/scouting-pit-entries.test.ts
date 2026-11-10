// Permission rules for the Scouting module's pit entries. One test for each
// thing the rules should allow or stop.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let otherStudent: string
let mentor: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  otherStudent = await db.member('Casey Lee')
  mentor = await db.member('Pat Mentor', 'mentor')
})

const add = (person: string, team = 9991, id?: string) =>
  db.as<{ id: string; team: number; created_by: string }>(
    person,
    `insert into public.scouting_pit_entries (id, team, drivetrain, weight_lb, motors)
     values (coalesce($1::uuid, gen_random_uuid()), $2, 'Swerve', 115.5, '8 Kraken X60') returning *`,
    [id ?? null, team],
  )

describe('scouting pit entries', () => {
  it('lets a member add an entry, signed with their own id', async () => {
    const [entry] = await add(student)
    expect(entry.created_by).toBe(student)
  })

  it("doesn't let anyone add an entry as someone else", async () => {
    await expect(
      db.as(student, 'insert into public.scouting_pit_entries (team, created_by) values (9991, $1)', [otherStudent]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('lets every member read every entry', async () => {
    await add(student, 9991)
    await add(otherStudent, 9992)
    expect(await db.as(student, 'select team from public.scouting_pit_entries order by team')).toEqual([{ team: 9991 }, { team: 9992 }])
  })

  it('keeps every visit to the same team', async () => {
    await add(student, 9991)
    await add(otherStudent, 9991)
    expect(await db.as(student, 'select team from public.scouting_pit_entries')).toHaveLength(2)
  })

  it('refuses the same entry sent twice from a device', async () => {
    const id = '00000000-0000-4000-8000-00000000b001'
    await add(student, 9991, id)
    await expect(add(student, 9991, id)).rejects.toThrow('duplicate key')
  })

  it('refuses an entry with no team, or a weight or size that is 0 or less', async () => {
    await expect(db.as(student, "insert into public.scouting_pit_entries (motors) values ('NEOs')")).rejects.toThrow('not-null')
    await expect(db.as(student, 'insert into public.scouting_pit_entries (team, weight_lb) values (9991, 0)')).rejects.toThrow('check constraint')
    await expect(db.as(student, 'insert into public.scouting_pit_entries (team, height_in) values (9991, -2)')).rejects.toThrow('check constraint')
  })

  it('can be changed or removed by a mentor, but not a student, even their own', async () => {
    const [entry] = await add(student)
    expect(await db.as(student, "update public.scouting_pit_entries set motors = 'Changed' where id = $1 returning id", [entry.id])).toEqual([])
    expect(await db.as(student, 'delete from public.scouting_pit_entries where id = $1 returning id', [entry.id])).toEqual([])
    expect(await db.as(mentor, "update public.scouting_pit_entries set motors = 'Changed' where id = $1 returning motors", [entry.id])).toEqual([{ motors: 'Changed' }])
    expect(await db.as(mentor, 'delete from public.scouting_pit_entries where id = $1 returning id', [entry.id])).toEqual([{ id: entry.id }])
  })

  it("can't be read or added by someone who isn't signed in", async () => {
    await add(student)
    await expect(db.as(null, 'select * from public.scouting_pit_entries')).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, 'insert into public.scouting_pit_entries (team) values (9991)')).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read or added by someone whose access is off", async () => {
    await add(student)
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.scouting_pit_entries')).toEqual([])
    await expect(add(student)).rejects.toThrow(PERMISSION_DENIED)
  })
})
