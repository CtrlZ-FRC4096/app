/**
 * Scouting module data.
 *
 * Entries: what a scout counted for one robot in one match. Venue Wi-Fi is
 * unreliable, so an entry is saved on this device first, in a store, and
 * marked as not synced (Waiting). That's why saving doesn't use a table
 * from createTable(): on the live site a table saves straight to the
 * database, which needs a connection.
 *
 * Syncing: syncEntries() sends Waiting entries to the scouting_entries
 * table (entriesTable below), where everyone on the team can see them, and
 * marks them Synced. It runs after each save, when the connection comes
 * back, and every minute while anything is Waiting. The table and its rules
 * are in supabase/migrations/..._scouting_entries.sql.
 *
 * The Blue Alliance (TBA): an event's match schedule and rankings, and a
 * team's matches and name. These come through the `tba` server function
 * (supabase/functions/tba/), which holds the team's TBA key, so the key is
 * never in the browser. In demo mode they return the made-up example data
 * below instead, so pages can be built without a key.
 *
 * The types are the parts of TBA's answers we use. TBA sends more; see
 * https://www.thebluealliance.com/apidocs/v3 for everything.
 */
import { useSyncExternalStore } from 'react'
import { callFunction } from '../../core/functions'
import { plural } from '../../core/format'
import type { Notice } from '../../core/registry'
import { currentUser } from '../../core/session'
import { createStore, useStore } from '../../core/store'
import { supabase } from '../../core/supabase'
import { createTable, explain, fail, ok, type Fields, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'
import { EVENT_KEY } from './season'

// ---------------------------------------------------------------------------
// Entries, saved on this device.

/** Whether the robot was stopped during the match. These are FRC rules, so they don't change with the game. */
export const STOPS = ['None', 'A-stop', 'E-stop'] as const
export type Stop = (typeof STOPS)[number]

/** Driver skill, from 1 (struggles to drive) to 5 (smooth and quick). */
export const DRIVER_SKILLS = [1, 2, 3, 4, 5]

/** The database allows up to this many characters of notes. */
export const MAX_NOTES_LENGTH = 1000

/**
 * What a scout recorded for one robot in one match.
 *
 * Entries saved before event, roles, broke_down, stop and driver_skill were
 * added don't have them, and have a defense field instead. toTeamEntry()
 * fills in the missing ones when they're sent.
 */
export interface Entry {
  /** Made on the device, so sending an entry twice can't make two rows. */
  id: string
  /** ISO date and time it was saved. */
  created_at: string
  /** EVENT_KEY from season.ts when it was saved, like 2026ilch. */
  event: string
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

/** Why an entry can't be saved, or null if it can. */
export function checkEntry(fields: EntryFields): string | null {
  if (!isCount(fields.team)) return 'Enter the team number first.'
  if (!isCount(fields.match)) return 'Enter the match number first.'
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
    event: EVENT_KEY,
    scouted_by: currentUser()?.id ?? null,
    synced: false,
  }
  entryStore.set((entries) => [entry, ...entries])
  return ok(entry)
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
// Syncing: entries the team can see, in the team database.

/** One row of the scouting_entries table: a synced entry. The fields match its columns. */
export interface TeamEntry extends Row {
  /** Who scouted it: the entry's scouted_by. Show their name with useMemberNames(). */
  created_by: string | null
  event: string
  match: number
  team: number
  counts: Record<string, number>
  endgame: string
  roles: string[]
  broke_down: boolean
  stop: Stop
  /** Null only for entries saved before driver skill was on the form. */
  driver_skill: number | null
  notes: string
}

const EXAMPLE_TEAM_ENTRIES: TeamEntry[] = [
  {
    id: '00000000-0000-4000-8000-0000005c0001',
    created_at: '2026-03-13T15:09:00Z',
    created_by: DEMO_PEOPLE.alex,
    event: EVENT_KEY,
    match: 1,
    team: 9991,
    counts: { autoFuel: 4, teleopFuel: 18, fuelMissed: 3 },
    endgame: 'Level 2',
    roles: ['Scorer'],
    broke_down: false,
    stop: 'None',
    driver_skill: 4,
    notes: 'Quick to line up shots.',
  },
  {
    id: '00000000-0000-4000-8000-0000005c0002',
    created_at: '2026-03-13T15:10:00Z',
    created_by: DEMO_PEOPLE.jordan,
    event: EVENT_KEY,
    match: 1,
    team: 9993,
    counts: { autoFuel: 0, teleopFuel: 6, fuelMissed: 5 },
    endgame: 'None',
    roles: ['Defender'],
    broke_down: true,
    stop: 'None',
    driver_skill: 2,
    notes: 'Intake stopped working halfway through.',
  },
]

export const entriesTable = createTable<TeamEntry>('scouting_entries', { demo: EXAMPLE_TEAM_ENTRIES })

/**
 * An entry as a row for the table. Entries saved before some fields were on
 * the form get the same values a new form starts with, and this event.
 */
export function toTeamEntry(entry: Entry): TeamEntry {
  // Older entries are missing fields their type says they have.
  const saved: Partial<Entry> = entry
  return {
    id: entry.id,
    created_at: entry.created_at,
    created_by: entry.scouted_by,
    event: saved.event ?? EVENT_KEY,
    match: entry.match,
    team: entry.team,
    counts: entry.counts,
    endgame: entry.endgame,
    roles: saved.roles ?? [],
    broke_down: saved.broke_down ?? false,
    stop: saved.stop ?? 'None',
    driver_skill: saved.driver_skill ?? null,
    notes: entry.notes,
  }
}

/**
 * False when the phone knows it has no connection. Phones can also say
 * they're connected to venue Wi-Fi that has no internet, so a true here
 * doesn't promise sending will work.
 */
export function isOnline(): boolean {
  return globalThis.navigator?.onLine !== false
}

/** isOnline() for a page. The page redraws when the connection comes or goes. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, () => true)
}

function subscribeOnline(listener: () => void) {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/**
 * The Waiting entries the signed-in person can send. The database only
 * takes someone's own entries, so on a phone shared by scouts, each
 * person's entries wait until they sign in.
 */
export function entriesToSend(entries: Entry[], userId: string | null | undefined): Entry[] {
  return entries.filter((e) => !e.synced && userId != null && e.scouted_by === userId)
}

let sending: Promise<Result<number>> | null = null

/**
 * Send the signed-in person's Waiting entries to the team database, then
 * mark them Synced. Returns how many were sent. If it fails, they stay
 * Waiting, to try again later. If it's already sending, this waits for that.
 */
export function syncEntries(): Promise<Result<number>> {
  sending ??= sendWaiting().finally(() => {
    sending = null
  })
  return sending
}

async function sendWaiting(): Promise<Result<number>> {
  const toSend = entriesToSend(entryStore.get(), currentUser()?.id)
  if (toSend.length === 0) return ok(0)
  if (!isOnline()) return fail("No connection. Entries will send when it's back.")
  const rows = toSend.map(toTeamEntry)
  if (supabase) {
    // All at once. An id the database already has was sent before, perhaps
    // just as the connection dropped, so it's skipped instead of failing.
    const { error } = await supabase.from(entriesTable.name).upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    if (error) return fail(explain(error))
  } else {
    // Demo mode: add them to the example table, skipping ids it has, like
    // the database does. The rows keep their own id and created_at, which
    // the demo table's insert leaves alone.
    const have = new Set(entriesTable.rows().map((row) => row.id))
    for (const row of rows.filter((r) => !have.has(r.id))) {
      const result = await entriesTable.insert(row as Fields<TeamEntry>)
      if (!result.ok) return result
    }
  }
  const sent = new Set(toSend.map((e) => e.id))
  entryStore.set((entries) => entries.map((e) => (sent.has(e.id) ? { ...e, synced: true } : e)))
  return ok(sent.size)
}

// Keep trying in the background. Not in the tests, which have no window.
const RETRY_MS = 60_000
if (typeof window !== 'undefined') {
  const retry = () => void syncEntries()
  window.addEventListener('online', retry)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retry()
  })
  setInterval(retry, RETRY_MS)
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
