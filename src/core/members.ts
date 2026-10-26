/**
 * The team: everyone who has signed in, with their role.
 *
 * In live mode this is the members table, filled in by Slack sign-in (see
 * supabase/migrations/..._members_and_slack_sign_in.sql). In demo mode it's
 * the made-up people below.
 *
 * Any module can show who did something: rows have created_by, and
 * useMemberNames() turns that id into a name.
 */
import { useMemo } from 'react'
import { createTable, type Row } from './table'
import { DEMO_PEOPLE } from './demo'
import type { Role } from './roles'

export interface Member extends Row {
  slack_user_id: string
  name: string
  avatar_url: string | null
  role: Role
  /** False when an admin has switched off this person's access. */
  active: boolean
}

const DEMO_MEMBERS: Member[] = [
  { id: DEMO_PEOPLE.alex, slack_user_id: 'U0DEMO0001', name: 'Alex Rivera', avatar_url: null, role: 'student', active: true, created_at: '2026-09-02T18:00:00Z' },
  { id: DEMO_PEOPLE.pat, slack_user_id: 'U0DEMO0002', name: 'Pat Chen', avatar_url: null, role: 'mentor', active: true, created_at: '2026-09-01T18:00:00Z' },
  { id: DEMO_PEOPLE.morgan, slack_user_id: 'U0DEMO0003', name: 'Morgan Lee', avatar_url: null, role: 'admin', active: true, created_at: '2026-09-01T17:00:00Z' },
  { id: DEMO_PEOPLE.jordan, slack_user_id: 'U0DEMO0004', name: 'Jordan Kim', avatar_url: null, role: 'student', active: true, created_at: '2026-09-03T19:00:00Z' },
  { id: DEMO_PEOPLE.sam, slack_user_id: 'U0DEMO0005', name: 'Sam Ortiz', avatar_url: null, role: 'student', active: false, created_at: '2025-09-04T19:00:00Z' },
]

export const membersTable = createTable<Member>('members', {
  demo: DEMO_MEMBERS,
  sort: (a, b) => a.name.localeCompare(b.name),
})

export function useMembers(): Member[] {
  return membersTable.useRows()
}

/** A function that gives a member's name from their id, for "posted by" lines. */
export function useMemberNames(): (id: string | null | undefined) => string {
  const members = membersTable.useRows()
  return useMemo(() => {
    const names = new Map(members.map((m) => [m.id, m.name]))
    return (id) => (id && names.get(id)) || 'A former member'
  }, [members])
}

/** Initials for a round avatar when there's no picture: "Alex Rivera" → "AR". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}
