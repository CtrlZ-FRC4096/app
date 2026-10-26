// Permission rules for the Example module's table. Copy this file when you
// add a table, and write one test for each thing the rules should allow or
// stop.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let mentor: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  mentor = await db.member('Pat Mentor', 'mentor')
})

const post = (person: string, text: string) =>
  db.as<{ id: string; created_by: string }>(person, 'insert into public.example_notes (text) values ($1) returning *', [text])

describe('example notes', () => {
  it('lets a member post a note, signed with their own id', async () => {
    const [note] = await post(student, 'Bring a laptop')
    expect(note.created_by).toBe(student)
  })

  it("doesn't let anyone post a note as someone else", async () => {
    await expect(
      db.as(student, 'insert into public.example_notes (text, created_by) values ($1, $2)', ['Signed by a mentor', mentor]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('refuses empty notes and notes over 200 characters', async () => {
    await expect(post(student, '')).rejects.toThrow('check constraint')
    await expect(post(student, 'x'.repeat(201))).rejects.toThrow('check constraint')
  })

  it("can't be read or posted by someone who isn't signed in", async () => {
    await post(student, 'Bring a laptop')
    await expect(db.as(null, 'select * from public.example_notes')).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, "insert into public.example_notes (text) values ('Hi')")).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read or posted by someone whose access is off", async () => {
    await post(student, 'Bring a laptop')
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.example_notes')).toEqual([])
    await expect(post(student, 'Still here?')).rejects.toThrow(PERMISSION_DENIED)
  })

  it('can be removed by a mentor but not by a student', async () => {
    const [note] = await post(student, 'Bring a laptop')
    expect(await db.as(student, 'delete from public.example_notes where id = $1 returning id', [note.id])).toEqual([])
    expect(await db.as(mentor, 'delete from public.example_notes where id = $1 returning id', [note.id])).toEqual([{ id: note.id }])
  })

  it("can't be edited after posting, even by a mentor", async () => {
    const [note] = await post(student, 'Bring a laptop')
    await expect(db.as(mentor, "update public.example_notes set text = 'Changed' where id = $1", [note.id])).rejects.toThrow(PERMISSION_DENIED)
  })
})
