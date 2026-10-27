/**
 * A small Slack client for the team app's bot: call a Slack method, or send
 * a message. Both the `slack` server function and the scheduled reminders
 * (scripts/slack-reminders.ts, which runs in GitHub) send through this, so
 * they behave the same.
 *
 * Plain TypeScript with no Deno or npm: imports, so it also runs in Node
 * and supabase/tests can test it.
 */

export const SLACK_API = 'https://slack.com/api'

/** One message, to a person (their Slack user ID, starting with U) or a channel (C…). */
export interface SlackMessage {
  to: string
  text: string
}

/** What Slack's errors mean, and what to do about them. */
export function slackProblem(error: string, needed?: string): string {
  switch (error) {
    case 'missing_scope':
      return `The Slack app needs the ${needed || 'chat:write'} permission. A mentor adds it under OAuth & Permissions, then reinstalls the app: see supabase/README.md.`
    case 'not_authed':
    case 'invalid_auth':
    case 'token_revoked':
    case 'token_expired':
    case 'account_inactive':
      return 'Slack turned down the bot token. A mentor should set SLACK_BOT_TOKEN again: see supabase/README.md.'
    case 'not_in_channel':
      return "The Slack app isn't in that channel. Invite it there: /invite @Ctrl-Z Team App"
    case 'channel_not_found':
      return "Slack can't find that channel. Check its ID, and invite the app if the channel is private."
    case 'user_not_found':
    case 'user_disabled':
      return "Slack can't find that person, or their account is switched off."
    case 'is_archived':
      return 'That channel is archived.'
    case 'msg_too_long':
      return 'That message is too long for Slack.'
    case 'ratelimited':
      return 'Slack asked us to slow down. Try again in a minute.'
    default:
      return `Slack had a problem (${error}). Try again in a minute.`
  }
}

export type SlackAnswer = { ok: true; data: Record<string, unknown> } | { ok: false; error: string }

interface Options {
  fetch?: typeof fetch
  /** Only for tests. */
  api?: string
  sleep?: (ms: number) => Promise<void>
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

/** A Slack client that uses the bot's token. */
export function createSlack(token: string, { fetch: post = fetch, api = SLACK_API, sleep = wait }: Options = {}) {
  /** Call a Slack method, like auth.test, waiting and trying again if Slack asks us to slow down. */
  async function call(method: string, body: Record<string, unknown> = {}): Promise<SlackAnswer> {
    for (let attempt = 0; attempt < 4; attempt++) {
      let response: Response
      try {
        response = await post(`${api}/${method}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(body),
        })
      } catch {
        return { ok: false, error: "Couldn't reach Slack. Try again in a minute." }
      }
      if (response.status === 429) {
        await sleep(Math.min(Number(response.headers.get('retry-after')) || 5, 60) * 1000)
        continue
      }
      const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
      if (!data) return { ok: false, error: `Slack had a problem (${response.status}). Try again in a minute.` }
      if (data.ok !== true) return { ok: false, error: slackProblem(String(data.error ?? 'unknown'), typeof data.needed === 'string' ? data.needed : undefined) }
      return { ok: true, data }
    }
    return { ok: false, error: slackProblem('ratelimited') }
  }

  return {
    call,
    /**
     * Send one message. To a person, it arrives in their direct messages
     * with the app. Links don't unfold into big previews.
     */
    send: (message: SlackMessage) => call('chat.postMessage', { channel: message.to, text: message.text, unfurl_links: false, unfurl_media: false }),
  }
}
