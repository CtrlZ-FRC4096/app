/**
 * Purchasing module data: what the team needs to buy, from asking for it to
 * it being in the shop.
 *
 * This replaces the "BOM List" in Slack's build parts channel, with the same
 * statuses, vendors and types. It's typed in by hand, separate from the BOM
 * (which comes from Onshape).
 *
 * Like the Slack list, anyone on the team can add, change and delete any
 * item. The database's rules are in
 * supabase/migrations/..._purchase_items.sql.
 *
 * Order details (dates, tracking, who ordered), prices, importing the Slack
 * list and receipts come in later steps: see issue #66.
 */
import { createTable, fail, newestFirst, type Fields, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'
import { currentUser } from '../../core/session'
import type { Notice, Tone } from '../../core/registry'

// ---------------------------------------------------------------------------
// The lists. Change these to change the choices on the page.

/**
 * Where an item is up to, in order. These match the Slack list.
 *
 *   - `key` is what's saved. Never change one: the database checks it, so
 *     adding a status also needs a new migration.
 *   - `current` items are the ones still in progress, shown first.
 *   - People asking for something pick one of the `ask` statuses: its priority.
 */
export const STATUSES = [
  { key: 'wait', label: 'Wait to Order', hint: "Don't order yet", tone: 'plain', current: false, ask: true },
  { key: 'order_low', label: 'Order Low Priority', hint: 'Place with the next order', tone: 'info', current: true, ask: true },
  { key: 'order', label: 'Order', hint: 'Place the order now', tone: 'warn', current: true, ask: true },
  { key: 'order_high', label: 'Order High Priority', hint: 'Place the order now, with priority shipping', tone: 'crit', current: true, ask: true },
  { key: 'placed', label: 'Order Placed', hint: 'Ordered, on the way', tone: 'info', current: true, ask: false },
  { key: 'out_of_stock', label: 'Out of Stock', hint: "The vendor doesn't have it", tone: 'crit', current: true, ask: false },
  { key: 'backordered', label: 'Backordered', hint: "Ordered, but the vendor is waiting for more", tone: 'warn', current: true, ask: false },
  { key: 'received', label: 'Received', hint: 'Delivered, not in the shop yet', tone: 'ok', current: true, ask: false },
  { key: 'in_shop', label: 'In Shop', hint: 'Put away in the shop', tone: 'ok', current: false, ask: false },
  { key: 'cancelled', label: 'Cancel Item', hint: 'Not buying it', tone: 'plain', current: false, ask: false },
] as const satisfies readonly { key: string; label: string; hint: string; tone: Tone; current: boolean; ask: boolean }[]

export type StatusKey = (typeof STATUSES)[number]['key']
export type Status = (typeof STATUSES)[number]

/** The status a new item starts with. */
export const FIRST_STATUS: StatusKey = 'order'

/** Where things are bought. Spelled as in the Slack list, so its import matches. */
export const VENDORS = [
  'Amazon',
  'West Coast Products',
  'Andy Mark',
  'REV Robotics',
  'McMaster',
  'Digikey',
  'CTRE',
  'V-Belt Guys',
  'Thrifty Bot',
  'Bambu Lab',
  'Other',
]

/** What it's for: a subteam, a part of the robot, or who's paying. As in the Slack list. */
export const TYPES = [
  'Electrical',
  'Code',
  'Hardware',
  'Mechanical',
  'Field',
  'Shooter',
  'Intake',
  'Indexer',
  'Climber',
  'Hopper',
  'Drive Base',
  'Rotary Grant',
  'Miscellaneous',
]

export function statusOf(key: StatusKey): Status {
  return STATUSES.find((s) => s.key === key)!
}

/**
 * The choices for a picker: the list, plus the item's current value if it's
 * no longer in the list, so changing an old item doesn't lose it.
 */
export function choices(list: readonly string[], current: string): string[] {
  return current && !list.includes(current) ? [...list, current] : [...list]
}

// ---------------------------------------------------------------------------
// The table.

/** One row of the purchase_items table. The fields match its columns. */
export interface PurchaseItem extends Row {
  /** What to buy, like "Ethernet Cables 5 ft 10 pack". */
  name: string
  status: StatusKey
  vendor: string
  type: string
  /** The product page. */
  link: string | null
  /** The vendor's part or item number. */
  part_number: string | null
  /** How many are needed. */
  quantity: number
  /**
   * Who asked for it: always whoever filled in the form. The database
   * refuses anyone else, and nobody can change it. Show their name with
   * useMemberNames().
   */
  requested_by: string | null
  notes: string | null
  /** Who added it to the app. */
  created_by: string | null
}

/** The database allows the same: see the checks on its columns. */
export const MAX_NAME_LENGTH = 200
export const MAX_QUANTITY = 10000
export const MAX_PART_NUMBER_LENGTH = 100
export const MAX_LINK_LENGTH = 2000
export const MAX_NOTES_LENGTH = 1000

let exampleCount = 0
function example(
  fields: Omit<PurchaseItem, 'id' | 'created_at' | 'created_by' | 'link' | 'notes'> & { notes?: string },
  created_at: string,
): PurchaseItem {
  exampleCount += 1
  return {
    id: `00000000-0000-4000-8000-0000000c00${String(exampleCount).padStart(2, '0')}`,
    link: fields.part_number ? `https://example.com/parts/${fields.part_number}` : null,
    notes: null,
    ...fields,
    created_at,
    created_by: fields.requested_by,
  }
}

// Made up. Part numbers start EXAMPLE- so nobody orders them.
const EXAMPLE_ITEMS: PurchaseItem[] = [
  example({ name: 'Compliant wheel, 2 in', status: 'order', vendor: 'Andy Mark', type: 'Intake', part_number: 'EXAMPLE-CW-2', quantity: 8, requested_by: DEMO_PEOPLE.alex, notes: 'Spares for the intake rollers.' }, '2026-10-31T21:10:00Z'),
  example({ name: 'Brushless motor', status: 'order_high', vendor: 'REV Robotics', type: 'Shooter', part_number: 'EXAMPLE-NEO-01', quantity: 2, requested_by: DEMO_PEOPLE.sam, notes: 'Needed before Saturday build day.' }, '2026-10-30T22:00:00Z'),
  example({ name: 'Zip ties, 8 in (pack of 100)', status: 'order_low', vendor: 'Amazon', type: 'Miscellaneous', part_number: null, quantity: 2, requested_by: DEMO_PEOPLE.jordan }, '2026-10-30T19:45:00Z'),
  example({ name: 'Ethernet cables, 5 ft (10 pack)', status: 'wait', vendor: 'Amazon', type: 'Electrical', part_number: null, quantity: 1, requested_by: DEMO_PEOPLE.jordan }, '2026-10-29T18:20:00Z'),
  example({ name: 'Timing belt, 60T', status: 'placed', vendor: 'West Coast Products', type: 'Drive Base', part_number: 'EXAMPLE-TB-60', quantity: 4, requested_by: DEMO_PEOPLE.sam }, '2026-10-24T20:00:00Z'),
  example({ name: 'Hex bearing, 1/2 in', status: 'backordered', vendor: 'Andy Mark', type: 'Hardware', part_number: 'EXAMPLE-HB-12', quantity: 12, requested_by: DEMO_PEOPLE.alex }, '2026-10-22T23:15:00Z'),
  example({ name: 'Motor controller', status: 'received', vendor: 'CTRE', type: 'Electrical', part_number: 'EXAMPLE-MC-1', quantity: 1, requested_by: DEMO_PEOPLE.pat }, '2026-10-21T17:00:00Z'),
  example({ name: 'Polycarbonate sheet, 1/8 in', status: 'in_shop', vendor: 'McMaster', type: 'Mechanical', part_number: 'EXAMPLE-PC-18', quantity: 1, requested_by: DEMO_PEOPLE.jordan }, '2026-10-20T18:30:00Z'),
  example({ name: 'Field tape, 2 in', status: 'cancelled', vendor: 'Other', type: 'Field', part_number: null, quantity: 3, requested_by: DEMO_PEOPLE.alex, notes: 'Found some in the storage room.' }, '2026-10-18T16:00:00Z'),
]

export const itemsTable = createTable<PurchaseItem>('purchase_items', { demo: EXAMPLE_ITEMS, sort: newestFirst })

/** Every item, newest first. */
export function useItems(): PurchaseItem[] {
  return itemsTable.useRows()
}

// ---------------------------------------------------------------------------
// The views: the same ones as the Slack list.

export const VIEWS = ['Current', 'All', 'By status', 'By vendor'] as const
export type View = (typeof VIEWS)[number]

/** One heading on the page and the items under it. */
export interface Group {
  title: string
  /** The status, for a status group. */
  status?: Status
  items: PurchaseItem[]
}

/** Still in progress: the three Order statuses, Order Placed, Out of Stock, Backordered and Received. */
export function isCurrent(item: PurchaseItem): boolean {
  return statusOf(item.status).current
}

/**
 * The items for a view, under headings:
 *
 *   - Current: what's in progress, by status. The one people work from.
 *   - All: everything, newest first.
 *   - By status: everything, by status.
 *   - By vendor: everything, by vendor, for putting one order together per vendor.
 *
 * Headings with nothing under them are left out.
 */
export function groupItems(items: PurchaseItem[], view: View): Group[] {
  if (view === 'All') return items.length > 0 ? [{ title: 'All items', items }] : []
  if (view === 'By vendor') {
    const vendors = [...VENDORS, ...[...new Set(items.map((i) => i.vendor))].filter((v) => !VENDORS.includes(v)).sort()]
    return vendors.map((vendor) => ({ title: vendor, items: items.filter((i) => i.vendor === vendor) })).filter((g) => g.items.length > 0)
  }
  const shown = view === 'Current' ? items.filter(isCurrent) : items
  return STATUSES.map((status) => ({ title: status.label, status, items: shown.filter((i) => i.status === status.key) })).filter((g) => g.items.length > 0)
}

// ---------------------------------------------------------------------------
// The home page.

/** "3 to order now (1 high priority)", for the home page tile. */
export function summaryText(items: PurchaseItem[]): string {
  const now = items.filter((i) => i.status === 'order' || i.status === 'order_high').length
  const high = items.filter((i) => i.status === 'order_high').length
  if (now > 0) return `${now} to order now` + (high > 0 ? ` (${high} high priority)` : '')
  const current = items.filter(isCurrent).length
  return current > 0 ? `Nothing to order now · ${current} in progress` : 'Nothing to order now'
}

export function usePurchasingSummary(): Notice {
  const items = useItems()
  const high = items.some((i) => i.status === 'order_high')
  const now = items.some((i) => i.status === 'order')
  return { tone: high ? 'warn' : now ? 'info' : 'plain', text: summaryText(items) }
}

// ---------------------------------------------------------------------------
// Adding, changing and deleting items.

/** What someone types in. The link, part number and notes can be left empty. */
export interface NewItem {
  name: string
  status: StatusKey
  vendor: string
  type: string
  link: string
  part_number: string
  quantity: number
  notes: string
}

export const EMPTY_ITEM: NewItem = { name: '', status: FIRST_STATUS, vendor: '', type: '', link: '', part_number: '', quantity: 1, notes: '' }

/** An item's fields, to fill in the form for changing it. */
export function itemToForm(item: PurchaseItem): NewItem {
  return {
    name: item.name,
    status: item.status,
    vendor: item.vendor,
    type: item.type,
    link: item.link ?? '',
    part_number: item.part_number ?? '',
    quantity: item.quantity,
    notes: item.notes ?? '',
  }
}

/** Why an item can't be saved, or null if it can. */
export function checkItem(item: NewItem): string | null {
  const name = item.name.trim()
  if (!name) return 'Say what to buy, like "Ethernet cables, 5 ft (10 pack)".'
  if (name.length > MAX_NAME_LENGTH) return `Keep the name under ${MAX_NAME_LENGTH} characters. This one is ${name.length}.`
  if (!STATUSES.some((s) => s.key === item.status)) return 'Pick a status.'
  if (!item.vendor.trim()) return "Pick a vendor. If it isn't listed, pick Other and say which in the notes."
  if (item.vendor.trim().length > 100) return 'Keep the vendor under 100 characters.'
  if (!item.type.trim()) return 'Pick a type: what it\'s for.'
  if (item.type.trim().length > 100) return 'Keep the type under 100 characters.'
  if (!Number.isInteger(item.quantity) || item.quantity < 1) return 'Ask for at least 1.'
  if (item.quantity > MAX_QUANTITY) return `That's a lot. Ask for ${MAX_QUANTITY} or fewer.`
  const link = item.link.trim()
  if (link && !/^https:\/\/\S+$/.test(link)) return "The link should be the product's page, starting with https://"
  if (link.length > MAX_LINK_LENGTH) return `That link is too long. Keep it under ${MAX_LINK_LENGTH} characters.`
  if (item.part_number.trim().length > MAX_PART_NUMBER_LENGTH) return `Keep the part number under ${MAX_PART_NUMBER_LENGTH} characters.`
  const notes = item.notes.trim()
  if (notes.length > MAX_NOTES_LENGTH) return `Keep the notes under ${MAX_NOTES_LENGTH} characters. These are ${notes.length}.`
  return null
}

/** Empty boxes are saved as nothing (null), not as empty text. */
const itemFields = (item: NewItem) => ({
  name: item.name.trim(),
  status: item.status,
  vendor: item.vendor.trim(),
  type: item.type.trim(),
  link: item.link.trim() || null,
  part_number: item.part_number.trim() || null,
  quantity: item.quantity,
  notes: item.notes.trim() || null,
})

/** Ask for something, as the person who asked for it. */
export async function addItem(item: NewItem): Promise<Result<PurchaseItem>> {
  const problem = checkItem(item)
  if (problem) return fail(problem)
  const fields: Fields<PurchaseItem> = { ...itemFields(item), requested_by: currentUser()?.id ?? null }
  return itemsTable.insert(fields)
}

export async function changeItem(item: PurchaseItem, changes: NewItem): Promise<Result<PurchaseItem>> {
  const problem = checkItem(changes)
  if (problem) return fail(problem)
  return itemsTable.update(item.id, itemFields(changes))
}

export async function removeItem(item: PurchaseItem): Promise<Result> {
  return itemsTable.remove(item.id)
}
