/**
 * Roster module data: which students and student leaders are active this
 * season, and their subteams. Mentors and admins see and change it; the
 * database gives everyone else only their own entry (see
 * supabase/migrations/..._roster.sql).
 *
 * Other modules read it from here: Attendance's required Mondays are for
 * active students (activeRosterIds below).
 */
import { useMemo } from 'react'
import { createTable, fail, ok, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'
import { membersTable, type Member } from '../../core/members'
import { isMentor, type Role } from '../../core/roles'
import { currentUser } from '../../core/session'
import { plural } from '../../core/format'
import type { Notice } from '../../core/registry'

/** A subteam, like Mechanical. */
export interface Subteam extends Row {
  name: string
  /** Where it sits in lists, smallest first. */
  position: number
  created_by: string | null
}

/** Whether a student is active this season. A student with no row isn't. */
export interface RosterStudent extends Row {
  member_id: string
  active: boolean
  created_by: string | null
}

/** Someone on a subteam. */
export interface SubteamMember extends Row {
  member_id: string
  subteam_id: string
  /** Their main subteam. At most one each. */
  main: boolean
  created_by: string | null
}

/** The roles on the roster. Mentors and admins aren't. */
export const ROSTER_ROLES: Role[] = ['student', 'leader']

/** The database allows the same: see the check on roster_subteams.name. */
export const MAX_SUBTEAM_NAME = 40

// ---------------------------------------------------------------------------
// Example data. The subteams' ids match the ones the migration starts with.

const subteamId = (n: number) => `00000000-0000-4000-8000-00b1${n.toString(16).padStart(8, '0')}`
const rowId = (table: number, n: number) => `00000000-0000-4000-8000-00b${table}${n.toString(16).padStart(8, '0')}`
const CREATED = '2026-09-05T18:00:00Z'

export const ELECTRICAL = subteamId(1)
export const MECHANICAL = subteamId(2)
export const SOFTWARE = subteamId(3)
export const STRATEGY = subteamId(4)

export const subteamsTable = createTable<Subteam>('roster_subteams', {
  demo: [
    { id: ELECTRICAL, name: 'Electrical', position: 1, created_at: CREATED, created_by: null },
    { id: MECHANICAL, name: 'Mechanical', position: 2, created_at: CREATED, created_by: null },
    { id: SOFTWARE, name: 'Software', position: 3, created_at: CREATED, created_by: null },
    { id: STRATEGY, name: 'Strategy', position: 4, created_at: CREATED, created_by: null },
  ],
  sort: (a, b) => a.position - b.position || a.name.localeCompare(b.name),
})

// Alex, Jordan and Casey are active. Sam's access is switched off, so Sam
// isn't on the roster at all.
export const studentsTable = createTable<RosterStudent>('roster_students', {
  demo: [
    { id: rowId(2, 1), member_id: DEMO_PEOPLE.alex, active: true, created_at: CREATED, created_by: DEMO_PEOPLE.pat },
    { id: rowId(2, 2), member_id: DEMO_PEOPLE.jordan, active: true, created_at: CREATED, created_by: DEMO_PEOPLE.pat },
    { id: rowId(2, 3), member_id: DEMO_PEOPLE.casey, active: true, created_at: CREATED, created_by: DEMO_PEOPLE.pat },
  ],
})

// Alex: Mechanical (main) and Software. Jordan: Electrical. Casey: Software (main) and Strategy.
export const subteamMembersTable = createTable<SubteamMember>('roster_subteam_members', {
  demo: [
    { id: rowId(3, 1), member_id: DEMO_PEOPLE.alex, subteam_id: MECHANICAL, main: true, created_at: CREATED, created_by: DEMO_PEOPLE.pat },
    { id: rowId(3, 2), member_id: DEMO_PEOPLE.alex, subteam_id: SOFTWARE, main: false, created_at: CREATED, created_by: DEMO_PEOPLE.pat },
    { id: rowId(3, 3), member_id: DEMO_PEOPLE.jordan, subteam_id: ELECTRICAL, main: true, created_at: CREATED, created_by: DEMO_PEOPLE.pat },
    { id: rowId(3, 4), member_id: DEMO_PEOPLE.casey, subteam_id: SOFTWARE, main: true, created_at: CREATED, created_by: DEMO_PEOPLE.pat },
    { id: rowId(3, 5), member_id: DEMO_PEOPLE.casey, subteam_id: STRATEGY, main: false, created_at: CREATED, created_by: DEMO_PEOPLE.pat },
  ],
})

// ---------------------------------------------------------------------------
// Reading.

/** One student or student leader on the roster, with their subteams. */
export interface RosterEntry {
  member: Member
  active: boolean
  /** Their subteams' ids, main one first. */
  subteams: string[]
  /** Their main subteam's id, or null. */
  main: string | null
}

/**
 * Everyone who can be on the roster: students and student leaders whose
 * access is on (Members page), A to Z, each with whether they're active and
 * their subteams.
 */
export function rosterEntries(members: Member[], students: RosterStudent[], subteamMembers: SubteamMember[]): RosterEntry[] {
  return members
    .filter((m) => m.active && ROSTER_ROLES.includes(m.role))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((member) => {
      const mine = subteamMembers.filter((s) => s.member_id === member.id).sort((a, b) => Number(b.main) - Number(a.main))
      return {
        member,
        active: students.some((s) => s.member_id === member.id && s.active),
        subteams: mine.map((s) => s.subteam_id),
        main: mine.find((s) => s.main)?.subteam_id ?? null,
      }
    })
}

export function useRoster(): RosterEntry[] {
  const members = membersTable.useRows()
  const students = studentsTable.useRows()
  const subteamMembers = subteamMembersTable.useRows()
  return useMemo(() => rosterEntries(members, students, subteamMembers), [members, students, subteamMembers])
}

export function useSubteams(): Subteam[] {
  return subteamsTable.useRows()
}

/**
 * The members who are active on the roster: students and student leaders,
 * with access on, that a mentor marked active. For other modules, like
 * Attendance's required Mondays.
 */
export function activeRosterIds(members: Member[], students: RosterStudent[]): Set<string> {
  return new Set(rosterEntries(members, students, []).filter((e) => e.active).map((e) => e.member.id))
}

/** The active members' ids (see activeRosterIds). Students only get their own row, so for them it's just themselves, if active. */
export function useActiveRosterIds(): Set<string> {
  const members = membersTable.useRows()
  const students = studentsTable.useRows()
  return useMemo(() => activeRosterIds(members, students), [members, students])
}

/** The home page tile: how many are active this season. */
export function useRosterSummary(): Notice {
  const roster = useRoster()
  const active = roster.filter((e) => e.active).length
  if (roster.length === 0) return { tone: 'plain', text: 'No students yet' }
  return { tone: 'info', text: `${plural(active, 'active student', 'active students')} of ${roster.length}` }
}

// ---------------------------------------------------------------------------
// Changing it. Mentors and admins only; the database checks again.

function mentorsOnly(): string | null {
  const me = currentUser()
  return me && isMentor(me.role) ? null : 'Only mentors and admins can change the roster.'
}

/** Mark someone active this season, or not. */
export async function setActive(member: Member, active: boolean): Promise<Result> {
  const problem = mentorsOnly()
  if (problem) return fail(problem)
  const row = studentsTable.rows().find((s) => s.member_id === member.id)
  const result = row ? await studentsTable.update(row.id, { active }) : await studentsTable.insert({ member_id: member.id, active })
  return result.ok ? ok(null) : result
}

/**
 * Put someone on a subteam, or take them off. Their first subteam becomes
 * their main one; taking them off their main one makes the next one main.
 */
export async function setOnSubteam(member: Member, subteamId: string, on: boolean): Promise<Result> {
  const problem = mentorsOnly()
  if (problem) return fail(problem)
  const mine = subteamMembersTable.rows().filter((s) => s.member_id === member.id)
  const row = mine.find((s) => s.subteam_id === subteamId)
  if (on) {
    if (row) return ok(null)
    const added = await subteamMembersTable.insert({ member_id: member.id, subteam_id: subteamId, main: mine.length === 0 })
    return added.ok ? ok(null) : added
  }
  if (!row) return ok(null)
  const removed = await subteamMembersTable.remove(row.id)
  if (!removed.ok || !row.main) return removed
  const next = mine.find((s) => s.id !== row.id)
  if (!next) return ok(null)
  const made = await subteamMembersTable.update(next.id, { main: true })
  return made.ok ? ok(null) : made
}

/** Make one of someone's subteams their main one. */
export async function setMainSubteam(member: Member, subteamId: string): Promise<Result> {
  const problem = mentorsOnly()
  if (problem) return fail(problem)
  const mine = subteamMembersTable.rows().filter((s) => s.member_id === member.id)
  const target = mine.find((s) => s.subteam_id === subteamId)
  if (!target) return fail(`${member.name} isn't on that subteam. Add them to it first.`)
  if (target.main) return ok(null)
  // Only one can be main: clear the old one first.
  for (const old of mine.filter((s) => s.main)) {
    const cleared = await subteamMembersTable.update(old.id, { main: false })
    if (!cleared.ok) return cleared
  }
  const made = await subteamMembersTable.update(target.id, { main: true })
  return made.ok ? ok(null) : made
}

/** Why a subteam name can't be used, or null if it can. `id` is the subteam being renamed. */
export function checkSubteamName(name: string, subteams: Subteam[], id?: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Give the subteam a name, like "Mechanical".'
  if (trimmed.length > MAX_SUBTEAM_NAME) return `Keep the name to ${MAX_SUBTEAM_NAME} characters.`
  const same = subteams.find((s) => s.id !== id && s.name.trim().toLowerCase() === trimmed.toLowerCase())
  return same ? `There's already a subteam called "${same.name}".` : null
}

/** Add a subteam, at the end of the list. */
export async function addSubteam(name: string): Promise<Result<Subteam>> {
  const subteams = subteamsTable.rows()
  const problem = mentorsOnly() ?? checkSubteamName(name, subteams)
  if (problem) return fail(problem)
  return subteamsTable.insert({ name: name.trim(), position: Math.max(0, ...subteams.map((s) => s.position)) + 1 })
}

export async function renameSubteam(subteam: Subteam, name: string): Promise<Result<Subteam>> {
  const problem = mentorsOnly() ?? checkSubteamName(name, subteamsTable.rows(), subteam.id)
  if (problem) return fail(problem)
  return subteamsTable.update(subteam.id, { name: name.trim() })
}

/** Remove a subteam. Everyone on it comes off it; anyone whose main one it was gets their next subteam as main. */
export async function removeSubteam(subteam: Subteam): Promise<Result> {
  const problem = mentorsOnly()
  if (problem) return fail(problem)
  const on = subteamMembersTable.rows().filter((s) => s.subteam_id === subteam.id)
  for (const row of on) {
    const member = membersTable.rows().find((m) => m.id === row.member_id)
    if (!member) continue
    const off = await setOnSubteam(member, subteam.id, false)
    if (!off.ok) return off
  }
  return subteamsTable.remove(subteam.id)
}
