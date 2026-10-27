/**
 * An example Slack reminder, to copy. It isn't switched on: a reminder only
 * goes out once it's listed in src/modules/reminders.ts.
 *
 * Every Monday, it thanks each person who posted notes in the last week,
 * in a direct message. Notice:
 *
 *   - notesThanks() makes the text. It's a plain function, tested in
 *     reminders.test.ts like everything in data.ts.
 *   - It reads the example_notes table. Every reminder also gets members,
 *     for each person's Slack ID (slack_user_id) and name.
 *   - It doesn't check whose access is off: messages to them are dropped
 *     for you.
 *
 * See src/core/reminders.ts for how reminders work.
 */
import { plural } from '../../core/format'
import type { Reminder } from '../../core/reminders'
import { appLink, slackEscape } from '../../core/slack'
import type { Note } from './data'

const WEEK = 7 * 24 * 60 * 60 * 1000

/** The message for someone who posted `count` notes last week. */
export function notesThanks(name: string, count: number): string {
  return `Thanks for posting ${plural(count, 'note', 'notes')} last week, ${slackEscape(name)}! ${appLink('example', 'See the notes')}`
}

export const weeklyNotesThanks: Reminder = {
  name: "Example: thanks for last week's notes",
  days: ['Mon'],
  tables: ['example_notes'],
  messages: ({ members, example_notes }, today) => {
    const notes = example_notes as Note[]
    const since = Date.parse(today.date) - WEEK
    const counts = new Map<string, number>()
    for (const note of notes) {
      if (note.created_by && Date.parse(note.created_at) >= since) counts.set(note.created_by, (counts.get(note.created_by) ?? 0) + 1)
    }
    return members
      .filter((member) => counts.has(member.id))
      .map((member) => ({ to: member.slack_user_id, text: notesThanks(member.name, counts.get(member.id) ?? 0) }))
  },
}
