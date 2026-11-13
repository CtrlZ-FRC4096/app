// Permission rules for the Prescouting module's notes (#117):
// signed-in members read every row, add one, and change any of them; student
// leaders, mentors and admins delete them. One row per team per event.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let other: string
let mentor: string
let leader: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  other = await db.member('Casey Lee')
  mentor = await db.member('Pat Mentor', 'mentor')
  leader = await db.member('Casey Leader', 'leader')
})

interface PrescoutRow {
  id: string
  team_number: number
  strengths: string
  created_by: string
}

const add = (person: string, team = 9991, strengths = 'Fast cycles') =>
  db.as<PrescoutRow>(person, "insert into public.prescouting_notes (event_key, team_number, strengths) values ('2026test', $1, $2) returning *", [team, strengths])

describe('prescouting notes', () => {
  it('lets a member add notes for a team, signed with their own id, with empty answers to start', async () => {
    const [row] = await add(student)
    expect(row).toMatchObject({ team_number: 9991, strengths: 'Fast cycles', created_by: student })
  })

  it("doesn't let anyone add notes as someone else", async () => {
    await expect(
      db.as(student, "insert into public.prescouting_notes (event_key, team_number, created_by) values ('2026test', 9991, $1)", [mentor]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('keeps one row per team per event', async () => {
    await add(student)
    await expect(add(other)).rejects.toThrow('duplicate key')
    expect(await add(other, 9992)).toHaveLength(1)
  })

  it("lets any member change anyone's answers", async () => {
    const [row] = await add(student)
    const changed = await db.as<PrescoutRow>(other, "update public.prescouting_notes set strengths = 'Great auto' where id = $1 returning *", [row.id])
    expect(changed).toMatchObject([{ strengths: 'Great auto' }])
  })

  it("doesn't let anyone change which team a row is for, or who started it", async () => {
    const [row] = await add(student)
    await expect(db.as(other, 'update public.prescouting_notes set team_number = 9999 where id = $1', [row.id])).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(other, 'update public.prescouting_notes set created_by = $2 where id = $1', [row.id, other])).rejects.toThrow(PERMISSION_DENIED)
  })

  it('refuses an answer over 2,000 characters', async () => {
    await expect(add(student, 9991, 'x'.repeat(2001))).rejects.toThrow('check constraint')
  })

  it('can be deleted by a mentor but not by a student', async () => {
    const [row] = await add(student)
    expect(await db.as(student, 'delete from public.prescouting_notes where id = $1 returning id', [row.id])).toEqual([])
    expect(await db.as(mentor, 'delete from public.prescouting_notes where id = $1 returning id', [row.id])).toEqual([{ id: row.id }])
  })

  it('lets a student leader delete notes, but not when their access is switched off', async () => {
    const [row] = await add(student)
    expect(await db.as(leader, 'delete from public.prescouting_notes where id = $1 returning id', [row.id])).toEqual([{ id: row.id }])
    const [next] = await add(student, 9992)
    await db.switchOff(leader)
    expect(await db.as(leader, 'delete from public.prescouting_notes where id = $1 returning id', [next.id])).toEqual([])
  })

  it("can't be read, added or changed by someone who isn't signed in", async () => {
    const [row] = await add(student)
    await expect(db.as(null, 'select * from public.prescouting_notes')).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, "insert into public.prescouting_notes (event_key, team_number) values ('2026test', 9992)")).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, "update public.prescouting_notes set strengths = 'Hi' where id = $1", [row.id])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read or changed by someone whose access is off", async () => {
    const [row] = await add(student)
    await db.switchOff(other)
    expect(await db.as(other, 'select * from public.prescouting_notes')).toEqual([])
    expect(await db.as(other, "update public.prescouting_notes set strengths = 'Hi' where id = $1 returning id", [row.id])).toEqual([])
    await expect(add(other, 9992)).rejects.toThrow(PERMISSION_DENIED)
  })
})
