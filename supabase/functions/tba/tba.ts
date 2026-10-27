/**
 * What the `tba` server function asks The Blue Alliance (TBA), kept apart
 * from index.ts so supabase/tests can test it: plain TypeScript, no Deno.
 *
 * The app can only ask for the four things below, so the team's TBA key
 * can't be used for anything else.
 */

export const TBA_API = 'https://www.thebluealliance.com/api/v3'

/** What the app can ask for. The same shape is in src/modules/scouting/data.ts. */
export type TbaRequest =
  | { kind: 'schedule'; event: string }
  | { kind: 'rankings'; event: string }
  | { kind: 'team-matches'; team: number; event: string }
  | { kind: 'team'; team: number }

// TBA event keys are the year and a short code, like 2026ilch.
const EVENT_KEY = /^\d{4}[a-z0-9]{1,16}$/

/** The TBA address for a request from the app, or why it isn't allowed. */
export function tbaPath(request: unknown): { path: string } | { error: string } {
  const r = (request ?? {}) as Record<string, unknown>
  const event = typeof r.event === 'string' && EVENT_KEY.test(r.event) ? r.event : null
  const team = typeof r.team === 'number' && Number.isInteger(r.team) && r.team > 0 && r.team < 100_000 ? r.team : null
  const needEvent = { error: 'Ask with an event key, like 2026ilch.' }
  const needTeam = { error: 'Ask with a team number, like 4096.' }
  switch (r.kind) {
    case 'schedule':
      return event ? { path: `/event/${event}/matches/simple` } : needEvent
    case 'rankings':
      return event ? { path: `/event/${event}/rankings` } : needEvent
    case 'team-matches':
      return !team ? needTeam : event ? { path: `/team/frc${team}/event/${event}/matches` } : needEvent
    case 'team':
      return team ? { path: `/team/frc${team}/simple` } : needTeam
    default:
      return { error: 'Ask for one of: schedule, rankings, team-matches or team.' }
  }
}

/** An answer to pass on to the app: JSON text and an HTTP status. */
export interface TbaAnswer {
  status: number
  body: string
}

interface Saved extends TbaAnswer {
  lastModified: string | null
  checkedAt: number
}

const MAX_SAVED = 500

/**
 * Ask TBA, with a short memory so it isn't asked the same thing over and
 * over: an answer less than `freshFor` milliseconds old is reused, and an
 * older one is checked with If-Modified-Since, which TBA answers with a
 * quick "not modified" when nothing changed. Twenty phones refreshing the
 * rankings cost TBA one request a minute.
 */
export function createTba(key: string, options: { fetch?: typeof fetch; now?: () => number; freshFor?: number } = {}) {
  const get = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const freshFor = options.freshFor ?? 60_000
  const saved = new Map<string, Saved>()

  return async function ask(path: string): Promise<TbaAnswer> {
    const last = saved.get(path)
    if (last && now() - last.checkedAt < freshFor) return last
    const headers: Record<string, string> = { 'X-TBA-Auth-Key': key, Accept: 'application/json' }
    if (last?.lastModified) headers['If-Modified-Since'] = last.lastModified

    let response: Response
    try {
      response = await get(TBA_API + path, { headers })
    } catch {
      // TBA can't be reached: an older answer is better than none.
      return last ?? problem(502, "Couldn't reach The Blue Alliance. Try again in a minute.")
    }
    if (response.status === 304 && last) {
      last.checkedAt = now()
      return last
    }
    if (!response.ok) {
      if (response.status === 401) return problem(502, 'The Blue Alliance turned down the key. A mentor should check the TBA_KEY secret.')
      if (response.status === 404) return problem(404, 'The Blue Alliance has nothing for that. Check the event key or team number.')
      return last ?? problem(502, `The Blue Alliance had a problem (${response.status}). Try again in a minute.`)
    }

    const answer: Saved = { status: 200, body: await response.text(), lastModified: response.headers.get('Last-Modified'), checkedAt: now() }
    if (saved.size >= MAX_SAVED) saved.clear()
    saved.set(path, answer)
    return answer
  }
}

function problem(status: number, error: string): TbaAnswer {
  return { status, body: JSON.stringify({ error }) }
}
