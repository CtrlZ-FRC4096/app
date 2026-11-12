/**
 * Roster module data: who's active this season, and their subteams.
 * Mentors and admins see and change it; the database gives everyone else
 * only their own entry (see supabase/migrations/..._roster.sql and
 * ..._roster_attendance_people.sql).
 *
 * The roster is everyone in attendance (from the Slack channel and Jibble,
 * src/modules/attendance/), whether or not they've signed in to the app,
 * plus students who have signed in but aren't in attendance yet. Roster
 * rows point at attendance people.
 *
 * Other modules read it from here: Attendance's required Mondays are for
 * active people (activeRosterIds below).
 */
import { useMemo } from 'react'
import { createTable, fail, ok, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'
import { membersTable, type Member } from '../../core/members'
import { isMentor, type Role } from '../../core/roles'
import { currentUser } from '../../core/session'
import { plural } from '../../core/format'
import type { Notice } from '../../core/registry'
import { peopleTable, type AttendancePerson } from '../attendance/data'

/** A subteam, like Mechanical. */
export interface Subteam extends Row {
  name: string
  /** Where it sits in lists, smallest first. */
  position: number
  created_by: string | null
}

/** Whether someone is active this season. Someone with no row isn't. */
export interface RosterStudent extends Row {
  /** Their attendance row (attendance_people). */
  person_id: string
  active: boolean
  created_by: string | null
}

/** Someone on a subteam. */
export interface SubteamMember extends Row {
  person_id: string
  subteam_id: string
  /** Their main subteam. At most one each. */
  main: boolean
  created_by: string | null
}

/** App roles that are listed even before they're in attendance. */
export const ROSTER_ROLES: Role[] = ['student', 'leader']

/** The database allows the same: see the check on roster_subteams.name. */
export const MAX_SUBTEAM_NAME = 40

// ---------------------------------------------------------------------------
// Example data. The subteams' ids match the ones the first roster migration
// adds; the people are Attendance's example people.

const subteamId = (n: number) => `00000000-0000-4000-8000-00b1${n.toString(16).padStart(8, '0')}`
const rowId = (table: number, n: number) => `00000000-0000-4000-8000-00b${table}${n.toString(16).padStart(8, '0')}`
/** Attendance's example people, by their order there (Alex is 1). */
const person = (n: number) => `00000000-0000-4000-8000-00a1${n.toString(16).padStart(8, '0')}`
const ALEX = person(1)
const JORDAN = person(2)
const CASEY = person(4)
const TAYLOR = person(5)
const QUINN = person(6)
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

// Alex, Jordan, Casey, Taylor and Quinn are active (Taylor and Quinn have no
// app account). Sam isn't: Sam's access is switched off.
export const studentsTable = createTable<RosterStudent>('roster_students', {
  version: 2,
  demo: [ALEX, JORDAN, CASEY, TAYLOR, QUINN].map((id, i) => ({ id: rowId(2, i + 1), person_id: id, active: true, created_at: CREATED, created_by: DEMO_PEOPLE.pat })),
})

// Alex: Mechanical (main) and Software. Jordan: Electrical. Casey: Software
// (main) and Strategy. Taylor: Mechanical. Quinn has no subteam yet.
export const subteamMembersTable = createTable<SubteamMember>('roster_subteam_members', {
  version: 2,
  demo: (
    [
      [ALEX, MECHANICAL, true],
      [ALEX, SOFTWARE, false],
      [JORDAN, ELECTRICAL, true],
      [CASEY, SOFTWARE, true],
      [CASEY, STRATEGY, false],
      [TAYLOR, MECHANICAL, true],
    ] as const
  ).map(([person_id, subteam_id, main], i) => ({ id: rowId(3, i + 1), person_id, subteam_id, main, created_at: CREATED, created_by: DEMO_PEOPLE.pat })),
})

// ---------------------------------------------------------------------------
// Reading.

/** One person on the roster, with their subteams. */
export interface RosterEntry {
  /** Their attendance row's id, or `member:<id>` for a student not in attendance yet. */
  key: string
  name: string
  /** Their attendance row, or null if they've signed in to the app but aren't in attendance yet. */
  person: AttendancePerson | null
  /** Their app account, matched by Slack account, or null if they've never signed in. */
  member: Member | null
  active: boolean
  /** Their subteams' ids, main one first. */
  subteams: string[]
  /** Their main subteam's id, or null. */
  main: string | null
}

/**
 * Everyone on the roster, A to Z: everyone in attendance who isn't hidden
 * (Attendance's "Hide"), plus students and student leaders whose access is
 * on but who aren't in attendance yet, each with whether they're active and
 * their subteams.
 */
export function rosterEntries(people: AttendancePerson[], members: Member[], students: RosterStudent[], subteamMembers: SubteamMember[]): RosterEntry[] {
  const memberBySlack = new Map(members.map((m) => [m.slack_user_id, m]))
  const inAttendance = new Set(people.map((p) => p.slack_user_id).filter(Boolean))
  const fromAttendance = people
    .filter((p) => !p.hidden)
    .map((p): RosterEntry => {
      const mine = subteamMembers.filter((s) => s.person_id === p.id).sort((a, b) => Number(b.main) - Number(a.main))
      return {
        key: p.id,
        name: p.name,
        person: p,
        member: (p.slack_user_id && memberBySlack.get(p.slack_user_id)) || null,
        active: students.some((s) => s.person_id === p.id && s.active),
        subteams: mine.map((s) => s.subteam_id),
        main: mine.find((s) => s.main)?.subteam_id ?? null,
      }
    })
  const notYet = members
    .filter((m) => m.active && ROSTER_ROLES.includes(m.role) && !inAttendance.has(m.slack_user_id))
    .map((m): RosterEntry => ({ key: `member:${m.id}`, name: m.name, person: null, member: m, active: false, subteams: [], main: null }))
  return [...fromAttendance, ...notYet].sort((a, b) => a.name.localeCompare(b.name))
}

export function useRoster(): RosterEntry[] {
  const people = peopleTable.useRows()
  const members = membersTable.useRows()
  const students = studentsTable.useRows()
  const subteamMembers = subteamMembersTable.useRows()
  return useMemo(() => rosterEntries(people, members, students, subteamMembers), [people, members, students, subteamMembers])
}

export function useSubteams(): Subteam[] {
  return subteamsTable.useRows()
}

/** The attendance people who are active this season. For other modules, like Attendance's required Mondays. */
export function activeRosterIds(students: RosterStudent[]): Set<string> {
  return new Set(students.filter((s) => s.active).map((s) => s.person_id))
}

/** The active attendance people's ids (see activeRosterIds). Students only get their own row, so for them it's just themselves, if active. */
export function useActiveRosterIds(): Set<string> {
  const students = studentsTable.useRows()
  return useMemo(() => activeRosterIds(students), [students])
}

/** The home page tile: how many are active this season. */
export function useRosterSummary(): Notice {
  const roster = useRoster()
  const active = roster.filter((e) => e.active).length
  if (roster.length === 0) return { tone: 'plain', text: 'Nobody yet' }
  return { tone: 'info', text: `${plural(active, 'active', 'active')} of ${plural(roster.length, 'person', 'people')}` }
}

// ---------------------------------------------------------------------------
// Changing it. Mentors and admins only; the database checks again.

function mentorsOnly(): string | null {
  const me = currentUser()
  return me && isMentor(me.role) ? null : 'Only mentors and admins can change the roster.'
}

/**
 * Their attendance row, adding one for a student who has signed in but
 * isn't in attendance yet (as the nightly pull from Slack would).
 */
async function personFor(entry: RosterEntry): Promise<Result<AttendancePerson>> {
  if (entry.person) return ok(entry.person)
  const member = entry.member!
  const existing = peopleTable.rows().find((p) => p.slack_user_id === member.slack_user_id)
  if (existing) return ok(existing)
  return peopleTable.insert({ slack_user_id: member.slack_user_id, name: member.name, hidden: false })
}

/** Mark someone active this season, or not. */
export async function setActive(entry: RosterEntry, active: boolean): Promise<Result> {
  const problem = mentorsOnly()
  if (problem) return fail(problem)
  const found = await personFor(entry)
  if (!found.ok) return found
  const row = studentsTable.rows().find((s) => s.person_id === found.value.id)
  const result = row ? await studentsTable.update(row.id, { active }) : await studentsTable.insert({ person_id: found.value.id, active })
  return result.ok ? ok(null) : result
}

/**
 * Put someone on a subteam, or take them off. Their first subteam becomes
 * their main one; taking them off their main one makes the next one main.
 */
export async function setOnSubteam(entry: RosterEntry, subteamId: string, on: boolean): Promise<Result> {
  const problem = mentorsOnly()
  if (problem) return fail(problem)
  const found = await personFor(entry)
  if (!found.ok) return found
  return changeSubteam(found.value.id, subteamId, on)
}

async function changeSubteam(personId: string, subteamId: string, on: boolean): Promise<Result> {
  const mine = subteamMembersTable.rows().filter((s) => s.person_id === personId)
  const row = mine.find((s) => s.subteam_id === subteamId)
  if (on) {
    if (row) return ok(null)
    const added = await subteamMembersTable.insert({ person_id: personId, subteam_id: subteamId, main: mine.length === 0 })
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
export async function setMainSubteam(entry: RosterEntry, subteamId: string): Promise<Result> {
  const problem = mentorsOnly()
  if (problem) return fail(problem)
  const mine = entry.person ? subteamMembersTable.rows().filter((s) => s.person_id === entry.person!.id) : []
  const target = mine.find((s) => s.subteam_id === subteamId)
  if (!target) return fail(`${entry.name} isn't on that subteam. Add them to it first.`)
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
  for (const row of subteamMembersTable.rows().filter((s) => s.subteam_id === subteam.id)) {
    const off = await changeSubteam(row.person_id, subteam.id, false)
    if (!off.ok) return off
  }
  return subteamsTable.remove(subteam.id)
}
