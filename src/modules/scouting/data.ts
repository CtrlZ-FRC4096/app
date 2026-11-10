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
import { isMentor } from '../../core/roles'
import { currentUser, onSignedIn } from '../../core/session'
import { DEMO_PEOPLE } from '../../core/demo'
import { createStore, useStore, type Store } from '../../core/store'
import { createTable, fail, newestFirst, ok, type Fields, type Result, type Row, type Table } from '../../core/table'
import { toCsv } from '../attendance/data'
import { COUNTERS, DRIVETRAINS, ENDGAME, EVENT_KEY, ROLES, type Counter } from './season'

/** The event we're at until a mentor picks one in the app, from season.ts, for other modules. */
export { EVENT_KEY }

// ---------------------------------------------------------------------------
// The event the team is scouting.
//
// A mentor picks it in the app (EventPicker.tsx), and every phone uses it:
// the schedule, rankings and Match 13 numbers are for it, and entries are
// saved under it. Each pick is a row in scouting_events
// (supabase/migrations/..._scouting_events.sql), and the newest one is the
// current event. Until a mentor picks one, it's EVENT_KEY from season.ts.
//
// The match form has to work with no Wi-Fi, so it never waits on the table:
// the current event is kept on this phone too (eventStore), and EventSync
// in EventPicker.tsx keeps that copy up to date while Scouting is open.

/** One time a mentor picked the event. */
export interface ScoutingEvent {
  id: string
  /** Like 2026ilch. */
  event_key: string
  /** Like "Midwest Regional". */
  name: string
  created_at: string
  created_by: string | null
}

/** Every time a mentor picked the event, newest first. */
export const eventsTable = createTable<ScoutingEvent>('scouting_events', {
  demo: [{ id: '00000000-0000-4000-8000-0000000e0201', event_key: EVENT_KEY, name: 'Example Regional', created_at: '2026-11-01T18:00:00Z', created_by: DEMO_PEOPLE.pat }],
  sort: newestFirst,
  keepOffline: true,
})

/** The event the team is scouting: its key, and its name once a mentor has picked it in the app. */
export interface CurrentEvent {
  key: string
  name: string | null
}

/** This phone's copy of the current event. Empty until Scouting has been open with a connection. */
export const eventStore = createStore<CurrentEvent | null>('scouting-event', 1, () => null)

/** The newest pick in the table, or nothing if a mentor hasn't picked one. */
export function latestEvent(rows: ScoutingEvent[]): CurrentEvent | null {
  const latest = rows[0]
  return latest ? { key: latest.event_key, name: latest.name } : null
}

/** The event the team is scouting, like 2026ilch. For code outside a page; pages use useCurrentEvent(). */
export function currentEvent(): string {
  return eventStore.get()?.key ?? EVENT_KEY
}

/** The event the team is scouting, for a page. It redraws when a mentor picks another event. */
export function useCurrentEvent(): CurrentEvent {
  return useStore(eventStore) ?? { key: EVENT_KEY, name: null }
}

/** Pick the event the whole team scouts. Only mentors and admins can; the database's rules check that too. */
export async function chooseEvent(event: Pick<TbaEvent, 'key' | 'name'>): Promise<Result<CurrentEvent>> {
  const role = currentUser()?.role
  if (!role || !isMentor(role)) return fail('Only a mentor can change the event. Ask a mentor to pick it.')
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
// Entries, saved on this device.

/** Whether the robot was stopped during the match. These are FRC rules, so they don't change with the game. */
export const STOPS = ['None', 'A-stop', 'E-stop'] as const
export type Stop = (typeof STOPS)[number]

/** Driver skill, from 1 (struggles to drive) to 5 (smooth and quick). */
export const DRIVER_SKILLS = [1, 2, 3, 4, 5]

/**
 * What a scout recorded for one robot in one match.
 *
 * Entries saved before roles, broke_down, stop and driver_skill were added
 * don't have them, and have a defense field instead. Syncing must fill in
 * the missing ones rather than assume every entry has them.
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
  /** The robot stopped working or lost a mechanism. */
  broke_down: boolean
  stop: Stop
  /** One of DRIVER_SKILLS. */
  driver_skill: number
  notes: string
  /** Who scouted it. Show their name with useMemberNames(). */
  scouted_by: string | null
  /** False while it's only on this device (Waiting). */
  synced: boolean
}

/** What the scout fills in on the form. saveEntry() adds the rest. */
export type EntryFields = Pick<Entry, 'match' | 'team' | 'counts' | 'endgame' | 'roles' | 'broke_down' | 'stop' | 'driver_skill' | 'notes'>

// Newest first. keepOnReset: "Reset example data" must never delete real
// scouting. Don't raise the version while entries are waiting on people's
// devices: copies saved under the old version are ignored.
export const entryStore = createStore<Entry[]>('scouting-entries', 1, () => [], { keepOnReset: true })

/** Every entry saved on this device, newest first. */
export function useEntries(): Entry[] {
  return useStore(entryStore)
}

/** The home page tile's status. Pit entries count too. */
export function useEntrySummary(): Notice {
  const entries = [...useEntries(), ...usePitEntries()]
  const waiting = entries.filter((e) => !e.synced).length
  if (waiting > 0) return { tone: 'info', text: plural(waiting, 'entry waiting', 'entries waiting') }
  return { tone: 'plain', text: entries.length === 0 ? 'No entries on this device' : `${plural(entries.length, 'entry', 'entries')} saved` }
}

const isCount = (value: number) => Number.isInteger(value) && value > 0

// The team database allows the same: see the checks in the scouting_entries
// migration. An entry it would refuse could never sync, so refuse it here.
export const MAX_MATCH = 1000
export const MAX_TEAM = 99999
export const MAX_NOTES_LENGTH = 1000

/** Why an entry can't be saved, or null if it can. */
export function checkEntry(fields: EntryFields): string | null {
  if (!isCount(fields.team)) return 'Enter the team number first.'
  if (fields.team > MAX_TEAM) return `Check the team number: ${fields.team} is too big.`
  if (!isCount(fields.match)) return 'Enter the match number first.'
  if (fields.match > MAX_MATCH) return `Check the match number: ${fields.match} is too big.`
  if (!DRIVER_SKILLS.includes(fields.driver_skill)) return 'Choose a driver skill first.'
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
  broke_down: boolean
  stop: Stop
  /** 1 to 5. Empty for entries saved before driver skill was on the form. */
  driver_skill: number | null
  notes: string | null
  /** Who scouted it, and when, on their phone. */
  scouted_by: string | null
  scouted_at: string
  /** Who sent it. Usually the scout, but a shared phone can send someone else's entries. */
  created_by: string | null
}

// Made up, for demo mode. Team numbers in the 9990s, so nobody mistakes them for real scouting.
const EXAMPLE_ENTRIES: ScoutingEntry[] = [
  { id: '00000000-0000-4000-8000-0000000d0001', event_key: EVENT_KEY, match_number: 1, team_number: 9991, counts: { autoFuel: 3, teleopFuel: 12, fuelMissed: 4 }, endgame: 'Level 2', roles: ['Scorer'], broke_down: false, stop: 'None', driver_skill: 4, notes: 'Fast intake', scouted_by: DEMO_PEOPLE.jordan, scouted_at: '2026-11-07T15:02:00Z', created_at: '2026-11-07T15:03:00Z', created_by: DEMO_PEOPLE.jordan },
  { id: '00000000-0000-4000-8000-0000000d0002', event_key: EVENT_KEY, match_number: 1, team_number: 9992, counts: { autoFuel: 0, teleopFuel: 5, fuelMissed: 1 }, endgame: 'None', roles: ['Defender'], broke_down: true, stop: 'A-stop', driver_skill: 2, notes: null, scouted_by: DEMO_PEOPLE.alex, scouted_at: '2026-11-07T15:02:30Z', created_at: '2026-11-07T15:04:00Z', created_by: DEMO_PEOPLE.alex },
]

export const entriesTable = createTable<ScoutingEntry>('scouting_entries', { demo: EXAMPLE_ENTRIES, sort: newestFirst })

/** An entry saved on a phone before roles, broke down, stop and driver skill were on the form (#28). */
type OlderEntry = Omit<Entry, 'roles' | 'broke_down' | 'stop' | 'driver_skill'> &
  Partial<Pick<Entry, 'roles' | 'broke_down' | 'stop' | 'driver_skill'>> & { defense?: boolean }

/**
 * An entry from this device, as a row for the team database. Entries saved
 * before #28 have "played defense" instead of roles: it becomes the
 * Defender role, the way the form treats it now. Their other new fields are
 * left at "no", "None" and empty.
 */
export function toRow(saved: Entry | OlderEntry): Omit<ScoutingEntry, 'created_at' | 'created_by'> {
  const entry = saved as OlderEntry
  return {
    id: entry.id,
    event_key: entry.event_key ?? currentEvent(),
    match_number: entry.match,
    team_number: entry.team,
    counts: entry.counts,
    endgame: entry.endgame,
    roles: entry.roles ?? (entry.defense ? ['Defender'] : []),
    broke_down: entry.broke_down ?? false,
    stop: entry.stop ?? 'None',
    driver_skill: entry.driver_skill ?? null,
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

/** Whether any match or pit entry on this device is Waiting. */
function hasWaiting(): boolean {
  return entryStore.get().some((e) => !e.synced) || pitStore.get().some((e) => !e.synced)
}

/** Stop sending, and show why on the page. */
function stopSending(problem: string): Result<number> {
  syncStatus.set({ sending: false, problem })
  return fail(problem)
}

// Sends match entries, then pit entries.
async function send(): Promise<Result<number>> {
  if (!hasWaiting()) return ok(0)
  if (globalThis.navigator?.onLine === false) return stopSending(NO_CONNECTION)
  if (!currentUser()) return fail('Sign in to send your entries.')

  syncStatus.set({ sending: true, problem: syncStatus.get().problem })
  const matches = await sendWaiting(entryStore, entriesTable, toRow)
  if (!matches.ok) return stopSending(matches.error)
  const pits = await sendWaiting(pitStore, pitTable, pitToRow)
  if (!pits.ok) return stopSending(pits.error)
  syncStatus.set({ sending: false, problem: null })
  return ok(matches.value + pits.value)
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
  /** The qualification match it was before, or null: pit scouting often happens before any match. */
  match: number | null
  /** One of DRIVETRAINS in season.ts, or '' if not chosen. */
  drivetrain: string
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
export type PitFields = Omit<PitEntry, 'id' | 'created_at' | 'event_key' | 'scouted_by' | 'synced'>

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
  if (fields.match !== null && !(isCount(fields.match) && fields.match <= MAX_MATCH)) return 'Check the match number, or leave it blank.'
  for (const [name, value] of [['weight', fields.weight], ['length', fields.length], ['width', fields.width], ['height', fields.height]] as const) {
    if (value !== null && !(value > 0 && value < MAX_PIT_NUMBER)) return `Check the ${name}, or leave it blank.`
  }
  // The same limits as the team database, so an entry can't get stuck Waiting.
  for (const [name, text] of [['motors', fields.motors], ['auto path', fields.auto_path], ['first strategy answer', fields.partners_do], ['second strategy answer', fields.they_do]] as const) {
    const length = text.trim().length
    if (length > MAX_NOTES_LENGTH) return `Keep the ${name} under ${MAX_NOTES_LENGTH} characters. This one is ${length}.`
  }
  return null
}

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
  { id: '00000000-0000-4000-8000-0000000d0101', event_key: EVENT_KEY, team_number: 9991, match_number: null, drivetrain: 'Swerve', weight: 118.5, length: 28, width: 28, height: 22, motors: '8 Kraken X60 on swerve, 2 on the shooter', auto_side: 'Center', auto_path: 'Scores preload, picks up 2 from the middle', partners_do: 'Feed us fuel', they_do: 'Score from the hub', scouted_by: DEMO_PEOPLE.jordan, scouted_at: '2026-11-06T22:10:00Z', created_at: '2026-11-06T22:11:00Z', created_by: DEMO_PEOPLE.jordan },
  { id: '00000000-0000-4000-8000-0000000d0102', event_key: EVENT_KEY, team_number: 9992, match_number: null, drivetrain: 'Tank', weight: null, length: null, width: null, height: null, motors: null, auto_side: 'Left', auto_path: null, partners_do: null, they_do: 'Play defense', scouted_by: DEMO_PEOPLE.alex, scouted_at: '2026-11-06T22:20:00Z', created_at: '2026-11-06T22:21:00Z', created_by: DEMO_PEOPLE.alex },
]

export const pitTable = createTable<ScoutingPitEntry>('scouting_pit_entries', { demo: EXAMPLE_PIT_ENTRIES, sort: newestFirst })

/** A pit entry from this device, as a row for the team database. Blank choices and boxes are sent as empty (null). */
export function pitToRow(entry: PitEntry): Omit<ScoutingPitEntry, 'created_at' | 'created_by'> {
  const text = (value: string) => value.trim() || null
  return {
    id: entry.id,
    event_key: entry.event_key ?? currentEvent(),
    team_number: entry.team,
    match_number: entry.match,
    drivetrain: text(entry.drivetrain),
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
  /** Newest first. */
  written: WrittenAnswer[]
}

/** A pit entry's written answers, leaving out the blank ones. The drivetrain is counted in pitDrivetrain() instead. */
export function pitAnswers(pit: PitRow): WrittenAnswer[] {
  const size = [pit.length, pit.width, pit.height].every((n) => n === null) ? '' : `${pit.length ?? '?'} × ${pit.width ?? '?'} × ${pit.height ?? '?'} inches (length × width × height)`
  const answers: [question: string, text: string | null][] = [
    ['Weight', pit.weight === null ? '' : `${pit.weight} pounds`],
    ['Size', size],
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

/** A pit entry's drivetrain, or null if the scout didn't choose one. */
export function pitDrivetrain(pit: PitRow): string | null {
  return pit.drivetrain?.trim() || null
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

  const notes: WrittenAnswer[] = mine.flatMap((e) =>
    e.notes?.trim() ? [{ kind: 'match' as const, question: 'Notes', text: e.notes.trim(), match: e.match_number, by: e.scouted_by, at: e.scouted_at }] : [],
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
    brokeDown: mine.filter((e) => e.broke_down).length,
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
  // Only the current event's, so the sums change when a mentor picks another event.
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
 * then each counter in season.ts. Not Match 13's total as well: it's the
 * three parts added up, so weighting it too would count xP twice. A new
 * counter in season.ts shows up here by itself.
 */
export function picklistParts(): PicklistPart[] {
  return [
    { key: 'xAuto', label: 'Match 13 auto', lowerIsBetter: false },
    { key: 'xTele', label: 'Match 13 teleop', lowerIsBetter: false },
    { key: 'xEnd', label: 'Match 13 endgame', lowerIsBetter: false },
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
  const [ratings, rankings] = await Promise.all([getRatings(event), getRankings(event)])
  const notRatedYet = !ratings.ok && NOT_RATED_YET.test(ratings.error)
  const rated: Result<Match13Rating[]> = notRatedYet ? ok([]) : ratings
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
  }))
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
// only mentors and admins can change it (the rules in
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
