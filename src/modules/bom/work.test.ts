// Tests for work.ts. Run them with `npm test`.
// Who is allowed to assign stages is the database's job: that's tested in
// supabase/tests/bom-steps.test.ts. Tests run as a student unless they say otherwise.
import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import { membersTable } from '../../core/members'
import { partsTable, stepName, stepsFor, stepsTable, systemsTable, type Part, type Step } from './data'
import { assignWholePart, myWork, workNotices, type WorkGroup } from './work'

beforeEach(() => {
  setDemoRole('student')
  partsTable.reset()
  systemsTable.reset()
  stepsTable.reset()
  membersTable.reset()
})

// The example stages are dated around this day.
const DAY = '2026-11-13'

const part = (name: string) => partsTable.rows().find((p) => p.name === name)!
const stepsOf = (name: string) => stepsFor(part(name), stepsTable.rows())

/** A group list written short, like [['in_progress', ['Intake side plate: CNC router']]]. */
const short = (groups: WorkGroup[]) => groups.map((g) => [g.status, g.items.map((i) => `${i.part.name}: ${stepName(i.step)}`)])

describe('myWork', () => {
  it("lists only that person's stages, grouped To do, In progress, Done, leaving out empty groups and parts removed in Onshape", () => {
    const steps = stepsTable.rows()
    const parts = partsTable.rows()
    const systems = systemsTable.rows()
    const sidePlate = part('Intake side plate')
    // Jordan's side plate post-process, marked done.
    const withDone = steps.map((s) => (s.part_id === sidePlate.id && s.stage === 'post' ? { ...s, status: 'done' as const } : s))
    const removed = parts.map((p): Part => (p.id === sidePlate.id ? { ...p, removed_in_onshape: true } : p))
    const cases: [string, Step[], Part[], (string | string[])[][]][] = [
      [DEMO_PEOPLE.alex, steps, parts, [['in_progress', ['Intake side plate: CNC router', 'Bellypan: Design']]]],
      [DEMO_PEOPLE.jordan, steps, parts, [['todo', ['Intake side plate: Post-process']], ['in_progress', ['Roller shaft: Lathe']]]],
      [DEMO_PEOPLE.jordan, withDone, parts, [['in_progress', ['Roller shaft: Lathe']], ['done', ['Intake side plate: Post-process']]]],
      [DEMO_PEOPLE.jordan, steps, removed, [['in_progress', ['Roller shaft: Lathe']]]],
      // Pat has nothing assigned.
      [DEMO_PEOPLE.pat, steps, parts, []],
    ]
    for (const [person, stepRows, partRows, expected] of cases) {
      expect(short(myWork(person, stepRows, partRows, systems, DAY))).toEqual(expected)
    }
  })

  it('puts late stages first, then the soonest due, then those with no due date, and marks the late ones', () => {
    const due = (name: string, stage: Step['stage'], due_date: string | null): Step => ({
      ...stepsOf(name).find((s) => s.stage === stage)!, assigned_to: DEMO_PEOPLE.casey, status: 'todo', due_date,
    })
    const steps = [
      due('Roller shaft', 'design', null),
      due('Frame rail', 'post', '2026-11-25'),
      due('Bellypan', 'design', '2026-11-18'),
      due('Pivot spacer', 'post', '2026-11-01'),
      due('Intake side plate', 'design', null),
    ]
    const [group] = myWork(DEMO_PEOPLE.casey, steps, partsTable.rows(), systemsTable.rows(), DAY)
    expect(group.items.map((i) => [i.part.name, i.late])).toEqual([
      ['Pivot spacer', true],
      ['Bellypan', false],
      ['Frame rail', false],
      // No due date: by part number, so INT-001 before INT-002.
      ['Intake side plate', false],
      ['Roller shaft', false],
    ])
  })
})

describe('workNotices', () => {
  it('counts the stages not done yet, says how many are late in the warning colour, and says nothing when there are none', () => {
    const cases: [string, string | undefined, string | undefined][] = [
      // Alex's side plate routing was due Nov 6.
      [DEMO_PEOPLE.alex, 'warn', '2 stages to do (1 late)'],
      [DEMO_PEOPLE.jordan, 'info', '2 stages to do'],
      [DEMO_PEOPLE.pat, undefined, undefined],
    ]
    for (const [person, tone, text] of cases) {
      const [notice] = workNotices(myWork(person, stepsTable.rows(), partsTable.rows(), systemsTable.rows(), DAY))
      expect([notice?.tone, notice?.text], person).toEqual([tone, text])
    }
    // Done stages don't count.
    const allDone = stepsTable.rows().map((s) => ({ ...s, status: 'done' as const }))
    expect(workNotices(myWork(DEMO_PEOPLE.alex, allDone, partsTable.rows(), systemsTable.rows(), DAY))).toEqual([])
  })
})

describe('assignWholePart', () => {
  it('gives every stage that isn\'t done the same person and due date, and leaves done stages with who did them', async () => {
    const result = await assignWholePart(part('Intake side plate'), stepsTable.rows(), { assigned_to: DEMO_PEOPLE.casey, due_date: '2026-11-30' })
    expect(result).toEqual({ ok: true, value: 2 })
    expect(stepsOf('Intake side plate').map((s) => [stepName(s), s.assigned_to, s.due_date])).toEqual([
      ['Design', null, null],
      ['Pre-process', null, null],
      ['CNC router', DEMO_PEOPLE.casey, '2026-11-30'],
      ['Post-process', DEMO_PEOPLE.casey, '2026-11-30'],
    ])
  })

  it("saves nothing, and says why, when the person can't be given work or the part has no stages left to assign", async () => {
    const allDone = stepsTable.rows().map((s) => ({ ...s, status: 'done' as const }))
    const cases: [string, Step[], string | null, RegExp][] = [
      ['Intake side plate', stepsTable.rows(), DEMO_PEOPLE.sam, /switched off/],
      ['Brushless motor', stepsTable.rows(), DEMO_PEOPLE.casey, /no stages yet/],
      ['Intake side plate', allDone, DEMO_PEOPLE.casey, /Every stage .* is done/],
    ]
    for (const [name, steps, person, error] of cases) {
      const before = stepsTable.rows()
      expect(await assignWholePart(part(name), steps, { assigned_to: person, due_date: null })).toMatchObject({ ok: false, error })
      expect(stepsTable.rows()).toEqual(before)
    }
  })
})
