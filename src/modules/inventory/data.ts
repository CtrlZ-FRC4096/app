/**
 * Inventory data: the parts the team keeps, where they live and how many
 * are left.
 *
 * The table is made by supabase/migrations/..._inventory_items.sql, which
 * also sets who can read and change parts: anyone on the team can read and
 * add them, and mentors change and delete them. Other modules (the BOM) read
 * parts from here, so keep these functions simple and tested.
 */
import { createTable, fail, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'

/** One row of the inventory_items table. The fields match its columns. */
export interface Item extends Row {
  name: string
  vendor: string
  /** The vendor's own number for the part. With the vendor, it's how the BOM finds a part. */
  vendor_part_number: string
  /** A bin or shelf, like "Bin E2". */
  location: string
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
  example('00000000-0000-4000-8000-00000001a005', 'Battery, 12V 18Ah', 'MK Battery', 'ES17-12', 'Battery cart', 8, 6),
  example('00000000-0000-4000-8000-00000001a006', 'CANivore', 'CTR Electronics', '21-678682', 'Bin E2', 1, 1),
  example('00000000-0000-4000-8000-00000001a007', 'Main breaker, 120A', 'AndyMark', 'am-0282a', 'Bin E4', 1, 2),
  example('00000000-0000-4000-8000-00000001a008', 'Voltage Regulator Module (VRM)', 'AndyMark', 'am-2857', 'Bin E3', 2, 1),
]

function example(id: string, name: string, vendor: string, vendor_part_number: string, location: string, quantity: number, low_stock_level: number): Item {
  return {
    id,
    name,
    vendor,
    vendor_part_number,
    location,
    quantity,
    low_stock_level,
    created_at: '2026-10-20T18:00:00Z',
    created_by: DEMO_PEOPLE.pat,
  }
}

export const itemsTable = createTable<Item>('inventory_items', {
  demo: EXAMPLE_ITEMS,
  sort: (a, b) => a.name.localeCompare(b.name),
})

/** Every part, in order by name. */
export function useItems(): Item[] {
  return itemsTable.useRows()
}

/** What someone types in to add a part. */
export interface NewItem {
  name: string
  vendor: string
  vendor_part_number: string
  location: string
  quantity: number
  low_stock_level: number
}

// The database has the same limits: see the checks in the inventory_items migration.
const LIMITS = { name: 100, vendor: 60, vendor_part_number: 60, location: 60 }

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
    quantity: item.quantity,
    low_stock_level: item.low_stock_level,
  })
}
