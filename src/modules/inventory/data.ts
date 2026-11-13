/**
 * Inventory data: the parts the team keeps, where they live and how many
 * are left.
 *
 * The table is made by supabase/migrations/..._inventory_items.sql, which
 * also sets who can read and change parts: anyone on the team can read and
 * add them, and mentors change and delete them. Other modules (the BOM) read
 * parts from here, so keep these functions simple and tested.
 *
 * Taking and adding stock: anyone on the team can change how many of a part
 * there are, with changeStock(), and each change is recorded in the
 * inventory_changes table (supabase/migrations/..._inventory_changes.sql).
 * Nobody can edit or delete that history.
 */
import { createTable, fail, newestFirst, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'
import { plural } from '../../core/format'
import type { Notice } from '../../core/registry'
import { currentUser, isMentor } from '../../core/session'

/** One row of the inventory_items table. The fields match its columns. */
export interface Item extends Row {
  name: string
  vendor: string
  /** The vendor's own number for the part. With the vendor, it's how the BOM finds a part. */
  vendor_part_number: string
  /** A bin or shelf, like "Bin E2". */
  location: string
  /** The product's page, where we buy it (#193). Always an https:// link, or null when there isn't one. */
  link: string | null
  quantity: number
  /** The part counts as low at or below this many. */
  low_stock_level: number
  /** Who added it. Show their name with useMemberNames(). */
  created_by: string | null
}

// Real parts from the wiki's Electrical > Components page. The quantities
// and bins are made up.
//
// Some are low on purpose, so the low-stock flag has something to show:
// the main breaker is below its level, and the roboRIO and CANivore are
// exactly at theirs.
const EXAMPLE_ITEMS: Item[] = [
  example('00000000-0000-4000-8000-00000001a001', 'Power Distribution Hub (PDH)', 'REV', 'REV-11-1850', 'Shelf E1', 2, 1),
  example('00000000-0000-4000-8000-00000001a002', 'Mini Power Module (MPM)', 'REV', 'REV-11-1956', 'Bin E3', 3, 2),
  example('00000000-0000-4000-8000-00000001a003', 'roboRIO 2.0', 'AndyMark', 'am-3000a', 'Shelf E1', 1, 1),
  example('00000000-0000-4000-8000-00000001a004', 'Robot radio (VH-109)', 'AndyMark', 'am-5583a', 'Shelf E1', 2, 1),
  // No product link, to show a part without one.
  example('00000000-0000-4000-8000-00000001a005', 'Battery, 12V 18Ah', 'MK Battery', 'ES17-12', 'Battery cart', 8, 6, false),
  example('00000000-0000-4000-8000-00000001a006', 'CANivore', 'CTR Electronics', '21-678682', 'Bin E2', 1, 1),
  example('00000000-0000-4000-8000-00000001a007', 'Main breaker, 120A', 'AndyMark', 'am-0282a', 'Bin E4', 1, 2),
  example('00000000-0000-4000-8000-00000001a008', 'Voltage Regulator Module (VRM)', 'AndyMark', 'am-2857', 'Bin E3', 2, 1),
  // Made up, with EXAMPLE- part numbers: these match parts in the BOM's
  // example Intake, so the BOM can show what's on the shelf. There are
  // enough wheels for the Intake, but not enough bearings.
  example('00000000-0000-4000-8000-00000001a009', 'Compliant wheel, 2 in', 'AndyMark', 'EXAMPLE-CW-2', 'Bin M3', 12, 4),
  example('00000000-0000-4000-8000-00000001a010', 'Flanged bearing, 1/2 in hex', 'WCP', 'EXAMPLE-BRG-12', 'Bin M1', 4, 2),
]

// The product links are made up, not real store pages.
function example(
  id: string, name: string, vendor: string, vendor_part_number: string, location: string, quantity: number, low_stock_level: number, hasLink = true,
): Item {
  return {
    id,
    name,
    vendor,
    vendor_part_number,
    location,
    link: hasLink ? `https://example.com/parts/${vendor_part_number}` : null,
    quantity,
    low_stock_level,
    created_at: '2026-10-20T18:00:00Z',
    created_by: DEMO_PEOPLE.pat,
  }
}

// Version 2: parts gained a product link (#193).
export const itemsTable = createTable<Item>('inventory_items', {
  demo: EXAMPLE_ITEMS,
  version: 2,
  sort: (a, b) => a.name.localeCompare(b.name),
})

/** Every part, in order by name. */
export function useItems(): Item[] {
  return itemsTable.useRows()
}

/** True when the quantity is at or below the part's low-stock level. */
export function isLow(item: Item): boolean {
  return item.quantity <= item.low_stock_level
}

/** Every low part, in order by name. */
export function useLowItems(): Item[] {
  return useItems().filter(isLow)
}

/** The home page tile's status. */
export function useLowStockSummary(): Notice {
  const low = useLowItems()
  if (low.length === 0) return { tone: 'ok', text: 'No parts low' }
  return { tone: 'warn', text: `${plural(low.length, 'part', 'parts')} low` }
}

/** One line under "Needs attention" on the home page when any parts are low. */
export function useLowStockAttention(): Notice[] {
  const low = useLowItems()
  if (low.length === 0) return []
  return [{ tone: 'warn', text: `${plural(low.length, 'part', 'parts')} low on stock.` }]
}

/** What someone types in to add a part. */
export interface NewItem {
  name: string
  vendor: string
  vendor_part_number: string
  location: string
  /** The product's page. Optional: leave it empty if there isn't one. */
  link: string
  quantity: number
  low_stock_level: number
}

// The database has the same limits: see the checks in the inventory_items migrations.
const LIMITS = { name: 100, vendor: 60, vendor_part_number: 60, location: 60 }
const MAX_LINK_LENGTH = 2000

/** Why a product link can't be saved, or null if it can. Empty is fine. Purchasing's link has the same rule and message. */
export function checkLink(link: string): string | null {
  const trimmed = link.trim()
  if (!trimmed) return null
  if (!/^https:\/\/\S+$/.test(trimmed)) return "The link should be the product's page, starting with https://"
  if (trimmed.length > MAX_LINK_LENGTH) return `Keep the link under ${MAX_LINK_LENGTH} characters. This one is ${trimmed.length}.`
  return null
}

/** Why a part can't be added, or null if it can. `items` is every part, to check it isn't listed already. */
export function checkItem(item: NewItem, items: Item[]): string | null {
  if (!item.name.trim()) return 'Add a name for the part.'
  if (!item.vendor.trim()) return 'Add the vendor you buy it from, like REV or AndyMark.'
  if (!item.vendor_part_number.trim()) return "Add the vendor's part number, like REV-11-1850."
  if (!item.location.trim()) return 'Add where it lives, like "Bin E2".'
  if (!Number.isInteger(item.quantity) || item.quantity < 0) return 'The quantity needs to be a whole number, 0 or more.'
  if (!Number.isInteger(item.low_stock_level) || item.low_stock_level < 0) return 'The low-stock level needs to be a whole number, 0 or more.'
  const names = { name: 'name', vendor: 'vendor', vendor_part_number: 'part number', location: 'location' }
  for (const [field, limit] of Object.entries(LIMITS) as [keyof typeof LIMITS, number][]) {
    const length = item[field].trim().length
    if (length > limit) return `Keep the ${names[field]} under ${limit} characters. This one is ${length}.`
  }
  const linkProblem = checkLink(item.link)
  if (linkProblem) return linkProblem
  const vendor = item.vendor.trim()
  const partNumber = item.vendor_part_number.trim()
  const listed = items.find((i) => i.vendor === vendor && i.vendor_part_number === partNumber)
  if (listed) return `${vendor} ${partNumber} is already listed, as "${listed.name}" in ${listed.location}.`
  return null
}

/** Add a part. Anyone on the team can add one; only mentors and admins can change or delete one. */
export async function addItem(item: NewItem): Promise<Result<Item>> {
  const problem = checkItem(item, itemsTable.rows())
  if (problem) return fail(problem)
  return itemsTable.insert({
    name: item.name.trim(),
    vendor: item.vendor.trim(),
    vendor_part_number: item.vendor_part_number.trim(),
    location: item.location.trim(),
    link: item.link.trim() || null,
    quantity: item.quantity,
    low_stock_level: item.low_stock_level,
  })
}

/** What the Edit button changes: how many are on the shelf, where they live, and the product link. */
export interface ItemChanges {
  quantity: number
  location: string
  link: string
}

/** Why a part's changes can't be saved, or null if they can. */
export function checkChanges(changes: ItemChanges): string | null {
  const location = changes.location.trim()
  if (!location) return 'Add where it lives, like "Bin E2".'
  if (location.length > LIMITS.location) return `Keep the location under ${LIMITS.location} characters. This one is ${location.length}.`
  if (!Number.isInteger(changes.quantity) || changes.quantity < 0) return 'The quantity needs to be a whole number, 0 or more.'
  return checkLink(changes.link)
}

const MENTORS_ONLY = 'Only mentors and admins change or delete parts. Ask one of them.'

/** Change a part's quantity, location and product link. Mentors and admins only: the database refuses anyone else. */
export async function changeItem(item: Item, changes: ItemChanges): Promise<Result<Item>> {
  const me = currentUser()
  if (!me || !isMentor(me.role)) return fail(MENTORS_ONLY)
  const problem = checkChanges(changes)
  if (problem) return fail(problem)
  const before = latest(item).quantity
  const updated = await itemsTable.update(item.id, { quantity: changes.quantity, location: changes.location.trim(), link: changes.link.trim() || null })
  if (!updated.ok || changes.quantity === before) return updated
  // A new count goes in the history too, so the history always adds up.
  return record(updated.value, changes.quantity - before, CORRECTED)
}

// ---------------------------------------------------------------------------
// Taking and adding stock, and its history.

/** One row of the inventory_changes table: one take or add. The fields match its columns. */
export interface StockChange extends Row {
  item_id: string
  /** How many were added (+10) or taken (-2). Never 0. */
  change: number
  /** Optional, like "for the intake rebuild". Empty if there isn't one. */
  note: string
  /** Who did it. Show their name with useMemberNames(). */
  created_by: string | null
}

/** The database allows the same: see the check on the note column. */
export const MAX_STOCK_NOTE_LENGTH = 200

/** The note on a history line when a mentor's Edit changes the count. */
export const CORRECTED = 'Count corrected'

// Made up, for the example parts above.
const EXAMPLE_CHANGES: StockChange[] = [
  {
    id: '00000000-0000-4000-8000-00000001c001',
    item_id: '00000000-0000-4000-8000-00000001a005',
    change: -2,
    note: 'For the practice robot',
    created_at: '2026-10-22T23:10:00Z',
    created_by: DEMO_PEOPLE.alex,
  },
  {
    id: '00000000-0000-4000-8000-00000001c002',
    item_id: '00000000-0000-4000-8000-00000001a005',
    change: 4,
    note: 'New order arrived',
    created_at: '2026-10-24T00:30:00Z',
    created_by: DEMO_PEOPLE.pat,
  },
  {
    id: '00000000-0000-4000-8000-00000001c003',
    item_id: '00000000-0000-4000-8000-00000001a007',
    change: -1,
    note: '',
    created_at: '2026-10-25T22:00:00Z',
    created_by: DEMO_PEOPLE.jordan,
  },
]

export const changesTable = createTable<StockChange>('inventory_changes', { demo: EXAMPLE_CHANGES, sort: newestFirst })

/** One part's history, newest first. */
export function useStockHistory(item: Item): StockChange[] {
  return changesTable.useRows().filter((c) => c.item_id === item.id)
}

/** The part as it is now: someone else may have taken some since the page drew it. */
function latest(item: Item): Item {
  return itemsTable.rows().find((i) => i.id === item.id) ?? item
}

/**
 * Why a stock change can't be made, or null if it can. `change` is how many
 * to add, or minus how many to take.
 */
export function checkStockChange(item: Item, change: number, note: string): string | null {
  if (!Number.isInteger(change) || change === 0) return 'Enter how many, 1 or more.'
  if (item.quantity + change < 0) {
    return item.quantity === 0 ? `There are no ${item.name} on the shelf.` : `Only ${item.quantity} on the shelf, so you can't take ${-change}.`
  }
  const length = note.trim().length
  if (length > MAX_STOCK_NOTE_LENGTH) return `Keep the note under ${MAX_STOCK_NOTE_LENGTH} characters. This one is ${length}.`
  return null
}

/**
 * Take parts from the shelf (a negative change) or add them (a positive
 * one), and record it in the history. Anyone on the team can.
 *
 * The quantity changes first, then the history line is added. The database
 * refuses a quantity below 0, so if the count can't change, nothing is
 * recorded. If two people take the same part at the same moment, one can
 * overwrite the other; a database function can fix that later.
 */
export async function changeStock(item: Item, change: number, note: string): Promise<Result<Item>> {
  const current = latest(item)
  const problem = checkStockChange(current, change, note)
  if (problem) return fail(problem)
  const updated = await itemsTable.update(item.id, { quantity: current.quantity + change })
  if (!updated.ok) return updated
  return record(updated.value, change, note.trim())
}

/** Add a history line for a change already made to `item`. */
async function record(item: Item, change: number, note: string): Promise<Result<Item>> {
  const line = await changesTable.insert({ item_id: item.id, change, note })
  if (!line.ok) return fail(`There are now ${item.quantity}, but the history didn't save. ${line.error}`)
  return { ok: true, value: item }
}

/** Delete a part from the list. Mentors and admins only. */
export async function removeItem(item: Item): Promise<Result> {
  const me = currentUser()
  if (!me || !isMentor(me.role)) return fail(MENTORS_ONLY)
  return itemsTable.remove(item.id)
}
