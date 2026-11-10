// Permission rules for the Batteries module's table. One test for each thing
// the rules should allow or stop.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let mentor: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  mentor = await db.member('Pat Mentor', 'mentor')
})

const add = (person: string, name = '2026-1') =>
  db.as<{ id: string; status: string; status_changed_at: string; created_by: string }>(
    person,
    "insert into public.batteries (name, status) values ($1, 'Charged') returning *",
    [name],
  )

describe('batteries', () => {
  it('lets a mentor add a battery, signed with their own id', async () => {
    const [battery] = await add(mentor)
    expect(battery).toMatchObject({ status: 'Charged', created_by: mentor })
  })

  it("doesn't let a student add a battery", async () => {
    await expect(add(student)).rejects.toThrow(PERMISSION_DENIED)
  })

  it('refuses two batteries with the same number', async () => {
    await add(mentor, '2026-1')
    await expect(add(mentor, '2026-1')).rejects.toThrow('unique constraint')
  })

  it('lets every member see the batteries', async () => {
    await add(mentor)
    expect(await db.as(student, 'select name from public.batteries')).toEqual([{ name: '2026-1' }])
  })

  it("lets a student change a battery's status, and the database records when", async () => {
    const [battery] = await add(mentor)
    await db.sql("update public.batteries set status_changed_at = now() - interval '2 hours' where id = $1", [battery.id])
    const [moved] = await db.as<{ status: string; recent: boolean }>(
      student,
      "update public.batteries set status = 'In the robot' where id = $1 returning status, status_changed_at > now() - interval '1 minute' as recent",
      [battery.id],
    )
    expect(moved).toEqual({ status: 'In the robot', recent: true })
  })

  it("doesn't let anyone set when the status changed by hand", async () => {
    const [battery] = await add(mentor)
    const [after] = await db.as<{ status_changed_at: string }>(
      student,
      "update public.batteries set status_changed_at = '2020-01-01' where id = $1 returning status_changed_at",
      [battery.id],
    )
    expect(after.status_changed_at).toEqual(battery.status_changed_at)
  })

  it("doesn't let a student rename, retire or change the notes on a battery", async () => {
    const [battery] = await add(mentor)
    for (const change of ["name = '2026-9'", 'retired = true', "notes = 'Cracked case'"]) {
      await expect(db.as(student, `update public.batteries set ${change} where id = $1`, [battery.id])).rejects.toThrow('Only mentors and admins')
    }
  })

  it("doesn't let a student sneak a rename in with a status change", async () => {
    const [battery] = await add(mentor)
    await expect(db.as(student, "update public.batteries set status = 'Charging', name = '2026-9' where id = $1", [battery.id])).rejects.toThrow('Only mentors and admins')
    expect(await db.sql('select name, status from public.batteries')).toEqual([{ name: '2026-1', status: 'Charged' }])
  })

  it('lets a mentor rename and retire a battery', async () => {
    const [battery] = await add(mentor)
    expect(await db.as(mentor, "update public.batteries set name = '2026-9', retired = true where id = $1 returning name, retired", [battery.id])).toEqual([
      { name: '2026-9', retired: true },
    ])
  })

  it('can be deleted by a mentor but not by a student', async () => {
    const [battery] = await add(mentor)
    expect(await db.as(student, 'delete from public.batteries where id = $1 returning id', [battery.id])).toEqual([])
    expect(await db.as(mentor, 'delete from public.batteries where id = $1 returning id', [battery.id])).toEqual([{ id: battery.id }])
  })

  it("can't be seen or changed by someone who isn't signed in", async () => {
    const [battery] = await add(mentor)
    await expect(db.as(null, 'select * from public.batteries')).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, "update public.batteries set status = 'Charging' where id = $1", [battery.id])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be seen or changed by someone whose access is off", async () => {
    const [battery] = await add(mentor)
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.batteries')).toEqual([])
    expect(await db.as(student, "update public.batteries set status = 'Charging' where id = $1 returning id", [battery.id])).toEqual([])
  })
})
