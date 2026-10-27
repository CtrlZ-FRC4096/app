/**
 * The Slack reminders that are switched on. Each goes out by itself on its
 * days, in the afternoon (see .github/workflows/slack-reminders.yml for the
 * time). How they work: src/core/reminders.ts.
 *
 * To switch one on, import it and add it to the list. Like registering a
 * module, this needs a mentor's approval: it messages real people.
 */
import type { Reminder } from '../core/reminders'

export const REMINDERS: Reminder[] = [
  // For example, after `import { weeklyNotesThanks } from './example/reminders'`:
  // weeklyNotesThanks,
]
