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
 * starts at `firstDay` (ATTENDANCE_SINCE), or 180 days ago.
 */
export function pullFrom(newestPulled: string | null, firstDay: string | null, now: Date = new Date()): Date {
  if (newestPulled) return new Date(Date.parse(newestPulled) - 3 * 86_400_000)
  if (firstDay) return new Date(`${firstDay}T00:00:00Z`)
  return new Date(now.getTime() - 180 * 86_400_000)
}
