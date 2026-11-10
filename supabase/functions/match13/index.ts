// Match 13, for scouting: each team's rating at an event, and who's
// predicted to win each match.
//
// The key is the MATCH13_KEY secret in Supabase, never in this repo or the
// browser: see "Server functions" in supabase/README.md. The app calls this
// through src/modules/scouting/data.ts.
import { forMembers, reply, replyText } from '../_shared/members.ts'
import { createMatch13, match13Path } from './match13.ts'

const key = Deno.env.get('MATCH13_KEY') ?? ''
const ask = createMatch13(key)

export default {
  fetch: forMembers(async (req) => {
    if (!key) {
      return reply({ error: "The Match 13 key isn't set up yet. A mentor adds it as the MATCH13_KEY secret: see supabase/README.md." }, 503)
    }
    const route = match13Path(await req.json().catch(() => null))
    if ('error' in route) return reply({ error: route.error }, 400)
    const answer = await ask(route.path)
    return replyText(answer.body, answer.status)
  }),
}
