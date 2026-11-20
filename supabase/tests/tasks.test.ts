// Permission rules for the Task board (#157). One test for each thing the
// rules should allow or stop. Students see every task and move their own
// along; student leaders, mentors and admins do everything else.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let other: string
let leader: string
let mentor: string
let admin: string

beforeEach(async () => {
  student = await db.member('Riley Park')
  other = await db.member('Casey Lee')
  leader = await db.member('Casey Leader', 'leader')
  mentor = await db.member('Pat Mentor', 'mentor')
  admin = await db.member('Morgan Admin', 'admin')
})

interface TaskRow {
  id: string
  title: string
  status: string
  done_at: string | null
  created_by: string
}

/** `person` adds a General task for `assignees`. */
const add = (person: string, assignees: string[], title = 'Sort the hardware bins') =>
  db.as<TaskRow>(person, 'insert into public.tasks (title, subteam, assignee_ids) values ($1, $2, $3) returning *', [title, 'General', assignees])

/** A student leader adds a task for `assignees`. */
const addTask = async (assignees: string[], title?: string) => (await add(leader, assignees, title))[0]

const setStatus = (person: string, id: string, status: string) =>
  db.as<TaskRow>(person, 'update public.tasks set status = $2 where id = $1 returning *', [id, status])

describe('tasks', () => {
  it('lets every member see every task, not only their own', async () => {
    await addTask([student])
    expect(await db.as(other, 'select title from public.tasks')).toEqual([{ title: 'Sort the hardware bins' }])
  })

  it('lets a student leader, mentor or admin add a task, signed as themselves', async () => {
    for (const person of [leader, mentor, admin]) {
      const [task] = await add(person, [student])
      expect(task.created_by).toBe(person)
    }
  })

  it("doesn't let a student add a task, even one for themselves", async () => {
    await expect(add(student, [student])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("doesn't let a student leader add a task as someone else", async () => {
    await expect(
      db.as(leader, "insert into public.tasks (title, created_by) values ('Sweep the floor', $1)", [mentor]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it("lets a student move a task they're on along, and back", async () => {
    const task = await addTask([student, other])
    for (const status of ['in_progress', 'done', 'todo']) {
      expect((await setStatus(student, task.id, status)).map((row) => row.status)).toEqual([status])
    }
  })

  it("doesn't let a student move someone else's task along", async () => {
    const task = await addTask([other])
    expect(await setStatus(student, task.id, 'done')).toEqual([])
    expect(await db.sql('select status from public.tasks')).toEqual([{ status: 'todo' }])
  })

  it("doesn't let a student change anything but the status of their own task", async () => {
    const task = await addTask([student])
    const changes = [
      "title = 'Renamed'",
      "details = 'More'",
      "subteam = 'Electrical'",
      "due_date = '2026-12-01'",
      "assignee_ids = '{}'",
      `assignee_ids = '{${student},${other}}'`,
      "status = 'done', title = 'Renamed'",
      `created_by = '${other}'`,
      "created_at = '2000-01-01'",
    ]
    for (const change of changes) {
      await expect(db.as(student, `update public.tasks set ${change} where id = $1`, [task.id])).rejects.toThrow('Only student leaders')
    }
    // A done_at the student sends is ignored: the database keeps its own.
    await db.as(student, "update public.tasks set done_at = '2000-01-01' where id = $1", [task.id])
    expect(await db.sql('select title, details, subteam, due_date, assignee_ids, status, done_at from public.tasks')).toEqual([
      { title: 'Sort the hardware bins', details: '', subteam: 'General', due_date: null, assignee_ids: [student], status: 'todo', done_at: null },
    ])
  })

  it('lets a student leader or mentor edit, reassign, re-date and move any task', async () => {
    const task = await addTask([student])
    for (const person of [leader, mentor]) {
      expect(
        await db.as(
          person,
          "update public.tasks set title = 'Renamed', subteam = 'Electrical', assignee_ids = $2, due_date = '2026-12-01', status = 'in_progress' where id = $1 returning title, subteam, assignee_ids, status",
          [task.id, [other]],
        ),
      ).toEqual([{ title: 'Renamed', subteam: 'Electrical', assignee_ids: [other], status: 'in_progress' }])
    }
  })

  it("sets done_at to the database's time when a task is done, and clears it when it's moved back", async () => {
    const task = await addTask([student])
    expect(task.done_at).toBeNull()
    const [done] = await setStatus(student, task.id, 'done')
    expect(done.done_at).not.toBeNull()
    // A change that leaves the status alone keeps done_at, and a time sent by the app is ignored.
    const [kept] = await db.as<TaskRow>(leader, "update public.tasks set title = 'Renamed', done_at = '2000-01-01' where id = $1 returning *", [task.id])
    expect(kept.done_at).toEqual(done.done_at)
    expect((await setStatus(student, task.id, 'in_progress'))[0].done_at).toBeNull()
    const [added] = await db.as<TaskRow>(leader, "insert into public.tasks (title, status, done_at) values ('Already done', 'done', null) returning *")
    expect(added.done_at).not.toBeNull()
  })

  it('can be deleted by a student leader, mentor or admin, but not by a student it is for', async () => {
    const tasks = [await addTask([student], 'One'), await addTask([student], 'Two'), await addTask([student], 'Three')]
    expect(await db.as(student, 'delete from public.tasks where id = $1 returning id', [tasks[0].id])).toEqual([])
    for (const [i, person] of [leader, mentor, admin].entries()) {
      expect(await db.as(person, 'delete from public.tasks where id = $1 returning id', [tasks[i].id])).toEqual([{ id: tasks[i].id }])
    }
  })

  it('refuses an empty title, a title over 120 characters, details over 1000 characters, and an unknown status', async () => {
    await expect(add(leader, [], '')).rejects.toThrow('check constraint')
    await expect(add(leader, [], 'x'.repeat(121))).rejects.toThrow('check constraint')
    await expect(db.as(leader, "insert into public.tasks (title, details) values ('Sweep', $1)", ['x'.repeat(1001)])).rejects.toThrow('check constraint')
    await expect(db.as(leader, "insert into public.tasks (title, status) values ('Sweep', 'waiting')")).rejects.toThrow('check constraint')
  })

  it("can't be seen or changed by someone who isn't signed in", async () => {
    const task = await addTask([student])
    await expect(db.as(null, 'select * from public.tasks')).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, "insert into public.tasks (title) values ('Hi')")).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(null, "update public.tasks set status = 'done' where id = $1", [task.id])).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be seen or changed by someone whose access is off, even their own task", async () => {
    const task = await addTask([student])
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.tasks')).toEqual([])
    expect(await setStatus(student, task.id, 'done')).toEqual([])
    await db.switchOff(leader)
    await expect(add(leader, [])).rejects.toThrow(PERMISSION_DENIED)
    expect(await db.as(leader, 'delete from public.tasks where id = $1 returning id', [task.id])).toEqual([])
  })
})
