/**
 * What the `onshape` server function asks Onshape, and how it reads the
 * answers. Kept apart from index.ts so supabase/tests can test it: plain
 * TypeScript, no Deno.
 *
 * The app can only ask for a system's parts, from a link to an assembly or
 * Part Studio on cad.onshape.com, or check that the keys work. So the
 * team's Onshape keys can't be used for anything else.
 */

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

/** What the app asked for, or why it isn't allowed. */
export function onshapeRequest(body: unknown): { kind: 'check' } | { kind: 'bom'; link: OnshapeLink } | { error: string } {
  const r = (body ?? {}) as Record<string, unknown>
  if (r.kind === 'check') return { kind: 'check' }
  if (r.kind !== 'bom') return { error: 'Ask for a bom, with a system’s Onshape link, or check.' }
  const link = typeof r.url === 'string' ? parseOnshapeLink(r.url) : null
  return link
    ? { kind: 'bom', link }
    : { error: "That isn't a link to an Onshape tab. Open the system's assembly in Onshape and copy the address from the browser." }
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
