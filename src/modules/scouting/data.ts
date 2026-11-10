/**
 * Scouting module data.
 *
 * Entries: what a scout counted for one robot in one match. Venue Wi-Fi is
 * unreliable, so an entry is saved on this device first, in a store, and
 * marked as not synced. Sending entries to the team database comes later.
 * This is why entries aren't in a table from createTable(): on the live
 * site a table saves straight to the database, which needs a connection.
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
import { createStore, useStore } from '../../core/store'
import { fail, ok, type Result } from '../../core/table'
import { EVENT_KEY } from './season'

// ---------------------------------------------------------------------------
// Entries, saved on this device.

/** What a scout recorded for one robot in one match. */
export interface Entry {
  /** Made on the device, so sending an entry twice can't make two rows. */
  id: string
  /** ISO date and time it was saved. */
  created_at: string
  /** The qualification match number. */
  match: number
  /** The team number, like 4096. */
  team: number
  /** The count for each counter in season.ts, by its key. */
  counts: Record<string, number>
  /** One of ENDGAME in season.ts. */
  endgame: string
  defense: boolean
  notes: string
  /** Who scouted it. Show their name with useMemberNames(). */
  scouted_by: string | null
  /** False while it's only on this device (Waiting). */
  synced: boolean
}

/** What the scout fills in on the form. saveEntry() adds the rest. */
export type EntryFields = Pick<Entry, 'match' | 'team' | 'counts' | 'endgame' | 'defense' | 'notes'>

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
    .map(([team_key, r], i) => ({ rank: i + 1, team_key, record: r, matches_played: r.wins + r.losses + r.ties }))
}
