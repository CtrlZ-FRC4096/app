// Tests for data.ts. Run them with `npm test`. They run in demo mode, as the
// made-up student (Alex) unless a test views the app as someone else. Who may
// do what is the database's job: that's tested in supabase/tests/tasks.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import { membersTable } from '../../core/members'
import { PIT_SUBGROUPS } from '../status/data'
import {
  SUBTEAMS, addTask, boardSections, checkTask, dueText, editTask, findTasks, isLate, moveAlong, moveBack, myTasks, removeTask, taskNotices,
  taskSummary, tasksTable, type Task, type TaskFields,
} from './data'

const { alex, jordan, casey, pat, sam } = DEMO_PEOPLE

/** A fixed day, so no test depends on today's date. */
const DAY = '2026-11-19'

let count = 0
/** A made-up task with only the fields a test cares about. */
function task(fields: Partial<Task>): Task {
  count += 1
  return {
    id: `task-${count}`, title: `Task ${count}`, details: '', subteam: 'General', assignee_ids: [], due_date: null, status: 'todo', done_at: null,
    created_at: `2026-11-10T18:00:${String(count % 60).padStart(2, '0')}Z`, created_by: casey, ...fields,
  }
}

/** An example task, found by its title. */
const named = (title: string) => tasksTable.rows().find((t) => t.title === title)!

const fields = (changes: Partial<TaskFields> = {}): TaskFields => ({
  title: 'Sweep the shop floor', details: '', subteam: 'General', assignee_ids: [alex], due_date: '2026-11-20', ...changes,
})

beforeEach(() => {
  setDemoRole('student')
  tasksTable.reset()
  membersTable.reset()
})

afterEach(() => {
  setDemoRole('student')
})

describe('dates', () => {
  it("marks a task late only when it isn't done and its due date has passed", () => {
    const cases: [Partial<Task>, boolean][] = [
      [{ due_date: '2026-11-18', status: 'todo' }, true],
      [{ due_date: '2026-11-18', status: 'in_progress' }, true],
      [{ due_date: '2026-11-18', status: 'done' }, false],
      [{ due_date: DAY, status: 'todo' }, false],
      [{ due_date: '2026-11-20', status: 'todo' }, false],
      [{ due_date: null, status: 'todo' }, false],
    ]
    expect(cases.map(([t]) => isLate(task(t), DAY))).toEqual(cases.map(([, late]) => late))
  })

  it('writes the due date for the page', () => {
    expect([null, DAY, '2026-11-20'].map((due) => dueText(due, DAY))).toEqual(['', 'Due today', 'Due Nov 20'])
  })
})

describe('my tasks', () => {
  it("lists only that person's unfinished tasks, soonest due first and no due date last", () => {
    const tasks = [
      task({ title: 'No date', assignee_ids: [alex] }),
      task({ title: 'Later', assignee_ids: [alex, jordan], due_date: '2026-11-25' }),
      task({ title: 'Done', assignee_ids: [alex], due_date: '2026-11-01', status: 'done' }),
      task({ title: 'Late', assignee_ids: [alex], due_date: '2026-11-15', status: 'in_progress' }),
      task({ title: 'Nobody yet', due_date: '2026-11-15' }),
    ]
    const titles = (person: string) => myTasks(tasks, person).map((t) => t.title)
    expect([titles(alex), titles(jordan), titles(pat)]).toEqual([['Late', 'Later', 'No date'], ['Later'], []])
  })
})

describe('moving tasks along', () => {
  it('moves your own task To do → In progress → Done, and no further', async () => {
    const { id } = named('Put the new drill bits away')
    const seen: (string | null)[][] = []
    for (let i = 0; i < 2; i++) {
      const moved = await moveAlong(id)
      seen.push(moved.ok ? [moved.value.status, moved.value.done_at && 'set'] : [moved.error])
    }
    expect(seen).toEqual([['in_progress', null], ['done', 'set']])
    expect(await moveAlong(id)).toMatchObject({ ok: false, error: expect.stringMatching(/already done/) })
  })

  it('moves a task back a step to undo a mis-tap, down to To do', async () => {
    const { id } = named('Sweep the shop floor')
    const seen: (string | null)[][] = []
    for (let i = 0; i < 2; i++) {
      const moved = await moveBack(id)
      seen.push(moved.ok ? [moved.value.status, moved.value.done_at] : [moved.error])
    }
    expect(seen).toEqual([['in_progress', null], ['todo', null]])
    expect(await moveBack(id)).toMatchObject({ ok: false, error: expect.stringMatching(/hasn't been started/) })
  })

  it("lets a student leader, mentor or admin move a task they aren't on along, and back", async () => {
    setDemoRole('leader')
    const { id } = named('Update the drive code README')
    const results = [await moveAlong(id), await moveBack(id)]
    expect(results.map((result) => (result.ok ? result.value.status : result.error))).toEqual(['in_progress', 'todo'])
  })

  it('tells a student to ask a student leader or mentor, and changes nothing', async () => {
    const before = tasksTable.rows()
    const mine = named('Put the new drill bits away')
    const results = [
      await addTask(fields()),
      await editTask(mine.id, fields({ title: 'Renamed' })),
      await removeTask(mine.id),
      await moveAlong(named('Update the drive code README').id),
    ]
    for (const result of results) expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/student leader or mentor/) })
    expect(tasksTable.rows()).toEqual(before)
  })
})

describe('checking a task', () => {
  it('refuses a task that breaks a rule', () => {
    const members = membersTable.rows()
    const cases: [Partial<TaskFields>, RegExp | null][] = [
      [{ title: '   ' }, /what needs doing/],
      [{ title: 'x'.repeat(121) }, /under 120 characters/],
      [{ details: 'x'.repeat(1001) }, /under 1000 characters/],
      [{ subteam: 'Outreach' }, /subteam from the list/],
      [{ assignee_ids: [alex, sam] }, /Sam Ortiz's access is switched off/],
      [{ assignee_ids: ['someone-else'] }, /isn't on the team/],
      [{ due_date: '2026-02-30' }, /from the calendar/],
      [{ title: 'x'.repeat(120), details: 'x'.repeat(1000), assignee_ids: [] }, null],
    ]
    expect(cases.map(([changes]) => checkTask(fields(changes), members))).toEqual(
      cases.map(([, problem]) => (problem ? expect.stringMatching(problem) : null)),
    )
  })

  it('lets people already on a task stay when it is edited, even if their access is now off', () => {
    expect(checkTask(fields({ assignee_ids: [alex, sam] }), membersTable.rows(), [sam])).toBeNull()
  })
})

describe('managing tasks (student leaders, mentors and admins)', () => {
  it('adds a task at To do, tidied, signed by whoever added it', async () => {
    setDemoRole('leader')
    const added = await addTask(fields({ title: '  Charge the drills  ', details: ' Both of them ', assignee_ids: [alex, jordan, alex], due_date: '' }))
    expect(added.ok && added.value).toMatchObject({
      title: 'Charge the drills', details: 'Both of them', assignee_ids: [alex, jordan], due_date: null, status: 'todo', done_at: null, created_by: casey,
    })
  })

  it('edits everything about a task but its status', async () => {
    setDemoRole('leader')
    const { id } = named('Re-crimp the PDH connectors')
    const changes = { title: 'Re-crimp the PDP', details: 'Ask Pat first.', subteam: 'Mechanical', assignee_ids: [jordan], due_date: '2026-12-01' }
    await editTask(id, changes)
    expect(tasksTable.rows().find((t) => t.id === id)).toMatchObject({ ...changes, status: 'in_progress' })
  })

  it('deletes only the task asked for', async () => {
    setDemoRole('leader')
    const { id } = named('Sort the hardware bins')
    const before = tasksTable.rows().length
    await removeTask(id)
    expect([tasksTable.rows().length, tasksTable.rows().some((t) => t.id === id)]).toEqual([before - 1, false])
  })
})

describe('the board', () => {
  it("finds tasks by title, details or a person's name, ignoring capitals", () => {
    const names: Record<string, string> = { [alex]: 'Alex Rivera', [jordan]: 'Jordan Kim' }
    const titles = (search: string) => findTasks(tasksTable.rows(), search, (id) => names[id] ?? '').map((t) => t.title).sort()
    expect(['BINS', 'ferrules', 'jordan', 'zzz'].map(titles)).toEqual([
      ['Sort the hardware bins'],
      ['Re-crimp the PDH connectors'],
      ['Label the spare motor controllers', 'Sort the hardware bins', 'Update the drive code README'],
      [],
    ])
    expect(findTasks(tasksTable.rows(), '  ', () => '')).toHaveLength(tasksTable.rows().length)
  })

  it('has a section for every subteam in order, plus any subteam no longer listed, with done tasks kept apart', () => {
    const tasks = [
      task({ title: 'Wire', subteam: 'Electrical' }),
      task({ title: 'Wired earlier', subteam: 'Electrical', status: 'done', done_at: '2026-11-01T20:00:00Z' }),
      task({ title: 'Wired lately', subteam: 'Electrical', status: 'done', done_at: '2026-11-18T20:00:00Z' }),
      task({ title: 'Flyers', subteam: 'Outreach' }),
    ]
    const summary = (show?: string) =>
      boardSections(tasks, show).map((s) => [s.subteam, s.open.map((t) => t.title), s.done.map((t) => t.title)])
    expect(summary()).toEqual([
      ['General', [], []],
      ['Mechanical', [], []],
      ['Electrical', ['Wire'], ['Wired lately', 'Wired earlier']],
      ['Programming', [], []],
      ['Drive team', [], []],
      ['Outreach', ['Flyers'], []],
    ])
    expect(summary('Electrical')).toEqual([['Electrical', ['Wire'], ['Wired lately', 'Wired earlier']]])
  })

  it("uses the pit checklist's subteam names, so they're the same everywhere", () => {
    expect([...SUBTEAMS]).toEqual(expect.arrayContaining([...PIT_SUBGROUPS]))
  })
})

describe('the home page', () => {
  it('says how many tasks are yours, or how many are open for a leader with none', () => {
    const mine = [
      task({ assignee_ids: [alex], due_date: '2026-11-15' }),
      task({ assignee_ids: [alex], due_date: DAY }),
      task({ assignee_ids: [alex] }),
      task({ assignee_ids: [alex], status: 'done' }),
    ]
    const cases: [Task[], string, 'student' | 'mentor'][] = [
      [mine, alex, 'student'],
      [[task({ assignee_ids: [alex], due_date: '2026-11-25' })], alex, 'student'],
      [mine, jordan, 'student'],
      [mine, pat, 'mentor'],
      [[], pat, 'mentor'],
    ]
    expect(cases.map(([tasks, id, role]) => taskSummary(tasks, { id, role }, DAY))).toEqual([
      { tone: 'warn', text: '3 tasks for you · 1 due today' },
      { tone: 'info', text: '1 task for you' },
      { tone: 'plain', text: 'Nothing assigned to you' },
      { tone: 'plain', text: '3 open tasks' },
      { tone: 'plain', text: 'No open tasks' },
    ])
  })

  it('needs your attention for your own late tasks, as one line', () => {
    const late = (title: string) => task({ title, assignee_ids: [alex], due_date: '2026-11-15' })
    const cases = [[late('Sweep')], [late('Sweep'), late('Mop')], [task({ assignee_ids: [alex], due_date: DAY })]]
    expect(cases.map((tasks) => taskNotices(tasks, alex, DAY))).toEqual([
      [{ tone: 'warn', text: 'Late: Sweep' }],
      [{ tone: 'warn', text: '2 of your tasks are late' }],
      [],
    ])
  })
})
