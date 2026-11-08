// Permission rules for notifications in the app (the bell at the top right).
// People see, read and delete only their own, and for now add them only
// for themselves.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let other: string
let mentor: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  other = await db.member('Casey Lee')
  mentor = await db.member('Pat Mentor', 'mentor')
})

const add = (person: string | null, title = 'Ctrl-Z', url: string | null = './#/notifications') =>
  db.as<{ id: string; member_id: string; read_at: string | null }>(person, "insert into public.notifications (title, body, url) values ($1, 'Hi', $2) returning *", [title, url])

const titles = (person: string) => db.as<{ title: string }>(person, 'select title from public.notifications order by title')

describe('notifications', () => {
  it('lets a member add one for themselves', async () => {
    const [row] = await add(student)
    expect(row.member_id).toBe(student)
    expect(row.read_at).toBeNull()
  })

  it("doesn't let anyone add one for someone else, not even a mentor", async () => {
    await expect(
      db.as(mentor, "insert into public.notifications (member_id, title) values ($1, 'Hi')", [student]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it("shows people only their own, not even a mentor anyone else's", async () => {
    await add(student, 'Mine')
    await add(other, 'Theirs')
    expect(await titles(student)).toEqual([{ title: 'Mine' }])
    expect(await titles(mentor)).toEqual([])
  })

  it('lets people mark their own read, and change nothing else', async () => {
    const [row] = await add(student)
    const [read] = await db.as<{ read_at: string | null }>(student, 'update public.notifications set read_at = now() where id = $1 returning read_at', [row.id])
    expect(read.read_at).not.toBeNull()
    await expect(db.as(student, "update public.notifications set title = 'Changed' where id = $1", [row.id])).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(student, 'update public.notifications set member_id = $2 where id = $1', [row.id, other])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("doesn't let anyone mark someone else's read", async () => {
    const [row] = await add(student)
    expect(await db.as(mentor, 'update public.notifications set read_at = now() where id = $1 returning id', [row.id])).toEqual([])
  })

  it("lets people delete their own, but not anyone else's", async () => {
    const [mine] = await add(student)
    const [theirs] = await add(other)
    expect(await db.as(student, 'delete from public.notifications where id = $1 returning id', [mine.id])).toEqual([{ id: mine.id }])
    expect(await db.as(student, 'delete from public.notifications where id = $1 returning id', [theirs.id])).toEqual([])
  })

  it("is closed to someone who isn't signed in, or whose access is off", async () => {
    await expect(add(null)).rejects.toThrow(PERMISSION_DENIED)
    await add(student)
    await db.switchOff(student)
    expect(await titles(student)).toEqual([])
    await expect(add(student)).rejects.toThrow(PERMISSION_DENIED)
  })

  it('only opens pages inside the app', async () => {
    await expect(add(student, 'Ctrl-Z', 'https://example.com/')).rejects.toThrow('check constraint')
    await expect(add(student, 'Ctrl-Z', 'javascript:alert(1)')).rejects.toThrow('check constraint')
    expect(await add(student, 'Ctrl-Z', './#/purchasing')).toHaveLength(1)
    expect(await add(student, 'Ctrl-Z', null)).toHaveLength(1)
  })

  it('needs a title', async () => {
    await expect(add(student, '  ')).rejects.toThrow('check constraint')
  })
})
