/**
 * Prescouting data: Scouting's Prescouting tab (#184).
 *
 * Before an event, scouts look up every team that's coming (#116), write
 * down what we know about each one (#117), and star the ones we care about
 * (#118). Stars show on Scouting's team pages too.
 *
 * The teams come from The Blue Alliance and their EPA, xP and other numbers
 * from Match 13 (#186), both through Scouting's data.ts (../data.ts), which
 * holds those server functions. Our notes are in the prescouting_notes table.
 */
import { useEffect } from 'react'
import { DEMO_PEOPLE } from '../../../core/demo'
import { href } from '../../../core/router'
import { currentUser, isLeader, useSession, type Role } from '../../../core/session'
import { createStore, useStore } from '../../../core/store'
import { createTable, fail, ok, type Result, type Row } from '../../../core/table'
import {
  COUNTERS, ENDGAME, EVENT_KEY, MAX_TEAM, getEventTeams, getRatings, matchLabel, searchTeamList, tbaTeamUrl, videoLink,
  type Counter, type Match13Rating, type TbaMatchWithVideos, type TbaTeam,
} from '../data'
import { DRIVETRAINS } from '../season'

// ---------------------------------------------------------------------------
// The teams at an event (#116).

/** One team in the prescouting list. */
export interface PrescoutTeam {
  team: number
  name: string
  /** Statbotics' EPA, from Match 13, or null if there isn't one yet. */
  epa: number | null
  /**
   * Match 13's xP (#186): how many points they add to their alliance's
   * score. Before the event it's Match 13's rating of how strong they are
   * going in; it changes once matches start. Null if Match 13 hasn't rated them.
   */
  xp: number | null
  /** Where their xP ranks among the teams at this event that Match 13 rated, like 5 of 40. Equal xP, equal rank. */
  xpRank: { rank: number; of: number } | null
  /** The parts of their xP: auto, teleop and endgame. */
  auto: number | null
  teleop: number | null
  endgame: number | null
  /** The Blue Alliance's OPR (points they score) and DPR (points they give up), through Match 13. */
  opr: number | null
  dpr: number | null
  /** Their page on The Blue Alliance. */
  tbaUrl: string
}

/** The Match 13 numbers on a team, as the prescouting page shows them. */
export type Match13Numbers = Pick<PrescoutTeam, 'xp' | 'auto' | 'teleop' | 'endgame' | 'epa' | 'opr' | 'dpr'>

/** Whether Match 13 gave any number for this team. */
export function hasMatch13(t: Match13Numbers): boolean {
  return [t.xp, t.auto, t.teleop, t.endgame, t.epa, t.opr, t.dpr].some((n) => n !== null)
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

/** A number from Match 13, or null if it's missing or not a real number. */
const numberOrNull = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null)

/**
 * Put each team's Match 13 numbers next to them (#186), sorted by team
 * number. A team Match 13 doesn't have gets null for each. Their xP rank is
 * among the teams in this list that have an xP: 1 is the best, and teams
 * with the same xP share a rank.
 */
export function prescoutList(teams: TbaTeam[], ratings: Match13Rating[], event: string): PrescoutTeam[] {
  const byTeam = new Map(ratings.map((r) => [r.teamNumber, r]))
  const xps = teams.flatMap((t) => {
    const xp = numberOrNull(byTeam.get(t.team_number)?.xpEnd)
    return xp === null ? [] : [xp]
  })
  return teams
    .map((t) => {
      const r = byTeam.get(t.team_number)
      const xp = numberOrNull(r?.xpEnd)
      return {
        team: t.team_number,
        name: t.nickname,
        epa: numberOrNull(r?.epa),
        xp,
        xpRank: xp === null ? null : { rank: xps.filter((other) => other > xp).length + 1, of: xps.length },
        auto: numberOrNull(r?.xAuto),
        teleop: numberOrNull(r?.xTele),
        endgame: numberOrNull(r?.xEnd),
        opr: numberOrNull(r?.opr),
        dpr: numberOrNull(r?.dpr),
        tbaUrl: tbaTeamUrl(t.team_number, event),
      }
    })
    .sort((a, b) => a.team - b.team)
}

/**
 * The prescouting list for an event: its teams from The Blue Alliance, with
 * their xP, EPA, OPR and the rest from Match 13. If Match 13 has no ratings
 * yet (often true before the event), the teams still show, with no numbers.
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
// written by any scout (#184). One row per team per event, in the
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
  /** One of DRIVETRAINS in season.ts, or '' if we don't know (#184). */
  drivetrain: string
  /** The highest level they can climb, one of ENDGAME in season.ts ('None': they can't), or '' if we don't know (#184). */
  best_climb: string
  /** About how many fuel they score in auto, or null if we don't know (#184). */
  auto_fuel: number | null
  /** About how many seconds a scoring cycle takes them, or null if we don't know (#184). */
  cycle_seconds: number | null
  /** Our overall rating, 1 (weak) to 5 (great), or null if not rated yet (#184). */
  rating: number | null
  /** Where they are on our tier list (#191), S best to F, or null if nobody's rated them yet. */
  tier: Tier | null
  /** Who started the notes for this team. */
  created_by: string | null
}

/** The tier list (#191): S is best, then A to F. A team nobody has rated yet is "Not rated". */
export const TIERS = ['S', 'A', 'B', 'C', 'D', 'F'] as const
export type Tier = (typeof TIERS)[number]

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

/**
 * The quick answers (#184): a few things to choose, or type a number for,
 * so teams are easy to compare at a glance. All of them are optional. The
 * choices come from season.ts: DRIVETRAINS, and ENDGAME for the best climb.
 */
export type PrescoutFacts = Pick<PrescoutNotes, 'drivetrain' | 'best_climb' | 'auto_fuel' | 'cycle_seconds' | 'rating'>

export const NO_FACTS: PrescoutFacts = { drivetrain: '', best_climb: '', auto_fuel: null, cycle_seconds: null, rating: null }

/** The limits on the numbers, the same as the database's (..._prescouting_quick_answers.sql). */
export const MAX_AUTO_FUEL = 99
export const MAX_CYCLE_SECONDS = 150

/** Check the quick answers. Gives back what to fix, or null if they're fine. */
export function checkFacts(facts: PrescoutFacts): string | null {
  const whole = (n: number | null, min: number, max: number) => n === null || (Number.isInteger(n) && n >= min && n <= max)
  if (facts.drivetrain !== '' && !DRIVETRAINS.includes(facts.drivetrain)) return 'Choose their drivetrain from the list, or Not sure.'
  if (facts.best_climb !== '' && !ENDGAME.includes(facts.best_climb)) return 'Choose their best climb from the list, or Not sure.'
  if (!whole(facts.auto_fuel, 0, MAX_AUTO_FUEL)) return `Fuel in auto should be a whole number from 0 to ${MAX_AUTO_FUEL}. Leave it empty if we don't know.`
  if (!whole(facts.cycle_seconds, 1, MAX_CYCLE_SECONDS)) return `Seconds per cycle should be a whole number from 1 to ${MAX_CYCLE_SECONDS}. Leave it empty if we don't know.`
  if (!whole(facts.rating, 1, 5)) return 'Rate them from 1 to 5, or choose Not rated.'
  return null
}

function hasFacts(facts: PrescoutFacts): boolean {
  return facts.drivetrain !== '' || facts.best_climb !== '' || facts.auto_fuel !== null || facts.cycle_seconds !== null || facts.rating !== null
}

/**
 * The quick answers that are filled in, as words to show, like "Rating:
 * 4 of 5" or "Seconds per cycle: about 8". For the prescouting overview and
 * Scouting's team page.
 */
export function prescoutFacts(notes: PrescoutFacts): { key: keyof PrescoutFacts; label: string; value: string }[] {
  const facts: { key: keyof PrescoutFacts; label: string; value: string }[] = []
  if (notes.rating !== null) facts.push({ key: 'rating', label: 'Rating', value: `${notes.rating} of 5` })
  if (notes.drivetrain) facts.push({ key: 'drivetrain', label: 'Drivetrain', value: notes.drivetrain })
  if (notes.best_climb) facts.push({ key: 'best_climb', label: 'Best climb', value: notes.best_climb === 'None' ? "Can't climb" : notes.best_climb })
  if (notes.auto_fuel !== null) facts.push({ key: 'auto_fuel', label: 'Fuel in auto', value: `about ${notes.auto_fuel}` })
  if (notes.cycle_seconds !== null) facts.push({ key: 'cycle_seconds', label: 'Seconds per cycle', value: `about ${notes.cycle_seconds}` })
  return facts
}

// Made up, for demo mode. Team numbers in the 9990s, so nobody mistakes them for real scouting.
const EXAMPLE_PRESCOUT: PrescoutNotes[] = [
  { id: '00000000-0000-4000-8000-0000000e0101', event_key: EVENT_KEY, team_number: 9991, overall: 'Strong scorer, slow climb. Good first pick.', strengths: 'Fast cycles from the hub. Very consistent driver.\nNever broke down at their last event.', weaknesses: 'Slow to climb', key_task: 'Scoring fuel in teleop', auto_paths: 'Starts center, scores preload, picks up 2 from the middle', performance: 'Won their first event, semifinalist at the second', other_notes: '', drivetrain: 'Swerve', best_climb: 'Level 2', auto_fuel: 5, cycle_seconds: 8, rating: 4, tier: 'S', created_at: '2026-11-05T19:00:00Z', created_by: DEMO_PEOPLE.jordan },
  { id: '00000000-0000-4000-8000-0000000e0102', event_key: EVENT_KEY, team_number: 9993, overall: '', strengths: 'Strong defense', weaknesses: '', key_task: 'Playing defense', auto_paths: '', performance: '', other_notes: 'Ask them about their intake in the pits', drivetrain: 'Tank', best_climb: '', auto_fuel: null, cycle_seconds: null, rating: null, tier: 'B', created_at: '2026-11-05T19:20:00Z', created_by: DEMO_PEOPLE.alex },
]

// Version 3: the overall summary was added to the rows (#153).
// Version 4: the tier (#191).
// Version 5: the quick answers (drivetrain, best climb, fuel in auto, seconds per cycle, rating) were added (#184).
export const prescoutTable = createTable<PrescoutNotes>('prescouting_notes', { demo: EXAMPLE_PRESCOUT, version: 5 })

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
 * the table themselves. A row with no answers yet counts as not prescouted.
 */
export function prescoutFor(rows: PrescoutNotes[], event: string, team: number): PrescoutNotes | null {
  const found = rows.find((row) => row.event_key === event && row.team_number === team) ?? null
  return hasAnswers(found) ? found : null
}

/** One team's prescouting at an event, for a page. */
export function usePrescoutFor(event: string, team: number): PrescoutNotes | null {
  return prescoutFor(prescoutTable.useRows(), event, team)
}

/** The Prescouting tab's address after #/scouting/ (#184). */
export const PRESCOUT_PATH = 'prescouting'

/**
 * The address of the list of teams, #/scouting/prescouting, or of a team's
 * prescouting page, like #/scouting/prescouting/2026ilch/9991.
 */
export function prescoutHref(event?: string, team?: number): string {
  return event === undefined || team === undefined ? href('scouting', PRESCOUT_PATH) : href('scouting', PRESCOUT_PATH, event, String(team))
}

/** Whether anyone has written any answers, or filled in any quick answers, for this team yet. */
export function hasAnswers(notes: PrescoutNotes | null | undefined): boolean {
  return !!notes && (PRESCOUT_QUESTIONS.some((q) => notes[q.key].trim() !== '') || hasFacts(notes))
}

/**
 * Save the answers for a team at an event, and the quick answers (#184) if
 * given: leave `facts` out to keep the ones already saved. The first save
 * adds their row, and later ones change it. Answers are trimmed. Whoever
 * saves last wins, so two people shouldn't edit the same team at once.
 */
export async function savePrescout(event: string, team: number, answers: PrescoutAnswers, facts?: PrescoutFacts): Promise<Result<PrescoutNotes>> {
  if (!isEventKey(event)) return fail(NOT_AN_EVENT_KEY)
  if (!Number.isInteger(team) || team < 1 || team > MAX_TEAM) return fail('That team number looks wrong. Go back to the list and choose the team again.')
  const tidy = Object.fromEntries(PRESCOUT_QUESTIONS.map((q) => [q.key, (answers[q.key] ?? '').trim()])) as PrescoutAnswers
  const tooLong = PRESCOUT_QUESTIONS.find((q) => tidy[q.key].length > MAX_PRESCOUT_ANSWER)
  if (tooLong) return fail(`${tooLong.label} is too long. Keep each answer under ${MAX_PRESCOUT_ANSWER.toLocaleString('en-US')} characters.`)
  const problem = facts ? checkFacts(facts) : null
  if (problem) return fail(problem)
  // Only the quick answers' own fields, so nothing else sneaks into the save.
  const quick: Partial<PrescoutFacts> = facts ? { drivetrain: facts.drivetrain, best_climb: facts.best_climb, auto_fuel: facts.auto_fuel, cycle_seconds: facts.cycle_seconds, rating: facts.rating } : {}
  const existing = findNotes(event, team)
  if (existing) return prescoutTable.update(existing.id, { ...tidy, ...quick })
  if (PRESCOUT_QUESTIONS.every((q) => tidy[q.key] === '') && !(facts && hasFacts(facts))) return fail('Write at least one answer before saving.')
  return prescoutTable.insert({ event_key: event, team_number: team, ...NO_FACTS, ...tidy, ...quick, tier: null })
}

/**
 * Put a team on the tier list (#191), or take them off it with null. One
 * tier per team per event, shared by everyone; whoever changes it last
 * wins. A team with no notes yet gets their row, with empty answers, so
 * they still count as not prescouted.
 */
export async function setTier(event: string, team: number, tier: Tier | null): Promise<Result<PrescoutNotes>> {
  if (!isEventKey(event)) return fail(NOT_AN_EVENT_KEY)
  if (!Number.isInteger(team) || team < 1 || team > MAX_TEAM) return fail('That team number looks wrong. Go back to the list and choose the team again.')
  if (tier !== null && !TIERS.includes(tier)) return fail('Choose a tier from S to F.')
  const existing = findNotes(event, team)
  if (existing) return prescoutTable.update(existing.id, { tier })
  return prescoutTable.insert({ event_key: event, team_number: team, ...NO_ANSWERS, ...NO_FACTS, tier })
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

/** Whether this person can remove a star: their own, or any team star if they're a student leader, mentor or admin. */
export function canRemoveStar(star: PrescoutStar, me: { id: string; role: Role } | null): boolean {
  if (!me) return false
  return star.created_by === me.id || (star.for_team && isLeader(me.role))
}

/** Remove a star: your own, or any team star if you're a student leader, mentor or admin. */
export async function unstarTeam(starId: string): Promise<Result> {
  const star = starsTable.rows().find((s) => s.id === starId)
  if (!star) return fail('That star has already been removed.')
  if (!canRemoveStar(star, currentUser())) return fail('You can only remove your own stars. Ask a student leader or mentor to remove a team star.')
  return starsTable.remove(starId)
}

// ---------------------------------------------------------------------------
// The prescouting overview (#118): every team at a glance, starred ones first.

export const PRESCOUT_SORTS = ['Team number', 'EPA', 'xP', 'Tier'] as const
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
 * everyone else. Within each, by team number, by EPA or xP best first
 * (teams with none after those with one), or by tier, S to F, then Not
 * rated (#191). Ties go by number.
 */
export function prescoutOverview(teams: PrescoutTeam[], notes: PrescoutNotes[], stars: PrescoutStar[], me: string | null, sort: PrescoutSort): OverviewTeam[] {
  const byTeam = new Map(notes.map((n) => [n.team_number, n]))
  // Best first, with teams that have no number after those with one.
  const best = (x: number | null, y: number | null) => (x === null ? 1 : 0) - (y === null ? 1 : 0) || (y ?? 0) - (x ?? 0)
  // S first, F last, then teams nobody has rated.
  const tierRank = (t: OverviewTeam) => (t.notes?.tier ? TIERS.indexOf(t.notes.tier) : TIERS.length)
  const bySort = (a: OverviewTeam, b: OverviewTeam) =>
    sort === 'EPA' ? best(a.epa, b.epa) : sort === 'xP' ? best(a.xp, b.xp) : sort === 'Tier' ? tierRank(a) - tierRank(b) : 0
  const seen = visibleStars(stars, me)
  return teams
    .map((t) => {
      const n = byTeam.get(t.team) ?? null
      const teamStars = starsFor(seen, t.team, me)
      return { ...t, notes: n, prescouted: hasAnswers(n), stars: teamStars, group: starGroup(teamStars) }
    })
    .sort((a, b) => STAR_GROUPS.indexOf(a.group) - STAR_GROUPS.indexOf(b.group) || bySort(a, b) || a.team - b.team)
}

/**
 * The teams that match what's typed in the overview's search box: every
 * word typed is in the team's number or name, ignoring capitals. So "40"
 * finds 4096 and 1640, and "robo" finds every name with "robo" in it. An
 * empty search matches every team. The order stays as it was.
 */
export function searchPrescout<T extends { team: number; name: string }>(teams: T[], text: string): T[] {
  return searchTeamList(teams, text, Number.POSITIVE_INFINITY, (team) => team.team, (team) => team.name)
}

/**
 * How the overview shows the teams: a card each; Compact, a short row each
 * that opens in place (#233); or one table with a column for each question.
 */
export const PRESCOUT_VIEWS = ['Cards', 'Compact', 'Table'] as const
export type PrescoutView = (typeof PRESCOUT_VIEWS)[number]

/** The overview's Cards / Compact / Table choice, remembered on this device like the event. */
export const prescoutViewStore = createStore<PrescoutView>('prescouting-view', 1, () => 'Cards', { keepOnReset: true })

export function usePrescoutView(): PrescoutView {
  const view = useStore(prescoutViewStore)
  // Anything else saved on the phone (from an older version, say) means Cards.
  return PRESCOUT_VIEWS.includes(view) ? view : 'Cards'
}

export function setPrescoutView(view: PrescoutView): void {
  prescoutViewStore.set(view)
}

/** How much of an answer a table cell shows: shorter than a card, so a row stays one line. */
export const TABLE_ANSWER_LENGTH = 40

/** How many stars a team has that you can see: the team's, plus your own just for you. */
export function starCount(stars: TeamStars): number {
  return stars.forTeam.length + (stars.mine ? 1 : 0)
}

/** The first line of an answer, cut short with "…" if it's long, for the overview. */
export function firstLine(text: string, max = 100): string {
  const lines = text.trim().split('\n')
  const line = lines[0].trim()
  if (line.length > max) return line.slice(0, max).trimEnd() + '…'
  return lines.length > 1 ? line + ' …' : line
}

/**
 * The second line of a team's Compact row (#233): their overall note, else
 * their key task, else the first other answer (like "Strengths: Fast"),
 * else their quick answers. Null if they're not prescouted yet (no notes,
 * or only a tier), so the page can say so.
 */
export function compactSummary(notes: PrescoutNotes | null): string | null {
  if (!notes || !hasAnswers(notes)) return null
  if (notes.overall.trim() !== '') return firstLine(notes.overall)
  if (notes.key_task.trim() !== '') return `Key task: ${firstLine(notes.key_task)}`
  const other = PRESCOUT_QUESTIONS.find((q) => notes[q.key].trim() !== '')
  if (other) return `${other.label}: ${firstLine(notes[other.key])}`
  return prescoutFacts(notes).map((f) => `${f.label} ${f.value}`).join(' · ')
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

/**
 * A team's looks from one season, like '2026': the rows for that team from
 * events that year. A look's event is where the match was played, so it's
 * the year in its key that counts, not the prescouting event.
 */
export function seasonLooks(rows: PrescoutMatch[], team: number, year: string): PrescoutMatch[] {
  return rows.filter((row) => row.team_number === team && row.event_key.startsWith(year))
}

// ---------------------------------------------------------------------------
// Comparing teams side by side (#233). Tick 2 to 4 teams in the overview,
// then the compare page shows them next to each other. The ticks are only
// kept while the app is open: nothing here is saved.

/** The most and fewest teams the compare page shows. */
export const MAX_COMPARE = 4
export const MIN_COMPARE = 2

/** The compare page's part of the address: #/scouting/prescouting/<event>/compare/<team>,<team>. */
export const COMPARE_PATH = 'compare'

/** A Match 13 number to one decimal place, or "—" if Match 13 didn't give it. */
export function formatEpa(epa: number | null): string {
  return epa === null ? '—' : epa.toFixed(1)
}

/**
 * The address of the compare page, like
 * #/scouting/prescouting/2026ilch/compare/254,1678. The teams are added by
 * hand: href() would turn each comma into %2C, an ugly link to send.
 * Team numbers are only digits, so they're safe as they are.
 */
export function compareHref(event: string, teams: number[]): string {
  return `${href('scouting', PRESCOUT_PATH, event, COMPARE_PATH)}/${teams.join(',')}`
}

/**
 * The teams in a compare address, like "254,1678" → [254, 1678]. Skips
 * anything that isn't a team number (digits only, from 1 to MAX_TEAM),
 * removes repeats, keeps the order given, and keeps no more than
 * MAX_COMPARE.
 */
export function parseCompare(text: string): number[] {
  const teams: number[] = []
  for (const part of text.split(',')) {
    // Digits only: Number() would also accept things like '1e3' and '0x10'.
    if (!/^\d+$/.test(part.trim())) continue
    const team = Number(part.trim())
    if (team < 1 || team > MAX_TEAM || teams.includes(team)) continue
    teams.push(team)
    if (teams.length === MAX_COMPARE) break
  }
  return teams
}

/** Tick or untick a team to compare: refused if MAX_COMPARE are already ticked. */
export function toggleCompare(chosen: number[], team: number): Result<number[]> {
  if (chosen.includes(team)) return ok(chosen.filter((t) => t !== team))
  if (chosen.length >= MAX_COMPARE) return fail(`You can compare up to ${MAX_COMPARE} teams. Untick one first.`)
  return ok([...chosen, team])
}

// The ticked teams, and the event they're at. Kept while the app is open,
// so you can tick, look at a team's page, come back and tick more. Not
// saved on the phone.
const compareStore = createStore<{ event: string; teams: number[] }>('prescouting-compare', 1, () => ({ event: '', teams: [] }), { persist: false })

/** The teams ticked to compare at this event. Ticks at another event don't count. */
export function compareChoice(event: string): number[] {
  const chosen = compareStore.get()
  return chosen.event === event ? chosen.teams : []
}

/** The teams ticked to compare at this event, for a page. */
export function useCompareChoice(event: string): number[] {
  const chosen = useStore(compareStore)
  return chosen.event === event ? chosen.teams : []
}

/** Tick a team to compare, or untick it. Ticking at a new event starts again. Gives back the ticked teams, or why not. */
export function tickCompare(event: string, team: number): Result<number[]> {
  const result = toggleCompare(compareChoice(event), team)
  if (result.ok) compareStore.set({ event, teams: result.value })
  return result
}

/** Untick every team. */
export function clearCompare(): void {
  compareStore.reset()
}

/**
 * The best of some numbers, to show in bold: the highest, or the lowest
 * when fewer is better. Null when there's nothing to point out: fewer than
 * two numbers known, or all the same. Ties for best are all best.
 */
export function bestValue(values: (number | null)[], lowerIsBetter = false): number | null {
  const known = values.filter((v): v is number => v !== null)
  if (known.length < 2 || known.every((v) => v === known[0])) return null
  return lowerIsBetter ? Math.min(...known) : Math.max(...known)
}

/** Everything the compare page shows about one team. */
export interface CompareTeam {
  team: number
  /** Null if The Blue Alliance doesn't list them at this event, or the list hasn't loaded. */
  name: string | null
  epa: number | null
  xp: number | null
  xpRank: { rank: number; of: number } | null
  tier: Tier | null
  /** Whether anyone has written answers for them yet. */
  prescouted: boolean
  answers: PrescoutAnswers
  /** The quick answers that are filled in, as words. */
  facts: ReturnType<typeof prescoutFacts>
  stars: TeamStars
  /** From matches scouted from video this season. */
  averages: PrescoutAverages
  /** Their prescouting page. */
  href: string
  tbaUrl: string
}

/**
 * Gather each team's details for the compare page, in the order given: the
 * list's name and Match 13 numbers, our notes and tier at this event, the
 * stars you can see (team stars, and your own), and their averages from
 * this season's matches scouted from video.
 */
export function compareTeams(
  event: string,
  teams: number[],
  from: { list: PrescoutTeam[]; notes: PrescoutNotes[]; stars: PrescoutStar[]; looks: PrescoutMatch[]; me: string | null },
): CompareTeam[] {
  const stars = from.stars.filter((s) => s.event_key === event)
  return teams.map((team) => {
    const details = from.list.find((t) => t.team === team)
    // The row itself, not prescoutFor(): a row with only a tier still has the tier.
    const row = from.notes.find((n) => n.event_key === event && n.team_number === team)
    return {
      team,
      name: details?.name ?? null,
      epa: details?.epa ?? null,
      xp: details?.xp ?? null,
      xpRank: details?.xpRank ?? null,
      tier: row?.tier ?? null,
      prescouted: hasAnswers(row),
      answers: Object.fromEntries(PRESCOUT_QUESTIONS.map((q) => [q.key, row?.[q.key] ?? ''])) as PrescoutAnswers,
      facts: prescoutFacts(row ?? NO_FACTS),
      stars: starsFor(stars, team, from.me),
      averages: prescoutAverages(seasonLooks(from.looks, team, event.slice(0, 4))),
      href: prescoutHref(event, team),
      tbaUrl: details?.tbaUrl ?? tbaTeamUrl(team, event),
    }
  })
}

/**
 * The compare page's teams, and the event's list (null while it loads), so
 * the page can say it's loading or what went wrong. Starts loading the list,
 * so a link opened on another phone works.
 */
export function useCompareTeams(event: string, teams: number[]): { list: Result<PrescoutTeam[]> | null; teams: CompareTeam[] } {
  const list = usePrescoutTeams(event)
  const notes = prescoutTable.useRows()
  const stars = starsTable.useRows()
  const looks = prescoutMatchesTable.useRows()
  const me = useSession().id
  return { list, teams: compareTeams(event, teams, { list: list?.ok ? list.value : [], notes, stars, looks, me }) }
}
