// Slack, for messages from the team app's bot: mentors messaging people or
// a channel, like a "Remind now" button, and anyone messaging themselves
// (the Example module's "Send me a Slack message" button). Needs the
// SLACK_BOT_TOKEN secret (the bot's xoxb- token, with the chat:write
// permission); see "Server functions" in supabase/README.md. The app calls
// this through src/core/slack.ts.
//
// Reminders on a schedule don't come through here: scripts/slack-reminders.ts
// sends them from GitHub, with the same Slack client (../_shared/slack.ts).
import { forMembers, reply } from '../_shared/members.ts'
import { createSlack } from '../_shared/slack.ts'
import { slackRequest, testMessage } from './slack.ts'

const token = Deno.env.get('SLACK_BOT_TOKEN') ?? ''
const slack = createSlack(token)

export default {
  fetch: forMembers(async (req, member, db) => {
    if (!token) {
      return reply({ error: "The Slack bot isn't set up yet. A mentor adds the SLACK_BOT_TOKEN secret: see supabase/README.md." }, 503)
    }
    const request = slackRequest(await req.json().catch(() => null), member.role)
    if ('error' in request) return reply({ error: request.error }, request.status)

    if (request.kind === 'check') {
      const bot = await slack.call('auth.test')
      if (!bot.ok) return reply({ error: bot.error }, 502)
      const test = await slack.send({ to: member.slack_user_id, text: testMessage(member.name) })
      if (!test.ok) return reply({ error: test.error }, 502)
      return reply({ bot: String(bot.data.user ?? 'The bot') })
    }

    if (request.kind === 'me') {
      const answer = await slack.send({ to: member.slack_user_id, text: request.text })
      return answer.ok ? reply({ sent: 1, failed: [] }) : reply({ error: answer.error }, 502)
    }

    // Find each person's Slack ID. The database's rules decide who the
    // caller can see, as everywhere else.
    const { data, error } = await db.from('members').select('id, name, slack_user_id, active').in('id', request.people)
    if (error) return reply({ error: "Couldn't read the member list. Try again." }, 500)
    const people = (data ?? []) as { id: string; name: string; slack_user_id: string; active: boolean }[]

    let sent = 0
    const failed: { name: string; error: string }[] = []
    const unknown = request.people.length - people.length
    if (unknown > 0) failed.push({ name: unknown === 1 ? 'One person' : `${unknown} people`, error: "Not on the team's member list." })
    for (const person of people) {
      if (!person.active) {
        failed.push({ name: person.name, error: 'Their access is switched off.' })
        continue
      }
      const answer = await slack.send({ to: person.slack_user_id, text: request.text })
      if (answer.ok) sent += 1
      else failed.push({ name: person.name, error: answer.error })
    }
    if (request.channel) {
      const answer = await slack.send({ to: request.channel, text: request.text })
      if (answer.ok) sent += 1
      else failed.push({ name: 'The channel', error: answer.error })
    }
    return reply({ sent, failed })
  }),
}
