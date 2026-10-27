/**
 * The automatic daily pull from the attendance channel.
 *
 * scripts/attendance-sync.ts runs this in GitHub Actions: it reads the
 * channel's messages and the member list from Slack, turns them into a
 * payload here, and hands the payload to the database function
 * private.import_attendance, which adds only what's new. The rules are the
 * same as importing an export by hand (resolve() in slack-export.ts).
 */
import { parseDay, resolve, type SlackUser } from './slack-export'

export interface SyncPayload {
  /** The newest message read, so the next pull can start a little before it. */
  newest_message_at: string | null
  people: { slack_user_id: string | null; name: string }[]
  checks: { slack_user_id: string | null; name: string; direction: 'in' | 'out'; at: string }[]
  rsvps: { slack_user_id: string; day: string; coming: boolean }[]
}

/** Build the payload from Slack's member list and the channel's messages. */
export function syncPayload(users: SlackUser[], messages: unknown[]): SyncPayload {
  const found = resolve(users, [parseDay(messages)])
  const person = (key: string) => found.people.get(key)!
  const times = messages
    .map((m) => Number((m as { ts?: unknown }).ts))
    .filter((t) => Number.isFinite(t))
  return {
    newest_message_at: times.length ? new Date(Math.max(...times) * 1000).toISOString() : null,
    people: [...found.people.values()],
    checks: found.checks.map((c) => ({ ...person(c.key), direction: c.direction, at: c.at })),
    rsvps: found.rsvps.map((r) => ({ slack_user_id: person(r.key).slack_user_id!, day: r.day, coming: r.coming })),
  }
}

/**
 * Where the next pull starts: a few days before the newest message already
 * pulled, so votes on recent polls are picked up again. The first pull
 * starts at `firstDay` (ATTENDANCE_SINCE), or 180 days ago. A day typed
 * when running the workflow by hand overrides this (see pickedDay).
 */
export function pullFrom(newestPulled: string | null, firstDay: string | null, now: Date = new Date()): Date {
  if (newestPulled) return new Date(Date.parse(newestPulled) - 3 * 86_400_000)
  if (firstDay) return new Date(`${firstDay}T00:00:00Z`)
  return new Date(now.getTime() - 180 * 86_400_000)
}

const DAY = 86_400_000

/** A day typed into "Run workflow" to pull older history, like "2025-09-01". Throws if it isn't a real day before now. */
export function pickedDay(value: string, now: Date = new Date()): Date {
  const day = value.trim()
  const at = new Date(`${day}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== day) {
    throw new Error(`"${value}" isn't a day. Type it like 2025-09-01.`)
  }
  if (at > now) throw new Error(`${day} is in the future. Pick a day to start pulling from.`)
  return at
}

/**
 * A warning for a pull from a picked day when the oldest message Slack sent
 * back is weeks later. On Slack's free plan the bot can only read the last
 * 90 days, so older messages need a Slack export and the Import tab.
 */
export function shortHistory(asked: Date, oldestMessage: Date | null): string | null {
  if (oldestMessage && oldestMessage.getTime() - asked.getTime() < 14 * DAY) return null
  const found = oldestMessage ? `starts on ${oldestMessage.toISOString().slice(0, 10)}` : 'is empty'
  return (
    `You asked for messages from ${asked.toISOString().slice(0, 10)}, but what Slack sent back ${found}. ` +
    "If the channel has older messages, Slack isn't letting the bot read them (on the free plan it can only read the last 90 days): " +
    'import a Slack export on the Attendance tab for those.'
  )
}
