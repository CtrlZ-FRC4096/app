/**
 * Writing team part numbers into Onshape (#21): the `part-numbers` request
 * of the onshape server function. Kept apart from index.ts so
 * supabase/tests/onshape-numbers.test.ts can test it with a made-up
 * Onshape: plain TypeScript, no Deno.
 *
 * What it allows, checked here on the server whatever the app sends:
 * - Only student leaders, mentors and admins can ask: the people who
 *   change parts.
 * - Only into a workspace (a /w/ link). Onshape doesn't let a version
 *   change.
 * - Only team numbers like 4096-26-INT-014, only into the Part number
 *   property, and only for parts in the system's own document. Nothing else
 *   in Onshape can be changed this way.
 *
 * It costs one Onshape API call to read each Part Studio's parts, then one
 * for each part whose number is different. Parts that already match aren't
 * written, so writing again costs little.
 */
import { ONSHAPE, onshapeProblem, parseOnshapeLink, paths, type OnshapeLink } from './onshape.ts'

/** The most parts one request can write. The app sends bigger systems in batches. */
export const MOST_NUMBERS = 100

/** The roles that can write part numbers: student leaders, mentors and admins. */
const LEADER_ROLES = ['leader', 'mentor', 'admin']

/** A team part number. The same pattern is in src/modules/bom/numbering.ts and the bom_part_counters migration. */
const TEAM_NUMBER = /^4096-\d{2}-[A-Z]{2,4}-\d{1,6}$/

/** Onshape's ID for the standard Part number property (the same as in onshape.ts). */
export const PART_NUMBER_PROPERTY = '57f3fb8efa3416c06701d60f'

/** One part to number, from the app's onshape_id: document/tab/part, and ?configuration if it has one. */
export interface NumberAsk {
  onshape_id: string
  documentId: string
  elementId: string
  partId: string
  configuration: string | null
  part_number: string
}

export interface PartNumbersRequest {
  /** The system's Onshape link: always a workspace. */
  link: OnshapeLink
  parts: NumberAsk[]
}

/** The answer to a `part-numbers` request. The same shape is in src/modules/bom/data.ts. */
export interface OnshapeNumbersAnswer {
  /** How many parts' numbers were changed in Onshape. */
  written: number
  /** How many already had the right number, so weren't changed. */
  unchanged: number
  /** Parts that couldn't be written, and why, for people: "it's from another Onshape document". */
  skipped: { onshape_id: string; reason: string }[]
}

const LEADERS_ONLY = 'Only student leaders and mentors can write part numbers into Onshape. Ask one of them.'
const VERSION_LINK =
  "This system's Onshape link is to a version, which can't be changed. Change system, and paste the workspace's address instead: open the document's Main workspace in Onshape and copy the address (it has /w/ in it)."

/** What the app asked to write, or why it isn't allowed, with the status to answer. */
export function partNumbersRequest(body: unknown, role: string): PartNumbersRequest | { error: string; status: number } {
  if (!LEADER_ROLES.includes(role)) return { error: LEADERS_ONLY, status: 403 }
  const r = (body ?? {}) as Record<string, unknown>
  const link = typeof r.url === 'string' ? parseOnshapeLink(r.url) : null
  if (!link) return { error: "That isn't a link to an Onshape tab. Change system, and paste the assembly's address from Onshape.", status: 400 }
  if (link.wvm !== 'w') return { error: VERSION_LINK, status: 400 }

  const asked = Array.isArray(r.parts) ? (r.parts as Record<string, unknown>[]) : []
  if (asked.length === 0 || asked.length > MOST_NUMBERS) return { error: `Send 1 to ${MOST_NUMBERS} parts at a time.`, status: 400 }
  const parts: NumberAsk[] = []
  for (const part of asked) {
    const id = typeof part?.id === 'string' ? part.id : ''
    const number = typeof part?.part_number === 'string' ? part.part_number : ''
    const m = id.match(/^([0-9a-f]{24})\/([^/?#\s]{1,64})\/([^/?#\s]{1,64})(?:\?(.{1,500}))?$/)
    if (!m) return { error: `${id || 'A part'} isn't a part from Onshape. Import the system from Onshape again.`, status: 400 }
    if (!TEAM_NUMBER.test(number)) return { error: `${number || 'A part number'} isn't a team part number like 4096-26-INT-001, so it can't be written into Onshape.`, status: 400 }
    if (parts.some((p) => p.onshape_id === id)) return { error: `${id} was sent twice. Send each part once.`, status: 400 }
    parts.push({ onshape_id: id, documentId: m[1], elementId: m[2], partId: m[3], configuration: m[4] ?? null, part_number: number })
  }
  return { link, parts }
}

/** Why a part can't be written, for people, or null if it can. */
export function skipReason(ask: NumberAsk, link: OnshapeLink): string | null {
  if (ask.documentId !== link.documentId) return "it's from another Onshape document, so number it there"
  if (!/^[0-9a-f]{24}$/.test(ask.elementId)) return "it isn't a part in a Part Studio"
  if (ask.configuration) return 'it has configurations, so type its part number into Onshape by hand'
  return null
}

/** The Onshape API address for one part's properties, in a workspace. */
export function partMetadataPath(link: OnshapeLink, elementId: string, partId: string): string {
  return `/api/v6/metadata/d/${link.documentId}/w/${link.wvmId}/e/${elementId}/p/${encodeURIComponent(partId)}`
}

type Answer = { ok: true; data: unknown } | { ok: false; status: number; error: string }
type Read = (path: string) => Promise<Answer>
type Write = (path: string, body: unknown) => Promise<Answer>

/**
 * Write the numbers. `read` is the onshape() reader from onshape.ts, and
 * `write` one from createOnshapeWriter(). Parts are grouped by Part Studio:
 * each one's parts are read once, and only parts with a different number
 * are written. If Onshape says no partway, it stops and says how many it wrote.
 */
export async function writePartNumbers(
  request: PartNumbersRequest,
  read: Read,
  write: Write,
): Promise<{ ok: true; answer: OnshapeNumbersAnswer } | { ok: false; status: number; error: string }> {
  const answer: OnshapeNumbersAnswer = { written: 0, unchanged: 0, skipped: [] }
  const skip = (ask: NumberAsk, reason: string) => answer.skipped.push({ onshape_id: ask.onshape_id, reason })
  const stopped = (problem: { status: number; error: string }) => ({
    ok: false as const,
    status: problem.status,
    error: answer.written > 0
      ? `Wrote ${answer.written === 1 ? '1 part number' : `${answer.written} part numbers`}, then Onshape said no: ${problem.error}`
      : problem.error,
  })

  const byStudio = new Map<string, NumberAsk[]>()
  for (const ask of request.parts) {
    const reason = skipReason(ask, request.link)
    if (reason) skip(ask, reason)
    else byStudio.set(ask.elementId, [...(byStudio.get(ask.elementId) ?? []), ask])
  }

  for (const [elementId, asks] of byStudio) {
    const studio = { ...request.link, elementId }
    const parts = await read(paths.parts(studio))
    if (!parts.ok && parts.status === 404) {
      asks.forEach((ask) => skip(ask, "its Part Studio isn't in Onshape any more"))
      continue
    }
    if (!parts.ok) return stopped(parts)
    // Each part's Part number in Onshape now.
    const now = new Map(
      (Array.isArray(parts.data) ? (parts.data as { partId?: string; partNumber?: string | null }[]) : [])
        .filter((p) => p.partId)
        .map((p) => [p.partId!, (p.partNumber ?? '').trim()]),
    )
    for (const ask of asks) {
      if (!now.has(ask.partId)) skip(ask, "it isn't in its Part Studio any more")
      else if (now.get(ask.partId) === ask.part_number) answer.unchanged += 1
      else {
        const saved = await write(partMetadataPath(request.link, elementId, ask.partId), {
          properties: [{ propertyId: PART_NUMBER_PROPERTY, value: ask.part_number }],
        })
        if (!saved.ok) return stopped(saved)
        answer.written += 1
      }
    }
  }
  return { ok: true, answer }
}

/** What to tell the person when Onshape won't take a change. */
export function writeProblem(status: number): string {
  if (status === 403) {
    return "Onshape didn't let the keys change that document. A mentor should check the Onshape keys have \"Write to your documents\" ticked, and that the account behind them can edit the document."
  }
  return onshapeProblem(status)
}

/** A small Onshape client for changes: POST with the keys (Basic authorization), like createOnshape() in onshape.ts. */
export function createOnshapeWriter(accessKey: string, secretKey: string, send: typeof fetch = fetch): Write {
  const authorization = `Basic ${btoa(`${accessKey}:${secretKey}`)}`
  return async function write(path, body) {
    let response: Response
    try {
      response = await send(ONSHAPE + path, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          Accept: 'application/json;charset=UTF-8; qs=0.09',
          'Content-Type': 'application/json;charset=UTF-8; qs=0.09',
        },
        body: JSON.stringify(body),
      })
    } catch {
      return { ok: false, status: 502, error: "Couldn't reach Onshape. Try again in a minute." }
    }
    if (!response.ok) return { ok: false, status: response.status === 404 || response.status === 403 ? response.status : 502, error: writeProblem(response.status) }
    return { ok: true, data: null }
  }
}
