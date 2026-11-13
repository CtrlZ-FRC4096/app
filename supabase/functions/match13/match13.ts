/**
 * What the `match13` server function asks Match 13 (match13.com), kept
 * apart from index.ts so supabase/tests can test it: plain TypeScript, no
 * Deno.
 *
 * Match 13 rates teams with xP ("expected points"): how many points a team
 * adds to its alliance's score. It also predicts who wins each match. It
 * has no schedule, scores or team names: those come from The Blue Alliance.
 *
 * The app can only ask for the four things below, so the team's Match 13
 * key can't be used for anything else. Docs: https://match13.com/docs/api
 */

export const MATCH13_API = 'https://actions.match13.com'

/** What the app can ask for. The same shape is in src/modules/scouting/data.ts. */
export type Match13Request =
  | { kind: 'ratings'; event: string }
  | { kind: 'predictions'; event: string }
  // Match 13's simulation of the event: each team's likely final rank (#152).
  | { kind: 'sim'; event: string }
  // One team's numbers at each event it played in a season, for prescouting (#153).
  | { kind: 'team-events'; team: number; year: number }

// Event keys are the same as The Blue Alliance's: the year and a short code, like 2026ilch.
const EVENT_KEY = /^\d{4}[a-z0-9]{1,16}$/

/** The Match 13 address for a request from the app, or why it isn't allowed. */
export function match13Path(request: unknown): { path: string } | { error: string } {
  const r = (request ?? {}) as Record<string, unknown>
  const event = typeof r.event === 'string' && EVENT_KEY.test(r.event) ? r.event : null
  const needEvent = { error: 'Ask with an event key, like 2026ilch.' }
  switch (r.kind) {
    case 'ratings':
      return event ? { path: `/v1/events/${event}/teams` } : needEvent
    case 'predictions':
      return event ? { path: `/v1/events/${event}/matches` } : needEvent
    case 'sim':
      return event ? { path: `/v1/events/${event}/sim` } : needEvent
    case 'team-events': {
      const team = Number.isInteger(r.team) && (r.team as number) >= 1 && (r.team as number) <= 99999 ? (r.team as number) : null
      const year = Number.isInteger(r.year) && (r.year as number) >= 1992 && (r.year as number) <= 2100 ? (r.year as number) : null
      return team && year ? { path: `/v1/teams/${team}/years/${year}/events` } : { error: 'Ask with a team number and a year, like 4096 and 2026.' }
    }
    default:
      return { error: 'Ask for one of: ratings, predictions, sim or team-events.' }
  }
}

/** An answer to pass on to the app: JSON text and an HTTP status. */
export interface Match13Answer {
  status: number
  body: string
}

interface Saved extends Match13Answer {
  checkedAt: number
}

const MAX_SAVED = 100

/**
 * Ask Match 13, remembering answers for `freshFor` milliseconds (two
 * minutes unless a test says otherwise).
 *
 * Match 13 allows the team 60 requests a minute and 1000 an hour, counting
 * every key the account has. Ratings only change after a match is played,
 * so twenty phones looking at the ratings cost one request every two
 * minutes, not twenty.
 */
export function createMatch13(key: string, options: { fetch?: typeof fetch; now?: () => number; freshFor?: number } = {}) {
  const get = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const freshFor = options.freshFor ?? 120_000
  const saved = new Map<string, Saved>()

  return async function ask(path: string): Promise<Match13Answer> {
    const last = saved.get(path)
    if (last && now() - last.checkedAt < freshFor) return last

    let response: Response
    try {
      response = await get(MATCH13_API + path, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } })
    } catch {
      // Match 13 can't be reached: an older answer is better than none.
      return last ?? problem(502, "Couldn't reach Match 13. Try again in a minute.")
    }
    if (!response.ok) {
      if (response.status === 401) return problem(502, 'Match 13 turned down the key. A mentor should check the MATCH13_KEY secret.')
      if (response.status === 404) return problem(404, 'Match 13 has nothing for that event yet. Check EVENT_KEY in season.ts, or try again once the event starts.')
      if (response.status === 429) return last ?? problem(503, 'The team has asked Match 13 too many times this hour. Try again in a few minutes.')
      return last ?? problem(502, `Match 13 had a problem (${response.status}). Try again in a minute.`)
    }

    const answer: Saved = { status: 200, body: await response.text(), checkedAt: now() }
    if (saved.size >= MAX_SAVED) saved.clear()
    saved.set(path, answer)
    return answer
  }
}

function problem(status: number, error: string): Match13Answer {
  return { status, body: JSON.stringify({ error }) }
}
