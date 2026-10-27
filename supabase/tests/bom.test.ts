// Permission rules for the BOM module's tables: members can read and add
// robots, systems and parts, change them, and delete parts. Only mentors
// can delete robots and systems, because that deletes every part in them.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let mentor: string
let robotId: string
let systemId: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  mentor = await db.member('Pat Mentor', 'mentor')
  ;[{ id: robotId }] = await db.as<{ id: string }>(mentor, "insert into public.bom_robots (name) values ('Test robot') returning id")
  ;[{ id: systemId }] = await db.as<{ id: string }>(
    mentor,
    "insert into public.bom_systems (robot_id, name, code) values ($1, 'Intake', 'INT') returning id",
    [robotId],
  )
})

const addMadePart = (person: string, partNumber = '4096-26-INT-001') =>
  db.as<{ id: string; created_by: string }>(
    person,
    "insert into public.bom_parts (system_id, part_number, name, kind, material, quantity) values ($1, $2, 'Side plate', 'made', '6061 aluminum, 1/4 in plate', 2) returning *",
    [systemId, partNumber],
  )

describe('BOM robots, systems and parts', () => {
  it('can be read by a student', async () => {
    await addMadePart(mentor)
    expect(await db.as(student, 'select id from public.bom_robots')).toHaveLength(1)
    expect(await db.as(student, 'select id from public.bom_systems')).toHaveLength(1)
    expect(await db.as(student, 'select id from public.bom_parts')).toHaveLength(1)
  })

  it('can be added by a mentor, signed with their own id', async () => {
    const [part] = await addMadePart(mentor)
    expect(part.created_by).toBe(mentor)
  })

  it('lets a student add a part, signed with their own id', async () => {
    const [part] = await addMadePart(student)
    expect(part.created_by).toBe(student)
  })

  it('lets a student add robots and systems, signed with their own id', async () => {
    const [robot] = await db.as<{ created_by: string }>(student, "insert into public.bom_robots (name) values ('2027 robot') returning created_by")
    const [system] = await db.as<{ created_by: string }>(
      student,
      "insert into public.bom_systems (robot_id, name, code) values ($1, 'Shooter', 'SHO') returning created_by",
      [robotId],
    )
    expect(robot.created_by).toBe(student)
    expect(system.created_by).toBe(student)
  })

  it("doesn't let anyone add something as someone else", async () => {
    await expect(
      db.as(mentor, "insert into public.bom_robots (name, created_by) values ('Robot', $1)", [student]),
    ).rejects.toThrow(PERMISSION_DENIED)
    await expect(
      db.as(
        student,
        "insert into public.bom_parts (system_id, part_number, name, kind, material, quantity, created_by) values ($1, '4096-26-INT-009', 'Plate', 'made', 'Aluminum', 1, $2)",
        [systemId, mentor],
      ),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it("doesn't let someone whose access is off add a part", async () => {
    await db.switchOff(student)
    await expect(addMadePart(student)).rejects.toThrow(PERMISSION_DENIED)
  })

  it('can be changed by anyone on the team', async () => {
    const [part] = await addMadePart(mentor)
    expect(await db.as(student, 'update public.bom_parts set quantity = 4 where id = $1 returning id', [part.id])).toEqual([{ id: part.id }])
    expect(await db.as(student, "update public.bom_systems set name = 'Changed', code = 'CHG' returning id")).toEqual([{ id: systemId }])
    expect(await db.as(student, "update public.bom_robots set name = 'Changed' returning id")).toEqual([{ id: robotId }])
    expect(await db.as(mentor, 'update public.bom_parts set quantity = 5 where id = $1 returning id', [part.id])).toEqual([{ id: part.id }])
  })

  it("doesn't let anyone change who made something, or move it to another robot or system", async () => {
    const [part] = await addMadePart(student)
    for (const person of [student, mentor]) {
      await expect(db.as(person, 'update public.bom_parts set created_by = $1 where id = $2', [mentor, part.id])).rejects.toThrow(PERMISSION_DENIED)
      await expect(db.as(person, 'update public.bom_systems set robot_id = robot_id')).rejects.toThrow(PERMISSION_DENIED)
      await expect(db.as(person, 'update public.bom_robots set created_at = now()')).rejects.toThrow(PERMISSION_DENIED)
    }
  })

  it("doesn't let someone whose access is off change or delete a part", async () => {
    const [part] = await addMadePart(student)
    await db.switchOff(student)
    expect(await db.as(student, 'update public.bom_parts set quantity = 9 where id = $1 returning id', [part.id])).toEqual([])
    expect(await db.as(student, 'delete from public.bom_parts where id = $1 returning id', [part.id])).toEqual([])
  })

  it('lets a student delete parts, but only mentors delete robots and systems', async () => {
    const [part] = await addMadePart(mentor)
    expect(await db.as(student, 'delete from public.bom_parts where id = $1 returning id', [part.id])).toEqual([{ id: part.id }])
    expect(await db.as(student, 'delete from public.bom_systems returning id')).toEqual([])
    expect(await db.as(student, 'delete from public.bom_robots returning id')).toEqual([])
    expect(await db.as(mentor, 'delete from public.bom_systems returning id')).toEqual([{ id: systemId }])
    expect(await db.as(mentor, 'delete from public.bom_robots returning id')).toEqual([{ id: robotId }])
  })

  it("can't be read or added by someone who isn't signed in", async () => {
    for (const table of ['bom_robots', 'bom_systems', 'bom_parts']) {
      await expect(db.as(null, `select * from public.${table}`)).rejects.toThrow(PERMISSION_DENIED)
    }
    await expect(db.as(null, "insert into public.bom_robots (name) values ('Hi')")).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read by someone whose access is off", async () => {
    await addMadePart(mentor)
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.bom_robots')).toEqual([])
    expect(await db.as(student, 'select * from public.bom_systems')).toEqual([])
    expect(await db.as(student, 'select * from public.bom_parts')).toEqual([])
  })

  it('needs a material for made parts and a vendor for COTS parts', async () => {
    await expect(
      db.as(mentor, "insert into public.bom_parts (system_id, part_number, name, kind, quantity) values ($1, '4096-26-INT-002', 'Plate', 'made', 1)", [systemId]),
    ).rejects.toThrow('check constraint')
    await expect(
      db.as(mentor, "insert into public.bom_parts (system_id, part_number, name, kind, quantity) values ($1, '4096-26-INT-003', 'Motor', 'cots', 1)", [systemId]),
    ).rejects.toThrow('check constraint')
  })

  it('refuses a quantity under 1, a bad system code, and a repeated part number', async () => {
    await expect(
      db.as(mentor, "insert into public.bom_parts (system_id, part_number, name, kind, vendor, quantity) values ($1, '4096-26-INT-004', 'Bolt', 'cots', 'McMaster', 0)", [systemId]),
    ).rejects.toThrow('check constraint')
    await expect(
      db.as(mentor, "insert into public.bom_systems (robot_id, name, code) values ($1, 'Shooter', 'shooter')", [robotId]),
    ).rejects.toThrow('check constraint')
    await addMadePart(mentor)
    await expect(addMadePart(mentor)).rejects.toThrow('duplicate key')
  })

  it("only accepts https:// Onshape links", async () => {
    await expect(
      db.as(mentor, "update public.bom_systems set onshape_url = 'javascript:alert(1)' where id = $1", [systemId]),
    ).rejects.toThrow('check constraint')
  })

  it('deletes the parts in a system when the system is deleted', async () => {
    await addMadePart(mentor)
    await db.as(mentor, 'delete from public.bom_systems where id = $1', [systemId])
    expect(await db.sql('select id from public.bom_parts')).toEqual([])
  })
})
