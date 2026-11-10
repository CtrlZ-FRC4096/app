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
import { callFunction } from '../../core/functions'
import { plural } from '../../core/format'
import type { Notice } from '../../core/registry'
import { currentUser } from '../../core/session'
import { DEMO_PEOPLE } from '../../core/demo'
import { createStore, useStore, type Store } from '../../core/store'
import { createTable, fail, newestFirst, ok, type Fields, type Result, type Row, type Table } from '../../core/table'
import { EVENT_KEY } from './season'

/** The event we're at, from season.ts, for other modules. */
export { EVENT_KEY }

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
   * was added don't have one; they're sent with today's EVENT_KEY.
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
    event_key: EVENT_KEY,
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
    event_key: entry.event_key ?? EVENT_KEY,
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
  /** The event, like 2026ilch. Pit entries saved before this was added don't have one; they're sent with today's EVENT_KEY. */
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
    event_key: EVENT_KEY,
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
    event_key: entry.event_key ?? EVENT_KEY,
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
export async function getSchedule(event = EVENT_KEY): Promise<Result<TbaMatch[]>> {
  const result = await callFunction<TbaMatch[] | null>('tba', { kind: 'schedule', event }, () => demoMatches(event))
  return result.ok ? ok(result.value ?? []) : result
}

/** The event's rankings, best first. Empty until the event starts. */
export async function getRankings(event = EVENT_KEY): Promise<Result<TbaRanking[]>> {
  const result = await callFunction<{ rankings: TbaRanking[] } | null>('tba', { kind: 'rankings', event }, () => ({ rankings: demoRankings() }))
  return result.ok ? ok(result.value?.rankings ?? []) : result
}

/** One team's matches at the event, with their videos. */
export async function getTeamMatches(team: number, event = EVENT_KEY): Promise<Result<TbaMatchWithVideos[]>> {
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
export async function getEventTeams(event = EVENT_KEY): Promise<Result<TbaTeam[]>> {
  const result = await callFunction<TbaTeam[] | null>('tba', { kind: 'teams', event }, () => DEMO_TEAMS.map(([team]) => demoTeam(team)))
  return result.ok ? ok([...(result.value ?? [])].sort((a, b) => a.team_number - b.team_number)) : result
}

/** A team's page on The Blue Alliance, for the season of `event` (like 2026ilch → 2026). */
export function tbaTeamUrl(team: number, event = EVENT_KEY): string {
  return `https://www.thebluealliance.com/team/${team}/${event.slice(0, 4)}`
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
export async function getRatings(event = EVENT_KEY): Promise<Result<Match13Rating[]>> {
  const result = await callFunction<{ teams: Match13Rating[] } | null>('match13', { kind: 'ratings', event }, () => ({ teams: demoRatings() }))
  if (!result.ok) return result
  return ok([...(result.value?.teams ?? [])].sort((a, b) => b.xpEnd - a.xpEnd || a.teamNumber - b.teamNumber))
}

/** Match 13's prediction for each of the event's matches. */
export async function getPredictions(event = EVENT_KEY): Promise<Result<MatchPrediction[]>> {
  const result = await callFunction<Match13Matches | null>('match13', { kind: 'predictions', event }, () => demoPredictions(event))
  if (!result.ok) return result
  return ok(
    (result.value?.matches ?? []).map(({ key, pred }) => ({ key, redWinChance: pred.winProb, redScore: pred.redScore, blueScore: pred.blueScore })),
  )
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
export function savedSchedule(event = EVENT_KEY): SavedSchedule | null {
  const saved = scheduleStore.get()
  return saved?.event === event ? saved : null
}

export function useSavedSchedule(event = EVENT_KEY): SavedSchedule | null {
  const saved = useStore(scheduleStore)
  return saved?.event === event ? saved : null
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
export function refreshSchedule(event = EVENT_KEY): Promise<Result<SavedSchedule>> {
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
export function keepScheduleFresh(event = EVENT_KEY): () => void {
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
    .map(([team_key, r], i) => ({ rank: i + 1, team_key, record: r, matches_played: r.wins + r.losses + r.ties }))
}
