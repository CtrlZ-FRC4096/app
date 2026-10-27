// The Blue Alliance, for scouting: an event's match schedule and rankings,
// a team's matches at an event (with videos), and a team's name.
//
// The key is the TBA_KEY secret in Supabase, never in this repo or the
// browser: see "Server functions" in supabase/README.md. The app calls this
// through src/modules/scouting/data.ts.
import { forMembers, reply, replyText } from '../_shared/members.ts'
import { createTba, tbaPath } from './tba.ts'

const key = Deno.env.get('TBA_KEY') ?? ''
const ask = createTba(key)

export default {
  fetch: forMembers(async (req) => {
    if (!key) {
      return reply({ error: "The Blue Alliance key isn't set up yet. A mentor adds it as the TBA_KEY secret: see supabase/README.md." }, 503)
    }
    const route = tbaPath(await req.json().catch(() => null))
    if ('error' in route) return reply({ error: route.error }, 400)
    const answer = await ask(route.path)
    return replyText(answer.body, answer.status)
  }),
}
