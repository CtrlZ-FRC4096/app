/**
 * Prescouting module data.
 *
 * Before an event, the scouting team looks up every team that's coming
 * (#116), writes down what we know about each one (#117), and stars the
 * ones we care about (#118). Stars are read by the Scouting
 * module too.
 *
 * The teams come from The Blue Alliance and their EPA from Match 13, both
 * through the Scouting module's data.ts, which holds those server
 * functions. Our notes are in the prescouting_notes table.
 */
import { useEffect } from 'react'
import { DEMO_PEOPLE } from '../../core/demo'
import { currentUser, isMentor, useSession, type Role } from '../../core/session'
import { createStore, useStore } from '../../core/store'
import { createTable, fail, ok, type Result, type Row } from '../../core/table'
import { EVENT_KEY, MAX_TEAM, getEventTeams, getRatings, tbaTeamUrl, type Match13Rating, type TbaTeam } from '../scouting/data'

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
  strengths: string
  weaknesses: string
  /** The main job they do in a match, like scoring in auto or playing defense. */
  key_task: string
  /** Where they start, and what their auto does. */
  auto_paths: string
  /** How they've done this season, like their results at earlier events. */
  performance: string
  other_notes: string
  /** Who started the notes for this team. */
  created_by: string | null
}

/** The answers to the prescouting questions. */
export type PrescoutAnswers = Pick<PrescoutNotes, 'strengths' | 'weaknesses' | 'key_task' | 'auto_paths' | 'performance' | 'other_notes'>

/** The questions, in the order the page asks them. */
export const PRESCOUT_QUESTIONS: { key: keyof PrescoutAnswers; label: string; hint: string }[] = [
  { key: 'strengths', label: 'Strengths', hint: 'What they do well' },
  { key: 'weaknesses', label: 'Weaknesses', hint: 'What they struggle with' },
  { key: 'key_task', label: 'Key task', hint: 'Their main job in a match, like scoring in auto or playing defense' },
  { key: 'auto_paths', label: 'Expected auto paths', hint: 'Where they start, and what their auto does' },
  { key: 'performance', label: 'Performance', hint: "How they've done this season, like their results at earlier events" },
  { key: 'other_notes', label: 'Other notes', hint: 'Anything else' },
]

export const MAX_PRESCOUT_ANSWER = 2000

export const NO_ANSWERS: PrescoutAnswers = { strengths: '', weaknesses: '', key_task: '', auto_paths: '', performance: '', other_notes: '' }

// Made up, for demo mode. Team numbers in the 9990s, so nobody mistakes them for real scouting.
const EXAMPLE_PRESCOUT: PrescoutNotes[] = [
  { id: '00000000-0000-4000-8000-0000000e0101', event_key: EVENT_KEY, team_number: 9991, strengths: 'Fast cycles from the hub. Very consistent driver.\nNever broke down at their last event.', weaknesses: 'Slow to climb', key_task: 'Scoring fuel in teleop', auto_paths: 'Starts center, scores preload, picks up 2 from the middle', performance: 'Won their first event, semifinalist at the second', other_notes: '', created_at: '2026-11-05T19:00:00Z', created_by: DEMO_PEOPLE.jordan },
  { id: '00000000-0000-4000-8000-0000000e0102', event_key: EVENT_KEY, team_number: 9993, strengths: 'Strong defense', weaknesses: '', key_task: 'Playing defense', auto_paths: '', performance: '', other_notes: 'Ask them about their intake in the pits', created_at: '2026-11-05T19:20:00Z', created_by: DEMO_PEOPLE.alex },
]

export const prescoutTable = createTable<PrescoutNotes>('prescouting_notes', { demo: EXAMPLE_PRESCOUT, version: 2 })

/** Every team's notes for an event. */
export function usePrescoutNotes(event: string): PrescoutNotes[] {
  return prescoutTable.useRows().filter((row) => row.event_key === event)
}

function findNotes(event: string, team: number): PrescoutNotes | undefined {
  return prescoutTable.rows().find((row) => row.event_key === event && row.team_number === team)
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
  return prescoutTable.insert({ event_key: event, team_number: team, ...tidy })
}

// ---------------------------------------------------------------------------
// Stars (#118): people star the teams they care about, so those teams come
// first, here and in Scouting. A star is just for you, or for the whole
// team with a reason. Several people can star a team for the whole team.
// Stars are in the prescouting_stars table
// (supabase/migrations/..._prescouting_stars.sql, rules tested in
// supabase/tests/prescouting-stars.test.ts). The Scouting module reads them
// from here too, so a star in either place shows in both.

/** One row of the prescouting_stars table. */
export interface PrescoutStar extends Row {
  event_key: string
  team_number: number
  /** True: for the whole team, with a reason. False: just for the person who made it. */
  for_team: boolean
  /** Why the team should look at them. Empty for most stars just for you. */
  reason: string
  /** Who starred it. Null for marks from before stars, and for people who've left. */
  created_by: string | null
}

export const MAX_STAR_REASON = 500

// Made up, for demo mode. Team numbers in the 9990s, so nobody mistakes them
// for real scouting. In demo mode you're Alex (as a student), so you see
// Alex's star just for them, but not Jordan's.
const EXAMPLE_STARS: PrescoutStar[] = [
  { id: '00000000-0000-4000-8000-0000000e0201', event_key: EVENT_KEY, team_number: 9991, for_team: true, reason: 'Fast, reliable auto. Good second pick.', created_at: '2026-11-05T19:05:00Z', created_by: DEMO_PEOPLE.jordan },
  { id: '00000000-0000-4000-8000-0000000e0202', event_key: EVENT_KEY, team_number: 9991, for_team: true, reason: 'Steady driver, rarely breaks down.', created_at: '2026-11-06T18:30:00Z', created_by: DEMO_PEOPLE.pat },
  { id: '00000000-0000-4000-8000-0000000e0203', event_key: EVENT_KEY, team_number: 9994, for_team: true, reason: 'Great defender if we need one.', created_at: '2026-11-06T18:40:00Z', created_by: DEMO_PEOPLE.casey },
  { id: '00000000-0000-4000-8000-0000000e0204', event_key: EVENT_KEY, team_number: 9993, for_team: false, reason: '', created_at: '2026-11-06T19:00:00Z', created_by: DEMO_PEOPLE.alex },
  { id: '00000000-0000-4000-8000-0000000e0205', event_key: EVENT_KEY, team_number: 9995, for_team: false, reason: '', created_at: '2026-11-06T19:10:00Z', created_by: DEMO_PEOPLE.jordan },
]

export const starsTable = createTable<PrescoutStar>('prescouting_stars', { demo: EXAMPLE_STARS })

/**
 * The stars this person may see: every team star, and their own stars just
 * for them. The database already hides other people's on the live site;
 * this does the same in demo mode, where every example row is in the browser.
 */
export function visibleStars(stars: PrescoutStar[], me: string | null): PrescoutStar[] {
  return stars.filter((s) => s.for_team || (me !== null && s.created_by === me))
}

/** The stars the signed-in person can see at an event. */
export function useStars(event: string): PrescoutStar[] {
  const { id } = useSession()
  return visibleStars(starsTable.useRows(), id).filter((s) => s.event_key === event)
}

/** One team's stars: the team stars (oldest first), and your own star just for you, if any. */
export interface TeamStars {
  forTeam: PrescoutStar[]
  /** Your star just for you. */
  mine: PrescoutStar | null
}

export function starsFor(stars: PrescoutStar[], team: number, me: string | null): TeamStars {
  const forTeam = stars.filter((s) => s.team_number === team && s.for_team).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const mine = stars.find((s) => s.team_number === team && !s.for_team && me !== null && s.created_by === me) ?? null
  return { forTeam, mine }
}

/** Where a team goes in a list: team stars first, then your own stars, then everyone else. */
export type StarGroup = 'Team stars' | 'Your stars' | 'Everyone else'
export const STAR_GROUPS: StarGroup[] = ['Team stars', 'Your stars', 'Everyone else']

export function starGroup(stars: TeamStars): StarGroup {
  return stars.forTeam.length > 0 ? 'Team stars' : stars.mine ? 'Your stars' : 'Everyone else'
}

/**
 * Team numbers with starred teams first: team stars, then your own, then
 * the rest, by number within each. For Scouting's Teams page. Starred teams
 * that aren't in `teams` are added, so a starred team is easy to find before
 * anyone has scouted them.
 */
export function starredFirst(teams: number[], stars: PrescoutStar[], me: string | null): { team: number; group: StarGroup }[] {
  const all = [...new Set([...teams, ...visibleStars(stars, me).map((s) => s.team_number)])]
  return all
    .map((team) => ({ team, group: starGroup(starsFor(stars, team, me)) }))
    .sort((a, b) => STAR_GROUPS.indexOf(a.group) - STAR_GROUPS.indexOf(b.group) || a.team - b.team)
}

/**
 * Star a team at an event, as the signed-in person: just for you, or for
 * the whole team with a reason. Each person has at most one of each kind
 * per team.
 */
export async function starTeam(event: string, team: number, star: { forTeam: boolean; reason: string }): Promise<Result<PrescoutStar>> {
  const me = currentUser()
  if (!me) return fail('Sign in to star teams.')
  if (!isEventKey(event)) return fail(NOT_AN_EVENT_KEY)
  if (!Number.isInteger(team) || team < 1 || team > MAX_TEAM) return fail('That team number looks wrong. Go back to the list and choose the team again.')
  const reason = star.reason.trim()
  if (star.forTeam && reason === '') return fail('Say why the team should look at them, like "Fast, reliable auto. Good second pick."')
  if (reason.length > MAX_STAR_REASON) return fail(`Keep the reason under ${MAX_STAR_REASON} characters.`)
  const already = starsTable.rows().some((s) => s.event_key === event && s.team_number === team && s.for_team === star.forTeam && s.created_by === me.id)
  if (already) return fail(star.forTeam ? "You've already starred this team for the whole team. Remove that star to give a new reason." : "You've already starred this team for yourself.")
  return starsTable.insert({ event_key: event, team_number: team, for_team: star.forTeam, reason })
}

/** Whether this person can remove a star: their own, or any team star if they're a mentor. */
export function canRemoveStar(star: PrescoutStar, me: { id: string; role: Role } | null): boolean {
  if (!me) return false
  return star.created_by === me.id || (star.for_team && isMentor(me.role))
}

/** Remove a star: your own, or any team star if you're a mentor. */
export async function unstarTeam(starId: string): Promise<Result> {
  const star = starsTable.rows().find((s) => s.id === starId)
  if (!star) return fail('That star has already been removed.')
  if (!canRemoveStar(star, currentUser())) return fail('You can only remove your own stars. Ask a mentor to remove a team star.')
  return starsTable.remove(starId)
}

// ---------------------------------------------------------------------------
// The prescouting overview (#118): every team at a glance, starred ones first.

export const PRESCOUT_SORTS = ['Team number', 'EPA'] as const
export type PrescoutSort = (typeof PRESCOUT_SORTS)[number]

/** One team in the overview: the list's details, their notes (or null), and their stars. */
export interface OverviewTeam extends PrescoutTeam {
  notes: PrescoutNotes | null
  /** Whether anyone has written answers for them yet. */
  prescouted: boolean
  stars: TeamStars
  group: StarGroup
}

/**
 * The overview's order: team stars first, then your own stars, then
 * everyone else. Within each, by team number, or by EPA best first (teams
 * with no EPA after those with one). Ties go by number.
 */
export function prescoutOverview(teams: PrescoutTeam[], notes: PrescoutNotes[], stars: PrescoutStar[], me: string | null, sort: PrescoutSort): OverviewTeam[] {
  const byTeam = new Map(notes.map((n) => [n.team_number, n]))
  const byEpa = (a: OverviewTeam, b: OverviewTeam) => (a.epa === null ? 1 : 0) - (b.epa === null ? 1 : 0) || (b.epa ?? 0) - (a.epa ?? 0)
  const seen = visibleStars(stars, me)
  return teams
    .map((t) => {
      const n = byTeam.get(t.team) ?? null
      const teamStars = starsFor(seen, t.team, me)
      return { ...t, notes: n, prescouted: hasAnswers(n), stars: teamStars, group: starGroup(teamStars) }
    })
    .sort((a, b) => STAR_GROUPS.indexOf(a.group) - STAR_GROUPS.indexOf(b.group) || (sort === 'EPA' ? byEpa(a, b) : 0) || a.team - b.team)
}

/** The first line of an answer, cut short with "…" if it's long, for the overview. */
export function firstLine(text: string, max = 100): string {
  const lines = text.trim().split('\n')
  const line = lines[0].trim()
  if (line.length > max) return line.slice(0, max).trimEnd() + '…'
  return lines.length > 1 ? line + ' …' : line
}
