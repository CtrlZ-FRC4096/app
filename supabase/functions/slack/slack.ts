/**
 * What the `slack` server function lets the app do, checked before it
 * does it. Kept apart from index.ts so supabase/tests can test it: plain
 * TypeScript, no Deno.
 *
 * - `check` (anyone on the team): checks the bot works by sending you a
 *   test message. The Members page's "Check them" button uses it.
 * - `me` (anyone on the team): a message to yourself. The Example
 *   module's "Send me a Slack message" button uses it.
 * - `send` (mentors only): one message to some team members, by their
 *   member IDs (the function looks up their Slack IDs), and/or to one
 *   channel the app has been invited to.
 *
 * So the bot's token can't be used for anything else, like reading
 * channels.
 */

/** Longer than this, and nobody reads it. Slack itself allows much more. */
export const MAX_TEXT = 3000
/** The most people one message can go to at once. */
export const MAX_PEOPLE = 100

export type SlackRequest = { kind: 'check' } | { kind: 'me'; text: string } | { kind: 'send'; people: string[]; channel: string | null; text: string }

const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHANNEL_ID = /^[CG][A-Z0-9]{6,}$/

/** The message's text, trimmed, or what's wrong with it. */
function messageText(value: unknown): string | { error: string; status: number } {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return { error: 'Write the message first.', status: 400 }
  if (text.length > MAX_TEXT) return { error: `Keep the message under ${MAX_TEXT} characters. This one is ${text.length}.`, status: 400 }
  return text
}

/** What the app asked for, or why it isn't allowed. */
export function slackRequest(body: unknown, role: string): SlackRequest | { error: string; status: number } {
  const r = (body ?? {}) as Record<string, unknown>
  if (r.kind === 'check') return { kind: 'check' }
  if (r.kind === 'me') {
    const text = messageText(r.text)
    return typeof text === 'string' ? { kind: 'me', text } : text
  }
  if (r.kind !== 'send') return { error: 'Ask to send a message, or check.', status: 400 }
  if (role !== 'mentor' && role !== 'admin') return { error: 'Only mentors can send Slack messages from the app.', status: 403 }

  const people = r.people ?? []
  if (!Array.isArray(people) || !people.every((id) => typeof id === 'string' && MEMBER_ID.test(id))) {
    return { error: 'people should be a list of member IDs.', status: 400 }
  }
  const unique = [...new Set(people as string[])]
  if (unique.length > MAX_PEOPLE) return { error: `Send to ${MAX_PEOPLE} people or fewer at once. Use a channel for everyone.`, status: 400 }

  const channel = r.channel ?? null
  if (channel !== null && !(typeof channel === 'string' && CHANNEL_ID.test(channel))) {
    return { error: 'channel should be a Slack channel ID, starting with C.', status: 400 }
  }
  if (unique.length === 0 && !channel) return { error: 'Say who to send it to: some people, a channel, or both.', status: 400 }

  const text = messageText(r.text)
  if (typeof text !== 'string') return text
  return { kind: 'send', people: unique, channel, text }
}

/** The message "Check them" sends you. */
export function testMessage(name: string): string {
  return `Hi ${name}! This is a test message from the team app, sent when you clicked Check them on the Members page. Slack messages from the app work.`
}
