// The example server function: copy this folder to start a new one.
//
// It answers signed-in team members only, saying who they are, and which
// secrets are set. It never sends a secret back, only whether it's there.
// The Members page's "Check server functions" button calls it.
import { forMembers, reply } from '../_shared/members.ts'

// The secrets the app's functions read. Add yours here when you add one.
const SECRETS = ['TBA_KEY', 'ONSHAPE_ACCESS_KEY', 'ONSHAPE_SECRET_KEY', 'SLACK_BOT_TOKEN', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_CALENDAR_ID']

export default {
  fetch: forMembers(async (_req, member) =>
    reply({
      message: `Hi ${member.name}`,
      role: member.role,
      secrets: Object.fromEntries(SECRETS.map((name) => [name, Boolean(Deno.env.get(name))])),
    }),
  ),
}
