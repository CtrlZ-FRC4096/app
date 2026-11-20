import { createStore, useStore } from '../../core/store'
import { createTable, fail, ok, type Result, type Row } from '../../core/table'
import { plural } from '../../core/format'
import { currentUser, isLeader } from '../../core/session'
import { membersTable } from '../../core/members'
import { DEMO_PEOPLE } from '../../core/demo'
import { isLive } from '../../core/supabase'
import { TEAM_TIME_ZONE } from '../../core/calendar'
import type { Notice } from '../../core/registry'
import type { Role } from '../../core/roles'
import {
  OUR_TEAM, STALE_MS, keepScheduleFresh, likelyWinner, loadEventTeams, loadRatings, matchesWithPredictions, rankOf, updatedAgo, useCurrentEvent, useRankings, useRatings,
  useSavedEventTeams, useSavedSchedule, useScheduleStatus, type Match13Rating, type SavedSchedule, type ScheduleRow, type ScheduleStatus, type TbaRanking, type TbaTeam,
} from '../scouting/data'
import { EVENT_KEY } from '../scouting/season'

// Pit checklist (#146): what to do to get the robot ready for each match.
//
// The checklist is in the team database (supabase/migrations/
// ..._pit_checklist.sql), so everyone sees the same items and checks:
//   pit_checklist_items   the items, with who each is assigned to
//   pit_checklist_checks  one row per item checked for a match
// Student leaders, mentors and admins add, rename, assign, reorder and
// remove items, clear the list, and check anything
// (..._pit_checklist_student_leaders.sql). Students check only the items
// assigned to them. The database refuses anything else; the checks here are
// so the page can say why straight away.

export const PIT_SUBGROUPS = ['General', 'Mechanical', 'Electrical', 'Programming', 'Drive team'] as const
export type PitSubgroup = typeof PIT_SUBGROUPS[number]

// Who's in each subgroup, on this device. It decides who the People popups
// list and which items Assign people skips, and taking someone out of a
// subgroup also takes them off its items for everyone (setSubgroupMembers()).
// Still saved in each browser, not the team database: a student leader or
// mentor sets it on their own device. A subgroup nobody has set up yet lists
// everyone. The made-up members only make sense in demo mode.
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

/** Everyone on any item's list of people, once each: who to suggest for a General item. */
export function assignedPeople(items: Pick<PitItem, 'assignee_ids'>[]): string[] {
  return [...new Set(items.flatMap((item) => item.assignee_ids))]
}

/**
 * Who a People popup lists before a name is typed, for items in these
 * subgroups. When the whole team can be chosen (General, or a subgroup with
 * no list on this device), that's the people already on items, plus the
 * members of the other subgroups given. Otherwise undefined: list everyone
 * who can be chosen, as a subgroup's own members are few.
 */
export function suggestedFor(subgroups: string[], items: Pick<PitItem, 'assignee_ids'>[]): string[] | undefined {
  const groups = subgroupMembersStore.get()
  if (!subgroups.some((group) => group === 'General' || groups[group] === undefined)) return undefined
  return [...new Set([...assignedPeople(items), ...subgroups.flatMap((group) => groups[group] ?? [])])]
}

/**
 * What to tell someone when picking a subgroup takes people off, like
 * "You're not in Electrical, so you were taken off." `ids` are the people
 * chosen before; `me` is who's using the page. Empty when nobody comes off.
 */
export function takenOffText(ids: string[], subgroup: string, members: { id: string; name: string }[], me: string | null): string {
  const off = ids.filter((id) => !belongsToSubgroup(id, subgroup))
  if (off.length === 0) return ''
  if (off.length === 1 && off[0] === me) return `You're not in ${subgroup}, so you were taken off.`
  const names = off.map((id) => (id === me ? 'you' : members.find((member) => member.id === id)?.name ?? 'Former member'))
  if (names.length === 1) return `${names[0]} isn't in ${subgroup}, and was taken off.`
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)} aren't in ${subgroup}, and were taken off.`
}

// ---------------------------------------------------------------------------
// The items.

/** One row of the pit_checklist_items table. The fields match its columns. */
export interface PitItem extends Row {
  text: string
  /** One of PIT_SUBGROUPS. */
  subgroup: string
  /** Members' ids. Only they (and student leaders, mentors and admins) can check the item. */
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

/** Whether someone runs the checklist: student leaders, mentors and admins. */
export function canManagePit(role: Role): boolean {
  return isLeader(role)
}

/** Null for someone who runs the checklist; otherwise who to ask, like "Ask a student leader or mentor to rename this item." */
function leaderProblem(what: string): string | null {
  const user = currentUser()
  return user && canManagePit(user.role) ? null : `Ask a student leader or mentor to ${what}.`
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

/** The people in `ids` who aren't on the item yet: the ones a change would add. */
const newPeople = (item: PitItem, ids: string[]) => ids.filter((id) => !item.assignee_ids.includes(id))

/** Add an item at the bottom of the list. Student leaders, mentors and admins only. */
export async function addPitItem(text: string, assigneeIds: string[], subgroup: PitSubgroup = 'General'): Promise<Result<PitItem>> {
  const problem = leaderProblem('add checklist items') ?? checkText(text) ??
    (PIT_SUBGROUPS.includes(subgroup) ? null : 'Choose a subgroup from the list.') ?? checkAssignees(assigneeIds, subgroup)
  if (problem) return fail(problem)
  const last = itemsTable.rows().at(-1)
  return itemsTable.insert({ text: text.trim(), subgroup, assignee_ids: [...new Set(assigneeIds)], position: (last?.position ?? 0) + 1 })
}

/** Change who an item is assigned to. Clearing everyone leaves it unassigned. Student leaders, mentors and admins only. */
export async function assignPitItem(id: string, assigneeIds: string[]): Promise<Result> {
  const problem = leaderProblem('change the people assigned to this item')
  if (problem) return fail(problem)
  const item = findItem(id)
  if (!item) return fail(MISSING)
  // Only the people being added are checked. Someone already on the item
  // stays, even if their access was switched off or this device's subgroup
  // list doesn't have them, so they never stop anyone else being changed.
  const wrong = checkAssignees(newPeople(item, assigneeIds), item.subgroup, true)
  if (wrong) return fail(wrong)
  const result = await itemsTable.update(id, { assignee_ids: [...new Set(assigneeIds)] })
  return result.ok ? ok(null) : result
}

// ---------------------------------------------------------------------------
// Several items at once: Select, then Assign people (#238).

/** A ticked item that Assign people leaves as it is, and who chosen isn't in its subgroup. */
export interface SkippedItem {
  item: PitItem
  /** The chosen people who aren't in the item's subgroup, on this device. */
  notIn: string[]
}

/** What Assign people does with the ticked items. */
export interface AssignPlan {
  /** The items the people go on, in list order. Anyone on one already stays, and isn't added twice. */
  assign: PitItem[]
  /** The items left as they are, because someone chosen isn't in their subgroup. */
  skip: SkippedItem[]
}

/**
 * Which ticked items the chosen people can go on. An item whose subgroup
 * doesn't have everyone being added is skipped whole: nobody is added to it.
 * General items take anyone. As in assignPitItem(), only the people being
 * added are checked, so someone already on an item doesn't skip it.
 */
export function planAssignment(items: PitItem[], peopleIds: string[]): AssignPlan {
  const plan: AssignPlan = { assign: [], skip: [] }
  for (const item of items) {
    const notIn = newPeople(item, peopleIds).filter((id) => !belongsToSubgroup(id, item.subgroup))
    if (notIn.length) plan.skip.push({ item, notIn })
    else plan.assign.push(item)
  }
  return plan
}

/**
 * Add the same people to several items: Assign people, after Select. The
 * people already on each item stay, and so do its checks. Items whose
 * subgroup someone chosen isn't in are skipped (planAssignment()). Gives
 * back what it did, so the page can say which items were skipped and why.
 * Student leaders, mentors and admins only.
 */
export async function assignPitItems(ids: string[], peopleIds: string[]): Promise<Result<AssignPlan>> {
  const problem = leaderProblem('change the people assigned to these items')
  if (problem) return fail(problem)
  // In list order, once each, leaving out any removed meanwhile.
  const items = itemsTable.rows().filter((item) => ids.includes(item.id))
  if (!items.length) return fail('Tick at least one item on the checklist first.')
  const people = [...new Set(peopleIds)]
  if (!people.length) return fail('Choose at least one person to add.')
  if (people.some((id) => !membersTable.rows().some((member) => member.id === id && member.active))) return fail('Choose active team members.')
  const plan = planAssignment(items, people)
  // A table saves one row at a time, so this goes item by item. Trying again
  // after a failure is safe: nobody is ever added to an item twice.
  let saved = 0
  for (const item of plan.assign) {
    const added = newPeople(item, people)
    if (!added.length) continue
    const result = await itemsTable.update(item.id, { assignee_ids: [...item.assignee_ids, ...added] })
    if (!result.ok) return saved === 0 ? result : fail(`Added them to ${plural(saved, 'item', 'items')}, then it stopped: ${result.error}`)
    saved += 1
  }
  return ok(plan)
}

/** "Pat", "Pat and Alex", or "Pat, Alex and Jordan". */
function andList(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** Who chosen isn't in a subgroup, like "Pat Chen isn't in Electrical." or "Pat Chen and Jordan Kim aren't in Electrical." */
export function notInText(ids: string[], subgroup: string, members: { id: string; name: string }[]): string {
  return `${andList(ids.map((id) => nameOf(id, members)))} ${ids.length === 1 ? "isn't" : "aren't"} in ${subgroup}.`
}

/**
 * What to say after Assign people: how many items the people are on now,
 * then each skipped item and why, like "Pat Chen is now on 2 items. Skipped
 * Code deployed: Pat Chen isn't in Programming." "Now on" because some may
 * have been on an item already.
 */
export function assignedText(plan: AssignPlan, peopleIds: string[], members: { id: string; name: string }[]): string {
  const added = plan.assign.length ? [`${andList(peopleIds.map((id) => nameOf(id, members)))} ${peopleIds.length === 1 ? 'is' : 'are'} now on ${plural(plan.assign.length, 'item', 'items')}.`] : []
  const skipped = plan.skip.map((skip) => `Skipped ${skip.item.text}: ${notInText(skip.notIn, skip.item.subgroup, members)}`)
  return [...added, ...skipped].join(' ')
}

/** Change an item's subgroup. People not in the new subgroup are unassigned. Student leaders, mentors and admins only. */
export async function setPitItemSubgroup(id: string, subgroup: PitSubgroup): Promise<Result> {
  const problem = leaderProblem('change this item’s subgroup') ?? (PIT_SUBGROUPS.includes(subgroup) ? null : 'Choose a subgroup from the list.')
  if (problem) return fail(problem)
  const item = findItem(id)
  if (!item) return fail(MISSING)
  const result = await itemsTable.update(id, { subgroup, assignee_ids: item.assignee_ids.filter((person) => belongsToSubgroup(person, subgroup)) })
  return result.ok ? ok(null) : result
}

/** Rename an item, keeping its assignments, place and checks. Student leaders, mentors and admins only. */
export async function renamePitItem(id: string, text: string): Promise<Result> {
  const problem = leaderProblem('rename this item') ?? checkText(text)
  if (problem) return fail(problem)
  if (!findItem(id)) return fail(MISSING)
  const result = await itemsTable.update(id, { text: text.trim() })
  return result.ok ? ok(null) : result
}

/** Remove an item, and its checks with it. Student leaders, mentors and admins only. */
export async function removePitItem(id: string): Promise<Result> {
  const problem = leaderProblem('remove checklist items')
  if (problem) return fail(problem)
  if (!findItem(id)) return fail(MISSING)
  const result = await itemsTable.remove(id)
  if (result.ok) {
    // The database deletes them too; this keeps the list on this device in step.
    for (const check of checksTable.rows().filter((c) => c.item_id === id)) await checksTable.remove(check.id)
  }
  return result
}

/**
 * Remove every item, and every check with them, to start the list again.
 * Gives back how many items were removed. Student leaders, mentors and
 * admins only.
 */
export async function clearPitChecklist(): Promise<Result<number>> {
  const problem = leaderProblem('clear the checklist')
  if (problem) return fail(problem)
  const items = itemsTable.rows()
  for (const item of items) {
    const result = await removePitItem(item.id)
    if (!result.ok) return result
  }
  return ok(items.length)
}

/** A position between two neighbours, so moving an item changes only that item. */
export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before !== undefined && after !== undefined) return (before + after) / 2
  if (before !== undefined) return before + 1
  if (after !== undefined) return after - 1
  return 0
}

/** Move an item to where `targetId` is now. Student leaders, mentors and admins only. */
export async function reorderPitItem(id: string, targetId: string): Promise<Result> {
  const problem = leaderProblem('reorder the checklist')
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

/**
 * Choose who's in a subgroup, on this device. People taken out of this
 * device's list also come off that subgroup's items, for everyone. Setting
 * a subgroup up for the first time, or adding someone, takes nobody off:
 * with no list before, it isn't known who was meant to be taken out.
 * Student leaders, mentors and admins only.
 */
export async function setSubgroupMembers(subgroup: PitSubgroup, ids: string[]): Promise<Result> {
  const problem = leaderProblem('edit subgroup members')
  if (problem) return fail(problem)
  if (!PIT_SUBGROUPS.includes(subgroup) || subgroup === 'General') return fail('General includes all active team members.')
  if (ids.some((id) => !membersTable.rows().some((member) => member.id === id && member.active))) return fail('Choose active team members.')
  const before = subgroupMembersStore.get()[subgroup]
  const removed = before ? before.filter((id) => !ids.includes(id)) : []
  subgroupMembersStore.set((groups) => ({ ...groups, [subgroup]: [...new Set(ids)] }))
  for (const item of itemsTable.rows().filter((item) => item.subgroup === subgroup)) {
    const kept = item.assignee_ids.filter((id) => !removed.includes(id))
    if (kept.length === item.assignee_ids.length) continue
    const result = await itemsTable.update(item.id, { assignee_ids: kept })
    if (!result.ok) return result
  }
  return ok(null)
}

// ---------------------------------------------------------------------------
// Checking items, for a match.

/** Whether someone may check an item: the people assigned to it, and student leaders, mentors and admins. */
export function canCheck(item: Pick<PitItem, 'assignee_ids'>, user: { id: string; role: Role }): boolean {
  return canManagePit(user.role) || item.assignee_ids.includes(user.id)
}

/** Check or uncheck an item for a match. */
export async function setPitItemCompleted(id: string, matchKey: string, completed: boolean): Promise<Result> {
  const item = findItem(id)
  if (!item) return fail(`${MISSING} Try another item.`)
  const user = currentUser()
  if (!user || !canCheck(item, user)) return fail('Only people assigned to this item can check or uncheck it. Ask a student leader or mentor if it should be yours.')
  const existing = checksTable.rows().find((check) => check.item_id === id && check.match_key === matchKey)
  if (completed) {
    if (existing) return ok(null)
    const result = await checksTable.insert({ item_id: id, match_key: matchKey })
    return result.ok ? ok(null) : result
  }
  return existing ? checksTable.remove(existing.id) : ok(null)
}

/**
 * Uncheck every item for one match, keeping the items and their people.
 * Each match already starts unchecked, so this is mostly for the practice
 * round, which is used again and again. Gives back how many were unchecked.
 * Student leaders, mentors and admins only.
 */
export async function uncheckAllPitItems(matchKey: string): Promise<Result<number>> {
  const problem = leaderProblem('uncheck the whole checklist')
  if (problem) return fail(problem)
  const checks = checksTable.rows().filter((check) => check.match_key === matchKey)
  for (const check of checks) {
    const result = await checksTable.remove(check.id)
    if (!result.ok) return result
  }
  return ok(checks.length)
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

/** The items not checked yet for a match, by who they're assigned to: unassigned first, so they stand out, then people by name. */
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

/**
 * Our matches still to play, from the event's matches in order, each with its
 * place in that order. It's our matches after the last match with a score:
 * one of ours still waiting for its score after a later match has one counts
 * as played (its score is late, or under review). The checklist, the home
 * tile and the pit display all use this, so they name the same next match.
 */
function ourMatchesLeft(rows: ScheduleRow[]): { lastScored: number; left: { row: ScheduleRow; place: number }[] } {
  const lastScored = rows.findLastIndex((row) => row.score !== null)
  const left = rows.flatMap((row, place) => (place > lastScored && row.ours ? [{ row, place }] : []))
  return { lastScored, left }
}

/** Our matches still to play, in order, then the practice round, which is always there. */
export function ourMatches(saved: SavedSchedule | null, team = OUR_TEAM): PitMatch[] {
  const rows = saved ? matchesWithPredictions(saved.matches, saved.predictions, team) : []
  const upcoming = ourMatchesLeft(rows).left
    .map(({ row }) => ({
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

// ---------------------------------------------------------------------------
// The pit display (#161), at #/status/display: a page left open on a TV or
// laptop in the pit, showing our next match, how long until it's expected
// to start, who we're with and against, and how we're doing.
//
// Everything comes from what the Scouting module saves on this device (the
// schedule, rankings, Match 13 ratings and team names), so it still shows
// with no connection, saying how old it is. The sums are here, as plain
// functions with `now` passed in, so the tests can use a fixed time;
// PitDisplay.tsx only shows what they give back. It never shows Match 13's
// predictions (who's likely to win, or the predicted score).

/** "Queue now" shows when our next match is this many matches away or fewer (1 is up next). */
export const QUEUE_AT = 2

/** How many of our matches after the next one "Coming up" lists. */
export const COMING_UP = 3

/** The "Updated" line stands out when the saved schedule is older than this, so nobody trusts an old time. */
export const DISPLAY_STALE_MS = 10 * 60 * 1000

/** How often the countdown ticks. It only does sums, so it never asks the network. */
export const DISPLAY_TICK_MS = 30 * 1000

/** One team in an alliance on the display. */
export interface DisplayTeam {
  number: number
  /** Its name, like "Ctrl-Z", or null when the event's team list isn't saved on this device. */
  name: string | null
  /** "Rank 6 · 5-2-0", "Rank 6" before The Blue Alliance has records, or "Not ranked yet". */
  standing: string
  /** "48.6 xP", "45.2 EPA" or "not rated": see ratingText(). */
  rating: string
  /** True for our team. */
  us: boolean
}

/** One of our matches still to play. */
export interface DisplayMatch {
  /** The Blue Alliance's match key, like 2026ilch_qm24. */
  key: string
  /** Like "Qual 24" or "Semifinal 3". */
  label: string
  alliance: 'Red' | 'Blue'
  /** When The Blue Alliance expects it to start, in seconds since 1970, or null. */
  time: number | null
  /** The other teams on our alliance. */
  partners: number[]
}

/** Our next match, with everything the big card shows. */
export interface NextMatch extends DisplayMatch {
  /** "18 min", "1 h 5 min", "Any minute now" or "Time not known yet": see countdownText(). */
  countdown: string
  /** True while counting down to a time; false when the countdown is words, which the page draws a little smaller. */
  counting: boolean
  /** How many matches until ours, counting from the last match with a score. 1 is up next. */
  away: number
  /** "Up next" or "3 matches away". */
  awayText: string
  /** True at QUEUE_AT matches away or fewer. */
  queueNow: boolean
  /** Our alliance, us first. */
  ours: DisplayTeam[]
  /** The other alliance. */
  theirs: DisplayTeam[]
}

/** What the display is worked out from: what the Scouting module saves on this device. */
export interface PitDisplayInput {
  schedule: SavedSchedule | null
  /** Whether the schedule is being fetched, and why the last try didn't work (useScheduleStatus()). */
  status: ScheduleStatus
  /** The event's rankings, best first. Empty before The Blue Alliance has them. */
  rankings: TbaRanking[]
  /** Every team's Match 13 rating. Empty before Match 13 has them. */
  ratings: Match13Rating[]
  /** The event's teams, for their names, or null when they aren't saved on this device. */
  teams: TbaTeam[] | null
}

/** Everything the display shows. */
export interface PitDisplayView {
  /** Our next match, or null when there isn't one: then `noMatch` says why. */
  next: NextMatch | null
  /** What the big card says instead of a next match, like "Quals done", with a smaller line under it. */
  noMatch: { text: string; note: string | null } | null
  /** Our rank and record, like "Rank 6 of 42 · 5-2-0", or "Not ranked yet". */
  standing: string
  /** Our last result, like "Qual 18 · Won 84–71", or null before we've played. */
  lastResult: string | null
  /** Our matches after the next one, up to COMING_UP of them. */
  comingUp: DisplayMatch[]
  /** "Updated 2 minutes ago", or null when no schedule is saved. */
  updated: string | null
  /** True when the saved schedule is older than DISPLAY_STALE_MS. The page makes "Updated" stand out. */
  stale: boolean
}

/**
 * The time until a match is expected to start: "18 min" or "1 h 5 min",
 * rounded up so it never says "0 min". "Any minute now" once the expected
 * time has passed (our next match has no score yet, so it hasn't been
 * played), and "Time not known yet" when there's no expected time.
 */
export function countdownText(time: number | null, now: Date): string {
  if (time === null) return 'Time not known yet'
  const minutes = Math.ceil((time * 1000 - now.getTime()) / 60_000)
  if (minutes <= 0) return 'Any minute now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
}

/**
 * When a match is expected to start: "10:42 AM" on the same day as `now`,
 * "Sun 9:00 AM" on another day, or "Time not known yet". It's in this
 * device's own time zone, like Scouting's Schedule page, which is the
 * event's when the device is there. `timeZone` is for the tests.
 */
export function clockTime(time: number | null, now: Date, timeZone?: string): string {
  if (time === null) return 'Time not known yet'
  const at = new Date(time * 1000)
  const format = (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(date)
  const sameDay = format(at, { dateStyle: 'short' }) === format(now, { dateStyle: 'short' })
  return format(at, sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/** A team's rating: Match 13's xP, Statbotics' EPA when Match 13 sent no xP, or "not rated". */
export function ratingText(rating: { xpEnd: number | null; epa: number | null } | undefined): string {
  const xp = rating?.xpEnd
  const epa = rating?.epa
  if (typeof xp === 'number') return `${xp.toFixed(1)} xP`
  if (typeof epa === 'number') return `${epa.toFixed(1)} EPA`
  return 'not rated'
}

/** " · 5-2-0" (wins, losses, ties), or nothing before The Blue Alliance has a record. */
function recordText(ranking: TbaRanking): string {
  return ranking.record ? ` · ${ranking.record.wins}-${ranking.record.losses}-${ranking.record.ties}` : ''
}

/**
 * Everything the pit display shows, from what's saved on this device, at
 * the time `now`.
 *
 * Our next match is our first one after the last match with a score. One of
 * ours still waiting for its score after a later match has one counts as
 * played. "Matches away" counts from that last match with a score, so with
 * Qual 21 scored, our Qual 24 is 3 matches away, and Qual 22 is up next.
 */
export function pitDisplay(input: PitDisplayInput, now: Date, team = OUR_TEAM): PitDisplayView {
  const matches = input.schedule?.matches ?? []
  // No predictions are passed in, so Match 13's can never reach the display.
  const rows = matchesWithPredictions(matches, [], team)
  const tba = new Map(matches.map((match) => [match.key, match]))
  const sideOf = (row: ScheduleRow): 'Red' | 'Blue' => (row.red.includes(team) ? 'Red' : 'Blue')

  const { lastScored, left } = ourMatchesLeft(rows)

  const teamOf = (number: number): DisplayTeam => {
    const ranking = rankOf(input.rankings, number)
    return {
      number,
      name: input.teams?.find((t) => t.team_number === number)?.nickname || null,
      standing: ranking ? `Rank ${ranking.rank}${recordText(ranking)}` : 'Not ranked yet',
      rating: ratingText(input.ratings.find((r) => r.teamNumber === number)),
      us: number === team,
    }
  }
  const displayMatch = (row: ScheduleRow): DisplayMatch => {
    const alliance = sideOf(row)
    const partners = (alliance === 'Red' ? row.red : row.blue).filter((n) => n !== team)
    return { key: row.key, label: row.label, alliance, time: row.time, partners }
  }

  let next: NextMatch | null = null
  if (left.length > 0) {
    const { row, place } = left[0]
    const match = displayMatch(row)
    const away = place - lastScored
    next = {
      ...match,
      countdown: countdownText(row.time, now),
      counting: row.time !== null && row.time * 1000 > now.getTime(),
      away,
      awayText: away === 1 ? 'Up next' : `${away} matches away`,
      queueNow: away <= QUEUE_AT,
      ours: [team, ...match.partners].map(teamOf),
      theirs: (match.alliance === 'Red' ? row.blue : row.red).map(teamOf),
    }
  }

  const ourRanking = rankOf(input.rankings, team)
  const standing = ourRanking ? `Rank ${ourRanking.rank} of ${input.rankings.length}${recordText(ourRanking)}` : 'Not ranked yet'

  // Our last match with a score, our score first.
  const last = rows.filter((row) => row.ours && row.score).at(-1)
  let lastResult: string | null = null
  if (last?.score) {
    const side = sideOf(last)
    const [us, them] = side === 'Red' ? [last.score.red, last.score.blue] : [last.score.blue, last.score.red]
    // The Blue Alliance's winner, when it gives one, covers playoff tiebreakers. Otherwise the higher score wins.
    const winner = tba.get(last.key)?.winning_alliance
    const outcome = winner ? (winner === side.toLowerCase() ? 'Won' : 'Lost') : us > them ? 'Won' : us < them ? 'Lost' : 'Tied'
    lastResult = `${last.label} · ${outcome} ${us}–${them}`
  }

  let noMatch: PitDisplayView['noMatch'] = null
  if (!next) {
    if (!input.schedule) {
      noMatch = input.status.problem && !input.status.loading
        ? { text: 'No schedule on this device yet', note: `${input.status.problem} This page tries again every 2 minutes.` }
        : { text: 'Getting the schedule…', note: null }
    } else if (rows.length === 0) {
      noMatch = { text: 'Schedule not out yet', note: 'This page checks The Blue Alliance every 2 minutes.' }
    } else if (!rows.some((row) => row.ours)) {
      noMatch = { text: `${team} isn't on the schedule`, note: 'Check that the right event is picked in Scouting.' }
    } else if (rows.some((row) => row.ours && tba.get(row.key)?.comp_level !== 'qm')) {
      // We've played in the playoffs: between rounds, or out.
      noMatch = { text: 'No match scheduled for us yet', note: 'Playoff matches show here once The Blue Alliance has them.' }
    } else {
      noMatch = { text: 'Quals done', note: standing }
    }
  }

  const saved = input.schedule
  const stale = saved !== null && now.getTime() - Date.parse(saved.savedAt) > DISPLAY_STALE_MS
  let updated: string | null = null
  if (saved) {
    updated = `Updated ${updatedAgo(saved.savedAt, now)}`
    // Say why, when the last try to get the schedule says why. Otherwise it's most likely the connection.
    if (stale) updated += `. Times may be out of date: ${input.status.problem ?? "check this device's connection."}`
  }

  return { next, noMatch, standing, lastResult, comingUp: left.slice(1, 1 + COMING_UP).map(({ row }) => displayMatch(row)), updated, stale }
}

/** For the display: "Ready", "3 of 14 checklist items left", or "No checklist items yet". */
export function readyText(progress: MatchProgress): string {
  if (progress.total === 0) return 'No checklist items yet'
  if (progress.ready) return 'Ready'
  return `${progress.left} of ${progress.total} checklist ${progress.total === 1 ? 'item' : 'items'} left`
}

/**
 * The display, for the page, at the time `now`. It reads the copies saved
 * on this device, so it never waits on the network. useRankings() also
 * checks for new rankings every minute while the page is open
 * (watchRankings() in Scouting's data.ts).
 */
export function usePitDisplay(now: Date): PitDisplayView {
  const event = useCurrentEvent().key
  const schedule = useSavedSchedule(event)
  const status = useScheduleStatus()
  const rankings = useRankings().saved?.rankings ?? []
  const { ratings } = useRatings()
  const teams = useSavedEventTeams(event)
  return pitDisplay({ schedule, status, rankings, ratings, teams }, now)
}

/**
 * Keep the display's data up to date while it's open: the schedule (now
 * and every 2 minutes, with keepScheduleFresh()), Match 13's ratings (every
 * 5 minutes: useRatings() alone only loads them when a page opens), and the
 * teams' names (now, and when the device comes back online, in case it
 * opened with none). Gives back a function that stops it all, for when the
 * page closes.
 */
export function keepPitDisplayFresh(event: string): () => void {
  const stopSchedule = keepScheduleFresh(event)
  const loadNames = () => void loadEventTeams(event)
  const ratingsTimer = setInterval(() => void loadRatings(), STALE_MS)
  globalThis.addEventListener?.('online', loadNames)
  loadNames()
  return () => {
    stopSchedule()
    clearInterval(ratingsTimer)
    globalThis.removeEventListener?.('online', loadNames)
  }
}

/**
 * Keep the screen from sleeping while the display is open, with the Screen
 * Wake Lock API, where the browser has it. The browser lets go when the page
 * is hidden, so it asks again when the page is back on screen. Where there's
 * no wake lock, or the browser says no (battery saver, say), the page works
 * the same and the screen may sleep. Gives back a function that lets go, for
 * when the page closes.
 */
export function keepScreenAwake(): () => void {
  const wakeLock = globalThis.navigator?.wakeLock
  if (!wakeLock) return () => {}
  let held: WakeLockSentinel | null = null
  let asking = false
  let stopped = false
  const ask = () => {
    if (stopped || asking || globalThis.document?.visibilityState !== 'visible' || (held && !held.released)) return
    asking = true
    wakeLock.request('screen').then(
      (lock) => {
        asking = false
        // The page closed while the browser was answering.
        if (stopped) void lock.release()
        else held = lock
      },
      () => {
        asking = false
      },
    )
  }
  globalThis.document?.addEventListener('visibilitychange', ask)
  ask()
  return () => {
    stopped = true
    globalThis.document?.removeEventListener('visibilitychange', ask)
    if (held) void held.release()
  }
}
