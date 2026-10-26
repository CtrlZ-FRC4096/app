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
