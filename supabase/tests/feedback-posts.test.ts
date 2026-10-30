// Permission rules for the Feedback module's table: who can send, read and
// delete ideas and problems.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let mentor: string
let admin: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  mentor = await db.member('Pat Mentor', 'mentor')
  admin = await db.member('Morgan Admin', 'admin')
})

const send = (person: string, kind: string, text: string) =>
  db.as<{ id: string; created_by: string }>(
    person,
    'insert into public.feedback_posts (kind, text) values ($1, $2) returning *',
    [kind, text],
  )

const remove = (person: string, id: string) =>
  db.as<{ id: string }>(person, 'delete from public.feedback_posts where id = $1 returning id', [id])

describe('feedback posts', () => {
  it('lets anyone on the team send a post, signed with their own id', async () => {
    const [post] = await send(student, 'Idea', 'Label the drawers')
    expect(post.created_by).toBe(student)
  })

  it("doesn't let anyone send a post as someone else", async () => {
    await expect(
      db.as(student, 'insert into public.feedback_posts (kind, text, created_by) values ($1, $2, $3)', [
        'Idea',
        'Signed by a mentor',
        mentor,
      ]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('only allows the two kinds the app offers', async () => {
    await expect(send(student, 'Complaint', 'Not one of the kinds')).rejects.toThrow('check constraint')
  })

  it('refuses empty posts and posts over 500 characters', async () => {
    await expect(send(student, 'Idea', '')).rejects.toThrow('check constraint')
    await expect(send(student, 'Idea', 'x'.repeat(501))).rejects.toThrow('check constraint')
  })

  it('lets everyone on the team read the whole list', async () => {
    await send(student, 'Problem', 'The pit checklist is hard to tick off with gloves on')
    expect(await db.as(mentor, 'select text from public.feedback_posts')).toHaveLength(1)
    expect(await db.as(student, 'select text from public.feedback_posts')).toHaveLength(1)
  })

  it("can't be read or sent by someone who isn't signed in", async () => {
    await send(student, 'Idea', 'Label the drawers')
    await expect(db.as(null, 'select * from public.feedback_posts')).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, "insert into public.feedback_posts (kind, text) values ('Idea', 'Hi')")).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be read or sent by someone whose access is off", async () => {
    await send(student, 'Idea', 'Label the drawers')
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.feedback_posts')).toEqual([])
    await expect(send(student, 'Idea', 'Still here?')).rejects.toThrow(PERMISSION_DENIED)
  })

  it('can be deleted by a mentor but not by the student who sent it', async () => {
    const [post] = await send(student, 'Idea', 'Label the drawers')
    expect(await remove(student, post.id)).toEqual([])
    expect(await remove(mentor, post.id)).toEqual([{ id: post.id }])
  })

  it('can be deleted by an admin', async () => {
    const [post] = await send(student, 'Problem', 'The scouting page forgets my last match')
    expect(await remove(admin, post.id)).toEqual([{ id: post.id }])
  })

  it("can't be edited after sending, even by a mentor", async () => {
    const [post] = await send(student, 'Idea', 'Label the drawers')
    await expect(
      db.as(mentor, "update public.feedback_posts set text = 'Changed' where id = $1", [post.id]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })
})
