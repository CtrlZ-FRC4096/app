/**
 * The Slack reminders that are switched on. Each goes out by itself on its
 * days, in the afternoon (see .github/workflows/slack-reminders.yml for the
 * time). How they work: src/core/reminders.ts.
 *
 * To switch one on, import it and add it to the list. Like registering a
 * module, this needs a mentor's approval: it messages real people.
 */
import type { Reminder } from '../core/reminders'
import { dailyStageReminder, weeklyMentorSummary } from './bom/reminders'

export const REMINDERS: Reminder[] = [
  // For example, after `import { weeklyNotesThanks } from './example/reminders'`:
  // weeklyNotesThanks,

  // BOM (#22): each person's open stages on school days, and a weekly
  // summary of what's late and unassigned for mentors.
  dailyStageReminder,
  weeklyMentorSummary,
]
