/**
 * Slack reminders on a schedule: messages that go out by themselves on
 * certain days, like "You have 2 parts to CAM" (issue #22).
 *
 * How it works:
 *
 *   - A module writes a Reminder: which days it goes out, which tables it
 *     reads, and a plain function that turns their rows into messages.
 *     Copy src/modules/example/reminders.ts, and test the function like
 *     anything in data.ts.
 *   - Listing it in src/modules/reminders.ts switches it on. That needs a
 *     mentor's approval: it messages real people.
 *   - Every afternoon, the "Send Slack reminders" workflow
 *     (.github/workflows/slack-reminders.yml) runs scripts/slack-reminders.ts.
 *     It reads the tables, read-only, so a reminder can't change anything.
 *     planReminders() below works out each reminder's messages, and the
 *     team's Slack bot sends them.
 *
 * Messages to people whose access is switched off are dropped for you.
 */
import type { Member } from './members'
import { checkSlackMessage, type SlackMessage } from './slack'

export type Day = 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat'

export const EVERY_DAY: Day[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The day it is in Chicago when reminders go out. */
export interface Today {
  /** Like 2026-11-03. */
  date: string
  day: Day
}

/** Every row of the tables a reminder reads, by table name. members is always there. */
export type Tables = { members: Member[] } & Record<string, unknown[]>

export interface Reminder {
  /** For the Actions log, like "Daily work reminders". */
  name: string
  /** Which days it goes out (Chicago time). */
  days: Day[]
  /** The tables it reads, like ['bom_parts']. It gets every row of each, plus members. */
  tables: string[]
  /** Today's messages, from those rows. Return [] when there's nothing to say. */
  messages: (tables: Tables, today: Today) => SlackMessage[]
}

/** More than this from one reminder in a day is probably a mistake, so none are sent. */
export const MAX_MESSAGES_PER_REMINDER = 150

const TABLE_NAME = /^[a-z][a-z0-9_]{0,62}$/

/** What day it is in Chicago. */
export function todayInChicago(now: Date = new Date()): Today {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(now)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { date: `${part('year')}-${part('month')}-${part('day')}`, day: part('weekday') as Day }
}

/** Problems with the list of reminders, for a test to catch before they're switched on. */
export function checkReminders(reminders: Reminder[]): string[] {
  const problems: string[] = []
  const names = new Set<string>()
  for (const reminder of reminders) {
    if (!reminder.name.trim()) problems.push('A reminder has no name.')
    if (names.has(reminder.name)) problems.push(`Two reminders are called "${reminder.name}".`)
    names.add(reminder.name)
    if (reminder.days.length === 0) problems.push(`"${reminder.name}" has no days, so it never goes out.`)
    for (const day of reminder.days) if (!EVERY_DAY.includes(day)) problems.push(`"${reminder.name}" has a day that isn't one: ${day}.`)
    for (const table of reminder.tables) if (!TABLE_NAME.test(table)) problems.push(`"${reminder.name}" reads "${table}", which isn't a table name.`)
  }
  return problems
}

/** The tables to read for these reminders: members, and each table they list. */
export function tablesFor(reminders: Reminder[]): string[] {
  const names = [...new Set(['members', ...reminders.flatMap((r) => r.tables)])]
  const wrong = names.find((name) => !TABLE_NAME.test(name))
  if (wrong) throw new Error(`"${wrong}" isn't a table name.`)
  return names
}

/**
 * The SQL that reads those tables, read-only: one JSON object with every
 * row of each. Only tables in the public schema, where the app's are.
 */
export function tablesQuery(names: string[]): string {
  const columns = names.map((name) => `'${name}', (select coalesce(json_agg(t), '[]'::json) from public.${name} t)`)
  return `begin transaction read only;\nselect json_build_object(${columns.join(', ')});\ncommit;\n`
}

export interface ReminderRun {
  name: string
  messages: SlackMessage[]
  /** What went wrong, written so the public Actions log never shows a message or who it's to. */
  problems: string[]
}

/** Each reminder due today, with the messages to send and anything wrong with them. */
export function planReminders(reminders: Reminder[], tables: Tables, today: Today): ReminderRun[] {
  const switchedOff = new Set(tables.members.filter((m) => !m.active).map((m) => m.slack_user_id))
  return reminders
    .filter((reminder) => reminder.days.includes(today.day))
    .map((reminder) => {
      let made: SlackMessage[]
      try {
        made = reminder.messages(tables, today)
      } catch (error) {
        return { name: reminder.name, messages: [], problems: [`It crashed: ${error instanceof Error ? error.message : String(error)}`] }
      }
      const problems: string[] = []
      const messages = made.filter((message) => {
        if (switchedOff.has(message.to)) return false
        const problem = checkSlackMessage(message)
        if (problem) problems.push(problem)
        return !problem
      })
      if (messages.length > MAX_MESSAGES_PER_REMINDER) {
        const tooMany = `It made ${messages.length} messages, more than ${MAX_MESSAGES_PER_REMINDER}, so none were sent. Check it isn't messaging everyone by mistake.`
        return { name: reminder.name, messages: [], problems: [tooMany] }
      }
      return { name: reminder.name, messages: messages.map((m) => ({ to: m.to, text: m.text.trim() })), problems }
    })
}
