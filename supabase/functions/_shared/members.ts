/**
 * Shared by every server function: only signed-in team members whose access
 * is on can call one.
 *
 * Supabase checks the sign-in token before a function runs (verify_jwt, on
 * by default). forMembers() then looks the caller up in `members` with
 * their own token, so the database's rules decide, as everywhere else in
 * the app, and someone whose access is switched off is turned away.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { tokenSubject } from './token.ts'

export interface Member {
  id: string
  name: string
  role: 'student' | 'mentor' | 'admin'
  /** Their Slack user ID, starting with U: messages to them go here. */
  slack_user_id: string
}

const url = Deno.env.get('SUPABASE_URL') ?? ''

// The publishable key: the browser's key, safe here too. The caller's own
// token decides what the database shows.
function publishableKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}') as Record<string, string>
    return keys.default ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  } catch {
    return Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  }
}

/** A JSON answer the browser is allowed to read. */
export function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders })
}

/** Like reply(), for JSON that's already text, such as an answer passed on from another service. */
export function replyText(json: string, status = 200): Response {
  return new Response(json, { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function findMember(req: Request): Promise<{ member: Member; db: SupabaseClient } | null> {
  const authorization = req.headers.get('Authorization')
  const id = tokenSubject(authorization)
  if (!authorization || !id) return null
  const db = createClient(url, publishableKey(), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await db.from('members').select('id, name, role, slack_user_id, active').eq('id', id).maybeSingle()
  // People whose access is off can still read their own row, so check it.
  if (error || !data?.active) return null
  return { member: { id: data.id, name: data.name, role: data.role, slack_user_id: data.slack_user_id }, db }
}

/**
 * Wrap a function so only team members can call it. It also answers the
 * browser's CORS check, and turns a crash into a message for the person.
 *
 * The handler gets the caller, and `db`: the database as the caller, with
 * their permissions, for reading what the function needs.
 */
export function forMembers(
  handler: (req: Request, member: Member, db: SupabaseClient) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    try {
      const caller = await findMember(req)
      if (!caller) {
        return reply({ error: 'Only signed-in team members can use this. Sign in again, or ask a mentor to switch your access on.' }, 403)
      }
      return await handler(req, caller.member, caller.db)
    } catch (error) {
      console.error(error)
      return reply({ error: 'Something went wrong in the server function. A mentor can read its logs in Supabase.' }, 500)
    }
  }
}
