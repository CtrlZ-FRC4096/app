// Permission rules for the Training module's progress table. One test for
// each thing the rules should allow or stop.
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

const markDone = (person: string, lesson = 'code-first-button') =>
  db.as<{ id: string; created_by: string }>(person, 'insert into public.training_progress (lesson_id) values ($1) returning *', [lesson])

describe('training progress', () => {
  it('lets a member mark a lesson done, as themselves', async () => {
    const [row] = await markDone(student)
    expect(row.created_by).toBe(student)
  })

  it("doesn't let anyone mark a lesson done for someone else", async () => {
    await expect(
      db.as(student, 'insert into public.training_progress (lesson_id, created_by) values ($1, $2)', ['code-first-button', otherStudent]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('refuses the same lesson twice for one person, but not for two people', async () => {
    await markDone(student)
    await expect(markDone(student)).rejects.toThrow('unique constraint')
    await markDone(otherStudent)
  })

  it("shows students their own progress only, and mentors everyone's", async () => {
    await markDone(student)
    await markDone(otherStudent, 'code-first-rule')
    expect(await db.as(student, 'select lesson_id from public.training_progress')).toEqual([{ lesson_id: 'code-first-button' }])
    expect(await db.as(mentor, 'select lesson_id from public.training_progress order by lesson_id')).toEqual([
      { lesson_id: 'code-first-button' },
      { lesson_id: 'code-first-rule' },
    ])
  })

  it('lets a member mark their own lesson not done, but not anyone else’s', async () => {
    const [mine] = await markDone(student)
    const [theirs] = await markDone(otherStudent)
    expect(await db.as(student, 'delete from public.training_progress where id = $1 returning id', [theirs.id])).toEqual([])
    expect(await db.as(mentor, 'delete from public.training_progress where id = $1 returning id', [theirs.id])).toEqual([])
    expect(await db.as(student, 'delete from public.training_progress where id = $1 returning id', [mine.id])).toEqual([{ id: mine.id }])
  })

  it("can't be changed, only added or removed", async () => {
    const [row] = await markDone(student)
    await expect(db.as(student, "update public.training_progress set lesson_id = 'code-first-rule' where id = $1", [row.id])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read or added by someone who isn't signed in", async () => {
    await markDone(student)
    await expect(db.as(null, 'select * from public.training_progress')).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, "insert into public.training_progress (lesson_id) values ('code-first-button')")).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read or added by someone whose access is off", async () => {
    await markDone(student)
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.training_progress')).toEqual([])
    await expect(markDone(student, 'code-first-rule')).rejects.toThrow(PERMISSION_DENIED)
  })
})
