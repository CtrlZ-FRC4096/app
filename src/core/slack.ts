/**
 * Slack messages from the team app's bot, for any module: a "Remind now"
 * button, or telling a channel that something happened. They go through the
 * `slack` server function (supabase/functions/slack/), which holds the
 * bot's token. Only mentors can send; the server function checks too.
 *
 * In demo mode nothing is sent: sendSlack() answers as if it all went.
 *
 * For messages that go out by themselves on a schedule, like a daily
 * reminder, see src/core/reminders.ts.
 *
 * Message text uses Slack's formatting: *bold*, _italic_, and links from
 * slackLink() or appLink(). Put anything people typed (names, part names)
 * through slackEscape() first, so it shows as typed.
 */
import { callFunction } from './functions'
import { isMentor } from './roles'
import { currentUser } from './session'
import { fail, type Result } from './table'

/** Where the app is, for links in messages. */
export const APP_ADDRESS = 'https://ctrlz-frc4096.github.io/app/'

/** Longer than this, and nobody reads it. The server function allows the same. */
export const MAX_SLACK_TEXT = 3000

/** A message: to a person's Slack ID (members.slack_user_id, starting with U) or a channel's ID (starting with C). */
export interface SlackMessage {
  to: string
  text: string
}

/** Show text exactly as typed in Slack, even with <, > or &. */
export function slackEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A link in a Slack message: slackLink('https://…', 'Open it'). */
export function slackLink(url: string, label: string): string {
  return `<${url.replace(/[|<>]/g, (c) => encodeURIComponent(c))}|${slackEscape(label)}>`
}

/** A link to a page in the app: appLink('bom', 'Open the BOM'). */
export function appLink(page: string, label: string): string {
  return slackLink(`${APP_ADDRESS}#/${page}`, label)
}

const SLACK_ID = /^[UWCG][A-Z0-9]{6,}$/

/** Why a message can't be sent, or null if it can. */
export function checkSlackMessage(message: SlackMessage): string | null {
  if (!SLACK_ID.test(message.to)) return "A message's \"to\" isn't a Slack user ID (U…) or channel ID (C…)."
  const length = message.text.trim().length
  if (length === 0) return 'A message is empty.'
  if (length > MAX_SLACK_TEXT) return `A message is ${length} characters. Keep it under ${MAX_SLACK_TEXT}.`
  return null
}

export interface SlackSend {
  /** Member IDs (members.id) to message directly. */
  people?: string[]
  /** A channel's ID, starting with C. In Slack, click the channel's name: it's at the bottom. The app must be in the channel. */
  channel?: string
  text: string
}

export interface SlackSent {
  /** How many messages went: one per person, plus one for the channel. */
  sent: number
  /** Who didn't get it, and why. */
  failed: { name: string; error: string }[]
}

/** What's wrong with a message's text, or null if nothing. */
function checkText(text: string): string | null {
  if (!text) return 'Write the message first.'
  if (text.length > MAX_SLACK_TEXT) return `Keep the message under ${MAX_SLACK_TEXT} characters. This one is ${text.length}.`
  return null
}

/**
 * Send yourself a message from the team's Slack bot: it arrives in your
 * direct messages with the app. Anyone on the team can. The Example
 * module's "Send me a Slack message" button shows how to use it.
 */
export async function sendSlackToMe(text: string): Promise<Result<SlackSent>> {
  const trimmed = text.trim()
  const problem = checkText(trimmed)
  if (problem) return fail(problem)
  return callFunction<SlackSent>('slack', { kind: 'me', text: trimmed }, () => ({ sent: 1, failed: [] }))
}

/** Send a message from the team's Slack bot, to some people, a channel, or both. Mentors only. */
export async function sendSlack(message: SlackSend): Promise<Result<SlackSent>> {
  const me = currentUser()
  if (!me || !isMentor(me.role)) return fail('Only mentors can send Slack messages from the app.')
  const people = [...new Set(message.people ?? [])]
  const channel = message.channel?.trim() || null
  const text = message.text.trim()
  if (people.length === 0 && !channel) return fail('Say who to send it to: some people, a channel, or both.')
  if (channel && !/^[CG][A-Z0-9]{6,}$/.test(channel)) {
    return fail("That isn't a channel ID. In Slack, click the channel's name: the ID, starting with C, is at the bottom.")
  }
  const problem = checkText(text)
  if (problem) return fail(problem)
  return callFunction<SlackSent>('slack', { kind: 'send', people, channel, text }, () => ({ sent: people.length + (channel ? 1 : 0), failed: [] }))
}
