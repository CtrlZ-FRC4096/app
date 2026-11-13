/**
 * What the `nexus` server function asks Nexus (frc.nexus), kept apart from
 * index.ts so supabase/tests can test it: plain TypeScript, no Deno.
 *
 * Nexus shows what's happening at an event right now: which match is on the
 * field, which teams should be queuing, and announcements (#165). The app
 * can only ask for one event's live status, so the team's Nexus key can't
 * be used for anything else. Docs: https://frc.nexus/api
 */

export const NEXUS_API = 'https://frc.nexus/api/v1'

/** What the app can ask for. The same shape is in src/modules/scouting/data.ts. */
export type NexusRequest = { kind: 'status'; event: string }

// Event keys are the same as The Blue Alliance's: the year and a short code, like 2026ilch.
const EVENT_KEY = /^\d{4}[a-z0-9]{1,16}$/

/** The Nexus address for a request from the app, or why it isn't allowed. */
export function nexusPath(request: unknown): { path: string } | { error: string } {
  const r = (request ?? {}) as Record<string, unknown>
  if (r.kind !== 'status') return { error: 'Ask for: status.' }
  if (typeof r.event !== 'string' || !EVENT_KEY.test(r.event)) return { error: 'Ask with an event key, like 2026ilch.' }
  return { path: `/event/${r.event}` }
}

/** An answer to pass on to the app: JSON text and an HTTP status. */
export interface NexusAnswer {
  status: number
  body: string
}

interface Saved extends NexusAnswer {
  checkedAt: number
}

const MAX_SAVED = 50

/**
 * Ask Nexus, remembering answers for `freshFor` milliseconds (30 seconds
 * unless a test says otherwise). Queuing changes every few minutes, so a
 * stand full of phones costs one request every 30 seconds, not one each.
 */
export function createNexus(key: string, options: { fetch?: typeof fetch; now?: () => number; freshFor?: number } = {}) {
  const get = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const freshFor = options.freshFor ?? 30_000
  const saved = new Map<string, Saved>()

  return async function ask(path: string): Promise<NexusAnswer> {
    const last = saved.get(path)
    if (last && now() - last.checkedAt < freshFor) return last

    let response: Response
    try {
      response = await get(NEXUS_API + path, { headers: { 'Nexus-Api-Key': key, Accept: 'application/json' } })
    } catch {
      // Nexus can't be reached: an older answer is better than none.
      return last ?? problem(502, "Couldn't reach Nexus. Try again in a minute.")
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return problem(502, 'Nexus turned down the key. A mentor should check the NEXUS_KEY secret.')
      if (response.status === 404) return problem(404, "Nexus doesn't have this event. Not every event uses Nexus.")
      if (response.status === 429) return last ?? problem(503, 'The team has asked Nexus too many times. Try again in a minute.')
      return last ?? problem(502, `Nexus had a problem (${response.status}). Try again in a minute.`)
    }

    const answer: Saved = { status: 200, body: await response.text(), checkedAt: now() }
    if (saved.size >= MAX_SAVED) saved.clear()
    saved.set(path, answer)
    return answer
  }
}

function problem(status: number, error: string): NexusAnswer {
  return { status, body: JSON.stringify({ error }) }
}
