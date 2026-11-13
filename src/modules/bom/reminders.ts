/**
 * Slack reminders about BOM stages (#22), built on the team's scheduled
 * reminders (src/core/reminders.ts; the Example module's reminders.ts is
 * the pattern).
 *
 *   - dailyStageReminder: on build days, each person with open stages
 *     assigned to them gets one direct message listing them, late ones
 *     first. People can turn theirs off with the switch on the BOM page
 *     (setDailyReminder() in data.ts).
 *   - weeklyMentorSummary: once a week, each mentor and admin gets what's
 *     late and what nobody has been given yet.
 *   - remindNow(): a mentor's "Remind now" button on one stage, which sends
 *     that one reminder straight away through the `slack` server function.
 *
 * The text of every message comes from a plain function below
 * (dailyMessage, remindNowMessage, mentorSummary), tested in
 * reminders.test.ts. They go out once they're listed in
 * src/modules/reminders.ts.
 */
import { plural } from '../../core/format'
import type { Member } from '../../core/members'
import type { Day, Reminder } from '../../core/reminders'
import { isMentor } from '../../core/roles'
import { currentUser } from '../../core/session'
import { appLink, sendSlack, slackEscape, type SlackMessage } from '../../core/slack'
import { fail, ok, type Result } from '../../core/table'
import { dueText, getsDailyReminder, isOverdue, partsTable, stepName, today, type Part, type ReminderOptOut, type Step } from './data'

// The choices the team should confirm (#22, "Things to decide first"). The
// time of day is set by .github/workflows/slack-reminders.yml: about 3 PM
// Chicago time, before after-school build.

/** The daily reminder goes out on school days, before build. Not on weekends. */
export const DAILY_DAYS: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

/** The mentors' summary goes out at the start of each week. */
export const WEEKLY_DAYS: Day[] = ['Mon']

/**
 * A mentors' Slack channel for the weekly summary, like 'C0123ABCD', once
 * there is one and the app has been invited to it. A channel's ID isn't a
 * secret. While this is null, each mentor and admin gets it directly.
 */
export const MENTOR_CHANNEL: string | null = null

/** The most stages listed in one message. Past this it says "…and 4 more", so a message stays short. */
export const MAX_LINES = 15

/** One stage, as a reminder writes it. */
export interface Work {
  part_number: string
  part_name: string
  /** Like "CNC router" or "Design" (stepName() in data.ts). */
  stage: string
  due_date: string | null
  late: boolean
  /** Who has it, for the mentors' summary. */
  who?: string
}

/** A stage of a part, as a reminder writes it. `day` is today, like 2026-11-09, to tell if it's late. */
export function workOf(part: Part, step: Step, day: string): Work {
  return { part_number: part.part_number, part_name: part.name, stage: stepName(step), due_date: step.due_date, late: isOverdue(step, day) }
}

/**
 * Every stage that isn't done, with its part. Only the stages the BOM page
 * shows: custom parts, not ones removed in Onshape.
 */
export function openStages(parts: Part[], steps: Step[]): { part: Part; step: Step }[] {
  const byId = new Map(parts.filter((p) => p.kind === 'made' && !p.removed_in_onshape).map((p) => [p.id, p]))
  return steps.flatMap((step) => {
    const part = byId.get(step.part_id)
    return part && step.status !== 'done' ? [{ part, step }] : []
  })
}

/** Late first, then the soonest due, then ones with no due date, each by part number. */
export function sortWork(work: Work[]): Work[] {
  return [...work].sort(
    (a, b) =>
      Number(b.late) - Number(a.late) ||
      (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') ||
      a.part_number.localeCompare(b.part_number) ||
      a.stage.localeCompare(b.stage),
  )
}

/** One line of a list: "• *Late* 4096-26-INT-001 Intake side plate: CNC router, due Nov 6". */
export function workLine(work: Work): string {
  const due = work.due_date ? `, due ${dueText(work.due_date)}` : ''
  const who = work.who ? ` (${slackEscape(work.who)})` : ''
  return `• ${work.late ? '*Late* ' : ''}${slackEscape(`${work.part_number} ${work.part_name}`)}: ${slackEscape(work.stage)}${due}${who}`
}

/** The lines for a list, in order, cut off at MAX_LINES. */
function workLines(work: Work[]): string[] {
  const sorted = sortWork(work)
  const lines = sorted.slice(0, MAX_LINES).map(workLine)
  if (sorted.length > MAX_LINES) lines.push(`…and ${sorted.length - MAX_LINES} more`)
  return lines
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

/** The daily message to someone with these open stages. */
export function dailyMessage(name: string, work: Work[]): string {
  const late = work.filter((w) => w.late).length
  return [
    `Hi ${slackEscape(firstName(name))}, you have ${plural(work.length, 'stage', 'stages')} to do in the BOM${late ? ` (${late} late)` : ''}:`,
    ...workLines(work),
    appLink('bom', 'Open the BOM'),
    '_To stop these messages, turn off "Daily Slack reminder" on the BOM page._',
  ].join('\n')
}

/** The message a mentor's "Remind now" sends about one stage. `from` is the mentor's name. */
export function remindNowMessage(from: string, work: Work): string {
  return [`${slackEscape(from)} asked me to remind you about this stage in the BOM:`, workLine(work), appLink('bom', 'Open the BOM')].join('\n')
}

/** The mentors' weekly summary: what's late (and who has it) and what nobody has yet. Null when there's nothing to say. */
export function mentorSummary(late: Work[], unassigned: Work[]): string | null {
  if (late.length === 0 && unassigned.length === 0) return null
  const lines = ['This week in the BOM:']
  if (late.length) lines.push(`*Late: ${plural(late.length, 'stage', 'stages')}*`, ...workLines(late))
  if (unassigned.length) lines.push(`*Not given to anyone: ${plural(unassigned.length, 'stage', 'stages')}*`, ...workLines(unassigned))
  lines.push(appLink('bom', 'Open the BOM'))
  return lines.join('\n')
}

/** Today's daily messages: one to each person with open stages, unless they turned it off. */
export function dailyMessages(members: Member[], parts: Part[], steps: Step[], optOuts: ReminderOptOut[], day: string): SlackMessage[] {
  const open = openStages(parts, steps)
  return members
    .filter((member) => getsDailyReminder(member.id, optOuts))
    .map((member) => ({ member, work: open.filter((o) => o.step.assigned_to === member.id).map((o) => workOf(o.part, o.step, day)) }))
    .filter(({ work }) => work.length > 0)
    .map(({ member, work }) => ({ to: member.slack_user_id, text: dailyMessage(member.name, work) }))
}

/** This week's summary, to the mentors' channel if there is one, or else to each mentor and admin. */
export function weeklyMessages(members: Member[], parts: Part[], steps: Step[], day: string, channel: string | null = MENTOR_CHANNEL): SlackMessage[] {
  const names = new Map(members.map((m) => [m.id, m.name]))
  const open = openStages(parts, steps)
  const late = open
    .filter((o) => isOverdue(o.step, day))
    .map((o) => ({ ...workOf(o.part, o.step, day), who: o.step.assigned_to ? (names.get(o.step.assigned_to) ?? 'A former member') : 'nobody yet' }))
  const unassigned = open.filter((o) => !o.step.assigned_to && !isOverdue(o.step, day)).map((o) => workOf(o.part, o.step, day))
  const text = mentorSummary(late, unassigned)
  if (!text) return []
  if (channel) return [{ to: channel, text }]
  return members.filter((m) => m.active && isMentor(m.role)).map((m) => ({ to: m.slack_user_id, text }))
}

export const dailyStageReminder: Reminder = {
  name: 'BOM: your stages',
  days: DAILY_DAYS,
  tables: ['bom_parts', 'bom_steps', 'bom_reminder_opt_outs'],
  messages: ({ members, bom_parts, bom_steps, bom_reminder_opt_outs }, today) =>
    dailyMessages(members, bom_parts as Part[], bom_steps as Step[], bom_reminder_opt_outs as ReminderOptOut[], today.date),
}

export const weeklyMentorSummary: Reminder = {
  name: "BOM: mentors' weekly summary",
  days: WEEKLY_DAYS,
  tables: ['bom_parts', 'bom_steps'],
  messages: ({ members, bom_parts, bom_steps }, today) => weeklyMessages(members, bom_parts as Part[], bom_steps as Step[], today.date),
}

/**
 * Mentors: send the person a stage is assigned to a reminder about it,
 * straight away. It goes even if they turned off their daily one, because
 * a mentor asked. The `slack` server function checks it's a mentor too.
 */
export async function remindNow(step: Step): Promise<Result> {
  const me = currentUser()
  if (!me || !isMentor(me.role)) return fail('Only mentors can send a reminder. Ask a mentor.')
  if (!step.assigned_to) return fail('Nobody has this stage yet. Assign it to someone first.')
  if (step.status === 'done') return fail(`${stepName(step)} is already done, so there's nothing to remind them about.`)
  const part = partsTable.rows().find((p) => p.id === step.part_id)
  if (!part) return fail('That part has been deleted.')
  const sent = await sendSlack({ people: [step.assigned_to], text: remindNowMessage(me.name, workOf(part, step, today())) })
  if (!sent.ok) return sent
  const problem = sent.value.failed[0]
  if (problem) return fail(`The reminder didn't send: ${problem.error}`)
  return ok(null)
}
