/**
 * Files for the machines (#24): a part's STEP or STL, straight from
 * Onshape, for whoever is at the lathe, mill, router or 3D printer. Kept
 * apart from index.ts (and from the other requests in onshape.ts) so
 * supabase/tests can test it: plain TypeScript, no Deno.
 *
 * The app sends only which part (its id in bom_parts) and which kind of
 * file. index.ts reads the part from the database with the caller's own
 * sign-in, so the keys can only fetch parts that are in the team's BOM, and
 * the part's Onshape link and id come from there, not from the browser.
 *
 * - STL (3D printer): one call. Onshape answers the file straight away,
 *   usually by sending us on to another of its servers first.
 * - STEP (lathe, mill, CAM): Onshape makes it in the background. One call
 *   to start it, a few to ask if it's done, and one to fetch it: usually
 *   4 to 6 calls in all.
 * - DXF of a flat face (laser, router) and 3MF aren't here yet: see the
 *   BOM README's "Files for the machines".
 *
 * Onshape limits API calls per year, so the app only asks when someone
 * presses Download.
 */
import { ONSHAPE, onshapeProblem, parseOnshapeLink, shapeAsk, type OnshapeLink } from './onshape.ts'

/** The kinds of file this function can fetch. */
export const FILE_FORMATS = ['step', 'stl'] as const
export type PartFileFormat = (typeof FILE_FORMATS)[number]

/** The biggest file it passes on: 20 MB. A robot part's STEP or STL is far smaller. */
export const MOST_BYTES = 20 * 1024 * 1024

/**
 * How long to wait before each check on a STEP that's being made, in
 * milliseconds: soon at first, then less often. Each check is an API call,
 * and after these (about a minute in all) it gives up.
 */
export const STEP_WAITS = [1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 10000, 10000]

/** A `file` request from the app: which part, and which kind of file. */
export interface FileRequest {
  part: string
  format: PartFileFormat
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Is this a request for a part's file? (The other requests are in onshape.ts.) */
export function isFileRequest(body: unknown): boolean {
  return (body as { kind?: unknown } | null)?.kind === 'file'
}

/** What the app asked for, or why it isn't allowed. */
export function fileRequest(body: unknown): FileRequest | { error: string } {
  const r = (body ?? {}) as Record<string, unknown>
  if (r.kind !== 'file') return { error: 'Ask for a file, with a part and a format.' }
  if (typeof r.part !== 'string' || !UUID.test(r.part)) return { error: "That isn't a part in the BOM. Reload the page and try again." }
  if (!FILE_FORMATS.includes(r.format as PartFileFormat)) return { error: 'The app can download STEP and STL files so far.' }
  return { part: r.part, format: r.format as PartFileFormat }
}

/** The columns of bom_parts this needs. */
export interface FilePart {
  name: string
  onshape_url: string | null
  onshape_id: string | null
  removed_in_onshape: boolean
}

/** Where a part is in Onshape: its Part Studio, its id there, and its configuration. */
export interface PartSource {
  link: OnshapeLink
  partId: string
  configuration: string | null
}

/** Where to fetch a part from, or why it can't be (written for the person). */
export function partSource(part: FilePart | null): PartSource | { error: string; status: number } {
  if (!part) return { error: "That part isn't in the BOM any more. Reload the page.", status: 404 }
  if (part.removed_in_onshape) return { error: `${part.name} has been removed in Onshape, so there's no file to download.`, status: 400 }
  const link = part.onshape_url ? parseOnshapeLink(part.onshape_url) : null
  const ask = link && part.onshape_id ? shapeAsk(part.onshape_id, link) : null
  if (!link || !ask) {
    return { error: `The app doesn't know which Onshape part ${part.name} is. Import its system from Onshape, then try again.`, status: 400 }
  }
  return { link, partId: ask.partId, configuration: ask.configuration }
}

const base = (link: OnshapeLink) => `/d/${link.documentId}/${link.wvm}/${link.wvmId}/e/${link.elementId}`
const configured = (configuration: string | null) => (configuration ? `&configuration=${encodeURIComponent(configuration)}` : '')

/** The Onshape API addresses for files. */
export const filePaths = {
  // A binary STL in millimeters, which is what slicers expect.
  stl: (s: PartSource) =>
    `/api/v6/partstudios${base(s.link)}/stl?partIds=${encodeURIComponent(s.partId)}&mode=binary&units=millimeter&grouping=true${configured(s.configuration)}`,
  // Starting a STEP (a "translation"). Onshape only makes these from a workspace or a version.
  translate: (s: PartSource) => `/api/v6/partstudios${base(s.link)}/translations`,
  translation: (id: string) => `/api/v6/translations/${encodeURIComponent(id)}`,
  download: (documentId: string, fileId: string) => `/api/v6/documents/d/${encodeURIComponent(documentId)}/externaldata/${encodeURIComponent(fileId)}`,
}

/** What to send Onshape to start making a part's STEP. Not stored in the document, so it isn't cluttered. */
export function stepTranslation(s: PartSource): Record<string, unknown> {
  return {
    formatName: 'STEP',
    partIds: s.partId,
    storeInDocument: false,
    ...(s.configuration ? { configuration: s.configuration } : {}),
  }
}

/** How a STEP being made is getting on, from Onshape's answer. */
export type TranslationState =
  | { state: 'active'; id: string }
  | { state: 'done'; documentId: string; fileId: string }
  | { state: 'failed'; reason: string }

/** Read Onshape's answer about a translation: still going, done (and where the file is), or failed. */
export function readTranslation(answer: unknown, documentId: string): TranslationState {
  const a = (answer ?? {}) as { id?: unknown; requestState?: unknown; resultExternalDataIds?: unknown; resultDocumentId?: unknown; documentId?: unknown; failureReason?: unknown }
  const fileId = Array.isArray(a.resultExternalDataIds) && typeof a.resultExternalDataIds[0] === 'string' ? a.resultExternalDataIds[0] : null
  const doc = [a.resultDocumentId, a.documentId].find((d): d is string => typeof d === 'string' && d.length > 0) ?? documentId
  if (a.requestState === 'DONE' && fileId) return { state: 'done', documentId: doc, fileId }
  if (a.requestState === 'ACTIVE' && typeof a.id === 'string') return { state: 'active', id: a.id }
  const reason = typeof a.failureReason === 'string' && a.failureReason.trim() ? a.failureReason.trim() : 'no reason given'
  return { state: 'failed', reason }
}

const ascii = (bytes: Uint8Array, length: number) => String.fromCharCode(...bytes.subarray(0, length))

/**
 * Does this look like the kind of file asked for? So a page of JSON or an
 * error is never handed to someone as their part.
 * - STEP is text that starts with ISO-10303-21;
 * - A binary STL is an 80-byte header, the number of triangles, then 50
 *   bytes for each triangle. A text STL starts with "solid".
 */
export function looksLike(format: PartFileFormat, bytes: Uint8Array): boolean {
  if (format === 'step') return ascii(bytes, 64).trimStart().startsWith('ISO-10303-21')
  if (bytes.length >= 84) {
    const triangles = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true)
    if (triangles > 0 && 84 + 50 * triangles === bytes.length) return true
  }
  return ascii(bytes, 64).trimStart().startsWith('solid') && ascii(bytes.subarray(-128), 128).includes('endsolid')
}

/** Only Onshape's own servers get the keys, when Onshape sends us on to another one. */
export function isOnshapeServer(address: string): boolean {
  try {
    const url = new URL(address)
    return url.protocol === 'https:' && (url.hostname === 'onshape.com' || url.hostname.endsWith('.onshape.com'))
  } catch {
    return false
  }
}

const tooBig = `That file is bigger than ${MOST_BYTES / 1024 / 1024} MB, too big to pass on. Export it from Onshape instead.`

type Problem = { ok: false; status: number; error: string }
export type FileAnswer = { ok: true; bytes: Uint8Array<ArrayBuffer>; calls: number } | (Problem & { calls: number })

/** What to say when Onshape says no to a file. A missing part means its link is out of date. */
function fileProblem(status: number): Problem {
  if (status === 404) return { ok: false, status: 404, error: "Onshape can't find that part any more. Import its system from Onshape again." }
  return { ok: false, status: status === 403 ? 403 : 502, error: onshapeProblem(status) }
}

/** Read a body up to MOST_BYTES, stopping as soon as it's bigger. */
async function readCapped(response: Response): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(response.headers.get('Content-Length') ?? 0) > MOST_BYTES) return null
  if (!response.body) return new Uint8Array(await response.arrayBuffer())
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MOST_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return bytes
}

/**
 * Fetches a part's file from Onshape with the keys. `get` and `wait` can be
 * swapped in the tests for a made-up Onshape that answers at once.
 */
export function createOnshapeFiles(
  accessKey: string,
  secretKey: string,
  get: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
) {
  const authorization = `Basic ${btoa(`${accessKey}:${secretKey}`)}`

  /** A part's file, and how many Onshape API calls it took. */
  return async function partFile(source: PartSource, format: PartFileFormat): Promise<FileAnswer> {
    // Counted for each file, so two people downloading at once don't mix up their counts.
    let calls = 0

    /** One call to Onshape. Redirects are followed by hand, so the keys only ever go to Onshape's servers. */
    async function call(path: string, init: { method?: string; body?: unknown; accept: string }): Promise<Response | Problem> {
      let address = ONSHAPE + path
      for (let hop = 0; hop < 4; hop += 1) {
        let response: Response
        calls += 1
        try {
          response = await get(address, {
            method: init.method ?? 'GET',
            redirect: 'manual',
            headers: {
              Authorization: authorization,
              Accept: init.accept,
              ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(init.body ? { body: JSON.stringify(init.body) } : {}),
          })
        } catch {
          return { ok: false, status: 502, error: "Couldn't reach Onshape. Try again in a minute." }
        }
        if (response.status >= 300 && response.status < 400) {
          const next = response.headers.get('Location')
          if (!next) break
          address = new URL(next, address).toString()
          if (!isOnshapeServer(address)) break
          continue
        }
        return response.ok ? response : fileProblem(response.status)
      }
      return { ok: false, status: 502, error: 'Onshape sent the file somewhere unexpected. A mentor can check the onshape function’s logs.' }
    }

    const JSON_ACCEPT = 'application/json;charset=UTF-8; qs=0.09'
    const FILE_ACCEPT = 'application/vnd.onshape.v1+octet-stream, application/octet-stream;q=0.9, */*;q=0.1'

    async function json(path: string, body?: unknown): Promise<{ ok: true; data: unknown } | Problem> {
      const response = await call(path, { method: body ? 'POST' : 'GET', body, accept: JSON_ACCEPT })
      if (!(response instanceof Response)) return response
      try {
        return { ok: true, data: await response.json() }
      } catch {
        return { ok: false, status: 502, error: 'Onshape sent an answer the app couldn’t read. Try again in a minute.' }
      }
    }

    async function file(path: string, format: PartFileFormat): Promise<{ ok: true; bytes: Uint8Array<ArrayBuffer> } | Problem> {
      const response = await call(path, { accept: FILE_ACCEPT })
      if (!(response instanceof Response)) return response
      const bytes = await readCapped(response)
      if (!bytes) return { ok: false, status: 413, error: tooBig }
      if (!looksLike(format, bytes)) return { ok: false, status: 502, error: `Onshape didn't send a ${format.toUpperCase()} file. Try again, or export it from Onshape.` }
      return { ok: true, bytes }
    }

    async function step(source: PartSource): Promise<{ ok: true; bytes: Uint8Array<ArrayBuffer> } | Problem> {
      if (source.link.wvm === 'm') {
        return { ok: false, status: 400, error: 'That part is linked to an old point in its document’s history. Import its system from Onshape again.' }
      }
      const started = await json(filePaths.translate(source), stepTranslation(source))
      if (!started.ok) return started
      let state = readTranslation(started.data, source.link.documentId)
      for (const ms of STEP_WAITS) {
        if (state.state !== 'active') break
        await wait(ms)
        const checked = await json(filePaths.translation(state.id))
        if (!checked.ok) return checked
        state = readTranslation(checked.data, source.link.documentId)
      }
      if (state.state === 'active') return { ok: false, status: 504, error: 'Onshape is taking too long to make the STEP. Try again in a few minutes.' }
      if (state.state === 'failed') return { ok: false, status: 502, error: `Onshape couldn't make the STEP (${state.reason}). Try exporting it from Onshape.` }
      return file(filePaths.download(state.documentId, state.fileId), 'step')
    }

    const answer = format === 'stl' ? await file(filePaths.stl(source), 'stl') : await step(source)
    return { ...answer, calls }
  }
}
