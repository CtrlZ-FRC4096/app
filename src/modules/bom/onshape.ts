/**
 * Importing a system's parts from Onshape (issue #19).
 *
 * getOnshapeBom() in data.ts asks the `onshape` server function for the
 * parts in the system's assembly (sub-assemblies flattened into one list)
 * or Part Studio. planOnshapeImport() below then works out what would
 * change, without changing anything, so the page can show it first, and
 * applyOnshapeImport() in data.ts makes the changes.
 *
 * - Parts are matched by which Onshape part they are, never by name, so a
 *   part renamed in CAD keeps everything done to it. The first time, a part
 *   typed in by hand is matched if Onshape has the same part number.
 * - New parts are added, and names, quantities and materials updated to
 *   what Onshape has. Where Onshape has nothing (no material yet, say),
 *   what's already in the app stays.
 * - Parts no longer in Onshape are marked "Removed in Onshape", not
 *   deleted, so their history stays. If they come back, the mark goes.
 */
import { nextPartNumber, partsTable, type BomSystem, type Part, type PartKind } from './data'

/** One part from Onshape. The same shape is in supabase/functions/onshape/onshape.ts. */
export interface OnshapeLine {
  /** Which part it is in Onshape: document, tab, part and configuration. */
  onshape_id: string
  name: string
  part_number: string | null
  revision: string | null
  quantity: number
  material: string | null
  vendor: string | null
  /** From Onshape's standard content library (bolts, nuts and so on): bought, not made. */
  standard: boolean
  /** Opens the part's tab in Onshape. */
  url: string
}

/** What the onshape server function sends back for a system. */
export interface OnshapeBom {
  /** The tab's name in Onshape, like "Intake assembly". */
  name: string
  kind: 'assembly' | 'partstudio'
  lines: OnshapeLine[]
}

/** A part's columns, without the ones the database fills in. */
export type PartRow = Omit<Part, 'id' | 'created_at' | 'created_by'>

export interface PartChange {
  part: Part
  changes: Partial<PartRow>
  /** What changed, for people: "quantity 2 → 3", "name", "back in Onshape". Empty if only links changed. */
  what: string[]
}

export interface OnshapeImportPlan {
  /** The Onshape tab's name. */
  source: string
  add: PartRow[]
  change: PartChange[]
  /** Parts no longer in Onshape, to mark as removed. */
  removed: Part[]
  unchanged: number
}

/** For the page: what importing `bom` into `system` would change, against every part now. */
export function planImport(system: BomSystem, bom: OnshapeBom): OnshapeImportPlan {
  return planOnshapeImport(system, bom, partsTable.rows())
}

// The database's length limits (see the bom migration).
const fit = (value: string | null, max: number) => (value ? value.slice(0, max).trim() || null : null)

/** Work out what importing `bom` into `system` would change. `allParts` is every part, so new part numbers are free. */
export function planOnshapeImport(system: BomSystem, bom: OnshapeBom, allParts: Part[]): OnshapeImportPlan {
  const mine = allParts.filter((p) => p.system_id === system.id)
  const byOnshapeId = new Map(mine.filter((p) => p.onshape_id).map((p) => [p.onshape_id!, p]))
  const typedIn = new Map(mine.filter((p) => !p.onshape_id).map((p) => [p.part_number, p]))
  // Which part has each part number: they're unique across the whole BOM.
  const owner = new Map(allParts.map((p) => [p.part_number, p.id]))
  const numbered: Pick<Part, 'part_number'>[] = [...allParts]

  function newNumber(): string {
    let number = nextPartNumber(system, numbered as Part[])
    while (owner.has(number)) {
      numbered.push({ part_number: number })
      number = nextPartNumber(system, numbered as Part[])
    }
    claim(number, 'new')
    return number
  }
  function claim(number: string, id: string) {
    owner.set(number, id)
    numbered.push({ part_number: number })
  }

  const plan: OnshapeImportPlan = { source: bom.name, add: [], change: [], removed: [], unchanged: 0 }
  const seen = new Set<string>()

  for (const line of bom.lines) {
    const existing = byOnshapeId.get(line.onshape_id) ?? (line.part_number ? typedIn.get(line.part_number) : undefined)
    if (existing) {
      seen.add(existing.id)
      typedIn.delete(existing.part_number)
    }
    // Bought if it's standard content or has a vendor (or was already marked bought).
    const kind: PartKind = line.standard || line.vendor || existing?.kind === 'cots' ? 'cots' : 'made'
    // A made part's Onshape part number is ours, if no other part has it. A
    // bought part's is usually the vendor's, so it gets a team number too.
    const fromOnshape = kind === 'made' ? fit(line.part_number, 40) : null
    const freeNumber = fromOnshape && (!owner.has(fromOnshape) || owner.get(fromOnshape) === existing?.id) ? fromOnshape : null

    // Where Onshape has nothing, keep what's already here.
    const row: PartRow = {
      system_id: system.id,
      part_number: freeNumber ?? existing?.part_number ?? newNumber(),
      name: fit(line.name, 100) ?? existing?.name ?? 'Unnamed part',
      revision: fit(line.revision, 10) ?? existing?.revision ?? null,
      kind,
      material: kind === 'made' ? (fit(line.material, 100) ?? existing?.material ?? null) : null,
      quantity: Math.max(1, Math.round(line.quantity) || 1),
      vendor: kind === 'cots' ? (fit(line.vendor, 100) ?? existing?.vendor ?? null) : null,
      vendor_part_number: kind === 'cots' ? (fit(line.part_number, 100) ?? existing?.vendor_part_number ?? null) : null,
      onshape_url: line.url,
      onshape_id: line.onshape_id,
      removed_in_onshape: false,
    }
    if (freeNumber) claim(freeNumber, existing?.id ?? 'new')

    if (!existing) {
      plan.add.push(row)
      continue
    }
    const changes: Partial<PartRow> = {}
    const what: string[] = []
    for (const key of Object.keys(row) as (keyof PartRow)[]) {
      if (row[key] !== existing[key]) (changes as Record<string, unknown>)[key] = row[key]
    }
    if ('name' in changes) what.push(`renamed from ${existing.name}`)
    if ('quantity' in changes) what.push(`quantity ${existing.quantity} → ${row.quantity}`)
    if ('part_number' in changes) what.push(`part number ${existing.part_number} → ${row.part_number}`)
    if ('revision' in changes) what.push(`revision ${row.revision ?? 'none'}`)
    if ('material' in changes || 'vendor' in changes || 'vendor_part_number' in changes || 'kind' in changes) what.push('details')
    if (existing.removed_in_onshape) what.push('back in Onshape')
    if (!existing.onshape_id) what.push('linked to Onshape')

    if (Object.keys(changes).length === 0) plan.unchanged += 1
    else plan.change.push({ part: existing, changes, what })
  }

  plan.removed = mine.filter((p) => p.onshape_id && !p.removed_in_onshape && !seen.has(p.id))
  return plan
}
