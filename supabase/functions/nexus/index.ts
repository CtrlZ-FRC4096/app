// Nexus, for scouting (#165): an event's live status, like what's on the
// field and which teams should be queuing.
//
// The key is the NEXUS_KEY secret in Supabase, never in this repo or the
// browser: see "Server functions" in supabase/README.md. The app calls this
// through src/modules/scouting/data.ts.
import { forMembers, reply, replyText } from '../_shared/members.ts'
import { createNexus, nexusPath } from './nexus.ts'

const key = Deno.env.get('NEXUS_KEY') ?? ''
const ask = createNexus(key)

export default {
  fetch: forMembers(async (req) => {
    if (!key) {
      return reply({ error: "The Nexus key isn't set up yet. A mentor adds it as the NEXUS_KEY secret: see supabase/README.md." }, 503)
    }
    const route = nexusPath(await req.json().catch(() => null))
    if ('error' in route) return reply({ error: route.error }, 400)
    const answer = await ask(route.path)
    return replyText(answer.body, answer.status)
  }),
}
