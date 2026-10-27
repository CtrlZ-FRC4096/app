// Tests for working out scheduled Slack reminders (reminders.ts), and a
// check of the reminders that are switched on.
import { describe, expect, it } from 'vitest'
import { REMINDERS } from '../modules/reminders'
import type { Member } from './members'
import { checkReminders, MAX_MESSAGES_PER_REMINDER, planReminders, tablesFor, tablesQuery, todayInChicago, type Reminder, type Tables } from './reminders'

const member = (n: number, more: Partial<Member> = {}): Member => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, slack_user_id: `U0TEST000${n}`, name: `Person ${n}`, avatar_url: null, role: 'student', active: true, created_at: '', ...more,
})
const tables: Tables = { members: [member(1), member(2), member(3, { active: false })], parts: [{ name: 'Plate' }] }
const monday = { date: '2026-11-02', day: 'Mon' as const }
const reminder = (more: Partial<Reminder>): Reminder => ({
  name: 'Test', days: ['Mon'], tables: ['parts'], messages: ({ members }) => members.map((m) => ({ to: m.slack_user_id, text: `Hi ${m.name}` })), ...more,
})

describe('the reminders that are switched on', () => {
  it('are all set up right', () => {
    expect(checkReminders(REMINDERS)).toEqual([])
  })
})

describe('todayInChicago', () => {
  it("is Chicago's day, not the server's", () => {
    // 3:07 PM in Chicago in winter is 21:07 UTC, the same day.
    expect(todayInChicago(new Date('2026-01-12T21:07:00Z'))).toEqual({ date: '2026-01-12', day: 'Mon' })
    // 2 AM UTC on Tuesday is still Monday evening in Chicago.
    expect(todayInChicago(new Date('2026-11-03T02:00:00Z'))).toEqual({ date: '2026-11-02', day: 'Mon' })
  })
})

describe('checkReminders', () => {
  it('catches mistakes before a reminder is switched on', () => {
    expect(checkReminders([reminder({}), reminder({ days: [] }), reminder({ name: 'Other', tables: ['parts; drop table members'] })])).toEqual([
      'Two reminders are called "Test".',
      '"Test" has no days, so it never goes out.',
      '"Other" reads "parts; drop table members", which isn\'t a table name.',
    ])
  })
})

describe('tablesFor and tablesQuery', () => {
  it('reads members and each table once, read-only', () => {
    expect(tablesFor([reminder({}), reminder({ tables: ['parts', 'bins'] })])).toEqual(['members', 'parts', 'bins'])
    expect(() => tablesFor([reminder({ tables: ['auth.users'] })])).toThrow(/isn't a table name/)
    const sql = tablesQuery(['members', 'parts'])
    expect(sql).toMatch(/^begin transaction read only;/)
    expect(sql).toContain("'parts', (select coalesce(json_agg(t), '[]'::json) from public.parts t)")
  })
})

describe('planReminders', () => {
  it("makes today's reminders' messages, and skips people whose access is off", () => {
    expect(planReminders([reminder({}), reminder({ name: 'Fridays', days: ['Fri'] })], tables, monday)).toEqual([
      { name: 'Test', messages: [{ to: 'U0TEST0001', text: 'Hi Person 1' }, { to: 'U0TEST0002', text: 'Hi Person 2' }], problems: [] },
    ])
  })

  it("drops messages that can't be sent, saying why without saying who to", () => {
    const run = planReminders([reminder({ messages: () => [{ to: 'Person 1', text: 'Hi' }, { to: 'U0TEST0001', text: ' ' }, { to: 'C0ABC1234', text: 'Hi all' }] })], tables, monday)
    expect(run[0].messages).toEqual([{ to: 'C0ABC1234', text: 'Hi all' }])
    expect(run[0].problems).toEqual(['A message\'s "to" isn\'t a Slack user ID (U…) or channel ID (C…).', 'A message is empty.'])
  })

  it("keeps going when one reminder crashes", () => {
    const broken = reminder({ name: 'Broken', messages: () => { throw new Error('rows is undefined') } })
    expect(planReminders([broken, reminder({})], tables, monday).map((r) => [r.name, r.messages.length, r.problems])).toEqual([
      ['Broken', 0, ['It crashed: rows is undefined']],
      ['Test', 2, []],
    ])
  })

  it('sends nothing when a reminder makes far too many messages', () => {
    const flood = reminder({ messages: () => Array.from({ length: MAX_MESSAGES_PER_REMINDER + 1 }, () => ({ to: 'U0TEST0001', text: 'Hi' })) })
    const [run] = planReminders([flood], tables, monday)
    expect(run.messages).toEqual([])
    expect(run.problems[0]).toMatch(/151 messages, more than 150, so none were sent/)
  })
})
