// Tests for the BOM's Slack reminders (reminders.ts). Tests run as a
// student unless they say otherwise. Who can turn off whose reminder is the
// database's job: supabase/tests/bom-reminder-opt-outs.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import type { Member } from '../../core/members'
import { APP_ADDRESS } from '../../core/slack'
import { partsTable, stepsTable, type Part, type ReminderOptOut, type Step } from './data'
import {
  MAX_LINES, dailyMessage, dailyStageReminder, mentorSummary, openStages, remindNow, remindNowMessage, sortWork, weeklyMentorSummary, weeklyMessages, workLine,
  type Work,
} from './reminders'

const LINK = `<${APP_ADDRESS}#/bom|Open the BOM>`
const monday = { date: '2026-11-16', day: 'Mon' as const }

const person = (id: string, name: string, role: Member['role'] = 'student', active = true): Member => ({
  id, slack_user_id: `U0TEST${id.toUpperCase()}`, name, avatar_url: null, role, active, created_at: '',
})
const alex = person('alex', 'Alex Rivera')
const jordan = person('jordan', 'Jordan Kim')
const pat = person('pat', 'Pat Chen', 'mentor')
const morgan = person('morgan', 'Morgan Lee', 'admin')
const sam = person('sam', 'Sam Ortiz', 'mentor', false)
const members = [alex, jordan, pat, morgan, sam]

const part = (id: string, part_number: string, name: string, more: Partial<Part> = {}): Part => ({
  id, system_id: 's', part_number, name, revision: null, kind: 'made', material: 'Aluminum', quantity: 2, vendor: null, vendor_part_number: null,
  product_url: null, onshape_url: null, onshape_id: null, removed_in_onshape: false, created_by: null, created_at: '', ...more,
})
const plate = part('plate', '4096-26-INT-001', 'Intake side plate')
const shaft = part('shaft', '4096-26-INT-002', 'Roller shaft')
const gone = part('gone', '4096-26-INT-003', 'Old bracket', { removed_in_onshape: true })
const parts = [plate, shaft, gone]

let n = 0
const step = (part_id: string, stage: Step['stage'], more: Partial<Step> = {}): Step => ({
  id: `step-${++n}`, part_id, stage, machine: null, status: 'todo', quantity_done: 0, assigned_to: null, due_date: null, created_by: null, created_at: '', ...more,
})
const steps = [
  step('plate', 'design', { status: 'done', assigned_to: 'alex', due_date: '2026-11-01' }),
  step('plate', 'process1', { machine: 'cnc_router', assigned_to: 'alex', due_date: '2026-11-20' }),
  step('shaft', 'process1', { machine: 'lathe', status: 'in_progress', assigned_to: 'alex', due_date: '2026-11-10' }),
  step('shaft', 'post', { assigned_to: 'jordan' }),
  step('plate', 'post', { due_date: '2026-11-12' }),
  step('shaft', 'design'),
  step('gone', 'design', { assigned_to: 'jordan' }),
]

const work = (more: Partial<Work>): Work => ({ part_number: '4096-26-INT-001', part_name: 'Intake side plate', stage: 'CNC router', due_date: null, late: false, ...more })

describe('workLine', () => {
  it('writes the part number, name and stage, then the due date, marking late ones and escaping what people typed', () => {
    const cases: [Partial<Work>, string][] = [
      [{}, '• 4096-26-INT-001 Intake side plate: CNC router'],
      [{ due_date: '2026-11-20' }, '• 4096-26-INT-001 Intake side plate: CNC router, due Nov 20'],
      [{ due_date: '2026-11-06', late: true }, '• *Late* 4096-26-INT-001 Intake side plate: CNC router, due Nov 6'],
      [{ who: 'Alex Rivera' }, '• 4096-26-INT-001 Intake side plate: CNC router (Alex Rivera)'],
      [{ part_name: 'Plate <v2> & spacer' }, '• 4096-26-INT-001 Plate &lt;v2&gt; &amp; spacer: CNC router'],
    ]
    for (const [more, line] of cases) expect(workLine(work(more))).toBe(line)
  })
})

describe('sortWork', () => {
  it('puts late ones first, then the soonest due, then ones with no due date', () => {
    const list = [
      work({ part_number: 'D', due_date: null }),
      work({ part_number: 'C', due_date: '2026-11-30' }),
      work({ part_number: 'B', due_date: '2026-11-20' }),
      work({ part_number: 'A', due_date: '2026-11-02', late: true }),
    ]
    expect(sortWork(list).map((w) => w.part_number)).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('openStages', () => {
  it("lists the stages that aren't done, of custom parts still in Onshape", () => {
    const cots = part('cots', '4096-26-INT-009', 'Bearing', { kind: 'cots' })
    const found = openStages([...parts, cots], [...steps, step('cots', 'design')])
    expect(found.map((o) => `${o.part.name}: ${o.step.stage}`)).toEqual([
      'Intake side plate: process1', 'Roller shaft: process1', 'Roller shaft: post', 'Intake side plate: post', 'Roller shaft: design',
    ])
  })
})

describe('dailyMessage', () => {
  it('lists the stages, late ones first, with a link to the BOM and how to stop them', () => {
    expect(dailyMessage('Alex Rivera', [work({ due_date: '2026-11-20' })])).toBe(
      [
        'Hi Alex, you have 1 stage to do in the BOM:',
        '• 4096-26-INT-001 Intake side plate: CNC router, due Nov 20',
        LINK,
        '_To stop these messages, turn off "Daily Slack reminder" on the BOM page._',
      ].join('\n'),
    )
    const several = dailyMessage('Alex Rivera', [work({ stage: 'Design' }), work({ stage: 'Lathe', due_date: '2026-11-10', late: true })])
    expect(several).toMatch(/^Hi Alex, you have 2 stages to do in the BOM \(1 late\):\n• \*Late\* .*: Lathe, due Nov 10\n• .*: Design\n/)
  })

  it(`lists at most ${MAX_LINES}, then says how many more`, () => {
    const many = Array.from({ length: MAX_LINES + 3 }, (_, i) => work({ part_number: `4096-26-INT-${String(i).padStart(3, '0')}` }))
    const lines = dailyMessage('Alex', many).split('\n')
    expect(lines.filter((line) => line.startsWith('•'))).toHaveLength(MAX_LINES)
    expect(lines).toContain('…and 3 more')
  })
})

describe('dailyStageReminder', () => {
  it("messages each person with open stages once, and nobody who turned it off or has nothing to do", () => {
    const tables = { members, bom_parts: parts, bom_steps: steps, bom_reminder_opt_outs: [] as ReminderOptOut[] }
    const sent = dailyStageReminder.messages(tables, monday)
    expect(sent.map((m) => m.to)).toEqual([alex.slack_user_id, jordan.slack_user_id])
    expect(sent[0].text).toMatch(/you have 2 stages to do in the BOM \(1 late\):\n• \*Late\* 4096-26-INT-002 Roller shaft: Lathe, due Nov 10\n• 4096-26-INT-001 Intake side plate: CNC router, due Nov 20\n/)

    const jordanOff: ReminderOptOut[] = [{ id: 'o', member_id: 'jordan', created_at: '' }]
    expect(dailyStageReminder.messages({ ...tables, bom_reminder_opt_outs: jordanOff }, monday).map((m) => m.to)).toEqual([alex.slack_user_id])
  })
})

describe('mentorSummary', () => {
  it("lists what's late with who has it, then what nobody has, or says nothing when there's neither", () => {
    expect(mentorSummary([], [])).toBeNull()
    const text = mentorSummary([work({ late: true, due_date: '2026-11-10', who: 'Alex Rivera' })], [work({ stage: 'Design' }), work({ stage: 'Mill' })])
    expect(text).toBe(
      [
        'This week in the BOM:',
        '*Late: 1 stage*',
        '• *Late* 4096-26-INT-001 Intake side plate: CNC router, due Nov 10 (Alex Rivera)',
        '*Not given to anyone: 2 stages*',
        '• 4096-26-INT-001 Intake side plate: Design',
        '• 4096-26-INT-001 Intake side plate: Mill',
        LINK,
      ].join('\n'),
    )
  })
})

describe('weeklyMentorSummary', () => {
  it("goes to each mentor and admin whose access is on, or to the mentors' channel if there is one, and not at all when there's nothing to say", () => {
    const sent = weeklyMentorSummary.messages({ members, bom_parts: parts, bom_steps: steps }, monday)
    expect(sent.map((m) => m.to)).toEqual([pat.slack_user_id, morgan.slack_user_id])
    // Late: the lathe (Alex's). Not given to anyone: the plate's post-process (late too, so listed once, as late) and the shaft's design.
    expect(sent[0].text).toContain('*Late: 2 stages*\n• *Late* 4096-26-INT-002 Roller shaft: Lathe, due Nov 10 (Alex Rivera)\n• *Late* 4096-26-INT-001 Intake side plate: Post-process, due Nov 12 (nobody yet)')
    expect(sent[0].text).toContain('*Not given to anyone: 1 stage*\n• 4096-26-INT-002 Roller shaft: Design')

    expect(weeklyMessages(members, parts, steps, monday.date, 'C0MENTORS1').map((m) => m.to)).toEqual(['C0MENTORS1'])
    expect(weeklyMessages(members, parts, [], monday.date)).toEqual([])
  })
})

describe('remindNowMessage', () => {
  it('says which mentor asked, and which stage', () => {
    expect(remindNowMessage('Pat Chen', work({ due_date: '2026-11-20' }))).toBe(
      `Pat Chen asked me to remind you about this stage in the BOM:\n• 4096-26-INT-001 Intake side plate: CNC router, due Nov 20\n${LINK}`,
    )
  })
})

describe('remindNow', () => {
  beforeEach(() => {
    partsTable.reset()
    stepsTable.reset()
  })
  afterEach(() => setDemoRole('student'))

  it("is for mentors, about a stage someone has that isn't done", async () => {
    const example = stepsTable.rows()
    const alexs = example.find((s) => s.assigned_to === DEMO_PEOPLE.alex && s.status !== 'done')!
    const nobodys = example.find((s) => !s.assigned_to && s.status !== 'done')!
    const done = { ...alexs, status: 'done' as const }
    const cases: [role: 'student' | 'mentor' | 'admin', step: Step, error: RegExp | null][] = [
      ['student', alexs, /Only mentors/],
      ['mentor', nobodys, /Assign it to someone first/],
      ['mentor', done, /already done/],
      ['mentor', alexs, null],
      ['admin', alexs, null],
    ]
    for (const [role, s, error] of cases) {
      setDemoRole(role)
      const result = await remindNow(s)
      if (error) expect(result.ok ? 'sent' : result.error, role).toMatch(error)
      else expect(result.ok, role).toBe(true)
    }
  })
})
