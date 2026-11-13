/**
 * Prescouting module data.
 *
 * Before an event, the scouting team looks up every team that's coming
 * (#116), writes down what we know about each one (#117), and stars the
 * ones they care about, for themselves or the whole team (#118).
 *
 * The teams come from The Blue Alliance and their EPA from Match 13, both
 * through the Scouting module's data.ts, which holds those server
 * functions. Our notes are in the prescouting_notes table.
 */
import { useEffect } from 'react'
import { href } from '../../core/router'
import { DEMO_PEOPLE } from '../../core/demo'
import { createStore, useStore } from '../../core/store'
import { isMentor } from '../../core/roles'
import { currentUser } from '../../core/session'
import { createTable, fail, ok, type Result, type Row } from '../../core/table'
import {
  COUNTERS, ENDGAME, EVENT_KEY, MAX_TEAM, getEventTeams, getRatings, matchLabel, tbaTeamUrl, videoLink,
  type Counter, type Match13Rating, type TbaMatchWithVideos, type TbaTeam,
} from '../scouting/data'

// ---------------------------------------------------------------------------
// The teams at an event (#116).

/** One team in the prescouting list. */
export interface PrescoutTeam {
  team: number
  name: string
  /** Statbotics' EPA, from Match 13, or null if there isn't one yet. */
  epa: number | null
  /** Their page on The Blue Alliance. */
  tbaUrl: string
}

/**
 * The event the prescouting list is for, remembered on this device. Each
 * Championship division is its own event with its own key, so this can be
 * a division. Starts as EVENT_KEY from season.ts.
 */
export const prescoutEventStore = createStore<string>('prescouting-event', 1, () => EVENT_KEY, { keepOnReset: true })

export function usePrescoutEvent(): string {
  return useStore(prescoutEventStore)
}

/** An event key the way TBA writes them: the year and a short code, like 2026ilch. Same rule as the tba function. */
export function isEventKey(key: string): boolean {
  return /^\d{4}[a-z0-9]{1,16}$/.test(key)
}

/** Tidy what someone typed into an event key: no spaces, all lowercase. */
export function cleanEventKey(typed: string): string {
  return typed.trim().toLowerCase()
}

const NOT_AN_EVENT_KEY = 'Type an event key like 2026ilch: the year, then the short code from the end of its page address on thebluealliance.com.'

/** Choose the prescouting event on this device. Gives back the tidied key, or what to fix. */
export function setPrescoutEvent(typed: string): Result<string> {
  const key = cleanEventKey(typed)
  if (!isEventKey(key)) return fail(NOT_AN_EVENT_KEY)
  prescoutEventStore.set(key)
  return ok(key)
}

/** Put each team's EPA next to them, sorted by team number. A team Match 13 doesn't have gets null. */
export function prescoutList(teams: TbaTeam[], ratings: Match13Rating[], event: string): PrescoutTeam[] {
  const epa = new Map(ratings.map((r) => [r.teamNumber, r.epa]))
  return teams
    .map((t) => ({ team: t.team_number, name: t.nickname, epa: epa.get(t.team_number) ?? null, tbaUrl: tbaTeamUrl(t.team_number, event) }))
    .sort((a, b) => a.team - b.team)
}

/**
 * The prescouting list for an event: its teams from The Blue Alliance, with
 * EPA from Match 13. If Match 13 has no ratings yet (often true before the
 * event), the teams still show, with no EPA.
 */
export async function loadPrescoutTeams(event: string): Promise<Result<PrescoutTeam[]>> {
  if (!isEventKey(event)) return fail(NOT_AN_EVENT_KEY)
  const [teams, ratings] = await Promise.all([getEventTeams(event), getRatings(event)])
  if (!teams.ok) return teams
  if (teams.value.length === 0) return fail("The Blue Alliance doesn't list any teams for this event yet. Check the event key, or try again closer to the event.")
  return ok(prescoutList(teams.value, ratings.ok ? ratings.value : [], event))
}

// Each event's list, kept while the app is open, so going from a team's
// page back to the list doesn't load it again. Not saved on the phone.
const teamLists = createStore<Record<string, Result<PrescoutTeam[]>>>('prescouting-teams', 1, () => ({}), { persist: false, keepOnReset: true })
const loadingLists = new Set<string>()

/** Load an event's prescouting list again, such as after it failed. */
export async function reloadPrescoutTeams(event: string): Promise<void> {
  if (loadingLists.has(event)) return
  loadingLists.add(event)
  teamLists.set((lists) => Object.fromEntries(Object.entries(lists).filter(([key]) => key !== event)))
  const result = await loadPrescoutTeams(event)
  loadingLists.delete(event)
  teamLists.set((lists) => ({ ...lists, [event]: result }))
}

/** An event's prescouting list for a page: null while it loads. */
export function usePrescoutTeams(event: string): Result<PrescoutTeam[]> | null {
  const result = useStore(teamLists)[event] ?? null
  useEffect(() => {
    if (!result) void reloadPrescoutTeams(event)
  }, [event, result])
  return result
}

// ---------------------------------------------------------------------------
// Prescouting notes (#117): what we know about each team before the event,
// written by anyone on the team. One row per team per event, in the
// prescouting_notes table (supabase/migrations/..._prescouting_notes.sql,
// rules tested in supabase/tests/prescouting-notes.test.ts). Prescouting
// happens before the event, with Wi-Fi, so it saves straight to the table.

/** One row of the prescouting_notes table. */
export interface PrescoutNotes extends Row {
  event_key: string
  team_number: number
  /** A summary, like "Strong scorer, inconsistent climb, good second pick" (#153). */
  overall: string
  strengths: string
  weaknesses: string
  /** The main job they do in a match, like scoring in auto or playing defense. */
  key_task: string
  /** Where they start, and what their auto does. */
  auto_paths: string
  /** How they've done this season, like their results at earlier events. */
  performance: string
  other_notes: string
  /**
   * The old shared Mark. No longer used: stars replaced it (#118), and the
   * stars migration turned every mark into a team star.
   */
  marked: boolean
  /** Who started the notes for this team. */
  created_by: string | null
}

/** The answers to the prescouting questions. */
export type PrescoutAnswers = Pick<PrescoutNotes, 'overall' | 'strengths' | 'weaknesses' | 'key_task' | 'auto_paths' | 'performance' | 'other_notes'>

/** The questions, in the order the page asks them. */
export const PRESCOUT_QUESTIONS: { key: keyof PrescoutAnswers; label: string; hint: string }[] = [
  { key: 'overall', label: 'Overall', hint: 'A summary, like: strong scorer, inconsistent climb, good second pick' },
  { key: 'strengths', label: 'Strengths', hint: 'What they do well' },
  { key: 'weaknesses', label: 'Weaknesses', hint: 'What they struggle with' },
  { key: 'key_task', label: 'Key task', hint: 'Their main job in a match, like scoring in auto or playing defense' },
  { key: 'auto_paths', label: 'Expected auto paths', hint: 'Where they start, and what their auto does' },
  { key: 'performance', label: 'Performance', hint: "How they've done this season, like their results at earlier events" },
  { key: 'other_notes', label: 'Other notes', hint: 'Anything else' },
]

export const MAX_PRESCOUT_ANSWER = 2000

export const NO_ANSWERS: PrescoutAnswers = { overall: '', strengths: '', weaknesses: '', key_task: '', auto_paths: '', performance: '', other_notes: '' }

// Made up, for demo mode. Team numbers in the 9990s, so nobody mistakes them for real scouting.
const EXAMPLE_PRESCOUT: PrescoutNotes[] = [
  { id: '00000000-0000-4000-8000-0000000e0101', event_key: EVENT_KEY, team_number: 9991, overall: 'Strong scorer, slow climb. Good first pick.', strengths: 'Fast cycles from the hub. Very consistent driver.\nNever broke down at their last event.', weaknesses: 'Slow to climb', key_task: 'Scoring fuel in teleop', auto_paths: 'Starts center, scores preload, picks up 2 from the middle', performance: 'Won their first event, semifinalist at the second', other_notes: '', marked: false, created_at: '2026-11-05T19:00:00Z', created_by: DEMO_PEOPLE.jordan },
  { id: '00000000-0000-4000-8000-0000000e0102', event_key: EVENT_KEY, team_number: 9993, overall: '', strengths: 'Strong defense', weaknesses: '', key_task: 'Playing defense', auto_paths: '', performance: '', other_notes: 'Ask them about their intake in the pits', marked: false, created_at: '2026-11-05T19:20:00Z', created_by: DEMO_PEOPLE.alex },
]

// Version 2: the overall summary was added to the rows (#153).
export const prescoutTable = createTable<PrescoutNotes>('prescouting_notes', { demo: EXAMPLE_PRESCOUT, version: 2 })

/** Every team's notes for an event. */
export function usePrescoutNotes(event: string): PrescoutNotes[] {
  return prescoutTable.useRows().filter((row) => row.event_key === event)
}

function findNotes(event: string, team: number): PrescoutNotes | undefined {
  return prescoutTable.rows().find((row) => row.event_key === event && row.team_number === team)
}

/**
 * One team's prescouting at an event (#119), or null if nobody has
 * prescouted them, so other pages (like Scouting's team page) never read
 * the table themselves. A row with only a mark and no answers counts as not
 * prescouted.
 */
export function prescoutFor(rows: PrescoutNotes[], event: string, team: number): PrescoutNotes | null {
  const found = rows.find((row) => row.event_key === event && row.team_number === team) ?? null
  return hasAnswers(found) ? found : null
}

/** One team's prescouting at an event, for a page. */
export function usePrescoutFor(event: string, team: number): PrescoutNotes | null {
  return prescoutFor(prescoutTable.useRows(), event, team)
}

/** The address of a team's prescouting page, like #/prescouting/2026ilch/9991. */
export function prescoutHref(event: string, team: number): string {
  return href('prescouting', event, String(team))
}

/** Whether anyone has written any answers for this team yet. A mark alone doesn't count. */
export function hasAnswers(notes: PrescoutNotes | null | undefined): boolean {
  return !!notes && PRESCOUT_QUESTIONS.some((q) => notes[q.key].trim() !== '')
}

/**
 * Save the answers for a team at an event. The first save adds their row,
 * and later ones change it. Answers are trimmed. Whoever saves last wins,
 * so two people shouldn't edit the same team at once.
 */
export async function savePrescout(event: string, team: number, answers: PrescoutAnswers): Promise<Result<PrescoutNotes>> {
  if (!isEventKey(event)) return fail(NOT_AN_EVENT_KEY)
  if (!Number.isInteger(team) || team < 1 || team > MAX_TEAM) return fail('That team number looks wrong. Go back to the list and choose the team again.')
  const tidy = Object.fromEntries(PRESCOUT_QUESTIONS.map((q) => [q.key, (answers[q.key] ?? '').trim()])) as PrescoutAnswers
  const tooLong = PRESCOUT_QUESTIONS.find((q) => tidy[q.key].length > MAX_PRESCOUT_ANSWER)
  if (tooLong) return fail(`${tooLong.label} is too long. Keep each answer under ${MAX_PRESCOUT_ANSWER.toLocaleString('en-US')} characters.`)
  const existing = findNotes(event, team)
  if (existing) return prescoutTable.update(existing.id, tidy)
  if (PRESCOUT_QUESTIONS.every((q) => tidy[q.key] === '')) return fail('Write at least one answer before saving.')
  return prescoutTable.insert({ event_key: event, team_number: team, ...tidy, marked: false })
}

// ---------------------------------------------------------------------------
// Stars (#118): people star the teams they care about, so those teams come
// first. A star is just for the person who made it, or for the whole team;
// a star for the whole team needs a reason. Several people can star the
// same team for the whole team, each with their own reason. Stars are in
// the scouting_prescout_stars table
// (supabase/migrations/..._scouting_prescout_stars.sql, rules tested in
// supabase/tests/scouting-prescout-stars.test.ts). The database only lets
// you see team stars and your own; visibleStars() does the same for demo
// mode, which has everyone's.

/** One star on one team at one event. */
export interface PrescoutStar extends Row {
  event_key: string
  team_number: number
  /** True for the whole team, false for just the person who made it. */
  for_team: boolean
  /** Why the team should look at them. Always there for a team star. */
  reason: string | null
  /** Who starred it. Show their name with useMemberNames(). Empty for marks from before stars. */
  created_by: string | null
}

export const MAX_STAR_REASON = 500

// Made up, for demo mode. In demo mode a student is Alex, so Alex sees Jordan's
// and Pat's team stars and their own star, but not Sam's star just for Sam.
const EXAMPLE_STARS: PrescoutStar[] = [
  { id: '00000000-0000-4000-8000-0000000e0301', event_key: EVENT_KEY, team_number: 9991, for_team: true, reason: 'Fast, reliable auto. Good first pick.', created_at: '2026-11-05T19:05:00Z', created_by: DEMO_PEOPLE.jordan },
  { id: '00000000-0000-4000-8000-0000000e0302', event_key: EVENT_KEY, team_number: 9991, for_team: true, reason: 'Never broke down at their last event', created_at: '2026-11-05T19:30:00Z', created_by: DEMO_PEOPLE.pat },
  { id: '00000000-0000-4000-8000-0000000e0303', event_key: EVENT_KEY, team_number: 9993, for_team: false, reason: null, created_at: '2026-11-05T19:40:00Z', created_by: DEMO_PEOPLE.alex },
  { id: '00000000-0000-4000-8000-0000000e0304', event_key: EVENT_KEY, team_number: 9994, for_team: false, reason: null, created_at: '2026-11-05T19:50:00Z', created_by: DEMO_PEOPLE.sam },
]

export const starsTable = createTable<PrescoutStar>('scouting_prescout_stars', { demo: EXAMPLE_STARS, sort: (a, b) => a.created_at.localeCompare(b.created_at) })

/** The stars someone can see: every team star, and their own. The same rule as the database. */
export function visibleStars(stars: PrescoutStar[], me: string | null | undefined): PrescoutStar[] {
  return stars.filter((s) => s.for_team || (me != null && s.created_by === me))
}

/** The stars the signed-in person can see at an event, oldest first. */
export function useStars(event: string): PrescoutStar[] {
  const rows = starsTable.useRows()
  return visibleStars(rows, currentUser()?.id).filter((s) => s.event_key === event)
}

/**
 * Star a team, just for you (`forTeam` false) or for the whole team, which
 * needs a reason. Says what to do when something's missing.
 */
export async function starTeam(event: string, team: number, star: { forTeam: boolean; reason?: string }): Promise<Result<PrescoutStar>> {
  if (!isEventKey(event)) return fail(NOT_AN_EVENT_KEY)
  if (!Number.isInteger(team) || team < 1 || team > MAX_TEAM) return fail('That team number looks wrong. Go back to the list and choose the team again.')
  const me = currentUser()?.id
  if (!me) return fail('Sign in to star teams.')
  const reason = (star.reason ?? '').trim()
  if (star.forTeam && !reason) return fail('Say why the team should look at them.')
  if (reason.length > MAX_STAR_REASON) return fail(`Keep the reason under ${MAX_STAR_REASON} characters. It's ${reason.length}.`)
  const already = starsTable.rows().some((s) => s.event_key === event && s.team_number === team && s.created_by === me && s.for_team === star.forTeam)
  if (already) return fail(star.forTeam ? "You've already starred them for the team. Remove that star to give a new reason." : "You've already starred them for yourself.")
  return starsTable.insert({ event_key: event, team_number: team, for_team: star.forTeam, reason: reason || null })
}

/** Remove your own star on a team, of one kind. */
export async function unstarTeam(event: string, team: number, forTeam: boolean): Promise<Result> {
  const me = currentUser()?.id
  const star = starsTable.rows().find((s) => s.event_key === event && s.team_number === team && s.created_by === me && s.for_team === forTeam)
  if (!star) return fail("You haven't starred them that way.")
  return starsTable.remove(star.id)
}

/** Remove someone's team star. Mentors and admins only: the database checks too. */
export async function removeTeamStar(star: PrescoutStar): Promise<Result> {
  const user = currentUser()
  const mine = user != null && star.created_by === user.id
  if (!mine && !(star.for_team && user && isMentor(user.role))) return fail("Only mentors can remove someone else's team star.")
  return starsTable.remove(star.id)
}

// ---------------------------------------------------------------------------
// The prescouting overview: every team at a glance, starred ones first.

export const PRESCOUT_SORTS = ['Team number', 'EPA'] as const
export type PrescoutSort = (typeof PRESCOUT_SORTS)[number]

/** Which group a team is in on the overview: starred for the team, starred by you, or everyone else. */
export type StarGroup = 'team' | 'mine' | 'rest'

/** One team in the overview: the list's details, their notes (or null) and their stars. */
export interface OverviewTeam extends PrescoutTeam {
  notes: PrescoutNotes | null
  /** Everyone's team stars on them, with reasons, oldest first. */
  teamStars: PrescoutStar[]
  /** Your own stars on them, of either kind. */
  myStars: PrescoutStar[]
  group: StarGroup
  /** Whether anyone has written answers for them yet. */
  prescouted: boolean
}

const GROUP_ORDER: StarGroup[] = ['team', 'mine', 'rest']

/**
 * The overview's order: teams starred for the team first, then teams you
 * starred, then everyone else. Within each, by team number, or by EPA best
 * first, with teams with no EPA after those with one. Ties go by number.
 * `stars` should be the ones you can see (visibleStars()).
 */
export function prescoutOverview(teams: PrescoutTeam[], notes: PrescoutNotes[], sort: PrescoutSort, stars: PrescoutStar[] = [], me: string | null = null): OverviewTeam[] {
  const byTeam = new Map(notes.map((n) => [n.team_number, n]))
  const byEpa = (a: OverviewTeam, b: OverviewTeam) => (a.epa === null ? 1 : 0) - (b.epa === null ? 1 : 0) || (b.epa ?? 0) - (a.epa ?? 0)
  return teams
    .map((t): OverviewTeam => {
      const n = byTeam.get(t.team) ?? null
      const on = stars.filter((s) => s.team_number === t.team)
      const teamStars = on.filter((s) => s.for_team)
      const myStars = on.filter((s) => me !== null && s.created_by === me)
      const group = teamStars.length > 0 ? 'team' : myStars.length > 0 ? 'mine' : 'rest'
      return { ...t, notes: n, teamStars, myStars, group, prescouted: hasAnswers(n) }
    })
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || (sort === 'EPA' ? byEpa(a, b) : 0) || a.team - b.team)
}

/** The first line of an answer, cut short with "…" if it's long, for the overview. */
export function firstLine(text: string, max = 100): string {
  const lines = text.trim().split('\n')
  const line = lines[0].trim()
  if (line.length > max) return line.slice(0, max).trimEnd() + '…'
  return lines.length > 1 ? line + ' …' : line
}

// ---------------------------------------------------------------------------
// A team's season (#153): their events this year, their matches at each,
// and scouting those matches from video. The events and matches come from
// The Blue Alliance through the Scouting module's data.ts. What a scout
// sees in a video is saved in the prescouting_matches table
// (supabase/migrations/..._prescouting_matches.sql, rules tested in
// supabase/tests/prescouting-matches.test.ts), with the same counters,
// endgame and roles as the match form, from season.ts. Prescouting happens
// with Wi-Fi, so it saves straight to the table.

/** One of a team's matches at an event, for the prescouting page. */
export interface SeasonMatch {
  /** Like 2026ilch_qm12. */
  key: string
  /** Like "Qual 12" or "Semifinal 2". */
  label: string
  alliance: 'red' | 'blue'
  /** The team's alliance's score and the other's, or null before it's played. */
  score: { ours: number; theirs: number } | null
  /** A link for each video. */
  videos: string[]
}

const LEVEL_ORDER = ['qm', 'ef', 'qf', 'sf', 'f']

/** A team's matches at an event, in the order they're played, qualifications then playoffs, with their video links. */
export function seasonMatches(matches: TbaMatchWithVideos[], team: number): SeasonMatch[] {
  const key = `frc${team}`
  return [...matches]
    .sort((a, b) => LEVEL_ORDER.indexOf(a.comp_level) - LEVEL_ORDER.indexOf(b.comp_level) || a.set_number - b.set_number || a.match_number - b.match_number)
    .flatMap((m) => {
      const alliance = m.alliances.red.team_keys.includes(key) ? 'red' : m.alliances.blue.team_keys.includes(key) ? 'blue' : null
      if (!alliance) return []
      const ours = m.alliances[alliance].score
      const theirs = m.alliances[alliance === 'red' ? 'blue' : 'red'].score
      const played = typeof ours === 'number' && ours >= 0 && typeof theirs === 'number' && theirs >= 0
      return [{ key: m.key, label: matchLabel(m), alliance, score: played ? { ours, theirs } : null, videos: (m.videos ?? []).map(videoLink).filter((v) => v !== null) }]
    })
}

/** One scout's look at one team in one match, from video. */
export interface PrescoutMatch extends Row {
  team_number: number
  /** The event the match was at, like 2026ilch. */
  event_key: string
  /** The Blue Alliance's key for the match, like 2026ilch_qm12. */
  match_key: string
  /** The count for each counter in season.ts, by its key. */
  counts: Record<string, number>
  /** One of ENDGAME in season.ts. */
  endgame: string
  /** Any of ROLES in season.ts. */
  roles: string[]
  notes: string
  /** Who scouted it. Show their name with useMemberNames(). */
  created_by: string | null
  updated_at: string
}

/** What a scout fills in for one match. */
export type PrescoutMatchFields = Pick<PrescoutMatch, 'counts' | 'endgame' | 'roles' | 'notes'>

// Made up, for demo mode: two scouts' looks at team 9991's example matches.
const EXAMPLE_PRESCOUT_MATCHES: PrescoutMatch[] = [
  { id: '00000000-0000-4000-8000-0000000e0401', team_number: 9991, event_key: EVENT_KEY, match_key: `${EVENT_KEY}_qm1`, counts: { autoFuel: 4, teleopFuel: 15, fuelMissed: 3 }, endgame: 'Level 2', roles: ['Scorer'], notes: 'Quick cycles from the hub', created_at: '2026-11-04T19:00:00Z', created_by: DEMO_PEOPLE.jordan, updated_at: '2026-11-04T19:00:00Z' },
  { id: '00000000-0000-4000-8000-0000000e0402', team_number: 9991, event_key: EVENT_KEY, match_key: `${EVENT_KEY}_qm2`, counts: { autoFuel: 2, teleopFuel: 11, fuelMissed: 5 }, endgame: 'Level 1', roles: ['Scorer', 'Feeder'], notes: '', created_at: '2026-11-04T19:30:00Z', created_by: DEMO_PEOPLE.sam, updated_at: '2026-11-04T19:30:00Z' },
]

export const prescoutMatchesTable = createTable<PrescoutMatch>('prescouting_matches', { demo: EXAMPLE_PRESCOUT_MATCHES, sort: (a, b) => a.match_key.localeCompare(b.match_key) || a.created_at.localeCompare(b.created_at) })

/** Every look at a team's matches, from everyone, for a page. */
export function usePrescoutMatches(team: number): PrescoutMatch[] {
  return prescoutMatchesTable.useRows().filter((row) => row.team_number === team)
}

/**
 * Save what you saw of a team in one match. The first save adds your row
 * for that match; later ones change it. Several people can scout the same
 * match, each with their own row.
 */
export async function savePrescoutMatch(team: number, event: string, matchKey: string, fields: PrescoutMatchFields, me: string | null = currentUser()?.id ?? null): Promise<Result<PrescoutMatch>> {
  if (!me) return fail('Sign in to scout matches.')
  if (!Number.isInteger(team) || team < 1 || team > MAX_TEAM) return fail('That team number looks wrong. Go back to the list and choose the team again.')
  if (!isEventKey(event) || !matchKey.startsWith(`${event}_`)) return fail("That match isn't from this event. Choose the match again.")
  if (!ENDGAME.includes(fields.endgame)) return fail('Choose how the robot finished the match.')
  const notes = fields.notes.trim()
  if (notes.length > MAX_PRESCOUT_ANSWER) return fail(`Keep the notes under ${MAX_PRESCOUT_ANSWER.toLocaleString('en-US')} characters.`)
  const counts = Object.fromEntries(Object.entries(fields.counts).map(([key, n]) => [key, Math.max(0, Math.round(n))]))
  const tidy = { counts, endgame: fields.endgame, roles: [...new Set(fields.roles)], notes }
  const mine = prescoutMatchesTable.rows().find((row) => row.match_key === matchKey && row.team_number === team && row.created_by === me)
  if (mine) return prescoutMatchesTable.update(mine.id, tidy)
  return prescoutMatchesTable.insert({ team_number: team, event_key: event, match_key: matchKey, ...tidy, updated_at: new Date().toISOString() })
}

/** A team's averages from the matches scouted from video. */
export interface PrescoutAverages {
  /** How many matches it's from. Two scouts on the same match count as one match. */
  matches: number
  /** Each counter in season.ts: the average per match, or null if no look has it. */
  counters: { key: string; label: string; average: number | null }[]
  /** How often each endgame came up, out of every look, in season.ts's order. */
  endgame: { option: string; count: number }[]
}

/**
 * The averages over these looks, like the Scouting team page's numbers
 * (teamSummary()). Two scouts' looks at the same match are averaged first,
 * so that match counts once.
 */
export function prescoutAverages(rows: PrescoutMatch[], counters: Counter[] = COUNTERS): PrescoutAverages {
  const byMatch = new Map<string, PrescoutMatch[]>()
  for (const row of rows) byMatch.set(row.match_key, [...(byMatch.get(row.match_key) ?? []), row])
  const mean = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length)
  return {
    matches: byMatch.size,
    counters: counters.map(({ key, label }) => {
      // Each match's average for this counter, from the looks that have it.
      const perMatch = [...byMatch.values()].flatMap((looks) => {
        const counts = looks.flatMap((l) => (typeof l.counts[key] === 'number' ? [l.counts[key]] : []))
        return counts.length === 0 ? [] : [mean(counts)!]
      })
      return { key, label, average: mean(perMatch) }
    }),
    endgame: ENDGAME.map((option) => ({ option, count: rows.filter((r) => r.endgame === option).length })),
  }
}
