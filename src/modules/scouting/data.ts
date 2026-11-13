/**
 * Scouting module data.
 *
 * Entries: what a scout counted for one robot in one match. Venue Wi-Fi is
 * unreliable, so an entry is saved on this device first, in a store, and
 * marked Waiting (not synced). This is why entries aren't saved straight
 * into a table from createTable(): on the live site a table saves to the
 * database, which needs a connection.
 *
 * Syncing: Waiting entries are sent to the scouting_entries table whenever
 * there's a connection (supabase/migrations/..._scouting_entries.sql), then
 * marked Synced. Each keeps the id this device gave it, and the table skips
 * an id it already has, so sending an entry twice never makes two rows.
 *
 * The Blue Alliance (TBA): an event's match schedule and rankings, and a
 * team's matches and name. These come through the `tba` server function
 * (supabase/functions/tba/), which holds the team's TBA key, so the key is
 * never in the browser. In demo mode they return the made-up example data
 * below instead, so pages can be built without a key.
 *
 * The types are the parts of TBA's answers we use. TBA sends more; see
 * https://www.thebluealliance.com/apidocs/v3 for everything.
 *
 * Match 13 (match13.com): each team's rating at the event, and who's
 * predicted to win each match. These come through the `match13` server
 * function (supabase/functions/match13/) in the same way, with made-up
 * example data in demo mode. See https://match13.com/docs/api for
 * everything Match 13 sends.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { TEAM_TIME_ZONE } from '../../core/calendar'
import { callFunction } from '../../core/functions'
import { plural } from '../../core/format'
import type { Notice } from '../../core/registry'
import { isLeader, isMentor, type Role } from '../../core/roles'
import { currentUser, onSignedIn } from '../../core/session'
import { DEMO_PEOPLE } from '../../core/demo'
import { createStore, useStore, type Store } from '../../core/store'
import { supabase } from '../../core/supabase'
import { createTable, fail, newestFirst, ok, type Fields, type Result, type Row, type Table } from '../../core/table'
import { toCsv } from '../attendance/data'
import { forgetFile, keepFile, readFile } from './photoFiles'
import { AUTO_SIDES, BREAKDOWN_PARTS, COUNTERS, DRIVETRAINS, ENDGAME, ENDGAME_POINTS, EVENT_KEY, RANKING_POINTS, ROLES, type Counter } from './season'

/** The event we're at until someone picks one in the app, from season.ts, for other modules. */
export { EVENT_KEY }
/** This season's counters, endgame choices and roles, for other modules (like Prescouting's video scouting, #153). */
export { COUNTERS, ENDGAME, ROLES, type Counter }

// ---------------------------------------------------------------------------
// The event the team is scouting.
//
// A student leader, mentor or admin picks it in the app (EventPicker.tsx),
// and every phone uses it: the schedule, rankings and Match 13 numbers are
// for it, and entries are saved under it. Each pick is a row in
// scouting_events (supabase/migrations/..._scouting_events.sql), and the
// newest one is the current event. Until someone picks one, it's EVENT_KEY
// from season.ts.
//
// The match form has to work with no Wi-Fi, so it never waits on the table:
// the current event is kept on this phone too (eventStore), and EventSync
// in EventPicker.tsx keeps that copy up to date while Scouting is open.

/** One time a student leader, mentor or admin picked the event. */
export interface ScoutingEvent {
  id: string
  /** Like 2026ilch. */
  event_key: string
  /** Like "Midwest Regional". */
  name: string
  created_at: string
  created_by: string | null
}

/** Every time someone picked the event, newest first. */
export const eventsTable = createTable<ScoutingEvent>('scouting_events', {
  demo: [{ id: '00000000-0000-4000-8000-0000000e0201', event_key: EVENT_KEY, name: 'Example Regional', created_at: '2026-11-01T18:00:00Z', created_by: DEMO_PEOPLE.pat }],
  sort: newestFirst,
  keepOffline: true,
})

/** The event the team is scouting: its key, and its name once someone has picked it in the app. */
export interface CurrentEvent {
  key: string
  name: string | null
}

/** This phone's copy of the current event. Empty until Scouting has been open with a connection. */
export const eventStore = createStore<CurrentEvent | null>('scouting-event', 1, () => null)

/** The newest pick in the table, or nothing if someone hasn't picked one. */
export function latestEvent(rows: ScoutingEvent[]): CurrentEvent | null {
  const latest = rows[0]
  return latest ? { key: latest.event_key, name: latest.name } : null
}

/** The event the team is scouting, like 2026ilch. For code outside a page; pages use useCurrentEvent(). */
export function currentEvent(): string {
  return eventStore.get()?.key ?? EVENT_KEY
}

/** The event the team is scouting, for a page. It redraws when someone picks another event. */
export function useCurrentEvent(): CurrentEvent {
  return useStore(eventStore) ?? { key: EVENT_KEY, name: null }
}

/** Pick the event the whole team scouts. Student leaders, mentors and admins can; the database's rules check that too. */
export async function chooseEvent(event: Pick<TbaEvent, 'key' | 'name'>): Promise<Result<CurrentEvent>> {
  const role = currentUser()?.role
  if (!role || !isLeader(role)) return fail('Only student leaders, mentors, and admins can change the event. Ask one of them to pick it.')
  const result = await eventsTable.insert({ event_key: event.key, name: event.name })
  if (!result.ok) return result
  const chosen = { key: event.key, name: event.name }
  eventStore.set(chosen)
  return ok(chosen)
}

/** An event from The Blue Alliance, for looking one up. */
export interface TbaEvent {
  /** Like 2026ilch. */
  key: string
  name: string
  city: string | null
  state_prov: string | null
  country: string | null
  /** Like 2026-03-12. */
  start_date: string
  end_date: string
  year: number
}

/** The seasons to look in: this year's and next year's, since next season's events are listed in the fall. */
export function lookupSeasons(today = new Date()): number[] {
  const year = today.getFullYear()
  return [year, year + 1]
}

/** Our team's events in a season, soonest first. */
export async function getOurEvents(year: number): Promise<Result<TbaEvent[]>> {
  const result = await callFunction<TbaEvent[] | null>('tba', { kind: 'team-events', team: OUR_TEAM, year }, () => demoEvents(year).filter((e) => e.ours))
  return result.ok ? ok(byDate(result.value ?? [])) : result
}

/**
 * Any team's events in a season, newest first (#153, for prescouting). The
 * tba function already allows a team's events, so this needs no server
 * change. In demo mode every team has the made-up events.
 */
export async function getTeamEvents(team: number, year: number): Promise<Result<TbaEvent[]>> {
  const result = await callFunction<TbaEvent[] | null>('tba', { kind: 'team-events', team, year }, () => demoEvents(year).slice(0, 3))
  return result.ok ? ok(byDate(result.value ?? []).reverse()) : result
}

/** An event's page on The Blue Alliance. */
export function tbaEventUrl(event: string): string {
  return `https://www.thebluealliance.com/event/${encodeURIComponent(event)}`
}

/** Every event in a season, soonest first. A few hundred, so search them with searchEvents(). */
export async function getAllEvents(year: number): Promise<Result<TbaEvent[]>> {
  const result = await callFunction<TbaEvent[] | null>('tba', { kind: 'events', year }, () => demoEvents(year))
  return result.ok ? ok(byDate(result.value ?? [])) : result
}

const byDate = (events: TbaEvent[]) => [...events].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name))

/**
 * The events that match what someone typed: every word has to be in the
 * name, city, state, country or key, ignoring capitals. Nothing typed
 * gives nothing, since a whole season is too many to scroll through.
 */
export function searchEvents(events: TbaEvent[], text: string, limit = 20): TbaEvent[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return events
    .filter((e) => {
      const about = [e.name, e.city, e.state_prov, e.country, e.key].filter(Boolean).join(' ').toLowerCase()
      return words.every((w) => about.includes(w))
    })
    .slice(0, limit)
}

/** "Mar 12–14, 2026 · Peoria, Illinois" */
export function eventWhenWhere(event: TbaEvent): string {
  const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const start = day(event.start_date)
  const end = day(event.end_date)
  const sameMonth = start.split(' ')[0] === end.split(' ')[0]
  const dates = event.start_date === event.end_date ? start : `${start}–${sameMonth ? end.split(' ')[1] : end}`
  const where = [event.city, event.state_prov].filter(Boolean).join(', ')
  return `${dates}, ${event.year}${where ? ` · ${where}` : ''}`
}

// Made-up events for demo mode. The first is EVENT_KEY, so demo mode's
// example schedule and entries are for an event in the list.
function demoEvents(year: number): (TbaEvent & { ours: boolean })[] {
  const event = (key: string, name: string, city: string, state: string, start: string, end: string, ours: boolean) => ({
    key, name, city, state_prov: state, country: 'USA', start_date: `${year}-${start}`, end_date: `${year}-${end}`, year, ours,
  })
  return [
    event(year === Number(EVENT_KEY.slice(0, 4)) ? EVENT_KEY : `${year}demo1`, 'Example Regional', 'Champaign', 'Illinois', '03-12', '03-14', true),
    event(`${year}demo2`, 'Sample District Event', 'Peoria', 'Illinois', '03-26', '03-28', true),
    event(`${year}demo3`, 'Demo Valley Regional', 'Springfield', 'Missouri', '03-30', '04-02', false),
    event(`${year}demo4`, 'Placeholder Championship', 'Houston', 'Texas', '04-15', '04-18', false),
  ]
}

// ---------------------------------------------------------------------------
// The strategy team (#167). From the scouting requirements: only strategy
// people and mentors see the analysis. Like purchasers, being on it is an
// extra permission on top of someone's role; mentors and admins always count.
//
// Strategy only: the overview, team pages, the picklists, the simulator,
// stats and Prescouting. Everyone: the match and pit forms, the schedule and
// the rankings, so any scout can do their job. Hiding pages is only
// tidiness: the read rules in supabase/migrations/..._scouting_strategy_team.sql
// (and the strategy tables' own migrations) keep the data safe.

/** One person on the strategy team. */
export interface StrategyMember extends Row {
  member_id: string
  /** Which mentor added them. */
  created_by: string | null
}

// Made up, for demo mode: Jordan and Sam are on it. Alex (the demo student)
// isn't, so viewing as a student shows what someone off the team sees;
// viewing as a student leader, mentor or admin shows every page.
const EXAMPLE_STRATEGY: StrategyMember[] = [
  { id: '00000000-0000-4000-8000-0000000d0401', member_id: DEMO_PEOPLE.sam, created_at: '2026-11-01T18:00:00Z', created_by: DEMO_PEOPLE.pat },
  { id: '00000000-0000-4000-8000-0000000d0402', member_id: DEMO_PEOPLE.jordan, created_at: '2026-11-01T18:00:00Z', created_by: DEMO_PEOPLE.pat },
]

// keepOffline: a phone with no Wi-Fi still knows which pages to show.
export const strategyTable = createTable<StrategyMember>('scouting_strategy_team', { demo: EXAMPLE_STRATEGY, keepOffline: true })

/**
 * True for strategy team members, student leaders, mentors and admins.
 * Student leaders have the same Scouting permissions as mentors
 * (..._scouting_student_leaders.sql), so they always count too.
 */
export function isStrategy(user: { id: string; role: Role } | null | undefined, members: StrategyMember[]): boolean {
  if (!user) return false
  return isLeader(user.role) || members.some((m) => m.member_id === user.id)
}

/** Whether the signed-in person is on the strategy team (or a student leader, mentor or admin), for a page. */
export function useIsStrategy(): boolean {
  const members = strategyTable.useRows()
  return isStrategy(currentUser(), members)
}

/** The Scouting pages only the strategy team sees, by their address after #/scouting/. '' is the overview. */
export const STRATEGY_PATHS = ['', 'team', 'picklist', 'my-picklist', 'team-picklist', 'shared-picklist', 'simulate', 'stats']

/** What a page off limits says. */
export const STRATEGY_ONLY = 'Only the strategy team and mentors can see this.'

/** The Scouting pages to hide from the signed-in person in the Competition menu. */
export function useHiddenScoutingPages(): string[] {
  return useIsStrategy() ? [] : STRATEGY_PATHS
}

/** Put someone on the strategy team. Mentors and admins only: the database checks too. */
export async function addStrategyMember(memberId: string): Promise<Result<StrategyMember>> {
  const user = currentUser()
  if (!user || !isMentor(user.role)) return fail('Only mentors choose the strategy team.')
  if (strategyTable.rows().some((m) => m.member_id === memberId)) return fail("They're already on the strategy team.")
  return strategyTable.insert({ member_id: memberId })
}

/** Take someone off the strategy team. Mentors and admins only. */
export async function removeStrategyMember(memberId: string): Promise<Result> {
  const user = currentUser()
  if (!user || !isMentor(user.role)) return fail('Only mentors choose the strategy team.')
  const row = strategyTable.rows().find((m) => m.member_id === memberId)
  if (!row) return fail("They're not on the strategy team.")
  return strategyTable.remove(row.id)
}

// ---------------------------------------------------------------------------
// Entries, saved on this device.

/** Whether the robot was stopped during the match. These are FRC rules, so they don't change with the game. */
export const STOPS = ['None', 'A-stop', 'E-stop', 'Both'] as const
export type Stop = (typeof STOPS)[number]

/** Driver skill, from 1 (struggles to drive) to 5 (smooth and quick). */
export const DRIVER_SKILLS = [1, 2, 3, 4, 5]

/**
 * What a scout recorded for one robot in one match.
 *
 * Entries saved before roles, broke_down, stop and driver_skill were added
 * don't have them, and have a defense field instead. Entries saved before
 * #162 don't have role_notes, broke_parts, broke_other, browned_out,
 * auto_side, auto_notes or ranking_points. Syncing must fill in the missing
 * ones rather than assume every entry has them.
 */
export interface Entry {
  /** Made on the device, so sending an entry twice can't make two rows. */
  id: string
  /** ISO date and time it was saved. */
  created_at: string
  /**
   * The event it was scouted at, like 2026ilch. Entries saved before this
   * was added don't have one; they're sent with the current event.
   */
  event_key?: string
  /** The qualification match number. */
  match: number
  /** The team number, like 4096. */
  team: number
  /** The count for each counter in season.ts, by its key. */
  counts: Record<string, number>
  /** One of ENDGAME in season.ts. */
  endgame: string
  /** Any of ROLES in season.ts. Empty if the scout chose none. */
  roles: string[]
  /** "How well does it do its role?", like "fast cycles, missed a few shots". '' if left blank. */
  role_notes: string
  /** The robot stopped working or lost a mechanism. */
  broke_down: boolean
  /** Any of BREAKDOWN_PARTS in season.ts. Only when broke_down. */
  broke_parts: string[]
  /** Anything else that broke, typed. '' if left blank. Only when broke_down. */
  broke_other: string
  /** The robot lost power or visibly browned out (stuttering, lights flickering). */
  browned_out: boolean
  stop: Stop
  /** One of DRIVER_SKILLS. */
  driver_skill: number
  /** Where it started its auto: one of AUTO_SIDES in season.ts, or '' if the scout didn't see. */
  auto_side: string
  /** What its auto did. '' if left blank. */
  auto_notes: string
  /** Any of RANKING_POINTS in season.ts: the bonus ranking points its alliance earned. */
  ranking_points: string[]
  notes: string
  /** Who scouted it. Show their name with useMemberNames(). */
  scouted_by: string | null
  /** False while it's only on this device (Waiting). */
  synced: boolean
}

/** What the scout fills in on the form. saveEntry() adds the rest. */
export type EntryFields = Pick<
  Entry,
  | 'match' | 'team' | 'counts' | 'endgame' | 'roles' | 'role_notes' | 'broke_down' | 'broke_parts' | 'broke_other'
  | 'browned_out' | 'stop' | 'driver_skill' | 'auto_side' | 'auto_notes' | 'ranking_points' | 'notes'
>

// Newest first. keepOnReset: "Reset example data" must never delete real
// scouting. Don't raise the version while entries are waiting on people's
// devices: copies saved under the old version are ignored.
export const entryStore = createStore<Entry[]>('scouting-entries', 1, () => [], { keepOnReset: true })

/** Every entry saved on this device, newest first. */
export function useEntries(): Entry[] {
  return useStore(entryStore)
}

/** The home page tile's status, like "3 entries waiting · Rank 6". Pit entries count too. The rank is from the rankings saved on this phone. */
export function useEntrySummary(): Notice {
  const entries = [...useEntries(), ...usePitEntries()]
  const event = useCurrentEvent().key
  const rankings = useStore(rankingsStore)
  const ours = rankings?.event === event ? rankOf(rankings.rankings, OUR_TEAM) : null
  const rank = ours ? ` · Rank ${ours.rank}` : ''
  const waiting = entries.filter((e) => !e.synced).length
  if (waiting > 0) return { tone: 'info', text: plural(waiting, 'entry waiting', 'entries waiting') + rank }
  return { tone: 'plain', text: (entries.length === 0 ? 'No entries on this device' : `${plural(entries.length, 'entry', 'entries')} saved`) + rank }
}

const isCount = (value: number) => Number.isInteger(value) && value > 0

// The team database allows the same: see the checks in the scouting_entries
// migration. An entry it would refuse could never sync, so refuse it here.
export const MAX_MATCH = 1000
export const MAX_TEAM = 99999
export const MAX_NOTES_LENGTH = 1000
/** For the short answers: how well it does its role, what else broke, and what its auto did. */
export const MAX_SHORT_LENGTH = 300

/** Why an entry can't be saved, or null if it can. */
export function checkEntry(fields: EntryFields): string | null {
  if (!isCount(fields.team)) return 'Enter the team number first.'
  if (fields.team > MAX_TEAM) return `Check the team number: ${fields.team} is too big.`
  if (!isCount(fields.match)) return 'Enter the match number first.'
  if (fields.match > MAX_MATCH) return `Check the match number: ${fields.match} is too big.`
  if (!DRIVER_SKILLS.includes(fields.driver_skill)) return 'Choose a driver skill first.'
  for (const [name, text] of [['how well it does its role', fields.role_notes], ['what else broke', fields.broke_other], ['auto answer', fields.auto_notes]] as const) {
    const length = text.trim().length
    if (length > MAX_SHORT_LENGTH) return `Keep ${name} under ${MAX_SHORT_LENGTH} characters. It's ${length}.`
  }
  const notes = fields.notes.trim().length
  if (notes > MAX_NOTES_LENGTH) return `Keep the notes under ${MAX_NOTES_LENGTH} characters. These are ${notes}.`
  return null
}

/** Save an entry on this device, marked as not synced yet. */
export function saveEntry(fields: EntryFields): Result<Entry> {
  const problem = checkEntry(fields)
  if (problem) return fail(problem)
  const entry: Entry = {
    ...fields,
    role_notes: fields.role_notes.trim(),
    // What broke only means something if it broke down.
    broke_parts: fields.broke_down ? fields.broke_parts : [],
    broke_other: fields.broke_down ? fields.broke_other.trim() : '',
    auto_notes: fields.auto_notes.trim(),
    notes: fields.notes.trim(),
    id: newId(),
    created_at: new Date().toISOString(),
    event_key: currentEvent(),
    scouted_by: currentUser()?.id ?? null,
    synced: false,
  }
  entryStore.set((entries) => [entry, ...entries])
  // Send it now if there's a connection. If not, it waits on this device.
  void syncEntries()
  return ok(entry)
}

// ---------------------------------------------------------------------------
// Syncing entries to the team database.

/** One row of the scouting_entries table: an entry that reached the team database. */
export interface ScoutingEntry extends Row {
  event_key: string
  match_number: number
  team_number: number
  counts: Record<string, number>
  endgame: string
  /** Any of ROLES in season.ts. */
  roles: string[]
  /** "How well does it do its role?" Empty if left blank, or saved before #162. */
  role_notes: string | null
  broke_down: boolean
  /** Any of BREAKDOWN_PARTS in season.ts. Empty for entries saved before #162. */
  broke_parts: string[]
  broke_other: string | null
  /** False for entries saved before #162. */
  browned_out: boolean
  stop: Stop
  /** 1 to 5. Empty for entries saved before driver skill was on the form. */
  driver_skill: number | null
  /** One of AUTO_SIDES in season.ts. Empty if the scout didn't see, or saved before #162. */
  auto_side: string | null
  auto_notes: string | null
  /** Any of RANKING_POINTS in season.ts. Empty for entries saved before #162. */
  ranking_points: string[]
  notes: string | null
  /** Who scouted it, and when, on their phone. */
  scouted_by: string | null
  scouted_at: string
  /** Who sent it. Usually the scout, but a shared phone can send someone else's entries. */
  created_by: string | null
}

// Made up, for demo mode. Team numbers in the 9990s, so nobody mistakes them for real scouting.
const EXAMPLE_ENTRIES: ScoutingEntry[] = [
  { id: '00000000-0000-4000-8000-0000000d0001', event_key: EVENT_KEY, match_number: 1, team_number: 9991, counts: { autoFuel: 3, teleopFuel: 12, fuelMissed: 4 }, endgame: 'Level 2', roles: ['Scorer'], role_notes: 'Quick cycles, missed a few long shots', broke_down: false, broke_parts: [], broke_other: null, browned_out: false, stop: 'None', driver_skill: 4, auto_side: 'Center', auto_notes: 'Scored preload and 2 more', ranking_points: ['Energized'], notes: 'Fast intake', scouted_by: DEMO_PEOPLE.jordan, scouted_at: '2026-11-07T15:02:00Z', created_at: '2026-11-07T15:03:00Z', created_by: DEMO_PEOPLE.jordan },
  { id: '00000000-0000-4000-8000-0000000d0002', event_key: EVENT_KEY, match_number: 1, team_number: 9992, counts: { autoFuel: 0, teleopFuel: 5, fuelMissed: 1 }, endgame: 'None', roles: ['Defender'], role_notes: null, broke_down: true, broke_parts: ['Intake'], broke_other: null, browned_out: true, stop: 'A-stop', driver_skill: 2, auto_side: 'Left', auto_notes: null, ranking_points: [], notes: null, scouted_by: DEMO_PEOPLE.alex, scouted_at: '2026-11-07T15:02:30Z', created_at: '2026-11-07T15:04:00Z', created_by: DEMO_PEOPLE.alex },
]

// Version 2: the questions from #162 were added to the rows.
export const entriesTable = createTable<ScoutingEntry>('scouting_entries', { demo: EXAMPLE_ENTRIES, sort: newestFirst, version: 2 })

/** Fields added to the form after the first entries were saved on phones: #28's, then #162's. */
type AddedLater = 'roles' | 'broke_down' | 'stop' | 'driver_skill' | 'role_notes' | 'broke_parts' | 'broke_other' | 'browned_out' | 'auto_side' | 'auto_notes' | 'ranking_points'

/** An entry saved on a phone by an older version of the app, before some questions were on the form. */
type OlderEntry = Omit<Entry, AddedLater> & Partial<Pick<Entry, AddedLater>> & { defense?: boolean }

/**
 * An entry from this device, as a row for the team database. Entries saved
 * before #28 have "played defense" instead of roles: it becomes the
 * Defender role, the way the form treats it now. Fields an older entry
 * doesn't have are left at "no", "None" and empty.
 */
export function toRow(saved: Entry | OlderEntry): Omit<ScoutingEntry, 'created_at' | 'created_by'> {
  const entry = saved as OlderEntry
  const text = (value: string | undefined) => value?.trim() || null
  return {
    id: entry.id,
    event_key: entry.event_key ?? currentEvent(),
    match_number: entry.match,
    team_number: entry.team,
    counts: entry.counts,
    endgame: entry.endgame,
    roles: entry.roles ?? (entry.defense ? ['Defender'] : []),
    role_notes: text(entry.role_notes),
    broke_down: entry.broke_down ?? false,
    broke_parts: entry.broke_parts ?? [],
    broke_other: text(entry.broke_other),
    browned_out: entry.browned_out ?? false,
    stop: entry.stop ?? 'None',
    driver_skill: entry.driver_skill ?? null,
    auto_side: text(entry.auto_side),
    auto_notes: text(entry.auto_notes),
    ranking_points: entry.ranking_points ?? [],
    notes: entry.notes.trim() || null,
    scouted_by: entry.scouted_by,
    scouted_at: entry.created_at,
  }
}

/** Whether entries are being sent right now, and why the last try didn't work, if it didn't. */
export interface SyncStatus {
  sending: boolean
  problem: string | null
}

// Only for this page visit: not saved.
export const syncStatus = createStore<SyncStatus>('scouting-sync', 1, () => ({ sending: false, problem: null }), { persist: false, keepOnReset: true })

export function useSyncStatus(): SyncStatus {
  return useStore(syncStatus)
}

const NO_CONNECTION = "No connection. They'll send by themselves when this phone is back online."

// The send under way, if there is one, so two tries at once share it.
let inFlight: Promise<Result<number>> | null = null

/**
 * Send every Waiting entry, match and pit, to the team database, and mark
 * them Synced.
 * Gives back how many were sent. If it can't (no connection, or not signed
 * in), they stay Waiting and the next try sends them. If a send is already
 * under way, this waits for it, then sends whatever is still waiting, such
 * as an entry saved in the meantime.
 */
export function syncEntries(): Promise<Result<number>> {
  if (inFlight) return inFlight.then(() => syncEntries())
  inFlight = send().finally(() => {
    inFlight = null
  })
  return inFlight
}

/** Whether any match or pit entry, or robot photo, on this device is Waiting. */
function hasWaiting(): boolean {
  return [entryStore, pitStore, photoStore].some((store) => store.get().some((e) => !e.synced))
}

/** Stop sending, and show why on the page. */
function stopSending(problem: string): Result<number> {
  syncStatus.set({ sending: false, problem })
  return fail(problem)
}

// Sends match entries, then pit entries, then robot photos.
async function send(): Promise<Result<number>> {
  if (!hasWaiting()) return ok(0)
  if (globalThis.navigator?.onLine === false) return stopSending(NO_CONNECTION)
  if (!currentUser()) return fail('Sign in to send your entries.')

  syncStatus.set({ sending: true, problem: syncStatus.get().problem })
  const matches = await sendWaiting(entryStore, entriesTable, toRow)
  if (!matches.ok) return stopSending(matches.error)
  const pits = await sendWaiting(pitStore, pitTable, pitToRow)
  if (!pits.ok) return stopSending(pits.error)
  const photos = await sendPhotos()
  if (!photos.ok) return stopSending(photos.error)
  syncStatus.set({ sending: false, problem: null })
  return ok(matches.value + pits.value + photos.value)
}

/**
 * Send one kind of entry: the Waiting ones in a store go to its table, then
 * are marked Synced. Gives back how many were sent.
 */
async function sendWaiting<E extends { id: string; synced: boolean }, T extends Row>(
  store: Store<E[]>,
  table: Table<T>,
  asRow: (entry: E) => Fields<T> & { id: string },
): Promise<Result<number>> {
  const waiting = store.get().filter((e) => !e.synced)
  if (waiting.length === 0) return ok(0)
  const result = await table.insertOnce(waiting.map(asRow))
  if (!result.ok) return result
  // Mark only the ones just sent: entries saved while sending stay Waiting.
  const sent = new Set(waiting.map((e) => e.id))
  store.set((entries) => entries.map((e) => (sent.has(e.id) ? { ...e, synced: true } : e)))
  return ok(waiting.length)
}

/** How often to try again while entries are waiting. */
export const RETRY_MS = 60 * 1000

/**
 * Keep trying to send Waiting entries: when the app opens, when the phone
 * comes back online, when the app comes back on screen, and every minute
 * while any are waiting. Venue Wi-Fi comes and goes, so this doesn't rely
 * on any one of them.
 */
function keepSyncing() {
  const tryNow = () => {
    if (hasWaiting()) void syncEntries()
  }
  globalThis.addEventListener('online', tryNow)
  // The sign-in is checked again once the connection is back: send then too.
  onSignedIn(tryNow)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tryNow()
  })
  setInterval(tryNow, RETRY_MS)
  setTimeout(tryNow, 0)
}

/** A random id like the database makes. Works on http:// pages too, unlike crypto.randomUUID(). */
function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// ---------------------------------------------------------------------------
// The pit form: what a team told us about their robot in their pit. Saved on
// this device first, like match entries, and synced later.

/** One pit form, filled in. Numbers the scout left blank are null. */
export interface PitEntry {
  /** Made on the device, so sending an entry twice can't make two rows. */
  id: string
  /** ISO date and time it was saved. */
  created_at: string
  /** The event, like 2026ilch. Pit entries saved before this was added don't have one; they're sent with the current event. */
  event_key?: string
  /** The team number, like 4096. */
  team: number
  /** The form doesn't ask for a match any more. Pit entries saved before that may have one, and still send it. */
  match?: number | null
  /** One of DRIVETRAINS in season.ts, or '' if not chosen. */
  drivetrain: string
  /** The drivetrain typed when it's Other, like "West coast with butterfly modules". '' otherwise. */
  drivetrain_other: string
  /** "What can their robot see?": any of VISION in season.ts. */
  vision: string[]
  /** More about what it can see, typed. '' if left blank. */
  vision_notes: string
  /** Pounds. */
  weight: number | null
  /** Inches. */
  length: number | null
  width: number | null
  height: number | null
  motors: string
  /** One of AUTO_SIDES in season.ts, or '' if not chosen. */
  auto_side: string
  auto_path: string
  /** "What do they want their partners to do?" */
  partners_do: string
  /** "What will they do?" */
  they_do: string
  /** Who scouted it. Show their name with useMemberNames(). */
  scouted_by: string | null
  /** False while it's only on this device (Waiting). */
  synced: boolean
}

/** What the scout fills in on the pit form. savePitEntry() adds the rest. */
export type PitFields = Omit<PitEntry, 'id' | 'created_at' | 'event_key' | 'match' | 'scouted_by' | 'synced'>

// Newest first. keepOnReset and the version: see entryStore above.
export const pitStore = createStore<PitEntry[]>('scouting-pit-entries', 1, () => [], { keepOnReset: true })

/** Every pit entry saved on this device, newest first. */
export function usePitEntries(): PitEntry[] {
  return useStore(pitStore)
}

/** Why a pit entry can't be saved, or null if it can. */
export function checkPitEntry(fields: PitFields): string | null {
  if (!isCount(fields.team)) return 'Enter the team number first.'
  if (fields.team > MAX_TEAM) return `Check the team number: ${fields.team} is too big.`
  for (const [name, value] of [['weight', fields.weight], ['length', fields.length], ['width', fields.width], ['height', fields.height]] as const) {
    if (value !== null && !(value > 0 && value < MAX_PIT_NUMBER)) return `Check the ${name}, or leave it blank.`
  }
  // The same limits as the team database, so an entry can't get stuck Waiting.
  for (const [name, text] of [['motors', fields.motors], ['auto path', fields.auto_path], ['first strategy answer', fields.partners_do], ['second strategy answer', fields.they_do]] as const) {
    const length = text.trim().length
    if (length > MAX_NOTES_LENGTH) return `Keep the ${name} under ${MAX_NOTES_LENGTH} characters. This one is ${length}.`
  }
  if (fields.drivetrain === 'Other' && fields.drivetrain_other.trim().length > MAX_DRIVETRAIN_LENGTH) return `Keep the drivetrain under ${MAX_DRIVETRAIN_LENGTH} characters.`
  if (fields.vision_notes.trim().length > MAX_SHORT_LENGTH) return `Keep what it can see under ${MAX_SHORT_LENGTH} characters.`
  return null
}

/** The longest a typed Other drivetrain can be, the same as the team database. */
export const MAX_DRIVETRAIN_LENGTH = 100

/** Weights and sizes must be under this. Nothing real comes close: it only stops a typo like 1155 for 115.5 from getting much worse. */
export const MAX_PIT_NUMBER = 10000

/** Save a pit entry on this device, marked as not synced yet. */
export function savePitEntry(fields: PitFields): Result<PitEntry> {
  const problem = checkPitEntry(fields)
  if (problem) return fail(problem)
  const trim = (text: string) => text.trim()
  const entry: PitEntry = {
    ...fields,
    motors: trim(fields.motors),
    // The typed drivetrain only means something when Other is chosen.
    drivetrain_other: fields.drivetrain === 'Other' ? trim(fields.drivetrain_other) : '',
    vision_notes: trim(fields.vision_notes),
    auto_path: trim(fields.auto_path),
    partners_do: trim(fields.partners_do),
    they_do: trim(fields.they_do),
    id: newId(),
    created_at: new Date().toISOString(),
    event_key: currentEvent(),
    scouted_by: currentUser()?.id ?? null,
    synced: false,
  }
  pitStore.set((entries) => [entry, ...entries])
  // Send it now if there's a connection. If not, it waits on this device.
  void syncEntries()
  return ok(entry)
}

/** One row of the scouting_pit_entries table: a pit entry that reached the team database. */
export interface ScoutingPitEntry extends Row {
  event_key: string
  team_number: number
  match_number: number | null
  drivetrain: string | null
  /** The drivetrain typed when it's Other. Empty otherwise, or for entries saved before #163. */
  drivetrain_other: string | null
  /** Any of VISION in season.ts. Empty for entries saved before #163. */
  vision: string[]
  vision_notes: string | null
  weight: number | null
  length: number | null
  width: number | null
  height: number | null
  motors: string | null
  auto_side: string | null
  auto_path: string | null
  partners_do: string | null
  they_do: string | null
  /** Who scouted it, and when, on their phone. */
  scouted_by: string | null
  scouted_at: string
  /** Who sent it. Usually the scout, but a shared phone can send someone else's entries. */
  created_by: string | null
}

// Made up, for demo mode. Team numbers in the 9990s, so nobody mistakes them for real scouting.
const EXAMPLE_PIT_ENTRIES: ScoutingPitEntry[] = [
  { id: '00000000-0000-4000-8000-0000000d0101', event_key: EVENT_KEY, team_number: 9991, match_number: null, drivetrain: 'Swerve', drivetrain_other: null, vision: ['AprilTags', 'Game piece detection'], vision_notes: 'Two cameras on the shooter', weight: 118.5, length: 28, width: 28, height: 22, motors: '8 Kraken X60 on swerve, 2 on the shooter', auto_side: 'Center', auto_path: 'Scores preload, picks up 2 from the middle', partners_do: 'Feed us fuel', they_do: 'Score from the hub', scouted_by: DEMO_PEOPLE.jordan, scouted_at: '2026-11-06T22:10:00Z', created_at: '2026-11-06T22:11:00Z', created_by: DEMO_PEOPLE.jordan },
  { id: '00000000-0000-4000-8000-0000000d0102', event_key: EVENT_KEY, team_number: 9992, match_number: null, drivetrain: 'Other', drivetrain_other: 'West coast with butterfly modules', vision: [], vision_notes: null, weight: null, length: null, width: null, height: null, motors: null, auto_side: 'Left', auto_path: null, partners_do: null, they_do: 'Play defense', scouted_by: DEMO_PEOPLE.alex, scouted_at: '2026-11-06T22:20:00Z', created_at: '2026-11-06T22:21:00Z', created_by: DEMO_PEOPLE.alex },
]

// Version 2: the drivetrain typed for Other, and vision, were added to the rows (#163).
export const pitTable = createTable<ScoutingPitEntry>('scouting_pit_entries', { demo: EXAMPLE_PIT_ENTRIES, sort: newestFirst, version: 2 })

/** Fields added to the pit form after the first pit entries were saved on phones (#163). */
type PitAddedLater = 'drivetrain_other' | 'vision' | 'vision_notes'

/** A pit entry saved on a phone by an older version of the app, before some questions were on the form. */
type OlderPitEntry = Omit<PitEntry, PitAddedLater> & Partial<Pick<PitEntry, PitAddedLater>>

/**
 * A pit entry from this device, as a row for the team database. Blank
 * choices and boxes are sent as empty (null), and so are questions an
 * older entry doesn't have.
 */
export function pitToRow(entry: PitEntry | OlderPitEntry): Omit<ScoutingPitEntry, 'created_at' | 'created_by'> {
  const text = (value: string | undefined) => value?.trim() || null
  return {
    id: entry.id,
    event_key: entry.event_key ?? currentEvent(),
    team_number: entry.team,
    match_number: entry.match ?? null,
    drivetrain: text(entry.drivetrain),
    drivetrain_other: text(entry.drivetrain_other),
    vision: entry.vision ?? [],
    vision_notes: text(entry.vision_notes),
    weight: entry.weight,
    length: entry.length,
    width: entry.width,
    height: entry.height,
    motors: text(entry.motors),
    auto_side: text(entry.auto_side),
    auto_path: text(entry.auto_path),
    partners_do: text(entry.partners_do),
    they_do: text(entry.they_do),
    scouted_by: entry.scouted_by,
    scouted_at: entry.created_at,
  }
}

/** A number box's text as a number, or null if it's blank. */
export function blankOrNumber(text: string): number | null {
  return text.trim() === '' ? null : Number(text)
}

/**
 * What's typed in a number box with everything but the number taken out:
 * digits and one decimal point, like "115.5". For weight and size, so a
 * scout can't type "about 120" or "120 lbs".
 */
export function numberOnly(text: string): string {
  const [whole, ...rest] = text.replace(/[^0-9.]/g, '').split('.')
  return rest.length === 0 ? whole : `${whole}.${rest.join('')}`
}

// ---------------------------------------------------------------------------
// Robot photos (#164): taken from the pit form, shown on the team page.
//
// Like entries, a photo is saved on this phone first and marked Waiting,
// then sent by syncEntries() when there's a connection: the file goes to
// the private robot-photos bucket, then a row goes in scouting_robot_photos
// (supabase/migrations/..._scouting_robot_photos.sql). The files wait in
// IndexedDB (photoFiles.ts), since localStorage is too small for photos;
// photoStore only lists them. Each photo is shrunk to a JPEG first, so it
// uploads quickly on venue Wi-Fi. Demo mode has no file storage: photos
// still show on the phone that took them.

/** One robot photo taken on this phone. The file itself is in photoFiles.ts. */
export interface PhotoEntry {
  /** Made on the phone, so sending a photo twice can't make two rows. */
  id: string
  /** ISO date and time it was taken. */
  created_at: string
  event_key: string
  team: number
  size_bytes: number
  /** Who took it. Show their name with useMemberNames(). */
  taken_by: string | null
  /** False while it's only on this phone (Waiting). */
  synced: boolean
}

// Newest first. keepOnReset and the version: see entryStore above.
export const photoStore = createStore<PhotoEntry[]>('scouting-photos', 1, () => [], { keepOnReset: true })

/** Every robot photo taken on this phone, newest first. */
export function usePhotoEntries(): PhotoEntry[] {
  return useStore(photoStore)
}

/** One row of scouting_robot_photos: a photo that reached the team database. */
export interface RobotPhoto extends Row {
  event_key: string
  team_number: number
  /** Where the file is in the robot-photos bucket: see photoPath(). */
  path: string
  size_bytes: number
  /** Who took it, and when, on their phone. */
  taken_by: string | null
  taken_at: string
  /** Who sent it. */
  created_by: string | null
}

// No example rows: demo mode has no files to show for them.
export const photosTable = createTable<RobotPhoto>('scouting_robot_photos', { demo: [], sort: newestFirst })

const PHOTO_BUCKET = 'robot-photos'
/** Photos are shrunk so their longest side is at most this many pixels. */
export const PHOTO_MAX_SIDE = 1280
/** The bucket takes files up to 5 MB. A shrunk photo is far smaller. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
/** How long a link to a photo works, in seconds. */
const PHOTO_LINK_SECONDS = 60 * 60

/** Where a photo goes in the bucket: event, team, then its id. The database checks it's exactly this. */
export function photoPath(event: string, team: number, id: string): string {
  return `${event}/${team}/${id}.jpg`
}

/** A photo's size once shrunk: its longest side at most `max`, the same shape. Small photos stay as they are. */
export function shrunkSize(width: number, height: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Shrink a photo from the camera to a JPEG (see shrunkSize()). Only works in a browser. */
export async function shrinkPhoto(file: Blob): Promise<Result<Blob>> {
  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = shrunkSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    return jpeg ? ok(jpeg) : fail("Couldn't shrink that photo. Try taking it again.")
  } catch {
    return fail("Couldn't read that photo. Try taking it again.")
  }
}

/**
 * Save a photo of team `team`'s robot on this phone, marked Waiting, and
 * send it if there's a connection. `shrink` is for tests, which can't draw
 * pictures.
 */
export async function addPhoto(team: number, file: Blob, shrink: (file: Blob) => Promise<Result<Blob>> = shrinkPhoto): Promise<Result<PhotoEntry>> {
  if (!isCount(team) || team > MAX_TEAM) return fail('Enter the team number first, then add the photo.')
  if (!file.type.startsWith('image/')) return fail("That isn't a photo. Choose a photo, or take one with the camera.")
  const shrunk = await shrink(file)
  if (!shrunk.ok) return shrunk
  if (shrunk.value.size > MAX_PHOTO_BYTES) return fail('That photo is too big, even shrunk. Try taking it again.')
  const photo: PhotoEntry = {
    id: newId(),
    created_at: new Date().toISOString(),
    event_key: currentEvent(),
    team,
    size_bytes: shrunk.value.size,
    taken_by: currentUser()?.id ?? null,
    synced: false,
  }
  await keepFile(photo.id, shrunk.value)
  photoStore.set((photos) => [photo, ...photos])
  void syncEntries()
  return ok(photo)
}

/** A photo from this phone, as a row for the team database. */
export function photoToRow(photo: PhotoEntry): Omit<RobotPhoto, 'created_at' | 'created_by'> {
  return {
    id: photo.id,
    event_key: photo.event_key,
    team_number: photo.team,
    path: photoPath(photo.event_key, photo.team, photo.id),
    size_bytes: photo.size_bytes,
    taken_by: photo.taken_by,
    taken_at: photo.created_at,
  }
}

/**
 * Send every Waiting photo: the file, then its row, then mark it Synced and
 * forget the file on this phone. A file that's already uploaded (an earlier
 * try that didn't hear back) counts as uploaded.
 */
async function sendPhotos(): Promise<Result<number>> {
  let sent = 0
  for (const photo of photoStore.get().filter((p) => !p.synced)) {
    const file = await readFile(photo.id)
    if (!file) {
      // Kept in memory (no IndexedDB) and the app was closed: it's gone.
      photoStore.set((photos) => photos.filter((p) => p.id !== photo.id))
      continue
    }
    const row = photoToRow(photo)
    if (supabase) {
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(row.path, file, { upsert: false, contentType: 'image/jpeg' })
      if (error && !/exists|duplicate/i.test(error.message)) return fail("Couldn't upload a robot photo. It will try again by itself.")
    }
    const added = await photosTable.insertOnce([row])
    if (!added.ok) return added
    photoStore.set((photos) => photos.map((p) => (p.id === photo.id ? { ...p, synced: true } : p)))
    await forgetFile(photo.id)
    sent += 1
  }
  return ok(sent)
}

/** One photo for the team page: the newest first. `url` is null until it can be shown. */
export interface TeamPhoto {
  id: string
  url: string | null
  taken_by: string | null
  taken_at: string
  /** True while it's only on this phone. */
  waiting: boolean
}

/**
 * A team's robot photos at this event (or `eventKey`, for prescouting), newest first: the team database's,
 * and this phone's Waiting ones. The Waiting ones show from the phone, so
 * they show with no Wi-Fi; sent ones need a connection, through links that
 * stop working after an hour.
 */
export function useTeamPhotos(team: number, eventKey?: string): TeamPhoto[] {
  const current = useCurrentEvent().key
  const event = eventKey ?? current
  const sent = photosTable.useRows()
  const onPhone = usePhotoEntries()
  const list = useMemo(() => {
    const rows = sent.filter((p) => p.event_key === event && p.team_number === team).map((p) => ({ id: p.id, path: p.path, taken_by: p.taken_by, taken_at: p.taken_at, waiting: false }))
    const have = new Set(rows.map((p) => p.id))
    const waiting = onPhone
      .filter((p) => !p.synced && p.event_key === event && p.team === team && !have.has(p.id))
      .map((p) => ({ id: p.id, path: photoPath(p.event_key, p.team, p.id), taken_by: p.taken_by, taken_at: p.created_at, waiting: true }))
    return [...rows, ...waiting].sort((a, b) => b.taken_at.localeCompare(a.taken_at))
  }, [sent, onPhone, event, team])

  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    let current = true
    const made: string[] = []
    void (async () => {
      const found: Record<string, string> = {}
      // From this phone: Waiting photos, and in demo mode any photo still here.
      for (const photo of list) {
        const file = await readFile(photo.id)
        if (file && typeof URL.createObjectURL === 'function') {
          found[photo.id] = URL.createObjectURL(file)
          made.push(found[photo.id])
        }
      }
      // From the team database's bucket: the rest, in one request.
      const rest = list.filter((p) => !found[p.id] && !p.waiting)
      if (supabase && rest.length > 0) {
        const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(rest.map((p) => p.path), PHOTO_LINK_SECONDS)
        for (const [i, link] of (data ?? []).entries()) if (link.signedUrl) found[rest[i].id] = link.signedUrl
      }
      if (current) setUrls(found)
    })()
    return () => {
      current = false
      for (const url of made) URL.revokeObjectURL(url)
    }
  }, [list])

  return list.map((p) => ({ id: p.id, url: urls[p.id] ?? null, taken_by: p.taken_by, taken_at: p.taken_at, waiting: p.waiting }))
}

// Keep sending Waiting match and pit entries, in a browser. (The tests call
// syncEntries() themselves.)
if (typeof window !== 'undefined' && typeof document !== 'undefined') keepSyncing()

// ---------------------------------------------------------------------------
// Team summary: everything we scouted about one team at this event, added
// up for the team page (#36). teamSummary() is a plain function, with no
// hooks, so the picklist can use the same numbers. pitAnswers() and
// pitDrivetrain() are the only code here that reads a pit entry's answers.

/** A match entry, from the team database or still Waiting on this phone (see toRow()). */
export type MatchRow = ReturnType<typeof toRow>

/** A pit entry, from the team database or still Waiting on this phone (see pitToRow()). */
export type PitRow = ReturnType<typeof pitToRow>

/** One counter from season.ts, for one team. */
export interface CounterSummary {
  key: string
  label: string
  /** The average per match, or null if no entry has this counter. */
  average: number | null
  /** Each entry's count, in match order. */
  perMatch: { match: number; count: number }[]
}

/** How often one answer came up. */
export interface Tally {
  option: string
  count: number
  /** count out of the entries it could have come up in, from 0 to 1. For <Bar>. */
  share: number
}

/** A note from a match, or an answer from the pit form. */
export interface WrittenAnswer {
  kind: 'match' | 'pit'
  question: string
  text: string
  /** The match number, or null if there wasn't one (pit scouting before any match). */
  match: number | null
  /** Who wrote it. Show their name with useMemberNames(). */
  by: string | null
  /** ISO date and time it was scouted. */
  at: string
}

export interface TeamSummary {
  team: number
  /** Match entries. Two scouts watching the same robot count as two. */
  matchCount: number
  pitCount: number
  counters: CounterSummary[]
  endgame: Tally[]
  /** Scouts can choose several roles, so these can add up to more than matchCount. */
  roles: Tally[]
  driverSkill: Tally[]
  drivetrain: Tally[]
  stops: Tally[]
  /** How many entries say the robot broke down. */
  brokeDown: number
  /** What broke, out of the entries where it broke down. Several parts can break in one match. */
  brokeParts: Tally[]
  /** How many entries say it died or browned out. */
  brownedOut: number
  /** Where it started its auto, out of the entries where the scout saw. */
  autoSides: Tally[]
  /** Which bonus ranking points its alliance earned, out of every match entry. */
  rankingPoints: Tally[]
  /** Newest first. */
  written: WrittenAnswer[]
}

/** A pit entry's written answers, leaving out the blank ones. The drivetrain is counted in pitDrivetrain() instead. */
export function pitAnswers(pit: PitRow): WrittenAnswer[] {
  const size = [pit.length, pit.width, pit.height].every((n) => n === null) ? '' : `${pit.length ?? '?'} × ${pit.width ?? '?'} × ${pit.height ?? '?'} inches (length × width × height)`
  const answers: [question: string, text: string | null][] = [
    ['Weight', pit.weight === null ? '' : `${pit.weight} pounds`],
    ['Size', size],
    ['Drivetrain (typed)', pit.drivetrain_other],
    ['What it can see', [pit.vision.join(', '), pit.vision_notes?.trim()].filter(Boolean).join('. ')],
    ['Motors', pit.motors],
    ['Auto starting side', pit.auto_side],
    ['Auto path', pit.auto_path],
    ['What they want partners to do', pit.partners_do],
    ['What they will do', pit.they_do],
  ]
  return answers.flatMap(([question, text]) =>
    text?.trim() ? [{ kind: 'pit' as const, question, text: text.trim(), match: pit.match_number, by: pit.scouted_by, at: pit.scouted_at }] : [],
  )
}

/**
 * A pit entry's drivetrain for the team page's bar, or null if the scout
 * didn't choose one. Anything that isn't on DRIVETRAINS any more (like an
 * older "Other omni/holonomic") counts as Other; the typed name is in
 * pitAnswers().
 */
export function pitDrivetrain(pit: PitRow): string | null {
  const chosen = pit.drivetrain?.trim()
  if (!chosen) return null
  return DRIVETRAINS.includes(chosen) ? chosen : 'Other'
}

/** This event's entries, each once: an entry that's both Waiting here and in the team database is the same entry. */
function thisEvent<T extends { id: string; event_key: string }>(entries: T[]): T[] {
  const seen = new Set<string>()
  return entries.filter((e) => {
    if (e.event_key !== currentEvent() || seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })
}

/**
 * How often each answer came up, out of `outOf`. Every option is listed, in
 * order, even ones that never came up; an answer that isn't an option any
 * more (renamed in season.ts) is added at the end.
 */
function tally(options: string[], answers: string[], outOf: number): Tally[] {
  const all = [...options, ...new Set(answers.filter((a) => !options.includes(a)))]
  return all.map((option) => {
    const count = answers.filter((a) => a === option).length
    return { option, count, share: outOf === 0 ? 0 : count / outOf }
  })
}

/** Everything scouted about one team at the current event, added up. */
export function teamSummary(team: number, entries: MatchRow[], pitEntries: PitRow[], counters: Counter[] = COUNTERS): TeamSummary {
  const mine = thisEvent(entries)
    .filter((e) => e.team_number === team)
    .sort((a, b) => a.match_number - b.match_number || a.scouted_at.localeCompare(b.scouted_at))
  const pits = thisEvent(pitEntries).filter((p) => p.team_number === team)
  const skills = mine.flatMap((e) => (e.driver_skill === null ? [] : [String(e.driver_skill)]))
  const drivetrains = pits.flatMap((p) => pitDrivetrain(p) ?? [])

  const broken = mine.filter((e) => e.broke_down)
  const autoSides = mine.flatMap((e) => e.auto_side?.trim() || [])

  // Each entry's written answers, leaving out blank ones.
  const notes: WrittenAnswer[] = mine.flatMap((e) =>
    ([
      ['How well it does its role', e.role_notes],
      ['Auto', e.auto_notes],
      ['What else broke', e.broke_other],
      ['Notes', e.notes],
    ] as const).flatMap(([question, text]) =>
      text?.trim() ? [{ kind: 'match' as const, question, text: text.trim(), match: e.match_number, by: e.scouted_by, at: e.scouted_at }] : [],
    ),
  )

  return {
    team,
    matchCount: mine.length,
    pitCount: pits.length,
    counters: counters.map(({ key, label }) => {
      const perMatch = mine.flatMap((e) => (typeof e.counts[key] === 'number' ? [{ match: e.match_number, count: e.counts[key] }] : []))
      const total = perMatch.reduce((sum, m) => sum + m.count, 0)
      return { key, label, average: perMatch.length === 0 ? null : total / perMatch.length, perMatch }
    }),
    endgame: tally(ENDGAME, mine.map((e) => e.endgame), mine.length),
    roles: tally(ROLES, mine.flatMap((e) => e.roles), mine.length),
    driverSkill: tally(DRIVER_SKILLS.map(String), skills, skills.length),
    drivetrain: tally(DRIVETRAINS, drivetrains, drivetrains.length),
    stops: tally([...STOPS], mine.map((e) => e.stop), mine.length),
    brokeDown: broken.length,
    brokeParts: tally(BREAKDOWN_PARTS, broken.flatMap((e) => e.broke_parts), broken.length),
    brownedOut: mine.filter((e) => e.browned_out).length,
    autoSides: tally(AUTO_SIDES, autoSides, autoSides.length),
    rankingPoints: tally(RANKING_POINTS, mine.flatMap((e) => e.ranking_points), mine.length),
    written: [...notes, ...pits.flatMap(pitAnswers)].sort((a, b) => b.at.localeCompare(a.at)),
  }
}

/** Every team with a match or pit entry at this event, lowest number first. */
export function scoutedTeams(entries: MatchRow[], pitEntries: PitRow[]): number[] {
  const teams = new Set([...thisEvent(entries), ...thisEvent(pitEntries)].map((e) => e.team_number))
  return [...teams].sort((a, b) => a - b)
}

/**
 * What the team page adds up: match and pit entries from the team database,
 * plus this phone's Waiting ones, so a scout sees their own entries straight
 * away. In live mode the page waits for the team database to load.
 */
function useScoutingRows(): { entries: MatchRow[]; pitEntries: PitRow[] } {
  const synced = entriesTable.useRows()
  const saved = useEntries()
  const syncedPit = pitTable.useRows()
  const savedPit = usePitEntries()
  // Only the current event's, so the sums change when someone picks another event.
  const event = useCurrentEvent().key
  const entries = useMemo(() => [...synced, ...saved.filter((e) => !e.synced).map(toRow)].filter((e) => e.event_key === event), [synced, saved, event])
  const pitEntries = useMemo(() => [...syncedPit, ...savedPit.filter((e) => !e.synced).map(pitToRow)].filter((e) => e.event_key === event), [syncedPit, savedPit, event])
  return { entries, pitEntries }
}

/** One team's summary, for the team page. */
export function useTeamSummary(team: number): TeamSummary {
  const { entries, pitEntries } = useScoutingRows()
  return useMemo(() => teamSummary(team, entries, pitEntries), [team, entries, pitEntries])
}

/** Every team scouted at this event, for the team page's list. */
export function useScoutedTeams(): number[] {
  const { entries, pitEntries } = useScoutingRows()
  return useMemo(() => scoutedTeams(entries, pitEntries), [entries, pitEntries])
}

// ---------------------------------------------------------------------------
// The Blue Alliance.

export interface TbaAlliance {
  /** -1 until the match is played. */
  score: number
  /** Like ["frc4096", "frc9991", "frc9992"]. */
  team_keys: string[]
}

/** One match in the schedule. */
export interface TbaMatch {
  /** Like 2026ilch_qm12. */
  key: string
  /** qm is a qualification match; the others are playoffs. */
  comp_level: 'qm' | 'ef' | 'qf' | 'sf' | 'f'
  set_number: number
  match_number: number
  alliances: { red: TbaAlliance; blue: TbaAlliance }
  winning_alliance: 'red' | 'blue' | ''
  /** When it's expected to start, in seconds since 1970, or null. */
  predicted_time: number | null
}

export interface TbaVideo {
  /** "youtube" for a YouTube video, whose key is the video's ID. */
  type: string
  key: string
}

/** A match with its videos, from a team's matches at an event. */
export interface TbaMatchWithVideos extends TbaMatch {
  videos: TbaVideo[]
}

export interface TbaRanking {
  rank: number
  team_key: string
  record: { wins: number; losses: number; ties: number } | null
  matches_played: number
  /** Numbers TBA works out. The first is the team's total ranking points. */
  extra_stats: number[]
}

export interface TbaTeam {
  key: string
  team_number: number
  nickname: string
  city: string | null
  state_prov: string | null
  country: string | null
}

/** "frc4096" → 4096. */
export function teamNumber(teamKey: string): number {
  return Number(teamKey.replace(/^frc/, ''))
}

/** The event's match schedule, in TBA's order. Empty until TBA has it. */
export async function getSchedule(event = currentEvent()): Promise<Result<TbaMatch[]>> {
  const result = await callFunction<TbaMatch[] | null>('tba', { kind: 'schedule', event }, () => demoMatches(event))
  return result.ok ? ok(result.value ?? []) : result
}

/** The event's rankings, best first. Empty until the event starts. */
export async function getRankings(event = currentEvent()): Promise<Result<TbaRanking[]>> {
  const result = await callFunction<{ rankings: TbaRanking[] } | null>('tba', { kind: 'rankings', event }, () => ({ rankings: demoRankings() }))
  return result.ok ? ok(result.value?.rankings ?? []) : result
}

/** One team's matches at the event, with their videos. */
export async function getTeamMatches(team: number, event = currentEvent()): Promise<Result<TbaMatchWithVideos[]>> {
  const result = await callFunction<TbaMatchWithVideos[] | null>('tba', { kind: 'team-matches', team, event }, () =>
    demoMatches(event).filter((m) => [...m.alliances.red.team_keys, ...m.alliances.blue.team_keys].includes(`frc${team}`)),
  )
  return result.ok ? ok(result.value ?? []) : result
}

/** A team's name and home. */
export function getTeam(team: number): Promise<Result<TbaTeam>> {
  return callFunction<TbaTeam>('tba', { kind: 'team', team }, () => demoTeam(team))
}

/** Every team registered for an event, by number. TBA lists them before the schedule is out. */
export async function getEventTeams(event = currentEvent()): Promise<Result<TbaTeam[]>> {
  const result = await callFunction<TbaTeam[] | null>('tba', { kind: 'teams', event }, () => DEMO_TEAMS.map(([team]) => demoTeam(team)))
  return result.ok ? ok([...(result.value ?? [])].sort((a, b) => a.team_number - b.team_number)) : result
}

/**
 * The event's page on Nexus (frc.nexus, #165), which shows what's on the
 * field right now, who should be queuing, and announcements. Only a link:
 * Nexus's live status in the app would need a server function with a key,
 * which a mentor sets up.
 */
export function nexusEventUrl(event = currentEvent()): string {
  return `https://frc.nexus/en/event/${encodeURIComponent(event)}`
}

/** A team's page on The Blue Alliance, for the season of `event` (like 2026ilch → 2026). */
export function tbaTeamUrl(team: number, event = currentEvent()): string {
  return `https://www.thebluealliance.com/team/${team}/${event.slice(0, 4)}`
}

// ---------------------------------------------------------------------------
// Filling in the team from the schedule (#40). A scout picks their position
// once, and the match form fills in the team for that position from the
// schedule. The schedule is saved on this device, so it still works with no
// Wi-Fi once it's been loaded.

/** Where a scout sits: which robot they watch in every match. */
export const POSITIONS = ['Red 1', 'Red 2', 'Red 3', 'Blue 1', 'Blue 2', 'Blue 3'] as const
export type Position = (typeof POSITIONS)[number]

// '' until the scout picks one. keepOnReset: it belongs to this device, not the example data.
export const positionStore = createStore<Position | ''>('scouting-position', 1, () => '', { keepOnReset: true })

/** This device's position, or '' if the scout hasn't picked one. */
export function usePosition(): Position | '' {
  return useStore(positionStore)
}

/** Remember this device's position. */
export function setPosition(position: Position) {
  positionStore.set(position)
}

/**
 * Get the latest schedule for the match form. It uses the schedule page's
 * saved copy (savedSchedule() and refreshSchedule() below), so there's one
 * schedule on the phone. If the latest can't be fetched (no Wi-Fi, say) but
 * a copy for this event is saved, that copy is used, so the form keeps
 * working.
 */
export async function loadSchedule(): Promise<Result<SavedSchedule>> {
  const result = await refreshSchedule()
  const saved = savedSchedule()
  if (saved && saved.matches.length > 0) return ok(saved)
  if (!result.ok) return fail(`Couldn't get the match schedule. ${result.error}`)
  // TBA has no schedule until shortly before the event.
  return fail("The Blue Alliance doesn't have the match schedule yet.")
}

/** The team in `position` in qualification match `match`, or null if the schedule doesn't say. */
export function teamFor(schedule: SavedSchedule | null, match: number, position: Position | ''): number | null {
  if (!schedule || !position) return null
  // Only qualification matches: the form's match number is one of those.
  const found = schedule.matches.find((m) => m.comp_level === 'qm' && m.match_number === match)
  if (!found) return null
  const [color, spot] = position.split(' ')
  const team = (color === 'Red' ? found.alliances.red : found.alliances.blue).team_keys[Number(spot) - 1]
  return team ? teamNumber(team) : null
}

// ---------------------------------------------------------------------------
// Event rankings that update live (#39). TBA updates the rankings after each
// match. While the rankings page is open it checks for new ones every
// minute, and right away when the app comes back on screen or the phone
// comes back online. The last ones it got are kept on this device, so with
// no Wi-Fi the page still shows them, with when they're from.

/** The last rankings this device got from TBA, and when. */
export interface SavedRankings {
  /** The event they're for. Rankings saved for another event aren't shown. */
  event: string
  /** Best first. */
  rankings: TbaRanking[]
  /** ISO date and time they came from TBA. */
  checked_at: string
}

export const rankingsStore = createStore<SavedRankings | null>('scouting-rankings', 1, () => null)

/** Whether the rankings are being checked right now, and why the last check didn't work, if it didn't. */
export interface RankingsStatus {
  checking: boolean
  problem: string | null
}

// Only for this page visit: not saved.
export const rankingsStatus = createStore<RankingsStatus>('scouting-rankings-status', 1, () => ({ checking: false, problem: null }), { persist: false, keepOnReset: true })

/** How often to check for new rankings while the page is open. */
export const RANKINGS_EVERY_MS = 60 * 1000

const RANKINGS_OFFLINE = "No connection. They'll update by themselves when this phone is back online."

/**
 * Get the event's rankings from TBA and keep them on this device. If it
 * can't (no connection, or TBA has a problem), the last ones stay, and the
 * status says why.
 */
export async function refreshRankings(event = currentEvent()): Promise<Result<SavedRankings>> {
  if (globalThis.navigator?.onLine === false) {
    rankingsStatus.set({ checking: false, problem: RANKINGS_OFFLINE })
    return fail(RANKINGS_OFFLINE)
  }
  rankingsStatus.set({ checking: true, problem: rankingsStatus.get().problem })
  const result = await getRankings(event)
  if (!result.ok) {
    rankingsStatus.set({ checking: false, problem: result.error })
    return result
  }
  const saved: SavedRankings = { event, rankings: result.value, checked_at: new Date().toISOString() }
  rankingsStore.set(saved)
  rankingsStatus.set({ checking: false, problem: null })
  return ok(saved)
}

/**
 * Keep the rankings up to date: check now, every minute while the app is
 * on screen, when it comes back on screen, and when the phone comes back
 * online. Gives back a function that stops it, for when the page closes.
 */
export function watchRankings(event = currentEvent()): () => void {
  const check = () => void refreshRankings(event)
  const onScreen = () => {
    if (document.visibilityState === 'visible') check()
  }
  globalThis.addEventListener('online', check)
  document.addEventListener('visibilitychange', onScreen)
  const timer = setInterval(onScreen, RANKINGS_EVERY_MS)
  check()
  return () => {
    globalThis.removeEventListener('online', check)
    document.removeEventListener('visibilitychange', onScreen)
    clearInterval(timer)
  }
}

/** The saved rankings for this event, or null if there are none yet. They update by themselves while the page is open. */
export function useRankings(): { saved: SavedRankings | null; status: RankingsStatus } {
  const event = useCurrentEvent().key
  useEffect(() => watchRankings(event), [event])
  const saved = useStore(rankingsStore)
  const status = useStore(rankingsStatus)
  return { saved: saved?.event === event ? saved : null, status }
}

/** One team's ranking, or null if they aren't ranked. For the team page. */
export function rankOf(rankings: TbaRanking[], team: number): TbaRanking | null {
  return rankings.find((r) => r.team_key === `frc${team}`) ?? null
}

// ---------------------------------------------------------------------------
// Match videos (#41): a team's qualification matches, each with links to its
// videos on The Blue Alliance. TBA adds videos as the event goes on, so a
// played match can have none yet. For the team page.

/**
 * A link to watch a video, or null if it isn't a YouTube video with a
 * normal-looking key. Some keys start partway in, like "abc123?t=30". Odd
 * keys are dropped, so whatever TBA sends can't become a strange link.
 */
export function videoLink(video: TbaVideo): string | null {
  if (video.type !== 'youtube' || !/^[\w-]+(\?t=\d+)?$/.test(video.key)) return null
  return `https://youtu.be/${video.key}`
}

/** One of a team's qualification matches, for the match videos list. */
export interface QualVideoRow {
  /** Like 2026ilch_qm12. */
  key: string
  /** The qualification match number. */
  number: number
  /** The alliance the team was on. */
  alliance: 'red' | 'blue'
  /** How it went for the team, or null if it hasn't been played yet. */
  result: 'Won' | 'Lost' | 'Tied' | null
  /** The team's alliance's score and the other one's. -1 until played. */
  ourScore: number
  theirScore: number
  /** A link for each video, or none if TBA has no video yet. */
  links: string[]
}

/** A team's qualification matches from getTeamMatches(), in order, with their video links. Playoffs are left out. */
export function qualVideoRows(matches: TbaMatchWithVideos[], team: number): QualVideoRow[] {
  const rows: QualVideoRow[] = []
  for (const match of matches) {
    if (match.comp_level !== 'qm') continue
    const alliance = match.alliances.red.team_keys.includes(`frc${team}`) ? 'red' : match.alliances.blue.team_keys.includes(`frc${team}`) ? 'blue' : null
    if (!alliance) continue
    const ourScore = match.alliances[alliance].score
    const theirScore = match.alliances[alliance === 'red' ? 'blue' : 'red'].score
    const played = ourScore >= 0 && theirScore >= 0
    rows.push({
      key: match.key,
      number: match.match_number,
      alliance,
      result: !played ? null : ourScore > theirScore ? 'Won' : ourScore < theirScore ? 'Lost' : 'Tied',
      ourScore,
      theirScore,
      links: match.videos.map(videoLink).filter((link) => link !== null),
    })
  }
  return rows.sort((a, b) => a.number - b.number)
}

export interface TeamQualVideos {
  rows: QualVideoRow[]
  loading: boolean
  /** Why the last load didn't work, or null. */
  error: string | null
  /** Load again, for a "Check again" button: TBA may have new videos. */
  reload: () => void
}

/** What the last load gave, and which team and try it was for. */
interface LoadedVideos {
  team: number
  tries: number
  rows: QualVideoRow[]
  error: string | null
}

/**
 * A team's qualification matches with their video links, loaded when the
 * page opens and again with reload(). Not kept on this device: videos
 * change during the event, so it always asks TBA.
 */
export function useTeamQualVideos(team: number): TeamQualVideos {
  const event = useCurrentEvent().key
  const [tries, setTries] = useState(0)
  const [loaded, setLoaded] = useState<LoadedVideos | null>(null)
  useEffect(() => {
    // If the team changes before TBA answers, this answer is for the old team: ignore it.
    let current = true
    void getTeamMatches(team, event).then((result) => {
      if (!current) return
      setLoaded((prev) => {
        // If it didn't work, keep showing this team's matches from last time.
        const rows = result.ok ? qualVideoRows(result.value, team) : prev?.team === team ? prev.rows : []
        return { team, tries, rows, error: result.ok ? null : result.error }
      })
    })
    return () => {
      current = false
    }
  }, [team, tries, event])
  const reload = useCallback(() => setTries((n) => n + 1), [])
  const loading = loaded?.team !== team || loaded.tries !== tries
  return {
    rows: loaded?.team === team ? loaded.rows : [],
    loading,
    error: loading ? null : loaded.error,
    reload,
  }
}

// ---------------------------------------------------------------------------
// Match 13: team ratings and match predictions.

/**
 * One team's Match 13 rating at the event. The numbers are points. xP
 * ("expected points") is how many points the team adds to its alliance's
 * score.
 */
export interface Match13Rating {
  teamNumber: number
  /** The rating going into the event. */
  xpStart: number
  /** The rating now (or at the end of the event). Rank teams by this one. */
  xpEnd: number
  /** The parts of xpEnd: auto, teleop and endgame. */
  xAuto: number | null
  xTele: number | null
  xEnd: number | null
  /** Statbotics' EPA, and The Blue Alliance's OPR and DPR, for comparison. */
  epa: number | null
  opr: number | null
  dpr: number | null
  // The rest came in #152. Match 13's docs give these names but not what
  // they mean, so these are our reading of them: check on match13.com.
  // Copies saved on phones before #152 don't have them, so they're optional.
  /** How much the team's score varies from match to match. Lower is steadier. */
  xVar?: number | null
  /** The chance, 0 to 1, of the team earning each of the season's ranking points. */
  xRp1?: number | null
  xRp2?: number | null
  xRp3?: number | null
  /** This season's game broken into parts, named the way Match 13 names them (they change each season). */
  components?: Record<string, unknown> | null
  // From Match 13's simulation of the event (#152, getEventSim()), added to
  // each rating when the ratings load. Missing until Match 13 has one.
  /** The team's average final rank in the simulation, and the range most runs land in (5th to 95th percentile). */
  simRank?: number | null
  simRankLow?: number | null
  simRankHigh?: number | null
  /** The team's average ranking points in the simulation. */
  simRp?: number | null
}

// ---------------------------------------------------------------------------
// More of Match 13's numbers (#152): for the team page and the stats table.
// They come from the same saved copy as the rest (useRatings()).

/** One number in the stats table, or on the team page. */
export interface StatColumn {
  key: string
  label: string
  /** True if lower is better, like DPR (points given up) or score variation. Sorting puts these lowest first. */
  lowerIsBetter?: boolean
  /** True for a chance from 0 to 1, shown as a percent. */
  percent?: boolean
}

/** The numbers every season has, in the order the stats table shows them. */
export const STAT_COLUMNS: StatColumn[] = [
  { key: 'xpEnd', label: 'xP' },
  { key: 'xAuto', label: 'Auto' },
  { key: 'xTele', label: 'Teleop' },
  { key: 'xEnd', label: 'Endgame' },
  { key: 'epa', label: 'EPA' },
  { key: 'opr', label: 'OPR' },
  { key: 'dpr', label: 'DPR', lowerIsBetter: true },
  { key: 'xVar', label: 'Variation', lowerIsBetter: true },
  { key: 'xRp1', label: 'RP 1 chance', percent: true },
  { key: 'xRp2', label: 'RP 2 chance', percent: true },
  { key: 'xRp3', label: 'RP 3 chance', percent: true },
  { key: 'simRank', label: 'Sim rank', lowerIsBetter: true },
  { key: 'simRp', label: 'Sim RP' },
]

/** The parts of this season's game a rating has, as numbers. Anything Match 13 sends that isn't a number is left out. */
export function ratingComponents(rating: Match13Rating): { name: string; value: number }[] {
  return Object.entries(rating.components ?? {}).flatMap(([name, value]) => (typeof value === 'number' && Number.isFinite(value) ? [{ name, value }] : []))
}

/** Every column for these ratings: the ones every season has, then a column for each game part any team has. */
export function statColumns(ratings: Match13Rating[]): StatColumn[] {
  const parts = [...new Set(ratings.flatMap((r) => ratingComponents(r).map((c) => c.name)))]
  return [...STAT_COLUMNS, ...parts.map((name) => ({ key: `part:${name}`, label: name }))]
}

/** One team's number for a column, or null if Match 13 left it out. */
export function statValue(rating: Match13Rating, key: string): number | null {
  if (key.startsWith('part:')) return ratingComponents(rating).find((c) => c.name === key.slice(5))?.value ?? null
  const value = (rating as unknown as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** "48.6", "72%" for a chance, or "not given" when Match 13 left it out. */
export function statText(value: number | null, column: Pick<StatColumn, 'percent'> = {}): string {
  if (value === null) return 'not given'
  return column.percent ? `${Math.round(value * 100)}%` : value.toFixed(1)
}

/**
 * The ratings sorted by one column: best first (lowest first for a
 * lower-is-better column), or the other way round with `bestFirst` false.
 * Teams with no number for it go at the bottom either way. Equal numbers go
 * in team number order.
 */
export function sortStats(ratings: Match13Rating[], column: StatColumn, bestFirst = true): Match13Rating[] {
  const flip = (column.lowerIsBetter ? 1 : -1) * (bestFirst ? 1 : -1)
  return [...ratings].sort((a, b) => {
    const x = statValue(a, column.key)
    const y = statValue(b, column.key)
    if (x === null || y === null) return x === y ? a.teamNumber - b.teamNumber : x === null ? 1 : -1
    return (x - y) * flip || a.teamNumber - b.teamNumber
  })
}

/** One team in Match 13's simulation of the event (#152). */
export interface SimTeam {
  team: number
  /** Average final rank, and the 5th and 95th percentile ranks. Null if Match 13 didn't send them. */
  rank: number | null
  rankLow: number | null
  rankHigh: number | null
  /** Average ranking points. */
  rp: number | null
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** The first of these fields that's a number. */
function firstNumber(from: Record<string, unknown> | undefined, keys: string[]): number | null {
  for (const key of keys) {
    const value = num(from?.[key])
    if (value !== null) return value
  }
  return null
}

/**
 * Read Match 13's simulation answer. Its docs give the fields' names but not
 * their exact shape, so this accepts a stats object (mean, p5, p50, p95)
 * under rank or rp, or flat fields like meanRank, and leaves out anything it
 * can't read, rather than guess. Check it against a real answer.
 */
export function readSim(answer: unknown): SimTeam[] {
  const body = answer as { teams?: unknown } | unknown[] | null
  const list = Array.isArray(body) ? body : Array.isArray((body as { teams?: unknown })?.teams) ? ((body as { teams: unknown[] }).teams) : []
  return list.flatMap((item) => {
    const t = (item ?? {}) as Record<string, unknown>
    const team = num(t.teamNumber) ?? num(t.team)
    if (team === null) return []
    const rank = (t.rank ?? t.ranks) as Record<string, unknown> | undefined
    const rp = (t.rp ?? t.rps ?? t.rankingPoints) as Record<string, unknown> | undefined
    const sim: SimTeam = {
      team,
      rank: typeof rank === 'object' ? firstNumber(rank, ['mean', 'avg', 'p50']) : firstNumber(t, ['meanRank', 'rankMean', 'avgRank']),
      rankLow: typeof rank === 'object' ? firstNumber(rank, ['p5']) : firstNumber(t, ['rankP5']),
      rankHigh: typeof rank === 'object' ? firstNumber(rank, ['p95']) : firstNumber(t, ['rankP95']),
      rp: typeof rp === 'object' ? firstNumber(rp, ['mean', 'avg', 'p50']) : firstNumber(t, ['meanRp', 'rpMean', 'avgRp']) ?? num(t.rp),
    }
    // A team with nothing readable isn't a simulation result.
    return sim.rank === null && sim.rp === null ? [] : [sim]
  })
}

/** Match 13's simulation of the event: each team's likely final rank. Empty until Match 13 has one. */
export async function getEventSim(event = currentEvent()): Promise<Result<SimTeam[]>> {
  const result = await callFunction<unknown>('match13', { kind: 'sim', event }, () => demoSim())
  return result.ok ? ok(readSim(result.value)) : result
}

/** Put each team's simulation numbers on its rating. */
export function withSim(ratings: Match13Rating[], sim: SimTeam[]): Match13Rating[] {
  const byTeam = new Map(sim.map((s) => [s.team, s]))
  return ratings.map((r) => {
    const s = byTeam.get(r.teamNumber)
    return s ? { ...r, simRank: s.rank, simRankLow: s.rankLow, simRankHigh: s.rankHigh, simRp: s.rp } : r
  })
}

/** One event a team played in a season, with its Match 13 numbers there (#153). */
export interface TeamEventRating {
  event: string
  /** The team's xP at the end of that event, or null if Match 13 didn't send it. */
  xp: number | null
  /** Their xP rank at that event. */
  rank: number | null
}

/** Read Match 13's answer for a team's events in a season. Like readSim(), it reads what it can and leaves out the rest. */
export function readTeamEvents(answer: unknown): TeamEventRating[] {
  const body = answer as { events?: unknown } | unknown[] | null
  const list = Array.isArray(body) ? body : Array.isArray((body as { events?: unknown })?.events) ? ((body as { events: unknown[] }).events) : []
  return list.flatMap((item) => {
    const e = (item ?? {}) as Record<string, unknown>
    const event = [e.eventKey, e.event, e.key].find((v): v is string => typeof v === 'string')
    if (!event) return []
    return [{ event, xp: firstNumber(e, ['xpEnd', 'xp', 'xpMean']), rank: firstNumber(e, ['rank', 'xpRank']) }]
  })
}

/** One team's Match 13 numbers at each event it played in a season, for prescouting (#153). */
export async function getTeamSeasonRatings(team: number, year: number): Promise<Result<TeamEventRating[]>> {
  const result = await callFunction<unknown>('match13', { kind: 'team-events', team, year }, () => demoTeamEvents(team, year))
  return result.ok ? ok(readTeamEvents(result.value)) : result
}

/** Who Match 13 thinks will win a match, and by how much. */
export interface MatchPrediction {
  /** Like 2026ilch_qm12: the same as TbaMatch's key, so you can match them up. */
  key: string
  /** The chance red wins, from 0 to 1. Blue's chance is 1 minus this. */
  redWinChance: number
  redScore: number
  blueScore: number
}

/** What Match 13 sends for predictions: the parts we use. */
interface Match13Matches {
  matches: { key: string; pred: { winProb: number; redScore: number; blueScore: number } }[]
}

/** Every team's Match 13 rating at the event, best first. Match 13 sends them in no order. */
export async function getRatings(event = currentEvent()): Promise<Result<Match13Rating[]>> {
  const result = await callFunction<{ teams: Match13Rating[] } | null>('match13', { kind: 'ratings', event }, () => ({ teams: demoRatings() }))
  if (!result.ok) return result
  return ok([...(result.value?.teams ?? [])].sort((a, b) => b.xpEnd - a.xpEnd || a.teamNumber - b.teamNumber))
}

/** Match 13's prediction for each of the event's matches. */
export async function getPredictions(event = currentEvent()): Promise<Result<MatchPrediction[]>> {
  const result = await callFunction<Match13Matches | null>('match13', { kind: 'predictions', event }, () => demoPredictions(event))
  if (!result.ok) return result
  return ok(
    (result.value?.matches ?? []).map(({ key, pred }) => ({ key, redWinChance: pred.winProb, redScore: pred.redScore, blueScore: pred.blueScore })),
  )
}

// Picklist score (#42): every team ranked by a mix of its Match 13 xP and our
// scouting averages, with a weight for how much each part counts. These are
// plain functions that take the numbers in. Working out each team's numbers
// waits on the team page (#36) and saved Match 13 ratings (#37).

/** One thing a team is scored on, like Match 13 auto or fuel missed. */
export interface PicklistPart {
  /** The key in TeamNumbers' values and in Weights. */
  key: string
  label: string
  /** True if fewer is better, like fuel missed. */
  lowerIsBetter: boolean
}

/**
 * Everything a team is scored on: Match 13's auto, teleop and endgame xP,
 * our average points per match (APS, #166), then each counter in season.ts. Not Match 13's total as well: it's the
 * three parts added up, so weighting it too would count xP twice. A new
 * counter in season.ts shows up here by itself.
 */
export function picklistParts(): PicklistPart[] {
  return [
    { key: 'xAuto', label: 'Match 13 auto', lowerIsBetter: false },
    { key: 'xTele', label: 'Match 13 teleop', lowerIsBetter: false },
    { key: 'xEnd', label: 'Match 13 endgame', lowerIsBetter: false },
    { key: 'aps', label: 'Average points (APS)', lowerIsBetter: false },
    ...COUNTERS.map((c) => ({ key: c.key, label: c.label, lowerIsBetter: c.lowerIsBetter ?? false })),
  ]
}

/** How much each part counts, from 0 (not at all) to 5, by the part's key. */
export type Weights = Record<string, number>

/** A part with no weight saved, like a counter added after the weights were set, counts this much. */
export const DEFAULT_WEIGHT = 1
export const MAX_WEIGHT = 5

export const DEFAULT_WEIGHTS: Weights = Object.fromEntries(picklistParts().map((part) => [part.key, DEFAULT_WEIGHT]))

// Saved on this phone only, so each scout can try their own weights.
// keepOnReset: "Reset example data" shouldn't undo them at an event.
export const weightsStore = createStore<Weights>('scouting-picklist-weights', 1, () => ({ ...DEFAULT_WEIGHTS }), { keepOnReset: true })

/** One team's numbers for the picklist, by part key. Null if we don't have that number yet. */
export interface TeamNumbers {
  team: number
  values: Record<string, number | null>
  /** How many matches we scouted them in. 0 if none yet. */
  matches: number
  /** False if Match 13 hasn't rated them yet. */
  rated: boolean
}

/** One line of the picklist. */
export interface RankedTeam {
  /** 1 is the best. */
  rank: number
  team: number
  /** 0 to 100, or null if the team has none of the weighted numbers. */
  score: number | null
  /** The numbers behind the score, by part key, as they came in. Null if missing. */
  parts: Record<string, number | null>
}

/**
 * Every team ranked best first. For each part, the best team gets 1 and the
 * worst 0, and the rest in between by how close they are (if every team has
 * the same number, they all get 0.5). For lower-is-better parts it's the
 * other way round. A team's score is the average of these, weighted, out of
 * 100.
 *
 * A team missing a number (no scouting yet, or not rated by Match 13 yet) is
 * scored on the numbers it has, so it isn't pushed down for what we don't
 * know. A team with none of the weighted numbers has no score and goes at
 * the bottom. Equal scores go in team number order, so every phone shows the
 * same list.
 */
export function rankTeams(teams: TeamNumbers[], weights: Weights): RankedTeam[] {
  const parts = picklistParts()
  const value = (team: TeamNumbers, key: string) => team.values[key] ?? null

  // Each part's lowest and highest number, over the teams that have one.
  const ranges = new Map(
    parts.map((part) => {
      const values = teams.map((t) => value(t, part.key)).filter((v): v is number => v !== null)
      return [part.key, { min: Math.min(...values), max: Math.max(...values) }]
    }),
  )

  const scored = teams.map((team) => {
    let total = 0
    let weightTotal = 0
    for (const part of parts) {
      const v = value(team, part.key)
      const weight = weights[part.key] ?? DEFAULT_WEIGHT
      if (v === null || weight <= 0) continue
      const { min, max } = ranges.get(part.key)!
      const n = max === min ? 0.5 : (v - min) / (max - min)
      total += weight * (part.lowerIsBetter ? 1 - n : n)
      weightTotal += weight
    }
    return {
      team: team.team,
      score: weightTotal > 0 ? (total / weightTotal) * 100 : null,
      parts: Object.fromEntries(parts.map((part) => [part.key, value(team, part.key)])),
    }
  })

  return scored
    .sort((a, b) => {
      if (a.score === b.score) return a.team - b.team
      if (a.score === null) return 1
      if (b.score === null) return -1
      return b.score - a.score
    })
    .map((line, i) => ({ rank: i + 1, ...line }))
}

/** The picklist as CSV text, to paste into a spreadsheet. A missing number is an empty cell. */
export function picklistCsv(ranked: RankedTeam[], parts: PicklistPart[]): string {
  const number = (n: number | null) => (n === null ? '' : String(Math.round(n * 10) / 10))
  return toCsv([
    ['Rank', 'Team', 'Score', ...parts.map((part) => part.label)],
    ...ranked.map((line) => [String(line.rank), String(line.team), number(line.score), ...parts.map((part) => number(line.parts[part.key] ?? null))]),
  ])
}

// The picklist page (#42). Each team's numbers come from teamSummary(), the
// same sums as the team page, so the two never disagree, and from the saved
// Match 13 ratings (useRatings()), so the list still works with no Wi-Fi.

/**
 * Every team in Match 13's ratings or our entries at this event, with its
 * numbers for rankTeams(): Match 13's auto, teleop and endgame xP, and our
 * average for each counter. Lowest team number first.
 */
export function picklistTeams(ratings: Match13Rating[], entries: MatchRow[], pitEntries: PitRow[]): TeamNumbers[] {
  const teams = [...new Set([...ratings.map((r) => r.teamNumber), ...scoutedTeams(entries, pitEntries)])].sort((a, b) => a - b)
  return teams.map((team) => {
    const rating = ratings.find((r) => r.teamNumber === team)
    const summary = teamSummary(team, entries, pitEntries)
    // Two scouts watching the same robot in the same match is still one match.
    const matches = new Set(entries.filter((e) => e.event_key === currentEvent() && e.team_number === team).map((e) => e.match_number))
    return {
      team,
      values: {
        xAuto: rating?.xAuto ?? null,
        xTele: rating?.xTele ?? null,
        xEnd: rating?.xEnd ?? null,
        aps: teamAps(team, entries)?.average ?? null,
        ...Object.fromEntries(summary.counters.map((c) => [c.key, c.average])),
      },
      matches: matches.size,
      rated: rating !== undefined,
    }
  })
}

/** How much one part counts. A part with no saved weight counts DEFAULT_WEIGHT. */
export function weightOf(weights: Weights, key: string): number {
  return weights[key] ?? DEFAULT_WEIGHT
}

/** True when every part's weight is 0, so no team can be scored. */
export function allWeightsZero(weights: Weights): boolean {
  return picklistParts().every((part) => weightOf(weights, part.key) <= 0)
}

/** Set how much one part counts: a whole number from 0 to MAX_WEIGHT. Saved on this phone. */
export function setWeight(key: string, weight: number) {
  const clamped = Math.min(MAX_WEIGHT, Math.max(0, Math.round(weight)))
  weightsStore.set((prev) => ({ ...prev, [key]: clamped }))
}

/** Put every weight back to DEFAULT_WEIGHT. */
export function resetWeights() {
  weightsStore.set({ ...DEFAULT_WEIGHTS })
}

/** One line of the picklist page: a RankedTeam, and what we know about the team. */
export interface PicklistLine extends RankedTeam {
  /** How many matches we scouted them in. 0 if none yet. */
  matches: number
  /** False if Match 13 hasn't rated them yet. */
  rated: boolean
}

/**
 * The picklist page's list: every team ranked with this phone's weights,
 * re-sorted as soon as a weight changes. `ratings` is useRatings(), for
 * when the Match 13 numbers are from and whether they could be loaded.
 */
export function useRankedPicklist() {
  const ratings = useRatings()
  const { entries, pitEntries } = useScoutingRows()
  const weights = useStore(weightsStore)
  const teams = useMemo(() => picklistTeams(ratings.ratings, entries, pitEntries), [ratings.ratings, entries, pitEntries])
  const ranked = useMemo(() => {
    const known = new Map(teams.map((t) => [t.team, t]))
    return rankTeams(teams, weights).map((line): PicklistLine => ({ ...line, matches: known.get(line.team)?.matches ?? 0, rated: known.get(line.team)?.rated ?? false }))
  }, [teams, weights])
  return { ranked, weights, ratings }
}

// ---------------------------------------------------------------------------
// The overview page (#160): one card for each scouting page, with its
// status and latest results. scoutingOverview() is a plain function that
// takes what's saved on this phone, so it needs nothing from the network
// and can be tested. useScoutingOverview() gathers it for the page.

/** One card on the overview: which page it opens, how it's going, and what to say. */
export interface OverviewCard {
  /** The page's name in the switch at the top of Scouting, like "Match" or "Final picklist". */
  view: string
  tone: Notice['tone']
  /** Short lines, most important first. */
  lines: string[]
}

/** What the overview is worked out from: everything already saved on this phone. */
export interface OverviewInput {
  /** This phone's match and pit entries. */
  entries: Entry[]
  pitEntries: PitEntry[]
  sync: SyncStatus
  /** This event's match and pit entries from the team database and this phone (see useScoutingRows()). */
  matchRows: MatchRow[]
  pitRows: PitRow[]
  schedule: SavedSchedule | null
  rankings: SavedRankings | null
  ratings: Match13Rating[]
  /** The Picklist page's list with this phone's weights, best first. */
  ranked: { team: number }[]
  /** The final picklist, top first. */
  finalPicklist: PicklistRow[]
  /** This person's own picklist, and everyone's averaged (#151). */
  myPicklist?: MyPicklistRow[]
  teamPicklist?: TeamPicklistLine[]
  now?: Date
}

/** Every team we know is at the event, from the saved schedule, rankings and Match 13 ratings, lowest first. */
export function eventTeams(schedule: SavedSchedule | null, rankings: SavedRankings | null, ratings: Match13Rating[]): number[] {
  const teams = new Set<number>([
    ...(schedule?.matches ?? []).flatMap((m) => [...m.alliances.red.team_keys, ...m.alliances.blue.team_keys].map(teamNumber)),
    ...(rankings?.rankings ?? []).map((r) => teamNumber(r.team_key)),
    ...ratings.map((r) => r.teamNumber),
  ])
  return [...teams].sort((a, b) => a - b)
}

/** "3 waiting · 12 synced", and a line for a sync problem. */
function entryLines(entries: { synced: boolean }[], kind: string, sync: SyncStatus): string[] {
  if (entries.length === 0) return [`No ${kind} entries on this phone yet`]
  const waiting = entries.filter((e) => !e.synced).length
  const lines = [waiting > 0 ? `${plural(waiting, `${kind} entry`, `${kind} entries`)} waiting to send` : `All ${plural(entries.length, `${kind} entry`, `${kind} entries`)} sent`]
  if (waiting > 0 && entries.length > waiting) lines.push(`${entries.length - waiting} sent`)
  if (waiting > 0 && sync.problem) lines.push(sync.problem)
  return lines
}

/** The overview's cards, in the same order as the switch at the top of Scouting. */
export function scoutingOverview(input: OverviewInput, team = OUR_TEAM): OverviewCard[] {
  const now = input.now ?? new Date()
  const teams = eventTeams(input.schedule, input.rankings, input.ratings)
  const waitingTone = (entries: { synced: boolean }[]) => (entries.some((e) => !e.synced) ? ('info' as const) : ('plain' as const))

  // Pit: how many of the event's teams have a pit entry.
  const pitTeams = new Set(input.pitRows.map((p) => p.team_number))
  const pitLines = entryLines(input.pitEntries, 'pit', input.sync)
  if (teams.length > 0) pitLines.push(`${teams.filter((t) => pitTeams.has(t)).length} of ${teams.length} teams pit scouted`)
  else if (pitTeams.size > 0) pitLines.push(`${plural(pitTeams.size, 'team', 'teams')} pit scouted`)

  // Schedule: our next match, or our last result.
  let schedule: OverviewCard
  if (!input.schedule) schedule = { view: 'Schedule', tone: 'plain', lines: ['No schedule saved yet'] }
  else {
    const ours = matchesWithPredictions(input.schedule.matches, input.schedule.predictions, team).filter((m) => m.ours)
    const next = ours.find((m) => !m.score)
    const last = [...ours].reverse().find((m) => m.score)
    const side = (m: ScheduleRow) => (m.red.includes(team) ? 'Red' : 'Blue')
    const lines: string[] = []
    if (next) lines.push(`Next: ${next.label} · ${side(next)} · ${next.prediction ? likelyWinner(next.prediction) : 'No prediction yet'}`)
    if (last?.score) {
      const [us, them] = side(last) === 'Red' ? [last.score.red, last.score.blue] : [last.score.blue, last.score.red]
      lines.push(`Last: ${last.label} · ${us > them ? 'Won' : us < them ? 'Lost' : 'Tied'} ${us}–${them}`)
    }
    if (lines.length === 0) lines.push(input.schedule.matches.length === 0 ? "The Blue Alliance doesn't have the schedule yet" : `${team} isn't on the schedule`)
    lines.push(`Saved ${updatedAgo(input.schedule.savedAt, now)}`)
    schedule = { view: 'Schedule', tone: 'plain', lines }
  }

  // Rankings: our rank and record.
  let rankings: OverviewCard
  if (!input.rankings) rankings = { view: 'Rankings', tone: 'plain', lines: ['No rankings saved yet'] }
  else {
    const ours = rankOf(input.rankings.rankings, team)
    const record = ours?.record ? ` · ${ours.record.wins}-${ours.record.losses}-${ours.record.ties}` : ''
    rankings = {
      view: 'Rankings',
      tone: 'plain',
      lines: [ours ? `Rank ${ours.rank} of ${input.rankings.rankings.length}${record}` : `${team} isn't in the rankings yet`, `Updated ${updatedAgo(input.rankings.checked_at, now)}`],
    }
  }

  // Teams: who we've scouted, and who we haven't.
  const scouted = scoutedTeams(input.matchRows, input.pitRows)
  const matchScouted = new Set(input.matchRows.map((e) => e.team_number))
  const notYet = teams.filter((t) => !matchScouted.has(t))
  const teamLines = [scouted.length === 0 ? 'No teams scouted yet' : `${plural(scouted.length, 'team', 'teams')} scouted`]
  if (teams.length > 0) teamLines.push(notYet.length === 0 ? 'Every team has a match entry' : `No match entries yet: ${notYet.join(', ')}`)

  const top = (list: number[]) => (list.length === 0 ? null : `Top ${Math.min(3, list.length)}: ${list.slice(0, 3).join(', ')}`)
  const finalOpen = input.finalPicklist.filter((row) => row.status === 'Open').map((row) => row.team_number)

  return [
    { view: 'Match', tone: waitingTone(input.entries), lines: entryLines(input.entries, 'match', input.sync) },
    { view: 'Pit', tone: waitingTone(input.pitEntries), lines: pitLines },
    schedule,
    rankings,
    { view: 'Teams', tone: 'plain', lines: teamLines },
    { view: 'Picklist', tone: 'plain', lines: [top(input.ranked.map((t) => t.team)) ?? 'No teams to rank yet'] },
    { view: 'My picklist', tone: 'plain', lines: [top((input.myPicklist ?? []).map((row) => row.team_number)) ?? 'Not started yet'] },
    {
      view: 'Team picklist',
      tone: 'plain',
      lines: (input.teamPicklist ?? []).length === 0
        ? ['Nobody has made a picklist yet']
        : [top(input.teamPicklist!.map((line) => line.team))!, `From ${plural(input.teamPicklist![0].lists, 'list', 'lists')}`],
    },
    {
      view: 'Final picklist',
      tone: 'plain',
      lines: input.finalPicklist.length === 0 ? ['Not started yet'] : [top(finalOpen) ?? 'Every team is picked or marked Do not pick', `${plural(input.finalPicklist.length, 'team', 'teams')} on the list`],
    },
    { view: 'Simulator', tone: 'plain', lines: ["Pick 6 teams to see the score we'd expect, and who's likely to win"] },
    { view: 'Stats', tone: 'plain', lines: [input.ratings.length === 0 ? 'No Match 13 ratings saved yet' : `${plural(input.ratings.length, 'team', 'teams')} rated by Match 13`] },
  ]
}

/**
 * The overview's cards, for the page. It only reads what's saved on this
 * phone (the schedule, rankings and Match 13 copies, and the tables the
 * other pages use), so opening it never asks The Blue Alliance or Match 13
 * for anything.
 */
export function useScoutingOverview(): OverviewCard[] {
  const event = useCurrentEvent().key
  const entries = useEntries()
  const pitEntries = usePitEntries()
  const sync = useSyncStatus()
  const { entries: matchRows, pitEntries: pitRows } = useScoutingRows()
  const schedule = useSavedSchedule()
  const savedRankings = useStore(rankingsStore)
  const savedRatings = useStore(ratingsStore)
  const weights = useStore(weightsStore)
  const finalPicklist = usePicklist()
  const myPicklist = useMyPicklist()
  const teamPicklist = useTeamPicklist()
  return useMemo(() => {
    const rankings = savedRankings?.event === event ? savedRankings : null
    const ratings = savedRatings.event === event ? savedRatings.ratings : []
    const ranked = rankTeams(picklistTeams(ratings, matchRows, pitRows), weights)
    return scoutingOverview({ entries, pitEntries, sync, matchRows, pitRows, schedule, rankings, ratings, ranked, finalPicklist, myPicklist, teamPicklist })
  }, [event, entries, pitEntries, sync, matchRows, pitRows, schedule, savedRankings, savedRatings, weights, finalPicklist, myPicklist, teamPicklist])
}

// ---------------------------------------------------------------------------
// Average points scored (APS) and the match simulator (#166).
//
// A team's points in a match are worked out from what we scouted: each
// counter times its points in season.ts, plus its endgame's points. APS is
// the average over the matches we scouted them in, with a range of one
// standard deviation either side (about two in three matches land in it).
// Match 13's xP is a second opinion, used when we've scouted a team in
// fewer than MIN_MATCHES matches.
//
// The simulator adds up each alliance's expected points. That's the simple
// version: it doesn't count defense or robots getting in each other's way.

/** Fewer scouted matches than this, and a team's APS is only a guess: it's marked, and Match 13's xP is used if there is one. */
export const MIN_MATCHES = 3

/** The points one match entry is worth to its alliance, from the points in season.ts. */
export function entryPoints(entry: Pick<MatchRow, 'counts' | 'endgame'>, counters: Counter[] = COUNTERS, endgamePoints: Record<string, number> = ENDGAME_POINTS): number {
  const scored = counters.reduce((sum, c) => sum + (c.points ?? 0) * (entry.counts[c.key] ?? 0), 0)
  return scored + (endgamePoints[entry.endgame] ?? 0)
}

/** A team's points per match from our scouting. */
export interface Aps {
  /** Average points per match. */
  average: number
  /** One standard deviation below and above the average. low is never below 0. */
  low: number
  high: number
  /** The standard deviation, for adding teams up in the simulator. */
  spread: number
  /** How many matches it's from. Two scouts on the same match count as one. */
  matches: number
}

/**
 * A team's APS at the current event, or null if we haven't scouted them in a
 * match. When two scouts watched the same robot in the same match, their
 * points are averaged first, so that match counts once.
 */
export function teamAps(team: number, entries: MatchRow[], counters: Counter[] = COUNTERS, endgamePoints: Record<string, number> = ENDGAME_POINTS): Aps | null {
  const byMatch = new Map<number, number[]>()
  for (const e of thisEvent(entries)) {
    if (e.team_number !== team) continue
    byMatch.set(e.match_number, [...(byMatch.get(e.match_number) ?? []), entryPoints(e, counters, endgamePoints)])
  }
  const perMatch = [...byMatch.values()].map((points) => points.reduce((a, b) => a + b, 0) / points.length)
  if (perMatch.length === 0) return null
  const average = perMatch.reduce((a, b) => a + b, 0) / perMatch.length
  const spread = Math.sqrt(perMatch.reduce((sum, p) => sum + (p - average) ** 2, 0) / perMatch.length)
  return { average, low: Math.max(0, average - spread), high: average + spread, spread, matches: perMatch.length }
}

/** What we expect one team to score, for the simulator. */
export interface TeamPoints {
  team: number
  /** From our scouting, or null if we haven't scouted them in a match. */
  aps: Aps | null
  /** Match 13's xP, or null if it hasn't rated them. */
  xp: number | null
  /** What the simulator uses: our APS, or Match 13's xP when we have too few matches. Null if we have neither. */
  expected: number | null
  /** The spread around `expected`: our APS's, or 0 for xP, which has none. */
  spread: number
  /** Where `expected` came from. */
  source: 'scouting' | 'match13' | null
  /** True when we've scouted them in fewer than MIN_MATCHES matches, so `expected` is only a guess. */
  fewMatches: boolean
}

/** One team's expected points, from our scouting and Match 13. */
export function teamPoints(team: number, entries: MatchRow[], ratings: Match13Rating[]): TeamPoints {
  const aps = teamAps(team, entries)
  const xp = ratings.find((r) => r.teamNumber === team)?.xpEnd ?? null
  const fewMatches = (aps?.matches ?? 0) < MIN_MATCHES
  // With few matches, Match 13 has seen more of them than we have.
  if (aps && (!fewMatches || xp === null)) return { team, aps, xp, expected: aps.average, spread: aps.spread, source: 'scouting', fewMatches }
  if (xp !== null) return { team, aps, xp, expected: xp, spread: 0, source: 'match13', fewMatches }
  return { team, aps, xp, expected: null, spread: 0, source: null, fewMatches }
}

/** One alliance's expected score in the simulator. */
export interface AllianceScore {
  /** The teams' expected points added up. Teams we know nothing about count as 0. */
  expected: number
  /** One standard deviation below and above. */
  low: number
  high: number
  spread: number
  /** Teams with no APS and no xP: their points are missing from `expected`. */
  unknown: number[]
}

/**
 * An alliance's expected score: its teams' expected points added up. The
 * spreads add the way they do in statistics (the square root of the sum of
 * squares), since teams don't all have a good or bad match at once.
 */
export function allianceScore(teams: TeamPoints[]): AllianceScore {
  const expected = teams.reduce((sum, t) => sum + (t.expected ?? 0), 0)
  const spread = Math.sqrt(teams.reduce((sum, t) => sum + t.spread ** 2, 0))
  return { expected, low: Math.max(0, expected - spread), high: expected + spread, spread, unknown: teams.filter((t) => t.expected === null).map((t) => t.team) }
}

/**
 * The chance red outscores blue, from 0 to 1, assuming scores spread out in
 * a bell curve. With no spread at all, the higher expected score wins for
 * certain, and equal scores are an even chance.
 */
export function redWinChance(red: AllianceScore, blue: AllianceScore): number {
  const spread = Math.sqrt(red.spread ** 2 + blue.spread ** 2)
  const lead = red.expected - blue.expected
  if (spread === 0) return lead > 0 ? 1 : lead < 0 ? 0 : 0.5
  return normalBelow(lead / spread)
}

// The chance a bell-curve value is below z (in standard deviations), from
// the Abramowitz and Stegun formula, correct to about 7 decimal places.
function normalBelow(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

/** "34 (26–41)": an expected score and its range, rounded. Just "34" when there's no range. */
export function pointsRange(expected: number, low: number, high: number): string {
  return low === high ? String(Math.round(expected)) : `${Math.round(expected)} (${Math.round(low)}–${Math.round(high)})`
}

/** Every team's expected points, for a page: our entries and this phone's Waiting ones, and the saved Match 13 copy, so it works with no Wi-Fi. */
export function useTeamPoints(): { pointsFor: (team: number) => TeamPoints; ratings: ReturnType<typeof useRatings> } {
  const ratings = useRatings()
  const { entries } = useScoutingRows()
  const pointsFor = useCallback((team: number) => teamPoints(team, entries, ratings.ratings), [entries, ratings.ratings])
  return { pointsFor, ratings }
}

/** The qualification matches not played yet, soonest first, from the schedule saved on this phone. For filling in the simulator. */
export function upcomingMatches(schedule: SavedSchedule | null): TbaMatch[] {
  if (!schedule) return []
  return schedule.matches
    .filter((m) => m.comp_level === 'qm' && !(m.alliances.red.score >= 0 && m.alliances.blue.score >= 0))
    .sort((a, b) => a.match_number - b.match_number)
}

// ---------------------------------------------------------------------------
// The match schedule page: The Blue Alliance's schedule with Match 13's
// prediction for each match. The last ones fetched are saved on this
// device, so the schedule still shows with no connection.

/** Our team, so the schedule can pick out our matches. */
export const OUR_TEAM = 4096

/** One match on the schedule page. */
export interface ScheduleRow {
  key: string
  /** Like "Qual 12" or "Semifinal 3". */
  label: string
  /** When it's expected to start, in seconds since 1970, or null. */
  time: number | null
  /** Team numbers on each side. */
  red: number[]
  blue: number[]
  /** The real score once the match is played, or null before. */
  score: { red: number; blue: number } | null
  /** Match 13's prediction, or null if it hasn't predicted this match yet. */
  prediction: MatchPrediction | null
  /** True when our team plays in it. */
  ours: boolean
}

const LEVELS: TbaMatch['comp_level'][] = ['qm', 'ef', 'qf', 'sf', 'f']
const LEVEL_NAMES: Record<TbaMatch['comp_level'], string> = { qm: 'Qual', ef: 'Eighthfinal', qf: 'Quarterfinal', sf: 'Semifinal', f: 'Final' }

/** "Qual 12", "Semifinal 3", "Final 2", or "Quarterfinal 1 match 2" when a set has more than one match. */
export function matchLabel(match: Pick<TbaMatch, 'comp_level' | 'set_number' | 'match_number'>): string {
  const name = LEVEL_NAMES[match.comp_level] ?? match.comp_level
  if (match.comp_level === 'qm' || match.comp_level === 'f') return `${name} ${match.match_number}`
  return match.match_number > 1 ? `${name} ${match.set_number} match ${match.match_number}` : `${name} ${match.set_number}`
}

/**
 * Put each match with its prediction, matched by the match key, in the
 * order they're played: qualifications, then playoffs. A match Match 13
 * hasn't predicted yet still shows, with no prediction. Played matches have
 * their real score.
 */
export function matchesWithPredictions(schedule: TbaMatch[], predictions: MatchPrediction[], team = OUR_TEAM): ScheduleRow[] {
  const predicted = new Map(predictions.map((p) => [p.key, p]))
  const order = (m: TbaMatch) => LEVELS.indexOf(m.comp_level)
  return [...schedule]
    .sort((a, b) => order(a) - order(b) || a.set_number - b.set_number || a.match_number - b.match_number)
    .map((m) => {
      const red = m.alliances.red.team_keys.map(teamNumber)
      const blue = m.alliances.blue.team_keys.map(teamNumber)
      // TBA sends -1 (or sometimes null) until the match is played.
      const scored = (score: number | null) => typeof score === 'number' && score >= 0
      const played = scored(m.alliances.red.score) && scored(m.alliances.blue.score)
      return {
        key: m.key,
        label: matchLabel(m),
        time: m.predicted_time ?? null,
        red,
        blue,
        score: played ? { red: m.alliances.red.score, blue: m.alliances.blue.score } : null,
        prediction: predicted.get(m.key) ?? null,
        ours: red.includes(team) || blue.includes(team),
      }
    })
}

/** Who's likely to win and their chance, like "Red 72%", or "Toss-up" when it's even. */
export function likelyWinner(prediction: MatchPrediction): string {
  const red = Math.round(prediction.redWinChance * 100)
  if (red === 50) return 'Toss-up'
  return red > 50 ? `Red ${red}%` : `Blue ${100 - red}%`
}

/** "just now", "1 minute ago", "3 hours ago", "2 days ago". */
export function updatedAgo(at: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${plural(minutes, 'minute', 'minutes')} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${plural(hours, 'hour', 'hours')} ago`
  return `${Math.floor(hours / 24)} days ago`
}

/** The schedule and predictions as last fetched, kept on this device. */
export interface SavedSchedule {
  event: string
  matches: TbaMatch[]
  predictions: MatchPrediction[]
  /** ISO date and time they were fetched. */
  savedAt: string
}

// Kept through "Reset example data", like entries: at an event it may be the
// only copy of the schedule on a phone with no connection.
export const scheduleStore = createStore<SavedSchedule | null>('scouting-schedule', 1, () => null, { keepOnReset: true })

/**
 * The schedule saved on this device for the event, or null if there isn't
 * one yet. Anything that needs the schedule with no connection (such as
 * filling in the team from the match number, #40) can use this.
 */
export function savedSchedule(event = currentEvent()): SavedSchedule | null {
  const saved = scheduleStore.get()
  return saved?.event === event ? saved : null
}

export function useSavedSchedule(event?: string): SavedSchedule | null {
  const current = useCurrentEvent().key
  const saved = useStore(scheduleStore)
  return saved?.event === (event ?? current) ? saved : null
}

export interface ScheduleStatus {
  loading: boolean
  /** Why the last try didn't work, written for the person, or null. */
  problem: string | null
}

// Only for this page visit: not saved.
export const scheduleStatus = createStore<ScheduleStatus>('scouting-schedule-status', 1, () => ({ loading: false, problem: null }), { persist: false, keepOnReset: true })

export function useScheduleStatus(): ScheduleStatus {
  return useStore(scheduleStatus)
}

// The fetch under way, if there is one, so two tries at once share it.
let scheduleInFlight: Promise<Result<SavedSchedule>> | null = null

/**
 * Get the latest schedule and predictions, and save them on this device.
 * If the schedule can't be fetched, the saved one stays. If only the
 * predictions can't, the schedule is saved with the last predictions.
 */
export function refreshSchedule(event = currentEvent()): Promise<Result<SavedSchedule>> {
  scheduleInFlight ??= fetchSchedule(event).finally(() => {
    scheduleInFlight = null
  })
  return scheduleInFlight
}

async function fetchSchedule(event: string): Promise<Result<SavedSchedule>> {
  if (globalThis.navigator?.onLine === false) {
    scheduleStatus.set({ loading: false, problem: 'No connection.' })
    return fail('No connection.')
  }
  scheduleStatus.set((now) => ({ ...now, loading: true }))
  const [schedule, predictions] = await Promise.all([getSchedule(event), getPredictions(event)])
  if (!schedule.ok) {
    scheduleStatus.set({ loading: false, problem: schedule.error })
    return schedule
  }
  // TBA has no schedule until shortly before the event. Don't swap a saved one for an empty one.
  const previous = savedSchedule(event)
  if (schedule.value.length === 0 && previous && previous.matches.length > 0) {
    scheduleStatus.set({ loading: false, problem: null })
    return ok(previous)
  }
  const saved: SavedSchedule = {
    event,
    matches: schedule.value,
    predictions: predictions.ok ? predictions.value : (savedSchedule(event)?.predictions ?? []),
    savedAt: new Date().toISOString(),
  }
  scheduleStore.set(saved)
  scheduleStatus.set({
    loading: false,
    problem: predictions.ok ? null : `Couldn't get new predictions from Match 13, so these may be old. ${predictions.error}`,
  })
  return ok(saved)
}

/** How often the schedule page asks again. The match13 function reuses its answer for 2 minutes, so sooner doesn't help. */
export const SCHEDULE_REFRESH_MS = 2 * 60 * 1000

/**
 * While the schedule page is open, keep it up to date: ask now, every 2
 * minutes, when the app comes back on screen, and when the phone comes back
 * online. Gives back a function that stops it, for when the page closes.
 */
export function keepScheduleFresh(event = currentEvent()): () => void {
  const refresh = () => void refreshSchedule(event)
  const onScreen = () => {
    if (globalThis.document?.visibilityState === 'visible') refresh()
  }
  globalThis.addEventListener?.('online', refresh)
  globalThis.document?.addEventListener('visibilitychange', onScreen)
  const timer = setInterval(refresh, SCHEDULE_REFRESH_MS)
  refresh()
  return () => {
    globalThis.removeEventListener?.('online', refresh)
    globalThis.document?.removeEventListener('visibilitychange', onScreen)
    clearInterval(timer)
  }
}

// ---------------------------------------------------------------------------
// One team's Match 13 numbers (#37), and a saved copy of every team's.
//
// getRatings() gets every team at the event in one request, so pages don't
// ask for one team at a time: they read the saved copy with useRatings(),
// then find a team in it with teamRating(). The win-loss record comes from
// The Blue Alliance's getRankings(), since Match 13 doesn't have records.
//
// The copy is kept on this device, because Match 13 is sometimes down and
// venue Wi-Fi is worse: with no connection, pages show the saved numbers
// and when they're from (savedWhen()). The team page and the picklist (#42)
// both use this copy, so neither makes its own requests.

/** A team's Match 13 rating, and where it puts them at the event. */
export interface TeamRating {
  rating: Match13Rating
  /** Their xP rank at the event: 1 is best. Teams with the same xpEnd share a rank. */
  rank: number
  /** How many teams Match 13 rated at the event. */
  teams: number
  /** xpEnd minus xpStart, to one decimal place: how much they've gone up (or down) at the event. */
  change: number
}

const oneDecimal = (n: number) => Math.round(n * 10) / 10

/**
 * One team's rating and rank, from every team's ratings (getRatings() or
 * useRatings()). Null when Match 13 hasn't rated them at this event: show
 * "No Match 13 rating yet", not an error.
 */
export function teamRating(ratings: Match13Rating[], team: number): TeamRating | null {
  const rating = ratings.find((r) => r.teamNumber === team)
  if (!rating) return null
  // Tied teams share a rank: two teams at the top are both 1, and the next is 3.
  const rank = 1 + ratings.filter((r) => r.xpEnd > rating.xpEnd).length
  return { rating, rank, teams: ratings.length, change: oneDecimal(rating.xpEnd - rating.xpStart) }
}

/** A team's wins, losses and ties at the event, from getRankings(). Null if they aren't in the rankings yet. */
export function teamRecord(rankings: TbaRanking[], team: number): { wins: number; losses: number; ties: number } | null {
  return rankings.find((r) => teamNumber(r.team_key) === team)?.record ?? null
}

/** A change with its sign, to one decimal place: "+4.6", "−1.4" or "0.0". */
export function signed(n: number): string {
  const rounded = oneDecimal(n)
  if (rounded > 0) return `+${rounded.toFixed(1)}`
  if (rounded < 0) return `−${Math.abs(rounded).toFixed(1)}`
  return '0.0'
}

/** When the saved numbers are from, in Chicago time: "Today at 3:40 PM" or "Nov 8 at 3:40 PM". */
export function savedWhen(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  const day = (date: Date) => new Intl.DateTimeFormat('en-US', { timeZone: TEAM_TIME_ZONE, month: 'short', day: 'numeric' }).format(date)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: TEAM_TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(at)
  return `${day(at) === day(now) ? 'Today' : day(at)} at ${time}`
}

/** Load again when the saved copy is older than this. */
export const STALE_MS = 5 * 60 * 1000

/** The saved copy of the event's Match 13 ratings and TBA rankings. */
export interface RatingsState {
  /** The event they're for, or null if nothing's saved. A copy for another event counts as nothing saved. */
  event: string | null
  /** Every team's rating, best first. Empty if none are saved, or Match 13 hasn't rated anyone yet. */
  ratings: Match13Rating[]
  /** The Blue Alliance's rankings, for each team's record. */
  rankings: TbaRanking[]
  /** When the ratings were last loaded, as ISO, or null if never. */
  loadedAt: string | null
  /** Why the last load didn't work, or null. The saved copy stays when it doesn't. */
  error: string | null
}

const noRatings = (): RatingsState => ({ event: null, ratings: [], rankings: [], loadedAt: null, error: null })

// Saved on this device, so the numbers still show with no connection. Not
// keepOnReset: it's only a copy, so "Reset example data" may clear it.
export const ratingsStore = createStore<RatingsState>('scouting-ratings', 1, noRatings)
// Only for this page visit: not saved.
const ratingsLoading = createStore('scouting-ratings-loading', 1, () => false, { persist: false, keepOnReset: true })

/** The saved copy for the current event, for code outside a page. A copy for another event gives nothing saved. */
export function savedRatings(): RatingsState {
  const saved = ratingsStore.get()
  return saved.event === currentEvent() ? saved : noRatings()
}

/** Whether to load again: nothing saved for this event, or the copy is older than STALE_MS. */
export function needsLoading(saved: RatingsState, now: Date = new Date()): boolean {
  return saved.event !== currentEvent() || !saved.loadedAt || now.getTime() - Date.parse(saved.loadedAt) > STALE_MS
}

// What the match13 function says when Match 13 has no ratings for the
// event yet (see supabase/functions/match13/match13.ts). That just means
// nobody's rated yet, so it isn't shown as a problem.
const NOT_RATED_YET = /nothing for that event/i

// The load under way, if there is one, so two pages loading at once share it.
let loading: Promise<void> | null = null

/**
 * Load every team's Match 13 rating and TBA ranking at the event, and save
 * them on this device. Each part is saved only if its own request worked;
 * if one didn't, the last saved copy of it stays and `error` says why.
 */
export function loadRatings(now: Date = new Date()): Promise<void> {
  if (!loading) {
    ratingsLoading.set(true)
    loading = load(now).finally(() => {
      loading = null
      ratingsLoading.set(false)
    })
  }
  return loading
}

async function load(now: Date): Promise<void> {
  const event = currentEvent()
  const [ratings, rankings, sim] = await Promise.all([getRatings(event), getRankings(event), getEventSim(event)])
  const notRatedYet = !ratings.ok && NOT_RATED_YET.test(ratings.error)
  // The simulation is extra: if Match 13 has none yet, the ratings show without it.
  const rated: Result<Match13Rating[]> = notRatedYet ? ok([]) : ratings.ok ? ok(withSim(ratings.value, sim.ok ? sim.value : [])) : ratings
  // Start from this event's copy, so another event's numbers never mix in.
  const prev = savedRatings()
  ratingsStore.set({
    event,
    ratings: rated.ok ? rated.value : prev.ratings,
    rankings: rankings.ok ? rankings.value : prev.rankings,
    loadedAt: rated.ok ? now.toISOString() : prev.loadedAt,
    error: !rated.ok ? rated.error : !rankings.ok ? rankings.error : null,
  })
}

/** For tests: forget the saved copy. */
export function resetRatings() {
  ratingsStore.reset()
  ratingsLoading.reset()
}

/**
 * The saved Match 13 ratings and TBA rankings for this event, loading them
 * when nothing's saved, when the copy is older than STALE_MS, and when the
 * phone comes back online. `refresh` is for a Refresh button.
 */
export function useRatings(): RatingsState & { loading: boolean; refresh: () => void } {
  const event = useCurrentEvent().key
  const saved = useStore(ratingsStore)
  const state = saved.event === event ? saved : noRatings()
  const isLoading = useStore(ratingsLoading)
  useEffect(() => {
    if (needsLoading(ratingsStore.get())) void loadRatings()
    const reload = () => void loadRatings()
    globalThis.addEventListener('online', reload)
    return () => globalThis.removeEventListener('online', reload)
  }, [event])
  return { ...state, loading: isLoading, refresh: () => void loadRatings() }
}

// ---------------------------------------------------------------------------
// Example data for demo mode. Made up: the other teams and the video don't exist.

const DEMO_TEAMS: [number, string][] = [
  [4096, 'Ctrl-Z'],
  [9991, 'Example Robotics'],
  [9992, 'Sample Squad'],
  [9993, 'Demo Dynamics'],
  [9994, 'Placeholder Pistons'],
  [9995, 'Mock Mechanics'],
]

function demoTeam(team: number): TbaTeam {
  const nickname = DEMO_TEAMS.find(([number]) => number === team)?.[1] ?? `Example team ${team}`
  return { key: `frc${team}`, team_number: team, nickname, city: 'Champaign', state_prov: 'Illinois', country: 'USA' }
}

// Who plays in each example match, red then blue, and the scores (-1: not played yet).
const DEMO_SCHEDULE: [red: number[], blue: number[], redScore: number, blueScore: number][] = [
  [[4096, 9991, 9992], [9993, 9994, 9995], 84, 71],
  [[9993, 9995, 4096], [9991, 9992, 9994], 66, 90],
  [[9992, 9994, 9995], [4096, 9993, 9991], -1, -1],
  [[9991, 4096, 9994], [9995, 9992, 9993], -1, -1],
]
const DEMO_START = Date.UTC(2026, 2, 13, 15, 0) / 1000

function demoMatches(event: string): TbaMatchWithVideos[] {
  return DEMO_SCHEDULE.map(([red, blue, redScore, blueScore], i) => ({
    key: `${event}_qm${i + 1}`,
    comp_level: 'qm',
    set_number: 1,
    match_number: i + 1,
    alliances: {
      red: { score: redScore, team_keys: red.map((t) => `frc${t}`) },
      blue: { score: blueScore, team_keys: blue.map((t) => `frc${t}`) },
    },
    winning_alliance: redScore < 0 ? '' : redScore > blueScore ? 'red' : 'blue',
    predicted_time: DEMO_START + i * 8 * 60,
    videos: redScore < 0 ? [] : [{ type: 'youtube', key: 'example-video' }],
  }))
}

// Made-up Match 13 ratings, in no order like the real ones: [team, xpStart, xpEnd].
// Best to worst isn't the same as by team number, so sorting by EPA shows a change.
const DEMO_RATINGS: [team: number, start: number, end: number][] = [
  [9993, 31.2, 30.4],
  [4096, 44.0, 48.6],
  [9995, 20.1, 22.8],
  [9991, 40.3, 41.7],
  [9994, 38.0, 44.9],
  [9992, 27.5, 26.1],
]

function demoRatings(): Match13Rating[] {
  const round = (n: number) => Math.round(n * 10) / 10
  return DEMO_RATINGS.map(([teamNumber, xpStart, xpEnd]) => ({
    teamNumber,
    xpStart,
    xpEnd,
    xAuto: round(xpEnd * 0.25),
    xTele: round(xpEnd * 0.6),
    xEnd: round(xpEnd * 0.15),
    epa: round(xpEnd * 0.95),
    opr: round(xpEnd * 1.05),
    dpr: round(30 - xpEnd * 0.2),
    xVar: round(60 - xpEnd),
    xRp1: round(Math.min(1, xpEnd / 50)),
    xRp2: round(Math.min(1, xpEnd / 80)),
    xRp3: round(Math.min(1, xpEnd / 60)),
    // Made-up part names: Match 13 names them for each season's game.
    components: { fuel: round(xpEnd * 0.7), tower: round(xpEnd * 0.3) },
  }))
}

/** A made-up simulation: teams ranked by their example xP, give or take a few places. */
function demoSim(): { teams: unknown[] } {
  const ranked = [...demoRatings()].sort((a, b) => b.xpEnd - a.xpEnd)
  return {
    teams: ranked.map((r, i) => ({
      teamNumber: r.teamNumber,
      rank: { mean: i + 1.4, p5: Math.max(1, i - 1), p50: i + 1, p95: Math.min(ranked.length, i + 3) },
      rp: { mean: Math.round((30 - i * 3.5) * 10) / 10 },
    })),
  }
}

/** Made-up Match 13 numbers for a team at each of the example events in a season. */
function demoTeamEvents(team: number, year: number): { events: unknown[] } {
  const xp = DEMO_RATINGS.find(([t]) => t === team)?.[2] ?? 30
  return { events: demoEvents(year).slice(0, 3).map((e, i) => ({ eventKey: e.key, xpEnd: Math.round((xp - i * 2.5) * 10) / 10, rank: 3 + i })) }
}

/** Made-up predictions for the example schedule: each alliance's ratings added up. */
function demoPredictions(event: string): Match13Matches {
  const rating = new Map(demoRatings().map((r) => [r.teamNumber, r.xpEnd]))
  const total = (teams: number[]) => Math.round(teams.reduce((sum, team) => sum + (rating.get(team) ?? 0), 0))
  return {
    matches: DEMO_SCHEDULE.map(([red, blue], i) => {
      const redScore = total(red)
      const blueScore = total(blue)
      return { key: `${event}_qm${i + 1}`, pred: { winProb: Math.round((redScore / (redScore + blueScore)) * 100) / 100, redScore, blueScore } }
    }),
  }
}

function demoRankings(): TbaRanking[] {
  const record = new Map(DEMO_TEAMS.map(([team]) => [`frc${team}`, { wins: 0, losses: 0, ties: 0 }]))
  for (const match of demoMatches(EVENT_KEY).filter((m) => m.winning_alliance)) {
    for (const color of ['red', 'blue'] as const) {
      for (const team of match.alliances[color].team_keys) {
        const r = record.get(team)!
        if (match.winning_alliance === color) r.wins += 1
        else r.losses += 1
      }
    }
  }
  return [...record]
    .sort(([a, ra], [b, rb]) => rb.wins - ra.wins || ra.losses - rb.losses || teamNumber(a) - teamNumber(b))
    // Made-up ranking points: 3 for a win and 1 for a tie, with no bonus points.
    .map(([team_key, r], i) => ({ rank: i + 1, team_key, record: r, matches_played: r.wins + r.losses + r.ties, extra_stats: [r.wins * 3 + r.ties] }))
}

// ---------------------------------------------------------------------------
// Shared picklist (#43): the order the strategy team wants to pick teams in
// on alliance selection day. It's a table, so every phone shows the same
// order and changes show up by themselves. Everyone signed in can read it;
// student leaders, mentors and admins can change it (the rules in
// supabase/migrations/..._scouting_picklist.sql).
//
// Each team has a position, and the list is in position order, smallest
// first. Positions start 1000 apart. Moving a team changes only its own
// position, to halfway between its new neighbours, so one move is one small
// change, and two people moving different teams at once don't undo each
// other. After many moves in one spot the halves get too close to tell
// apart; then moveTeam() numbers the list 1000, 2000, … again.

export const PICK_STATUSES = ['Open', 'Picked', 'Do not pick'] as const
/** Picked: already on another alliance. Teams keep their place when marked. */
export type PickStatus = (typeof PICK_STATUSES)[number]

/** One row of the scouting_picklist table: one team on one event's list. */
export interface PicklistRow extends Row {
  /** The event, like 2026ilch. Each event has its own list. */
  event_key: string
  team_number: number
  /** Smaller is higher on the list. */
  position: number
  status: PickStatus
  /** Who added it. Show their name with useMemberNames(). */
  created_by: string | null
}

/** How far apart positions are when teams are added. */
export const POSITION_GAP = 1000

/** Top of the list first. Two teams with the same position go by team number. */
export const byPosition = (a: PicklistRow, b: PicklistRow) => a.position - b.position || a.team_number - b.team_number

// Made up, for demo mode: the example teams above, not real ones.
const EXAMPLE_PICKLIST: PicklistRow[] = [
  { id: '00000000-0000-4000-8000-0000000d0101', event_key: EVENT_KEY, team_number: 9991, position: 1000, status: 'Open', created_at: '2026-11-07T20:00:00Z', created_by: DEMO_PEOPLE.pat },
  { id: '00000000-0000-4000-8000-0000000d0102', event_key: EVENT_KEY, team_number: 9993, position: 2000, status: 'Picked', created_at: '2026-11-07T20:00:00Z', created_by: DEMO_PEOPLE.pat },
  { id: '00000000-0000-4000-8000-0000000d0103', event_key: EVENT_KEY, team_number: 9992, position: 3000, status: 'Open', created_at: '2026-11-07T20:00:00Z', created_by: DEMO_PEOPLE.pat },
  { id: '00000000-0000-4000-8000-0000000d0104', event_key: EVENT_KEY, team_number: 9995, position: 4000, status: 'Do not pick', created_at: '2026-11-07T20:00:00Z', created_by: DEMO_PEOPLE.pat },
  { id: '00000000-0000-4000-8000-0000000d0105', event_key: EVENT_KEY, team_number: 9994, position: 5000, status: 'Open', created_at: '2026-11-07T20:00:00Z', created_by: DEMO_PEOPLE.pat },
]

export const picklistTable = createTable<PicklistRow>('scouting_picklist', { demo: EXAMPLE_PICKLIST, sort: byPosition })

/** One event's picklist, top first. */
export function picklist(event = currentEvent()): PicklistRow[] {
  return picklistTable.rows().filter((row) => row.event_key === event)
}

/** One event's picklist, top first, for a page. */
export function usePicklist(event?: string): PicklistRow[] {
  const current = useCurrentEvent().key
  return picklistTable.useRows().filter((row) => row.event_key === (event ?? current))
}

/**
 * A position between two teams' positions: halfway between them, or
 * POSITION_GAP above the top or below the bottom of the list. Leave out
 * `before` for the top, `after` for the bottom, and both for an empty list.
 */
export function positionBetween(before?: number, after?: number): number {
  if (before === undefined) return after === undefined ? POSITION_GAP : after - POSITION_GAP
  if (after === undefined) return before + POSITION_GAP
  return (before + after) / 2
}

/** Why these team numbers can't go on the list, or null if they can. */
function checkTeams(teams: number[]): string | null {
  const bad = teams.find((team) => !isCount(team) || team > MAX_TEAM)
  return bad === undefined ? null : `Check the team number: ${bad} isn't one.`
}

/** New rows for these teams, in the order given, each once, below the position `last`. */
function rowsBelow(teams: number[], last: number | undefined, event: string) {
  let position = last
  return [...new Set(teams)].map((team) => {
    position = positionBetween(position)
    return { event_key: event, team_number: team, position, status: 'Open' as const }
  })
}

/**
 * Start the event's picklist with these teams, best first (like the ranked
 * list). Only for an empty list: once it's started, the order is the
 * strategy team's, so this never replaces it.
 */
export async function startPicklist(teams: number[], event = currentEvent()): Promise<Result<PicklistRow[]>> {
  if (teams.length === 0) return fail('There are no teams to start the picklist with.')
  const problem = checkTeams(teams)
  if (problem) return fail(problem)
  if (picklist(event).length > 0) return fail('The picklist is already started. Move teams on it, or add the teams that are missing.')
  return picklistTable.insertMany(rowsBelow(teams, undefined, event))
}

/**
 * Add the teams that aren't on the event's picklist yet to the bottom, in
 * the order given. Teams already on it stay where they are.
 */
export async function addMissingTeams(teams: number[], event = currentEvent()): Promise<Result<PicklistRow[]>> {
  const problem = checkTeams(teams)
  if (problem) return fail(problem)
  const list = picklist(event)
  const onList = new Set(list.map((row) => row.team_number))
  const missing = teams.filter((team) => !onList.has(team))
  if (missing.length === 0) return ok([])
  return picklistTable.insertMany(rowsBelow(missing, list.at(-1)?.position, event))
}

/**
 * Move a team one place up (-1) or down (1) its event's list. Up from the
 * top or down from the bottom does nothing.
 */
export async function moveTeam(id: string, direction: -1 | 1): Promise<Result> {
  const row = picklistTable.rows().find((r) => r.id === id)
  if (!row) return fail("That team isn't on the picklist any more.")
  const list = picklist(row.event_key)
  const to = list.indexOf(row) + direction
  if (to < 0 || to >= list.length) return ok(null)

  // Its new neighbours: the teams it ends up between (none past either end).
  const [before, after] = direction === -1 ? [list[to - 1], list[to]] : [list[to], list[to + 1]]
  const position = positionBetween(before?.position, after?.position)
  if (position !== before?.position && position !== after?.position) {
    const result = await picklistTable.update(id, { position })
    return result.ok ? ok(null) : result
  }

  // Too close to tell apart: number the whole list again, with this move in it.
  const order = list.filter((r) => r.id !== id)
  order.splice(to, 0, row)
  for (const [i, r] of order.entries()) {
    const renumbered = (i + 1) * POSITION_GAP
    if (r.position === renumbered) continue
    const result = await picklistTable.update(r.id, { position: renumbered })
    if (!result.ok) return result
  }
  return ok(null)
}

/** Mark a team Open, Picked (on another alliance) or Do not pick. It keeps its place. */
export async function setPickStatus(id: string, status: PickStatus): Promise<Result> {
  if (!PICK_STATUSES.includes(status)) return fail('Choose Open, Picked or Do not pick.')
  const result = await picklistTable.update(id, { status })
  return result.ok ? ok(null) : result
}

// ---------------------------------------------------------------------------
// Personal picklists, and the team picklist that averages them (#151).
//
// Everyone signed in can make their own order for picking teams at an
// event, with a note on any team. Each is saved in scouting_my_picklist
// (supabase/migrations/..._scouting_my_picklist.sql), so it's on all their
// devices, and everyone can read every list so the team picklist can
// average them. You change only your own; mentors can remove anyone's.
// keepOffline: lists still show with no Wi-Fi, but changes need a connection.

/** One team on one person's picklist for one event. */
export interface MyPicklistRow extends Row {
  event_key: string
  team_number: number
  /** Its place on the list: 1 is best. */
  rank: number
  /** Like "Great defender, slow climb", or null. */
  note: string | null
  /** Whose list it's on. Show their name with useMemberNames(). */
  created_by: string | null
  updated_at: string
}

/** The longest a picklist note can be, the same as the team database. */
export const MAX_PICKLIST_NOTE = 500

const byRank = (a: MyPicklistRow, b: MyPicklistRow) => a.rank - b.rank || a.team_number - b.team_number

// Made up, for demo mode: three made-up people's lists of the example teams,
// different lengths, so the team picklist has something to average.
const EXAMPLE_MY_PICKLISTS: MyPicklistRow[] = (
  [
    [DEMO_PEOPLE.jordan, [[9994, 'Fast cycles, reliable climb'], [9991, null], [9993, null], [9992, 'Good defender']]],
    [DEMO_PEOPLE.sam, [[9991, 'Best auto we saw'], [9994, null], [9995, null]]],
    [DEMO_PEOPLE.pat, [[9994, null], [9993, 'Slow climb'], [9991, null], [9995, null], [9992, null]]],
  ] as [string, [number, string | null][]][]
).flatMap(([person, teams], p) =>
  teams.map(([team, note], i) => ({
    id: `00000000-0000-4000-8000-0000000d02${p}${i}`,
    event_key: EVENT_KEY,
    team_number: team,
    rank: i + 1,
    note,
    created_at: '2026-11-07T21:00:00Z',
    created_by: person,
    updated_at: '2026-11-07T21:00:00Z',
  })),
)

export const myPicklistTable = createTable<MyPicklistRow>('scouting_my_picklist', { demo: EXAMPLE_MY_PICKLISTS, sort: byRank, keepOffline: true })

/** One person's list for an event, best first. */
export function myPicklist(person: string | null | undefined = currentUser()?.id, event = currentEvent()): MyPicklistRow[] {
  return myPicklistTable.rows().filter((row) => row.event_key === event && row.created_by === person).sort(byRank)
}

/** The signed-in person's list for the current event, best first, for a page. */
export function useMyPicklist(): MyPicklistRow[] {
  const event = useCurrentEvent().key
  const rows = myPicklistTable.useRows()
  const person = currentUser()?.id
  return useMemo(() => rows.filter((row) => row.event_key === event && row.created_by === person).sort(byRank), [rows, event, person])
}

/** Why a change to your picklist can't be made, or null if it can. */
function cantChangePicklist(): string | null {
  if (!currentUser()) return 'Sign in to make your picklist.'
  if (globalThis.navigator?.onLine === false) return 'No connection. Your picklist is saved to the team, so changing it needs Wi-Fi or data.'
  return null
}

/**
 * Start your list with these teams, best first (like the Picklist page's
 * order with this phone's weights). Only for an empty list: once it's
 * started, the order is yours, so this never replaces it.
 */
export async function startMyPicklist(teams: number[], event = currentEvent()): Promise<Result<MyPicklistRow[]>> {
  const problem = cantChangePicklist() ?? (teams.length === 0 ? 'There are no teams to start your picklist with.' : checkTeams(teams))
  if (problem) return fail(problem)
  if (myPicklist(currentUser()?.id, event).length > 0) return fail('Your picklist is already started. Move teams on it, or add the teams that are missing.')
  return myPicklistTable.insertMany([...new Set(teams)].map((team, i) => ({ event_key: event, team_number: team, rank: i + 1, note: null, updated_at: new Date().toISOString() })))
}

/** Add the teams that aren't on your list yet to the bottom, in the order given. */
export async function addToMyPicklist(teams: number[], event = currentEvent()): Promise<Result<MyPicklistRow[]>> {
  const problem = cantChangePicklist() ?? checkTeams(teams)
  if (problem) return fail(problem)
  const list = myPicklist(currentUser()?.id, event)
  const onList = new Set(list.map((row) => row.team_number))
  const missing = [...new Set(teams)].filter((team) => !onList.has(team))
  if (missing.length === 0) return ok([])
  return myPicklistTable.insertMany(missing.map((team, i) => ({ event_key: event, team_number: team, rank: list.length + i + 1, note: null, updated_at: new Date().toISOString() })))
}

/**
 * Move a team on your list to place `rank` (1 is the top), and the teams in
 * between shift one place to make room. A place past either end means the
 * top or the bottom. Only rows whose place changes are saved.
 */
export async function moveOnMyPicklist(team: number, rank: number, event = currentEvent()): Promise<Result> {
  const problem = cantChangePicklist()
  if (problem) return fail(problem)
  const list = myPicklist(currentUser()?.id, event)
  const row = list.find((r) => r.team_number === team)
  if (!row) return fail(`Team ${team} isn't on your picklist.`)
  const to = Math.min(list.length, Math.max(1, Math.round(rank))) - 1
  const order = list.filter((r) => r !== row)
  order.splice(to, 0, row)
  for (const [i, r] of order.entries()) {
    if (r.rank === i + 1) continue
    const result = await myPicklistTable.update(r.id, { rank: i + 1 })
    if (!result.ok) return result
  }
  return ok(null)
}

/** Add, change or clear (with '') your note on a team on your list. */
export async function setPicklistNote(team: number, note: string, event = currentEvent()): Promise<Result> {
  const problem = cantChangePicklist()
  if (problem) return fail(problem)
  const text = note.trim()
  if (text.length > MAX_PICKLIST_NOTE) return fail(`Keep the note under ${MAX_PICKLIST_NOTE} characters. It's ${text.length}.`)
  const row = myPicklist(currentUser()?.id, event).find((r) => r.team_number === team)
  if (!row) return fail(`Team ${team} isn't on your picklist.`)
  const result = await myPicklistTable.update(row.id, { note: text || null })
  return result.ok ? ok(null) : result
}

/** Where one person put a team, for the team picklist. */
export interface Placement {
  /** Whose list. Show their name with useMemberNames(). */
  by: string | null
  /** Its place on their list, and how long their list is. */
  place: number
  of: number
  note: string | null
}

/** One line of the team picklist. */
export interface TeamPicklistLine {
  /** 1 is the best. */
  rank: number
  team: number
  /** Its average place as a share of each list: 0 is the top of every list it's on, 1 the bottom. */
  share: number
  /** Its average place, as places. */
  averagePlace: number
  /** Its best and worst place on any list. */
  best: number
  worst: number
  /** How many lists it's on, out of `lists`. */
  onLists: number
  lists: number
  /** Where each person put it, best first. */
  placements: Placement[]
}

/**
 * Everyone's lists for one event, averaged. Lists can be different lengths,
 * so each place is turned into a share of its list: the top is 0 and the
 * bottom is 1, so 1st of 30 counts the same as 1st of 20. A team that isn't
 * on someone's list is left out of that list's average, not counted as
 * last. Lowest average first; equal averages go in team number order.
 */
export function teamPicklist(rows: MyPicklistRow[]): TeamPicklistLine[] {
  const lists = new Map<string | null, MyPicklistRow[]>()
  for (const row of rows) lists.set(row.created_by, [...(lists.get(row.created_by) ?? []), row])

  const placements = new Map<number, (Placement & { share: number })[]>()
  for (const [by, list] of lists) {
    const ordered = [...list].sort(byRank)
    ordered.forEach((row, i) => {
      const share = ordered.length === 1 ? 0 : i / (ordered.length - 1)
      placements.set(row.team_number, [...(placements.get(row.team_number) ?? []), { by, place: i + 1, of: ordered.length, note: row.note, share }])
    })
  }

  const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
  return [...placements]
    .map(([team, placed]) => ({
      team,
      share: average(placed.map((p) => p.share)),
      averagePlace: average(placed.map((p) => p.place)),
      best: Math.min(...placed.map((p) => p.place)),
      worst: Math.max(...placed.map((p) => p.place)),
      onLists: placed.length,
      lists: lists.size,
      placements: placed.sort((a, b) => a.share - b.share).map(({ by, place, of, note }) => ({ by, place, of, note })),
    }))
    .sort((a, b) => a.share - b.share || a.team - b.team)
    .map((line, i) => ({ rank: i + 1, ...line }))
}

/** The team picklist for the current event, for a page. It updates by itself when someone changes their list. */
export function useTeamPicklist(): TeamPicklistLine[] {
  const event = useCurrentEvent().key
  const rows = myPicklistTable.useRows()
  return useMemo(() => teamPicklist(rows.filter((row) => row.event_key === event)), [rows, event])
}

// ---------------------------------------------------------------------------
// Nexus live status (#165, step 2): what's on the field right now, what's
// queuing, and when our next match should queue. It comes through the
// `nexus` server function (supabase/functions/nexus/), which holds the
// team's key, with made-up example data in demo mode. The last answer is
// kept on the phone, so with no Wi-Fi it still shows, with when it's from.
// Not every event uses Nexus: then this says so and the link is still there.

/** One event's live status from Nexus, the parts the app shows. */
export interface NexusStatus {
  /** Like "Qualification 18", or null. */
  onField: string | null
  nowQueuing: string | null
  /** Our next match that hasn't been played, or null. */
  ourNext: { label: string; status: string | null; alliance: 'red' | 'blue'; queueAt: number | null } | null
  /** The event's announcements, newest first. */
  announcements: string[]
  /** When Nexus's numbers are from, in milliseconds since 1970, or null. */
  asOf: number | null
}

/**
 * Read Nexus's answer for an event. Each match has a label like
 * "Qualification 18", a status ("Queuing soon", "Now queuing", "On deck",
 * "On field"), the teams on each side and estimated times. Anything it
 * can't read is left out. Check it against a real answer.
 */
export function readNexus(answer: unknown, team = OUR_TEAM): NexusStatus {
  const a = (answer ?? {}) as Record<string, unknown>
  const matches = (Array.isArray(a.matches) ? a.matches : []) as Record<string, unknown>[]
  const label = (m: Record<string, unknown>) => (typeof m.label === 'string' ? m.label : null)
  const status = (m: Record<string, unknown>) => (typeof m.status === 'string' ? m.status : null)
  const teams = (value: unknown) => (Array.isArray(value) ? value.map((t) => Number(String(t).replace(/^frc/, ''))) : [])
  const onField = matches.find((m) => status(m) === 'On field')
  const next = matches.find((m) => status(m) !== 'Completed' && (teams(m.redTeams).includes(team) || teams(m.blueTeams).includes(team)))
  const times = (next?.times ?? {}) as Record<string, unknown>
  const announcements = (Array.isArray(a.announcements) ? a.announcements : []) as Record<string, unknown>[]
  return {
    onField: onField ? label(onField) : null,
    nowQueuing: typeof a.nowQueuing === 'string' ? a.nowQueuing : null,
    ourNext: next && label(next)
      ? { label: label(next)!, status: status(next), alliance: teams(next.redTeams).includes(team) ? 'red' : 'blue', queueAt: num(times.estimatedQueueTime) }
      : null,
    announcements: [...announcements]
      .sort((x, y) => (num(y.postedTime) ?? 0) - (num(x.postedTime) ?? 0))
      .flatMap((n) => (typeof n.announcement === 'string' ? [n.announcement] : [])),
    asOf: num(a.dataAsOfTime),
  }
}

/** One event's live status from Nexus. */
export async function getNexusStatus(event = currentEvent()): Promise<Result<NexusStatus>> {
  const result = await callFunction<unknown>('nexus', { kind: 'status', event }, () => demoNexus(event))
  return result.ok ? ok(readNexus(result.value)) : result
}

/** The last Nexus status this phone got, and for which event. */
export interface SavedNexus {
  event: string
  status: NexusStatus
  /** ISO date and time it came. */
  savedAt: string
}

// Kept on the phone so it shows with no Wi-Fi. Not keepOnReset: it's only a copy.
export const nexusStore = createStore<SavedNexus | null>('scouting-nexus', 1, () => null)

/** How often to ask Nexus while the overview is open. The nexus function reuses its answer for 30 seconds. */
export const NEXUS_EVERY_MS = 60 * 1000

/** Ask Nexus now and keep the answer. Gives back why it couldn't, if it couldn't. */
export async function refreshNexus(event = currentEvent()): Promise<Result<SavedNexus>> {
  if (globalThis.navigator?.onLine === false) return fail('No connection.')
  const result = await getNexusStatus(event)
  if (!result.ok) return result
  const saved = { event, status: result.value, savedAt: new Date().toISOString() }
  nexusStore.set(saved)
  return ok(saved)
}

/** "Queue at 2:15 PM", in the phone's own time zone, which is the event's when you're there. */
export function queueTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/**
 * The event's Nexus status for a page: the saved copy, asked for again now
 * and every minute while the page is open. `problem` says why the last ask
 * didn't work, like an event that doesn't use Nexus.
 */
export function useNexusStatus(): { saved: SavedNexus | null; problem: string | null } {
  const event = useCurrentEvent().key
  const saved = useStore(nexusStore)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    const ask = () => void refreshNexus(event).then((result) => current && setProblem(result.ok ? null : result.error))
    ask()
    const timer = setInterval(ask, NEXUS_EVERY_MS)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [event])
  return { saved: saved?.event === event ? saved : null, problem }
}

/** Made-up Nexus status for demo mode, from the example schedule: match 3 on the field, match 4 queuing. */
function demoNexus(event: string) {
  const now = Date.now()
  return {
    eventKey: event,
    dataAsOfTime: now,
    nowQueuing: 'Qualification 4',
    matches: DEMO_SCHEDULE.map(([red, blue], i) => ({
      label: `Qualification ${i + 1}`,
      status: ['Completed', 'Completed', 'On field', 'Now queuing'][i] ?? 'Queuing soon',
      redTeams: red.map(String),
      blueTeams: blue.map(String),
      times: { estimatedQueueTime: now + (i - 3) * 8 * 60 * 1000 },
    })),
    announcements: [{ id: '1', announcement: 'Example: lunch break after match 30.', postedTime: now - 10 * 60 * 1000 }],
  }
}
