/**
 * The catalog of bought (COTS) parts (#20): one entry for each part a vendor
 * sells, with its name and a link to buy it. The team fills it in once and
 * reuses it every season: a COTS line in the BOM with the same vendor part
 * number shows the catalog's name and link, so nobody looks it up again.
 *
 * The table is made by supabase/migrations/..._bom_catalog.sql. Everyone on
 * the team can read it. Only student leaders, mentors and admins can add,
 * change and delete entries, the same as parts. Prices aren't here: they go
 * in a mentor-only prices table later, because students can read this one.
 *
 * data.ts passes all of this on (export * from './catalog'), so other
 * modules read the catalog from data.ts like everything else in the BOM.
 */
import { createTable, fail, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'
import { isLeader } from '../../core/roles'
import { currentUser } from '../../core/session'
import { vendorFor } from '../purchasing/data'
// Only the type: catalog.ts uses nothing else from data.ts, because data.ts loads this file.
import type { Part } from './data'

/** One row of bom_catalog: one part a vendor sells. */
export interface CatalogEntry extends Row {
  vendor: string
  /** How the BOM finds the entry: a COTS line with the same vendor part number. */
  vendor_part_number: string
  /** The product's name, the way the vendor's page has it. */
  name: string
  /** Where to buy it. Always an https:// link (the database checks). */
  product_url: string
  created_by: string | null
}

// Made-up example entries for some of the example COTS parts in data.ts, so
// the page shows both kinds of line: in the catalog, and not yet. The
// collar isn't in the example robot: the catalog keeps parts from every season.
const CREATED = { created_at: '2026-10-21T18:00:00Z', created_by: DEMO_PEOPLE.pat }
const EXAMPLE_CATALOG: CatalogEntry[] = [
  { id: '00000000-0000-4000-8000-0000000b3001', vendor: 'REV Robotics', vendor_part_number: 'EXAMPLE-NEO-01', name: 'Example brushless motor', product_url: 'https://example.com/rev/example-neo-01', ...CREATED },
  // The BOM writes this vendor "AndyMark": it's still the same vendor.
  { id: '00000000-0000-4000-8000-0000000b3002', vendor: 'Andy Mark', vendor_part_number: 'EXAMPLE-CW-2', name: 'Example compliant wheel, 2 in', product_url: 'https://example.com/andymark/example-cw-2', ...CREATED },
  { id: '00000000-0000-4000-8000-0000000b3003', vendor: 'Swerve Drive Specialties', vendor_part_number: 'EXAMPLE-MK-4', name: 'Example swerve module', product_url: 'https://example.com/sds/example-mk-4', ...CREATED },
  { id: '00000000-0000-4000-8000-0000000b3004', vendor: 'West Coast Products', vendor_part_number: 'EXAMPLE-COL-12', name: 'Example shaft collar, 1/2 in hex', product_url: 'https://example.com/wcp/example-col-12', ...CREATED },
]

/** By vendor, then name. */
const byVendor = (a: CatalogEntry, b: CatalogEntry) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name)

export const catalogTable = createTable<CatalogEntry>('bom_catalog', { demo: EXAMPLE_CATALOG, sort: byVendor })

/** Every catalog entry, by vendor. */
export function useCatalog(): CatalogEntry[] {
  return catalogTable.useRows()
}

// ---------------------------------------------------------------------------
// Matching a BOM line to its entry.

/** A vendor part number without capitals or spaces, so "rev-21-1650 " and "REV-21-1650" match, like shelfItem() in data.ts. */
const numberKey = (number: string) => number.replace(/\s+/g, '').toLowerCase()

/**
 * A vendor name to compare: the name Purchasing uses for it, if it has one
 * (vendorFor()), then letters and digits only, lowercase. So "REV" and "REV
 * Robotics" are one vendor, and so are "WCP" and "West Coast Products", and
 * "AndyMark" and "Andy Mark".
 */
const vendorKey = (vendor: string) => (vendorFor(vendor.trim()) ?? vendor).toLowerCase().replace(/[^a-z0-9]/g, '')

/** Are these the same vendor, however they're written? */
export function sameVendor(a: string, b: string): boolean {
  return vendorKey(a) === vendorKey(b)
}

/**
 * The catalog entry for a COTS line, if the catalog has it: the same vendor
 * part number (ignoring capitals and spaces) from the same vendor (however
 * it's written). Both have to match, so another vendor's part with the same
 * number never shows the wrong link to buy. A line with no vendor yet (some
 * Onshape imports) matches on the number alone, if only one entry has it.
 * Custom parts, and COTS lines with no vendor part number, have no entry.
 */
export function catalogEntryFor(part: Pick<Part, 'kind' | 'vendor' | 'vendor_part_number'>, entries: CatalogEntry[]): CatalogEntry | undefined {
  if (part.kind !== 'cots' || !part.vendor_part_number?.trim()) return undefined
  const number = numberKey(part.vendor_part_number)
  const found = entries.filter((entry) => numberKey(entry.vendor_part_number) === number)
  const vendor = part.vendor?.trim()
  if (!vendor) return found.length === 1 ? found[0] : undefined
  return found.find((entry) => sameVendor(entry.vendor, vendor))
}

/**
 * Should this line show Add to catalog? A COTS line with a vendor part number
 * (that's how the catalog finds it) that isn't in the catalog yet, and isn't
 * marked removed in Onshape.
 */
export function canAddToCatalog(part: Part, entries: CatalogEntry[]): boolean {
  return part.kind === 'cots' && !part.removed_in_onshape && Boolean(part.vendor_part_number?.trim()) && !catalogEntryFor(part, entries)
}

// ---------------------------------------------------------------------------
// Adding, changing and deleting entries.

/** What someone types in to add or change an entry. Every box is needed. */
export interface NewCatalogEntry {
  vendor: string
  vendor_part_number: string
  name: string
  product_url: string
}

/**
 * A new entry filled in from a BOM line, for the person to check: its vendor
 * (named the way Purchasing names it, so the catalog is tidy), vendor part
 * number, name, and product page if it has one.
 */
export function entryFromPart(part: Part): NewCatalogEntry {
  const vendor = part.vendor?.trim() ?? ''
  return {
    vendor: vendorFor(vendor) ?? vendor,
    vendor_part_number: part.vendor_part_number?.trim() ?? '',
    name: part.name,
    product_url: part.product_url ?? '',
  }
}

// The database has the same limits: see the checks in ..._bom_catalog.sql.
const LIMITS = { vendor: 100, vendor_part_number: 100, name: 100, product_url: 2000 }
const NAMES = { vendor: 'vendor', vendor_part_number: 'vendor part number', name: 'name', product_url: 'link' }

/**
 * Why an entry can't be saved, or null if it can. `entries` is the whole
 * catalog, to check it isn't there already; `id` is the entry being changed,
 * if it is one.
 */
export function checkCatalogEntry(entry: NewCatalogEntry, entries: CatalogEntry[], id?: string): string | null {
  const vendor = entry.vendor.trim()
  const number = entry.vendor_part_number.trim()
  const link = entry.product_url.trim()
  if (!vendor) return 'Add the vendor, like REV Robotics or West Coast Products.'
  if (!number) return "Add the vendor's part number, like REV-21-1650. The BOM finds catalog entries by it."
  if (!entry.name.trim()) return "Add the part's name, the way the vendor's page has it."
  if (!link) return "Add the link to buy it: open the product's page and copy its address."
  if (!/^https:\/\/\S+$/.test(link)) return "The link needs to be a whole link starting with https://. Open the product's page and copy its address."
  for (const [field, limit] of Object.entries(LIMITS) as [keyof typeof LIMITS, number][]) {
    const length = entry[field].trim().length
    if (length > limit) return `Keep the ${NAMES[field]} under ${limit} characters. This one is ${length}.`
  }
  // The same vendor part number from the same vendor, however it's written.
  const already = catalogEntryFor({ kind: 'cots', vendor, vendor_part_number: number }, entries.filter((e) => e.id !== id))
  if (already) {
    return `${already.vendor_part_number} from ${already.vendor} is already in the catalog, as "${already.name}". Change that one instead.`
  }
  return null
}

/** Why the signed-in person can't do this, or null if they can. The same people as parts (canEditRobotsAndParts() in data.ts). */
function leadersOnly(doing: string): string | null {
  const user = currentUser()
  return user && isLeader(user.role) ? null : `Only student leaders and mentors can ${doing}. Ask one of them.`
}

const entryFields = (entry: NewCatalogEntry) => ({
  vendor: entry.vendor.trim(),
  vendor_part_number: entry.vendor_part_number.trim(),
  name: entry.name.trim(),
  product_url: entry.product_url.trim(),
})

/** Add an entry. Student leaders, mentors and admins only. */
export async function addCatalogEntry(entry: NewCatalogEntry): Promise<Result<CatalogEntry>> {
  const problem = leadersOnly('add to the catalog') ?? checkCatalogEntry(entry, catalogTable.rows())
  if (problem) return fail(problem)
  return catalogTable.insert(entryFields(entry))
}

/** Change an entry. Every BOM line that matches it shows the change. */
export async function changeCatalogEntry(entry: CatalogEntry, changes: NewCatalogEntry): Promise<Result<CatalogEntry>> {
  const problem = leadersOnly('change the catalog') ?? checkCatalogEntry(changes, catalogTable.rows(), entry.id)
  if (problem) return fail(problem)
  return catalogTable.update(entry.id, entryFields(changes))
}

/** Delete an entry. BOM lines that matched it stay, and show Add to catalog again. */
export async function removeCatalogEntry(entry: CatalogEntry): Promise<Result> {
  const problem = leadersOnly('delete from the catalog')
  if (problem) return fail(problem)
  return catalogTable.remove(entry.id)
}
