// Permission rules for the Build progress grid. Everyone on the team reads
// it; only student leaders, mentors and admins change it.
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
  admin = await db.member('Morgan Admin', 'admin')
})

const add = (person: string, name = 'Intake') =>
  db.as<{ id: string; created_by: string }>(person, 'insert into public.build_subsystems (name, position) values ($1, 1) returning *', [name])

describe('build subsystems', () => {
  it('lets every member see the grid', async () => {
    await add(mentor)
    expect(await db.as(student, 'select name from public.build_subsystems')).toEqual([{ name: 'Intake' }])
  })

  it("doesn't let a student add a subsystem", async () => {
    await expect(add(student)).rejects.toThrow(PERMISSION_DENIED)
  })

  it("doesn't let a student change a cell, rename or remove a subsystem", async () => {
    const [row] = await add(mentor)
    expect(await db.as(student, `update public.build_subsystems set stages = '{"Design": "Done"}' where id = $1 returning id`, [row.id])).toEqual([])
    expect(await db.as(student, "update public.build_subsystems set name = 'Renamed' where id = $1 returning id", [row.id])).toEqual([])
    expect(await db.as(student, 'delete from public.build_subsystems where id = $1 returning id', [row.id])).toEqual([])
    expect(await db.sql('select name, stages from public.build_subsystems')).toEqual([{ name: 'Intake', stages: {} }])
  })

  it('lets a student leader, a mentor and an admin add, change, rename and remove subsystems', async () => {
    for (const [i, person] of [leader, mentor, admin].entries()) {
      const [row] = await add(person, `Shooter ${i}`)
      expect(row.created_by).toBe(person)
      expect(await db.as(person, `update public.build_subsystems set stages = '{"Design": "Done"}' where id = $1 returning stages`, [row.id])).toEqual([
        { stages: { Design: 'Done' } },
      ])
      expect(await db.as(person, "update public.build_subsystems set name = $2, position = 5 where id = $1 returning name", [row.id, `Climber ${i}`])).toEqual([
        { name: `Climber ${i}` },
      ])
      expect(await db.as(person, 'delete from public.build_subsystems where id = $1 returning id', [row.id])).toEqual([{ id: row.id }])
    }
  })

  it("doesn't let anyone add a subsystem as someone else", async () => {
    await expect(db.as(leader, "insert into public.build_subsystems (name, created_by) values ('Intake', $1)", [mentor])).rejects.toThrow(PERMISSION_DENIED)
  })

  it('refuses two subsystems with the same name, and stages that are not an object', async () => {
    await add(mentor, 'Intake')
    await expect(add(mentor, 'Intake')).rejects.toThrow('unique constraint')
    await expect(db.as(mentor, "insert into public.build_subsystems (name, stages) values ('Vision', '[]')")).rejects.toThrow('check constraint')
  })

  it("can't be seen or changed by someone who isn't signed in", async () => {
    await add(mentor)
    await expect(db.as(null, 'select * from public.build_subsystems')).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, "insert into public.build_subsystems (name) values ('Vision')")).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be seen or changed by a leader whose access is off", async () => {
    await add(mentor)
    await db.switchOff(leader)
    expect(await db.as(leader, 'select * from public.build_subsystems')).toEqual([])
    await expect(add(leader, 'Vision')).rejects.toThrow(PERMISSION_DENIED)
  })
})
