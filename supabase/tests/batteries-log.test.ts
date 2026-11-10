// Permission rules for the Batteries module's history. Everyone adds and
// reads; nobody edits or deletes.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let otherStudent: string
let mentor: string
let battery: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  otherStudent = await db.member('Casey Lee')
  mentor = await db.member('Pat Mentor', 'mentor')
  const [row] = await db.as<{ id: string }>(mentor, "insert into public.batteries (name) values ('2026-1') returning id")
  battery = row.id
})

const reading = (person: string, voltage = 12.9, ohms = 0.014) =>
  db.as<{ id: string; created_by: string }>(
    person,
    "insert into public.batteries_log (battery_id, kind, voltage, resistance_ohms) values ($1, 'reading', $2, $3) returning *",
    [battery, voltage, ohms],
  )

describe('battery history', () => {
  it('lets a member add a reading and a status change, signed as themselves', async () => {
    const [row] = await reading(student)
    expect(row.created_by).toBe(student)
    await db.as(student, "insert into public.batteries_log (battery_id, kind, status, match) values ($1, 'status', 'In the robot', 'Qual 12')", [battery])
  })

  it("doesn't let anyone add history as someone else", async () => {
    await expect(
      db.as(student, "insert into public.batteries_log (battery_id, kind, voltage, created_by) values ($1, 'reading', 12.9, $2)", [battery, otherStudent]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('lets every member read everyone’s history', async () => {
    await reading(student)
    expect(await db.as(otherStudent, 'select voltage from public.batteries_log')).toEqual([{ voltage: '12.9' }])
  })

  it("can't be edited or deleted, even by a mentor", async () => {
    const [row] = await reading(student)
    for (const person of [student, mentor]) {
      await expect(db.as(person, 'update public.batteries_log set voltage = 13 where id = $1', [row.id])).rejects.toThrow(PERMISSION_DENIED)
      await expect(db.as(person, 'delete from public.batteries_log where id = $1', [row.id])).rejects.toThrow(PERMISSION_DENIED)
    }
  })

  it('refuses a reading with nothing in it, or numbers no tester would give', async () => {
    await expect(db.as(student, "insert into public.batteries_log (battery_id, kind) values ($1, 'reading')", [battery])).rejects.toThrow('check constraint')
    await expect(reading(student, -1)).rejects.toThrow('check constraint')
    await expect(reading(student, 12.9, 5)).rejects.toThrow('check constraint')
  })

  it('refuses a status change with no status', async () => {
    await expect(db.as(student, "insert into public.batteries_log (battery_id, kind) values ($1, 'status')", [battery])).rejects.toThrow('check constraint')
  })

  it("goes with the battery when a mentor deletes one added by mistake", async () => {
    await reading(student)
    await db.as(mentor, 'delete from public.batteries where id = $1', [battery])
    expect(await db.sql('select * from public.batteries_log')).toEqual([])
  })

  it("can't be read or added by someone who isn't signed in, or whose access is off", async () => {
    await reading(student)
    await expect(db.as(null, 'select * from public.batteries_log')).rejects.toThrow(PERMISSION_DENIED)
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.batteries_log')).toEqual([])
    await expect(reading(student)).rejects.toThrow(PERMISSION_DENIED)
  })
})
