// Permission rules for the BOM's stages (bom_steps): anyone on the team can
// read stages, add and remove them, change a stage's status and how many
// are done, and assign it to someone with a due date. Nobody else can do
// anything.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let mentor: string
let partId: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  mentor = await db.member('Pat Mentor', 'mentor')
  const [{ id: robotId }] = await db.as<{ id: string }>(mentor, "insert into public.bom_robots (name) values ('Test robot') returning id")
  const [{ id: systemId }] = await db.as<{ id: string }>(
    mentor,
    "insert into public.bom_systems (robot_id, name, code) values ($1, 'Intake', 'INT') returning id",
    [robotId],
  )
  ;[{ id: partId }] = await db.as<{ id: string }>(
    mentor,
    "insert into public.bom_parts (system_id, part_number, name, kind, material, quantity) values ($1, '4096-26-INT-001', 'Side plate', 'made', '6061 aluminum, 1/4 in plate', 4) returning id",
    [systemId],
  )
})

type Step = { id: string; status: string; quantity_done: number; created_by: string; assigned_to: string | null; due_date: string | null }

const addStep = (person: string, stage = 'process1', machine: string | null = 'cnc_router') =>
  db.as<Step>(person, 'insert into public.bom_steps (part_id, stage, machine) values ($1, $2, $3) returning *', [partId, stage, machine])

describe('BOM stages', () => {
  it('can be added by a student or a mentor, signed with their own id, starting at to do with none done', async () => {
    const [step] = await addStep(student)
    expect(step).toMatchObject({ created_by: student, status: 'todo', quantity_done: 0, assigned_to: null, due_date: null })
    const [other] = await addStep(mentor, 'post', null)
    expect(other.created_by).toBe(mentor)
  })

  it("can't be added as someone else", async () => {
    await expect(
      db.as(student, "insert into public.bom_steps (part_id, stage, created_by) values ($1, 'design', $2)", [partId, mentor]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('can be read by a student', async () => {
    await addStep(mentor)
    expect(await db.as(student, 'select id from public.bom_steps')).toHaveLength(1)
  })

  it('can be moved along and counted by a student', async () => {
    const [step] = await addStep(mentor)
    const [changed] = await db.as<Step>(
      student,
      "update public.bom_steps set status = 'in_progress', quantity_done = 2 where id = $1 returning *",
      [step.id],
    )
    expect(changed).toMatchObject({ status: 'in_progress', quantity_done: 2 })
  })

  it('can be assigned to someone with a due date, and unassigned, by a student', async () => {
    const [step] = await addStep(mentor)
    const [assigned] = await db.as<{ assigned_to: string; due: string }>(
      student,
      "update public.bom_steps set assigned_to = $2, due_date = '2026-11-20' where id = $1 returning assigned_to, due_date::text as due",
      [step.id, mentor],
    )
    expect(assigned).toEqual({ assigned_to: mentor, due: '2026-11-20' })
    const [cleared] = await db.as<Step>(student, 'update public.bom_steps set assigned_to = null, due_date = null where id = $1 returning *', [step.id])
    expect(cleared).toMatchObject({ assigned_to: null, due_date: null })
  })

  it("can't be assigned to someone who isn't on the team", async () => {
    const [step] = await addStep(mentor)
    await expect(
      db.as(student, "update public.bom_steps set assigned_to = '00000000-0000-4000-8000-000000000001' where id = $1", [step.id]),
    ).rejects.toThrow('foreign key')
  })

  it("can't be assigned by someone whose access is off", async () => {
    const [step] = await addStep(mentor)
    await db.switchOff(student)
    expect(await db.as(student, 'update public.bom_steps set assigned_to = $2 where id = $1 returning id', [step.id, student])).toEqual([])
  })

  it('goes back to unassigned when the person is deleted from the team', async () => {
    const helper = await db.member('Casey Helper')
    const [step] = await addStep(mentor)
    await db.as(mentor, 'update public.bom_steps set assigned_to = $2 where id = $1', [step.id, helper])
    await db.sql('delete from public.members where id = $1', [helper])
    expect(await db.sql('select assigned_to from public.bom_steps where id = $1', [step.id])).toEqual([{ assigned_to: null }])
  })

  it("can't have its part, stage or machine changed, even by a mentor", async () => {
    const [step] = await addStep(mentor)
    for (const person of [student, mentor]) {
      await expect(db.as(person, "update public.bom_steps set stage = 'post' where id = $1", [step.id])).rejects.toThrow(PERMISSION_DENIED)
      await expect(db.as(person, "update public.bom_steps set machine = 'lathe' where id = $1", [step.id])).rejects.toThrow(PERMISSION_DENIED)
    }
  })

  it('can be removed by a student', async () => {
    const [step] = await addStep(mentor)
    expect(await db.as(student, 'delete from public.bom_steps where id = $1 returning id', [step.id])).toEqual([{ id: step.id }])
  })

  it("can't be read or changed by someone who isn't signed in, or whose access is off", async () => {
    const [step] = await addStep(mentor)
    await expect(db.as(null, 'select * from public.bom_steps')).rejects.toThrow(PERMISSION_DENIED)
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.bom_steps')).toEqual([])
    expect(await db.as(student, 'update public.bom_steps set quantity_done = 1 where id = $1 returning id', [step.id])).toEqual([])
    expect(await db.as(student, 'delete from public.bom_steps where id = $1 returning id', [step.id])).toEqual([])
    await expect(addStep(student, 'post', null)).rejects.toThrow(PERMISSION_DENIED)
  })

  it('needs a machine for the process stages, and only for them', async () => {
    await expect(addStep(mentor, 'process1', null)).rejects.toThrow('check constraint')
    await expect(addStep(mentor, 'design', 'lathe')).rejects.toThrow('check constraint')
    expect(await addStep(mentor, 'design', null)).toHaveLength(1)
  })

  it('refuses an unknown stage, machine or status, and less than 0 done', async () => {
    await expect(addStep(mentor, 'painting', null)).rejects.toThrow('check constraint')
    await expect(addStep(mentor, 'process1', 'hammer')).rejects.toThrow('check constraint')
    const [step] = await addStep(mentor)
    await expect(db.as(mentor, "update public.bom_steps set status = 'lost' where id = $1", [step.id])).rejects.toThrow('check constraint')
    await expect(db.as(mentor, 'update public.bom_steps set quantity_done = -1 where id = $1', [step.id])).rejects.toThrow('check constraint')
  })

  it('gives a part each stage only once', async () => {
    await addStep(mentor)
    await expect(addStep(mentor, 'process1', 'lathe')).rejects.toThrow('duplicate key')
  })

  it('deletes the stages of a part when the part is deleted', async () => {
    await addStep(mentor)
    await db.as(mentor, 'delete from public.bom_parts where id = $1', [partId])
    expect(await db.sql('select id from public.bom_steps')).toEqual([])
  })
})
