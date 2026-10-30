/**
 * What the `onshape` server function asks Onshape, and how it reads the
 * answers. Kept apart from index.ts so supabase/tests can test it: plain
 * TypeScript, no Deno.
 *
 * The app can only ask for a system's parts, from a link to an assembly or
 * Part Studio on cad.onshape.com; for parts' shapes, for the CNC router;
 * for where parts sit in a sheet's layout assembly; or check that the keys
 * work. So the team's Onshape keys can't be used for anything else.
 */
import type { OnshapeShape } from './shape.ts'

export const ONSHAPE = 'https://cad.onshape.com'

/** A tab in an Onshape document, from its address. */
export interface OnshapeLink {
  documentId: string
  /** w: a workspace, v: a version, m: a microversion. */
  wvm: 'w' | 'v' | 'm'
  wvmId: string
  elementId: string
}

/** One part from Onshape, ready for the app's BOM. */
export interface OnshapeLine {
  /** Which part it is in Onshape: document, tab, part and configuration. */
  onshape_id: string
  name: string
  part_number: string | null
  revision: string | null
  /** A whole number, 1 or more. */
  quantity: number
  material: string | null
  vendor: string | null
  /** From Onshape's standard content library (bolts, nuts and so on): bought, not made. */
  standard: boolean
  /** Opens the part's tab in Onshape. */
  url: string
}

/** The answer to a `bom` request. */
export interface OnshapeBom {
  /** The tab's name in Onshape, like "Intake assembly". */
  name: string
  kind: 'assembly' | 'partstudio'
  lines: OnshapeLine[]
}

const ID = '[0-9a-f]{24}'
const LINK = new RegExp(`^https://cad\\.onshape\\.com/documents/(${ID})/([wvm])/(${ID})/e/(${ID})/?(?:[?#].*)?$`)

/** The document, workspace (or version) and tab in an Onshape address, or null if it isn't one. */
export function parseOnshapeLink(url: string): OnshapeLink | null {
  const m = url.trim().match(LINK)
  return m ? { documentId: m[1], wvm: m[2] as OnshapeLink['wvm'], wvmId: m[3], elementId: m[4] } : null
}

/** A part to read the shape of, from a `shapes` request. */
export interface ShapeAsk {
  /** The part's onshape_id from the BOM: document/tab/part, and ?configuration if it has one. */
  onshape_id: string
  partId: string
  configuration: string | null
  /** The part's version when it was last read, to skip it if it hasn't changed. */
  known: string | null
}

/** The most parts one `shapes` request can read: each costs one of the team's yearly Onshape API calls. */
export const MOST_SHAPES = 25

export type OnshapeRequest =
  | { kind: 'check' }
  | { kind: 'bom'; link: OnshapeLink }
  | { kind: 'shapes'; link: OnshapeLink; parts: ShapeAsk[] }
  | { kind: 'layout'; link: OnshapeLink }

const NOT_A_LINK = "That isn't a link to an Onshape tab. Open it in Onshape and copy the address from the browser."

/** What the app asked for, or why it isn't allowed. */
export function onshapeRequest(body: unknown): OnshapeRequest | { error: string } {
  const r = (body ?? {}) as Record<string, unknown>
  if (r.kind === 'check') return { kind: 'check' }
  if (r.kind !== 'bom' && r.kind !== 'shapes' && r.kind !== 'layout') {
    return { error: 'Ask for a bom (with a system’s Onshape link), shapes (with a Part Studio link and parts), a layout (with an assembly link), or check.' }
  }
  const link = typeof r.url === 'string' ? parseOnshapeLink(r.url) : null
  if (!link) return { error: r.kind === 'bom' ? "That isn't a link to an Onshape tab. Open the system's assembly in Onshape and copy the address from the browser." : NOT_A_LINK }
  if (r.kind === 'bom' || r.kind === 'layout') return { kind: r.kind, link }

  const asked = Array.isArray(r.parts) ? r.parts : []
  if (asked.length === 0 || asked.length > MOST_SHAPES) return { error: `Ask for 1 to ${MOST_SHAPES} parts at a time.` }
  const parts: ShapeAsk[] = []
  for (const part of asked as Record<string, unknown>[]) {
    const id = typeof part?.id === 'string' ? part.id : ''
    const ask = shapeAsk(id, link, typeof part?.known === 'string' && part.known.length <= 100 ? part.known : null)
    if (!ask) return { error: `${id || 'A part'} isn't a part in that Part Studio. Import the system from Onshape again.` }
    parts.push(ask)
  }
  return { kind: 'shapes', link, parts }
}

/** Read a BOM onshape_id (document/tab/part?configuration) for a part in the linked tab, or null if it isn't one. */
export function shapeAsk(onshapeId: string, link: OnshapeLink, known: string | null = null): ShapeAsk | null {
  const m = onshapeId.match(/^([0-9a-f]{24})\/([0-9a-f]{24})\/([^/?#\s]{1,64})(?:\?(.{1,500}))?$/)
  if (!m || m[1] !== link.documentId || m[2] !== link.elementId) return null
  return { onshape_id: onshapeId, partId: m[3], configuration: m[4] ?? null, known }
}

const base = (link: OnshapeLink) => `/d/${link.documentId}/${link.wvm}/${link.wvmId}`

/** The Onshape API addresses the function uses. */
export const paths = {
  // Any document the keys can read: a cheap way to check they work.
  check: '/api/v6/documents?limit=1',
  element: (link: OnshapeLink) => `/api/v6/documents${base(link)}/elements?elementId=${link.elementId}`,
  // indented=false flattens sub-assemblies into one list of parts.
  bom: (link: OnshapeLink) => `/api/v6/assemblies${base(link)}/e/${link.elementId}/bom?indented=false`,
  parts: (link: OnshapeLink) => `/api/v9/parts${base(link)}/e/${link.elementId}`,
  // Every edge of one part, as lines of points: its shape for the CNC router.
  edges: (link: OnshapeLink, part: Pick<ShapeAsk, 'partId' | 'configuration'>) =>
    `/api/v6/parts${base(link)}/e/${link.elementId}/partid/${encodeURIComponent(part.partId)}/tessellatededges` +
    (part.configuration ? `?configuration=${encodeURIComponent(part.configuration)}` : ''),
  // Where every part in an assembly sits, for a sheet's layout.
  assembly: (link: OnshapeLink) => `/api/v6/assemblies${base(link)}/e/${link.elementId}?excludeSuppressed=true`,
}

// Onshape's IDs for its standard properties, as BOM headers use them.
const PROPERTY = {
  name: '57f3fb8efa3416c06701d60d',
  partNumber: '57f3fb8efa3416c06701d60f',
  revision: '57f3fb8efa3416c06701d610',
  quantity: '5ace84d3c046ad611c65a0dd',
  material: '57f3fb8efa3416c06701d615',
  vendor: '57f3fb8efa3416c06701d612',
} as const
type Property = keyof typeof PROPERTY

/** Text from a BOM value: a string, a number, or an object with a display name (materials). */
function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    return text(v.displayName ?? v.name ?? v.value)
  }
  return null
}

function quantity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(text(value))
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : 1
}

function tabUrl(documentId: string, wvm: string, wvmId: string, elementId: string): string {
  return `${ONSHAPE}/documents/${documentId}/${wvm}/${wvmId}/e/${elementId}`
}

interface BomHeader {
  id?: string
  name?: string
  propertyName?: string
}
interface BomRow {
  name?: string
  headerIdToValue?: Record<string, unknown>
  itemSource?: {
    documentId?: string
    elementId?: string
    partId?: string
    configuration?: string
    wvmType?: string
    wvmId?: string
    isStandardContent?: boolean
    nonGeometricItemId?: string
  }
}

/**
 * The parts in an assembly's flattened BOM. Values are found by Onshape's
 * property IDs, or by the column's name if a team renamed nothing but
 * Onshape changed its IDs.
 */
export function bomLines(bom: unknown, link: OnshapeLink): OnshapeLine[] {
  const b = (bom ?? {}) as { headers?: BomHeader[]; rows?: BomRow[] }
  const headers = b.headers ?? []
  const names: Record<Property, string[]> = {
    name: ['name'],
    partNumber: ['partnumber', 'part number'],
    revision: ['revision'],
    quantity: ['quantity'],
    material: ['material'],
    vendor: ['vendor'],
  }
  const columnOf = (property: Property): string | null => {
    const byId = headers.find((h) => h.id === PROPERTY[property])
    const byName = headers.find((h) => names[property].includes((h.propertyName ?? h.name ?? '').toLowerCase()))
    return (byId ?? byName)?.id ?? (headers.length ? null : PROPERTY[property])
  }
  const column = Object.fromEntries((Object.keys(PROPERTY) as Property[]).map((p) => [p, columnOf(p)])) as Record<Property, string | null>

  const lines = new Map<string, OnshapeLine>()
  for (const row of b.rows ?? []) {
    const source = row.itemSource ?? {}
    const value = (p: Property) => (column[p] ? row.headerIdToValue?.[column[p]!] : undefined)
    const documentId = source.documentId ?? link.documentId
    const elementId = source.elementId ?? link.elementId
    let id: string
    if (source.partId) id = `${documentId}/${elementId}/${source.partId}${source.configuration && source.configuration !== 'default' ? `?${source.configuration}` : ''}`
    else if (source.nonGeometricItemId) id = `${documentId}/item/${source.nonGeometricItemId}`
    else continue // A sub-assembly row: its parts are listed on their own.

    const line: OnshapeLine = {
      onshape_id: id,
      name: text(value('name')) ?? text(row.name) ?? 'Unnamed part',
      part_number: text(value('partNumber')),
      revision: text(value('revision')),
      quantity: quantity(value('quantity')),
      material: text(value('material')),
      vendor: text(value('vendor')),
      standard: Boolean(source.isStandardContent),
      url: tabUrl(documentId, source.wvmType ?? link.wvm, source.wvmId ?? link.wvmId, elementId),
    }
    // The same part twice (it shouldn't happen when flattened): add them up.
    const same = lines.get(id)
    if (same) same.quantity += line.quantity
    else lines.set(id, line)
  }
  return [...lines.values()]
}

interface StudioPart {
  name?: string
  partId?: string
  partNumber?: string | null
  revision?: string | null
  material?: unknown
  bodyType?: string
  customProperties?: Record<string, string>
}

/** The solid parts in a Part Studio, one of each. */
export function partStudioLines(parts: unknown, link: OnshapeLink): OnshapeLine[] {
  return (Array.isArray(parts) ? (parts as StudioPart[]) : [])
    .filter((p) => p.partId && (p.bodyType ?? 'solid') === 'solid')
    .map((p) => ({
      onshape_id: `${link.documentId}/${link.elementId}/${p.partId}`,
      name: text(p.name) ?? 'Unnamed part',
      part_number: text(p.partNumber),
      revision: text(p.revision),
      quantity: 1,
      material: text(p.material),
      vendor: null,
      standard: false,
      url: tabUrl(link.documentId, link.wvm, link.wvmId, link.elementId),
    }))
}

/** Each part's version in a Part Studio, from the same answer partStudioLines reads. */
export function partVersions(parts: unknown): Map<string, string> {
  const versions = new Map<string, string>()
  for (const p of Array.isArray(parts) ? (parts as { partId?: unknown; microversionId?: unknown }[]) : []) {
    if (typeof p.partId === 'string') versions.set(p.partId, typeof p.microversionId === 'string' ? p.microversionId : '')
  }
  return versions
}

/** The answer to a `shapes` request. Parts that haven't changed since `known` aren't read again. */
export interface OnshapeShapes {
  shapes: OnshapeShape[]
  /** onshape_ids of parts that haven't changed. */
  unchanged: string[]
  /** onshape_ids of parts no longer in the Part Studio. */
  missing: string[]
}

/** Where one part sits in a layout assembly. */
export interface OnshapePlacement {
  /** Which Onshape part, the same way the BOM's onshape_id says it. */
  onshape_id: string
  /** The part's name in the assembly, like "Side plate <2>". */
  name: string
  /**
   * How the part is moved and turned into place: 16 numbers, a 4 x 4
   * matrix row by row, as Onshape gives it, but with the move (the 4th,
   * 8th and 12th numbers) in inches.
   */
  transform: number[]
}

/** The answer to a `layout` request. */
export interface OnshapeLayout {
  placements: OnshapePlacement[]
}

interface AssemblyInstance {
  id?: string
  name?: string
  type?: string
  documentId?: string
  elementId?: string
  partId?: string
  configuration?: string
  suppressed?: boolean
  isStandardContent?: boolean
}
interface Assembly {
  documentId?: string
  elementId?: string
  configuration?: string
  instances?: AssemblyInstance[]
  occurrences?: { path?: string[]; transform?: number[]; hidden?: boolean }[]
}

/**
 * Every part in a layout assembly, including inside sub-assemblies, with
 * where it sits. Hidden and suppressed parts, and standard content like
 * screws, are left out.
 */
export function layoutPlacements(definition: unknown): OnshapePlacement[] {
  const d = (definition ?? {}) as { rootAssembly?: Assembly; subAssemblies?: Assembly[] }
  const root = d.rootAssembly ?? {}
  const subs = d.subAssemblies ?? []
  const placements: OnshapePlacement[] = []
  for (const occurrence of root.occurrences ?? []) {
    const path = occurrence.path ?? []
    const transform = occurrence.transform ?? []
    if (path.length === 0 || occurrence.hidden || transform.length !== 16 || !transform.every(Number.isFinite)) continue
    // Follow the path down through sub-assemblies to the part.
    let instances = root.instances ?? []
    let instance: AssemblyInstance | undefined
    for (const [i, id] of path.entries()) {
      instance = instances.find((x) => x.id === id)
      if (!instance || instance.suppressed) break
      if (i < path.length - 1) {
        const sub =
          subs.find((s) => s.documentId === instance!.documentId && s.elementId === instance!.elementId && (s.configuration ?? '') === (instance!.configuration ?? '')) ??
          subs.find((s) => s.documentId === instance!.documentId && s.elementId === instance!.elementId)
        instances = sub?.instances ?? []
      }
    }
    if (!instance || instance.suppressed || instance.type !== 'Part' || instance.isStandardContent) continue
    if (!instance.documentId || !instance.elementId || !instance.partId) continue
    const configuration = instance.configuration && instance.configuration !== 'default' ? `?${instance.configuration}` : ''
    placements.push({
      onshape_id: `${instance.documentId}/${instance.elementId}/${instance.partId}${configuration}`,
      name: text(instance.name) ?? 'Unnamed part',
      transform: transform.map((n, i) => (i === 3 || i === 7 || i === 11 ? n / 0.0254 : n)),
    })
  }
  return placements
}

/** What to tell the person when Onshape says no. */
export function onshapeProblem(status: number): string {
  if (status === 401) return 'Onshape turned down the keys. A mentor should check the ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY secrets.'
  if (status === 403) return "The Onshape account behind the keys can't open that document. Share the document with that account."
  if (status === 404) return "Onshape can't find that tab. Check the system's Onshape link."
  if (status === 429) return 'Onshape asked us to slow down. Try again in a few minutes.'
  return `Onshape had a problem (${status}). Try again in a minute.`
}

/** A small Onshape client: GET with the keys (Basic authorization), and the JSON answer or a problem. */
export function createOnshape(accessKey: string, secretKey: string, get: typeof fetch = fetch) {
  const authorization = `Basic ${btoa(`${accessKey}:${secretKey}`)}`
  return async function onshape(path: string): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
    let response: Response
    try {
      response = await get(ONSHAPE + path, { headers: { Authorization: authorization, Accept: 'application/json;charset=UTF-8; qs=0.09' } })
    } catch {
      return { ok: false, status: 502, error: "Couldn't reach Onshape. Try again in a minute." }
    }
    if (!response.ok) return { ok: false, status: response.status === 404 || response.status === 403 ? response.status : 502, error: onshapeProblem(response.status) }
    return { ok: true, data: await response.json() }
  }
}
