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
import { useEffect } from 'react'
import { callFunction } from '../../core/functions'
import { plural, shortDate } from '../../core/format'
import type { Notice } from '../../core/registry'
import { currentUser } from '../../core/session'
import { DEMO_PEOPLE } from '../../core/demo'
import { createStore, useStore } from '../../core/store'
import { createTable, fail, newestFirst, ok, type Result, type Row } from '../../core/table'
import { EVENT_KEY } from './season'

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

/** The home page tile's status. */
export function useEntrySummary(): Notice {
  const entries = useEntries()
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
 * Send every Waiting entry to the team database, and mark them Synced.
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

async function send(): Promise<Result<number>> {
  const waiting = entryStore.get().filter((e) => !e.synced)
  if (waiting.length === 0) return ok(0)
  if (globalThis.navigator?.onLine === false) {
    syncStatus.set({ sending: false, problem: NO_CONNECTION })
    return fail(NO_CONNECTION)
  }
  if (!currentUser()) return fail('Sign in to send your entries.')

  syncStatus.set({ sending: true, problem: syncStatus.get().problem })
  const result = await entriesTable.insertOnce(waiting.map(toRow))
  if (!result.ok) {
    syncStatus.set({ sending: false, problem: result.error })
    return result
  }
  // Mark only the ones just sent: entries saved while sending stay Waiting.
  const sent = new Set(waiting.map((e) => e.id))
  entryStore.set((entries) => entries.map((e) => (sent.has(e.id) ? { ...e, synced: true } : e)))
  syncStatus.set({ sending: false, problem: null })
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
    if (entryStore.get().some((e) => !e.synced)) void syncEntries()
  }
  globalThis.addEventListener('online', tryNow)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tryNow()
  })
  setInterval(tryNow, RETRY_MS)
  setTimeout(tryNow, 0)
}

// Only in a browser: the tests call syncEntries() themselves.
if (typeof window !== 'undefined' && typeof document !== 'undefined') keepSyncing()

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
export type PitFields = Omit<PitEntry, 'id' | 'created_at' | 'scouted_by' | 'synced'>

// Newest first. keepOnReset and the version: see entryStore above.
export const pitStore = createStore<PitEntry[]>('scouting-pit-entries', 1, () => [], { keepOnReset: true })

/** Every pit entry saved on this device, newest first. */
export function usePitEntries(): PitEntry[] {
  return useStore(pitStore)
}

/** Why a pit entry can't be saved, or null if it can. */
export function checkPitEntry(fields: PitFields): string | null {
  if (!isCount(fields.team)) return 'Enter the team number first.'
  if (fields.match !== null && !isCount(fields.match)) return 'Check the match number, or leave it blank.'
  for (const [name, value] of [['weight', fields.weight], ['length', fields.length], ['width', fields.width], ['height', fields.height]] as const) {
    if (value !== null && !(value > 0)) return `Check the ${name}, or leave it blank.`
  }
  return null
}

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
    scouted_by: currentUser()?.id ?? null,
    synced: false,
  }
  pitStore.set((entries) => [entry, ...entries])
  return ok(entry)
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
export async function refreshRankings(event = EVENT_KEY): Promise<Result<SavedRankings>> {
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
export function watchRankings(event = EVENT_KEY): () => void {
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
  useEffect(() => watchRankings(), [])
  const saved = useStore(rankingsStore)
  const status = useStore(rankingsStatus)
  return { saved: saved?.event === EVENT_KEY ? saved : null, status }
}

/** One team's ranking, or null if they aren't ranked. For the team page. */
export function rankOf(rankings: TbaRanking[], team: number): TbaRanking | null {
  return rankings.find((r) => r.team_key === `frc${team}`) ?? null
}

/** "Updated 2 minutes ago", from when the rankings were checked. */
export function updatedAgo(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${plural(minutes, 'minute', 'minutes')} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Updated ${plural(hours, 'hour', 'hours')} ago`
  return `Updated ${shortDate(iso)}`
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
const DEMO_RATINGS: [team: number, start: number, end: number][] = [
  [9993, 31.2, 30.4],
  [4096, 44.0, 48.6],
  [9995, 20.1, 22.8],
  [9991, 40.3, 41.7],
  [9994, 27.5, 26.1],
  [9992, 33.9, 35.2],
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
