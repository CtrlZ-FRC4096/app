/**
 * Members module data: who's on the team, their roles, and who can sign in.
 *
 * The rows are the members table from src/core/members.ts. Slack sign-in
 * adds people to it; nobody adds or deletes them here. Admins change two
 * things: a person's role, and whether their access is on.
 *
 * The database only lets admins change these, and never lets the team end
 * up without an admin. The checks here just explain that before trying.
 */
import { callFunction } from '../../core/functions'
import { membersTable, type Member } from '../../core/members'
import { currentUser } from '../../core/session'
import { fail, ok, type Result } from '../../core/table'
import { plural } from '../../core/format'
import type { Role } from '../../core/roles'
import type { Notice } from '../../core/registry'

export function useMemberSummary(): Notice {
  const members = membersTable.useRows()
  return { tone: 'info', text: plural(members.filter((m) => m.active).length, 'member', 'members') }
}

/** Why the signed-in person can't change this member, or null if they can. */
export function checkChange(member: Member): string | null {
  const me = currentUser()
  if (me?.role !== 'admin') return 'Only admins can change roles and access.'
  if (me.id === member.id) return "You can't change your own role or access. Ask another admin."
  return null
}

export async function changeRole(member: Member, role: Role): Promise<Result<Member>> {
  const problem = checkChange(member)
  if (problem) return fail(problem)
  if (member.role === role) return ok(member)
  return membersTable.update(member.id, { role })
}

/** Switch someone's access off (they can't sign in or see anything) or back on. */
export async function setAccess(member: Member, active: boolean): Promise<Result<Member>> {
  const problem = checkChange(member)
  if (problem) return fail(problem)
  if (member.active === active) return ok(member)
  return membersTable.update(member.id, { active })
}

/** Members whose name contains the search, ignoring capitals. */
export function search(members: Member[], text: string): Member[] {
  const wanted = text.trim().toLowerCase()
  return wanted ? members.filter((m) => m.name.toLowerCase().includes(wanted)) : members
}

// ---------------------------------------------------------------------------
// Checking the server functions (supabase/functions/) after setting them up.

export interface FunctionCheck {
  name: string
  ok: boolean
  text: string
}

interface Hello {
  message: string
  role: string
  /** Which secrets are set. The function never sends the secrets themselves. */
  secrets: Record<string, boolean>
}

/**
 * Are the server functions deployed, and do their keys work? Asks the
 * example `hello` function, then The Blue Alliance for team 4096, then
 * Onshape whether the keys open anything (one Onshape API call).
 */
export async function checkServerFunctions(): Promise<FunctionCheck[]> {
  const demoSecrets = { TBA_KEY: true, ONSHAPE_ACCESS_KEY: true, ONSHAPE_SECRET_KEY: true }
  const hello = await callFunction<Hello>('hello', {}, () => ({ message: 'Hi', role: 'mentor', secrets: demoSecrets }))
  if (!hello.ok) return [{ name: 'Server functions', ok: false, text: hello.error }]
  const { secrets } = hello.value
  const checks: FunctionCheck[] = [{ name: 'Server functions', ok: true, text: `Deployed, and they know you: "${hello.value.message}".` }]
  const setUp = 'see "Server functions" in supabase/README.md.'

  if (!secrets.TBA_KEY) {
    checks.push({ name: 'The Blue Alliance', ok: false, text: `No TBA_KEY secret yet. Add it in Supabase: ${setUp}` })
  } else {
    const team = await callFunction<{ nickname: string }>('tba', { kind: 'team', team: 4096 }, () => ({ nickname: 'Ctrl-Z' }))
    checks.push(
      team.ok
        ? { name: 'The Blue Alliance', ok: true, text: `Working: it says team 4096 is ${team.value.nickname}.` }
        : { name: 'The Blue Alliance', ok: false, text: team.error },
    )
  }

  if (!secrets.ONSHAPE_ACCESS_KEY || !secrets.ONSHAPE_SECRET_KEY) {
    const missing = ['ONSHAPE_ACCESS_KEY', 'ONSHAPE_SECRET_KEY'].filter((name) => !secrets[name]).join(' and ')
    const both = missing.includes(' and ')
    checks.push({ name: 'Onshape', ok: false, text: `No ${missing} secret${both ? 's' : ''} yet. Add ${both ? 'them' : 'it'} in Supabase: ${setUp}` })
  } else {
    const onshape = await callFunction<{ ok: true }>('onshape', { kind: 'check' }, () => ({ ok: true }))
    checks.push(
      onshape.ok
        ? { name: 'Onshape', ok: true, text: 'Working: Onshape accepted the keys. Import a system from the BOM page.' }
        : { name: 'Onshape', ok: false, text: onshape.error },
    )
  }
  return checks
}
