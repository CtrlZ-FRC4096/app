import { createStore, useStore } from '../../core/store'
import { createTable, fail, ok, type Result, type Row } from '../../core/table'
import { currentUser, isMentor } from '../../core/session'
import { membersTable } from '../../core/members'
import { DEMO_PEOPLE } from '../../core/demo'
import { isLive } from '../../core/supabase'
import { TEAM_TIME_ZONE } from '../../core/calendar'
import type { Notice } from '../../core/registry'
import type { Role } from '../../core/roles'
import { OUR_TEAM, likelyWinner, matchesWithPredictions, useSavedSchedule, type SavedSchedule } from '../scouting/data'
import { EVENT_KEY } from '../scouting/season'

// Pit checklist (#146): what to do to get the robot ready for each match.
//
// The checklist is in the team database (supabase/migrations/
// ..._pit_checklist.sql), so everyone sees the same items and checks:
//   pit_checklist_items   the items, with who each is assigned to
//   pit_checklist_checks  one row per item checked for a match
// Mentors and admins add, rename, assign, reorder and delete items, and
// check anything. Students check only the items assigned to them. The
// database refuses anything else; the checks here are so the page can say
// why straight away.

export const PIT_SUBGROUPS = ['General', 'Mechanical', 'Electrical', 'Programming', 'Drive team'] as const
export type PitSubgroup = typeof PIT_SUBGROUPS[number]

// Who's in each subgroup, so the assignment lists show the right people.
// Still saved in each browser, not the team database: a mentor sets it on
// their own device. A subgroup nobody has set up yet lists everyone. The
// made-up members only make sense in demo mode.
const DEMO_SUBGROUP_MEMBERS: Record<string, string[]> = {
  Mechanical: [DEMO_PEOPLE.alex, DEMO_PEOPLE.jordan],
  Electrical: [DEMO_PEOPLE.alex, DEMO_PEOPLE.pat],
  Programming: [DEMO_PEOPLE.jordan, DEMO_PEOPLE.morgan],
  'Drive team': [DEMO_PEOPLE.alex, DEMO_PEOPLE.pat],
}

export const subgroupMembersStore = createStore<Record<string, string[]>>('status:subgroup-members', 1, () => (isLive ? {} : DEMO_SUBGROUP_MEMBERS))

export function useSubgroupMembers() {
  return useStore(subgroupMembersStore)
}

/** Whether someone can be assigned items in a subgroup. General, and a subgroup nobody has set up yet, take everyone. */
export function belongsToSubgroup(id: string, subgroup: string): boolean {
  const members = subgroupMembersStore.get()[subgroup]
  return subgroup === 'General' || members === undefined || members.includes(id)
}

/** True when the name contains the search, ignoring capitals and spaces at the ends. */
export function nameMatches(name: string, search: string): boolean {
  return name.toLowerCase().includes(search.trim().toLowerCase())
}

/**
 * The people to show under a "Find someone" box: everyone whose name matches
 * the search, plus the people already chosen, in their usual order. Chosen
 * people always stay visible, so searching never hides who is assigned.
 */
export function matchMembers<T extends { id: string; name: string }>(members: T[], search: string, chosenIds: string[] = []): T[] {
  return members.filter((member) => chosenIds.includes(member.id) || nameMatches(member.name, search))
}

// ---------------------------------------------------------------------------
// The items.

/** One row of the pit_checklist_items table. The fields match its columns. */
export interface PitItem extends Row {
  text: string
  /** One of PIT_SUBGROUPS. */
  subgroup: string
  /** Members' ids. Only they (and mentors) can check the item. */
  assignee_ids: string[]
  /** Its place in the list: smaller is higher up. */
  position: number
  created_by: string | null
}

/** One row of the pit_checklist_checks table: an item checked for a match. */
export interface PitCheck extends Row {
  item_id: string
  /** The Blue Alliance's match key, like 2026ilch_qm12, or PRACTICE_KEY. */
  match_key: string
  /** Who checked it. created_at is when. */
  created_by: string
}

export const MAX_ITEM_LENGTH = 200

/** The round to check against when there's no schedule (event not started, or nothing saved with no connection). */
export const PRACTICE_KEY = 'practice'

const exampleItem = (id: string, position: number, text: string, subgroup: PitSubgroup, assignee_ids: string[]): PitItem => ({
  id, text, subgroup, assignee_ids, position, created_at: '2026-11-01T18:00:00Z', created_by: DEMO_PEOPLE.pat,
})

// Made-up items for demo mode. Alex is who you are viewing as a student.
const EXAMPLE_ITEMS: PitItem[] = [
  exampleItem('00000000-0000-4000-8000-0000000c0001', 1, 'Batteries charged and numbered', 'Electrical', [DEMO_PEOPLE.alex]),
  exampleItem('00000000-0000-4000-8000-0000000c0002', 2, 'Both bumper colors packed', 'General', [DEMO_PEOPLE.pat]),
  exampleItem('00000000-0000-4000-8000-0000000c0003', 3, 'Robot weighed', 'Mechanical', [DEMO_PEOPLE.alex]),
  exampleItem('00000000-0000-4000-8000-0000000c0004', 4, 'Code deployed', 'Programming', [DEMO_PEOPLE.jordan]),
  exampleItem('00000000-0000-4000-8000-0000000c0005', 5, 'Driver station laptop charged', 'Drive team', [DEMO_PEOPLE.alex]),
  exampleItem('00000000-0000-4000-8000-0000000c0006', 6, 'Safety glasses for everyone in the pit', 'General', []),
]

// Made-up checks: some done for our next demo match (Qual 3 in the demo schedule).
const EXAMPLE_CHECKS: PitCheck[] = [
  { id: '00000000-0000-4000-8000-0000000c1001', item_id: EXAMPLE_ITEMS[0].id, match_key: `${EVENT_KEY}_qm3`, created_at: '2026-11-01T19:00:00Z', created_by: DEMO_PEOPLE.alex },
  { id: '00000000-0000-4000-8000-0000000c1002', item_id: EXAMPLE_ITEMS[3].id, match_key: `${EVENT_KEY}_qm3`, created_at: '2026-11-01T19:05:00Z', created_by: DEMO_PEOPLE.jordan },
]

export const itemsTable = createTable<PitItem>('pit_checklist_items', {
  demo: EXAMPLE_ITEMS,
  sort: (a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at),
})

export const checksTable = createTable<PitCheck>('pit_checklist_checks', { demo: EXAMPLE_CHECKS })

export function usePitChecklist(): PitItem[] {
  return itemsTable.useRows()
}

export function usePitChecks(): PitCheck[] {
  return checksTable.useRows()
}

function mentorProblem(message: string): string | null {
  const user = currentUser()
  return user && isMentor(user.role) ? null : message
}

function checkAssignees(ids: string[], subgroup = 'General', allowEmpty = false): string | null {
  if (!ids.length && !allowEmpty) return 'Assign at least one person to this item.'
  if (ids.some((id) => !membersTable.rows().some((member) => member.id === id && member.active))) {
    return 'Choose active team members for this item.'
  }
  if (ids.some((id) => !belongsToSubgroup(id, subgroup))) return `Choose people from ${subgroup}.`
  return null
}

function checkText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return 'Write a checklist item first.'
  if (trimmed.length > MAX_ITEM_LENGTH) return `Keep checklist items to ${MAX_ITEM_LENGTH} characters or fewer.`
  return null
}

const findItem = (id: string) => itemsTable.rows().find((item) => item.id === id)
const MISSING = 'That item is no longer on the checklist.'

/** Add an item at the bottom of the list. Mentors and admins only. */
export async function addPitItem(text: string, assigneeIds: string[], subgroup: PitSubgroup = 'General'): Promise<Result<PitItem>> {
  const problem = mentorProblem('Ask a mentor to add checklist items.') ?? checkText(text) ??
    (PIT_SUBGROUPS.includes(subgroup) ? null : 'Choose a subgroup from the list.') ?? checkAssignees(assigneeIds, subgroup)
  if (problem) return fail(problem)
  const last = itemsTable.rows().at(-1)
  return itemsTable.insert({ text: text.trim(), subgroup, assignee_ids: [...new Set(assigneeIds)], position: (last?.position ?? 0) + 1 })
}

/** Change who an item is assigned to. Clearing everyone leaves it unassigned. Mentors and admins only. */
export async function assignPitItem(id: string, assigneeIds: string[]): Promise<Result> {
  const problem = mentorProblem('Ask a mentor to change the people assigned to this item.')
  if (problem) return fail(problem)
  const item = findItem(id)
  if (!item) return fail(MISSING)
  const wrong = checkAssignees(assigneeIds, item.subgroup, true)
  if (wrong) return fail(wrong)
  const result = await itemsTable.update(id, { assignee_ids: [...new Set(assigneeIds)] })
  return result.ok ? ok(null) : result
}

/** Change an item's subgroup. People not in the new subgroup are unassigned. Mentors and admins only. */
export async function setPitItemSubgroup(id: string, subgroup: PitSubgroup): Promise<Result> {
  const problem = mentorProblem('Ask a mentor to change this item’s subgroup.') ?? (PIT_SUBGROUPS.includes(subgroup) ? null : 'Choose a subgroup from the list.')
  if (problem) return fail(problem)
  const item = findItem(id)
  if (!item) return fail(MISSING)
  const result = await itemsTable.update(id, { subgroup, assignee_ids: item.assignee_ids.filter((person) => belongsToSubgroup(person, subgroup)) })
  return result.ok ? ok(null) : result
}

/** Rename an item, keeping its assignments, place and checks. Mentors and admins only. */
export async function renamePitItem(id: string, text: string): Promise<Result> {
  const problem = mentorProblem('Ask a mentor to rename this item.') ?? checkText(text)
  if (problem) return fail(problem)
  if (!findItem(id)) return fail(MISSING)
  const result = await itemsTable.update(id, { text: text.trim() })
  return result.ok ? ok(null) : result
}

/** Delete an item, and its checks with it. Mentors and admins only. */
export async function removePitItem(id: string): Promise<Result> {
  const problem = mentorProblem('Ask a mentor to delete checklist items.')
  if (problem) return fail(problem)
  if (!findItem(id)) return fail(MISSING)
  const result = await itemsTable.remove(id)
  if (result.ok) {
    // The database deletes them too; this keeps the list on this device in step.
    for (const check of checksTable.rows().filter((c) => c.item_id === id)) await checksTable.remove(check.id)
  }
  return result
}

/** A position between two neighbours, so moving an item changes only that item. */
export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before !== undefined && after !== undefined) return (before + after) / 2
  if (before !== undefined) return before + 1
  if (after !== undefined) return after - 1
  return 0
}

/** Move an item to where `targetId` is now. Mentors and admins only. */
export async function reorderPitItem(id: string, targetId: string): Promise<Result> {
  const problem = mentorProblem('Ask a mentor to reorder the checklist.')
  if (problem) return fail(problem)
  const items = itemsTable.rows()
  const from = items.findIndex((item) => item.id === id)
  const to = items.findIndex((item) => item.id === targetId)
  if (from < 0 || to < 0) return fail(MISSING)
  if (from === to) return ok(null)
  // Without the item, the target's neighbours are at to - 1 and to. Moving
  // down, that puts it just after the target; moving up, just before it.
  const others = items.filter((item) => item.id !== id)
  const position = positionBetween(others[to - 1]?.position, others[to]?.position)
  const result = await itemsTable.update(id, { position })
  return result.ok ? ok(null) : result
}

/** Move an item to a place typed into Move to…, like "3" (1 is the top). */
export async function movePitItemTo(id: string, placeText: string): Promise<Result> {
  const items = itemsTable.rows()
  if (!items.some((item) => item.id === id)) return fail(MISSING)
  const place = Number(placeText.trim())
  if (!placeText.trim() || !Number.isInteger(place) || place < 1 || place > items.length) {
    return fail(`Type a position from 1 to ${items.length}.`)
  }
  return reorderPitItem(id, items[place - 1].id)
}

/** Move an item up (-1) or down (1) one place, from the keyboard. */
export async function movePitItem(id: string, direction: -1 | 1): Promise<Result> {
  const items = itemsTable.rows()
  const from = items.findIndex((item) => item.id === id)
  if (from < 0) return fail(MISSING)
  const to = from + direction
  if (to < 0 || to >= items.length) return ok(null)
  return reorderPitItem(id, items[to].id)
}

/** Choose who's in a subgroup, on this device. Removes their assignments on that subgroup's items. Mentors and admins only. */
export async function setSubgroupMembers(subgroup: PitSubgroup, ids: string[]): Promise<Result> {
  const problem = mentorProblem('Ask a mentor to edit subgroup members.')
  if (problem) return fail(problem)
  if (!PIT_SUBGROUPS.includes(subgroup) || subgroup === 'General') return fail('General includes all active team members.')
  if (ids.some((id) => !membersTable.rows().some((member) => member.id === id && member.active))) return fail('Choose active team members.')
  subgroupMembersStore.set((groups) => ({ ...groups, [subgroup]: [...new Set(ids)] }))
  for (const item of itemsTable.rows().filter((item) => item.subgroup === subgroup)) {
    const kept = item.assignee_ids.filter((id) => ids.includes(id))
    if (kept.length === item.assignee_ids.length) continue
    const result = await itemsTable.update(item.id, { assignee_ids: kept })
    if (!result.ok) return result
  }
  return ok(null)
}

// ---------------------------------------------------------------------------
// Checking items, for a match.

/** Whether someone may check an item: the people assigned to it, and mentors and admins. */
export function canCheck(item: Pick<PitItem, 'assignee_ids'>, user: { id: string; role: Role }): boolean {
  return isMentor(user.role) || item.assignee_ids.includes(user.id)
}

/** Check or uncheck an item for a match. */
export async function setPitItemCompleted(id: string, matchKey: string, completed: boolean): Promise<Result> {
  const item = findItem(id)
  if (!item) return fail(`${MISSING} Try another item.`)
  const user = currentUser()
  if (!user || !canCheck(item, user)) return fail('Only people assigned to this item can check or uncheck it. Ask a mentor if it should be yours.')
  const existing = checksTable.rows().find((check) => check.item_id === id && check.match_key === matchKey)
  if (completed) {
    if (existing) return ok(null)
    const result = await checksTable.insert({ item_id: id, match_key: matchKey })
    return result.ok ? ok(null) : result
  }
  return existing ? checksTable.remove(existing.id) : ok(null)
}

/** The ids of the items checked for a match. */
export function checkedIds(checks: PitCheck[], matchKey: string): Set<string> {
  return new Set(checks.filter((check) => check.match_key === matchKey).map((check) => check.item_id))
}

export interface MatchProgress {
  done: number
  total: number
  left: number
  /** Every item is checked for the match (and there's at least one). */
  ready: boolean
}

/** How much of the checklist is done for a match. */
export function matchProgress(items: PitItem[], checks: PitCheck[], matchKey: string): MatchProgress {
  const checked = checkedIds(checks, matchKey)
  const done = items.filter((item) => checked.has(item.id)).length
  return { done, total: items.length, left: items.length - done, ready: items.length > 0 && done === items.length }
}

/** "Ready", "3 of 14 left", or "No items yet". */
export function progressText(progress: MatchProgress): string {
  if (progress.total === 0) return 'No items yet'
  return progress.ready ? 'Ready' : `${progress.left} of ${progress.total} left`
}

/** The items assigned to someone, in list order. */
export function myItems(items: PitItem[], personId: string): PitItem[] {
  return items.filter((item) => item.assignee_ids.includes(personId))
}

/** The name for a member's id, or "Former member" for someone no longer on the team list. */
function nameOf(id: string, members: { id: string; name: string }[]): string {
  return members.find((member) => member.id === id)?.name ?? 'Former member'
}

export interface PersonProgress {
  id: string
  name: string
  done: number
  total: number
}

/** Each assigned person's progress for a match, like Alex: 4 of 5, by name. An item shared by two people counts for both. */
export function progressByPerson(items: PitItem[], checks: PitCheck[], matchKey: string, members: { id: string; name: string }[]): PersonProgress[] {
  const checked = checkedIds(checks, matchKey)
  const people = new Map<string, PersonProgress>()
  for (const item of items) {
    for (const id of item.assignee_ids) {
      const person = people.get(id) ?? { id, name: nameOf(id, members), done: 0, total: 0 }
      person.total += 1
      if (checked.has(item.id)) person.done += 1
      people.set(id, person)
    }
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export interface UncheckedGroup {
  /** The person, or null for items assigned to nobody. */
  id: string | null
  name: string
  items: PitItem[]
}

/** The items not checked yet for a match, by who they're assigned to: unassigned first, so a mentor sees them, then people by name. */
export function uncheckedByPerson(items: PitItem[], checks: PitCheck[], matchKey: string, members: { id: string; name: string }[]): UncheckedGroup[] {
  const checked = checkedIds(checks, matchKey)
  const left = items.filter((item) => !checked.has(item.id))
  const unassigned = left.filter((item) => item.assignee_ids.length === 0)
  const people = [...new Set(left.flatMap((item) => item.assignee_ids))]
    .map((id) => ({ id, name: nameOf(id, members), items: left.filter((item) => item.assignee_ids.includes(id)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return [...(unassigned.length ? [{ id: null, name: 'Unassigned', items: unassigned }] : []), ...people]
}

// ---------------------------------------------------------------------------
// Our matches, from the schedule the Scouting module saves on this device
// (The Blue Alliance, with Match 13's predictions). It's saved, so this
// works with no connection; with no schedule at all, there's the practice
// round.

export interface PitMatch {
  /** The Blue Alliance's match key, or PRACTICE_KEY. */
  key: string
  /** Like "Qual 12", or "Practice / no match". */
  label: string
  /** When it's expected to start, in seconds since 1970, or null. */
  time: number | null
  /** Which side we're on, or null for the practice round. */
  alliance: 'Red' | 'Blue' | null
  /** Match 13's prediction, like "Red 72% · 84–71", or null. */
  prediction: string | null
}

export const PRACTICE_MATCH: PitMatch = { key: PRACTICE_KEY, label: 'Practice / no match', time: null, alliance: null, prediction: null }

/** Our matches still to play, in order, then the practice round, which is always there. */
export function ourMatches(saved: SavedSchedule | null, team = OUR_TEAM): PitMatch[] {
  const rows = saved ? matchesWithPredictions(saved.matches, saved.predictions, team) : []
  const upcoming = rows
    .filter((row) => row.ours && !row.score)
    .map((row) => ({
      key: row.key,
      label: row.label,
      time: row.time,
      alliance: row.red.includes(team) ? 'Red' as const : 'Blue' as const,
      prediction: row.prediction ? `${likelyWinner(row.prediction)} · ${Math.round(row.prediction.redScore)}–${Math.round(row.prediction.blueScore)}` : null,
    }))
  return [...upcoming, PRACTICE_MATCH]
}

/** The match to show first: our next one, or the practice round when there's none. */
export function defaultMatch(matches: PitMatch[]): PitMatch {
  return matches[0] ?? PRACTICE_MATCH
}

/** When a match is expected to start, like "Sat 10:42 AM", in the team's time zone. */
export function matchTime(seconds: number): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TEAM_TIME_ZONE, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(seconds * 1000))
}

/** Our matches still to play, from the schedule saved on this device. */
export function useOurMatches(): PitMatch[] {
  return ourMatches(useSavedSchedule())
}

/** The home page tile: are we ready for the next match? */
export function pitSummary(items: PitItem[], checks: PitCheck[], match: PitMatch): Notice {
  const progress = matchProgress(items, checks, match.key)
  const name = match.key === PRACTICE_KEY ? 'practice' : match.label
  if (progress.total === 0) return { tone: 'plain', text: 'No pit checklist items yet' }
  if (progress.ready) return { tone: 'ok', text: `Ready for ${name}` }
  return { tone: 'warn', text: `${progress.left} of ${progress.total} left for ${name}` }
}

export function usePitSummary(): Notice {
  return pitSummary(usePitChecklist(), usePitChecks(), defaultMatch(useOurMatches()))
}
