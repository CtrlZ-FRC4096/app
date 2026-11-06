/**
 * Purchasing module data: what the team needs to buy, from asking for it to
 * it being in the shop.
 *
 * This replaces the "BOM List" in Slack's build parts channel, with the same
 * statuses, vendors and types. It's typed in by hand, separate from the BOM
 * (which comes from Onshape).
 *
 * Anyone on the team asks for things, and changes the priority of what's
 * being asked for. Placing, cancelling and following up orders, and saying
 * who they ship to, is for mentors and the team's purchasers (#78). The
 * database's rules are in supabase/migrations/..._purchase_items.sql and
 * ..._purchasing_orders.sql; the checks here only give a clearer message.
 *
 * Dates, tracking, prices, importing the Slack list and receipts come in
 * later steps: see issue #66.
 */
import { createTable, fail, newestFirst, type Fields, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'
import { currentUser, isMentor, useSession, type User } from '../../core/session'
import { isLive } from '../../core/supabase'
import type { Notice, Tone } from '../../core/registry'
import type { BomSystem, Part } from '../bom/data'

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
  /**
   * Who placed the order: filled in by the database with whoever moves it
   * to Order Placed, unless they pick someone else. Mentors and purchasers
   * can change it.
   */
  ordered_by: string | null
  /** Who the package goes to. Set by mentors and purchasers. */
  shipped_to: string | null
  /** When the order should arrive, like "2026-11-12": set by whoever places it (mentors and purchasers). */
  estimated_arrival: string | null
  /** The BOM part it's for, when it was asked for from the BOM page. */
  bom_part_id: string | null
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
  fields: Omit<PurchaseItem, 'id' | 'created_at' | 'created_by' | 'link' | 'notes' | 'ordered_by' | 'shipped_to' | 'estimated_arrival' | 'bom_part_id'> &
    Partial<Pick<PurchaseItem, 'ordered_by' | 'shipped_to' | 'estimated_arrival' | 'bom_part_id'>> & { notes?: string },
  created_at: string,
): PurchaseItem {
  exampleCount += 1
  return {
    id: `00000000-0000-4000-8000-0000000c00${String(exampleCount).padStart(2, '0')}`,
    link: fields.part_number ? `https://example.com/parts/${fields.part_number}` : null,
    notes: null,
    ordered_by: null,
    shipped_to: null,
    estimated_arrival: null,
    bom_part_id: null,
    ...fields,
    created_at,
    created_by: fields.requested_by,
  }
}

// The example BOM parts (src/modules/bom/data.ts) three of these were asked for from.
const BOM_BRUSHLESS_MOTOR = '00000000-0000-4000-8000-0000000b1004'
const BOM_COMPLIANT_WHEEL = '00000000-0000-4000-8000-0000000b1005'
const BOM_ABSOLUTE_ENCODER = '00000000-0000-4000-8000-0000000b1011'
// Ordered by a made-up mentor, and shipped to the shop through them.
const ORDERED = { ordered_by: DEMO_PEOPLE.pat, shipped_to: DEMO_PEOPLE.pat }

// Made up. Part numbers start EXAMPLE- so nobody orders them.
const EXAMPLE_ITEMS: PurchaseItem[] = [
  example({ name: 'Compliant wheel, 2 in', status: 'order', vendor: 'Andy Mark', type: 'Intake', part_number: 'EXAMPLE-CW-2', quantity: 8, requested_by: DEMO_PEOPLE.alex, notes: 'Spares for the intake rollers.', bom_part_id: BOM_COMPLIANT_WHEEL }, '2026-10-31T21:10:00Z'),
  example({ name: 'Brushless motor', status: 'order_high', vendor: 'REV Robotics', type: 'Intake', part_number: 'EXAMPLE-NEO-01', quantity: 2, requested_by: DEMO_PEOPLE.sam, notes: 'Needed before Saturday build day.', bom_part_id: BOM_BRUSHLESS_MOTOR }, '2026-10-30T22:00:00Z'),
  example({ name: 'Zip ties, 8 in (pack of 100)', status: 'order_low', vendor: 'Amazon', type: 'Miscellaneous', part_number: null, quantity: 2, requested_by: DEMO_PEOPLE.jordan }, '2026-10-30T19:45:00Z'),
  example({ name: 'Ethernet cables, 5 ft (10 pack)', status: 'wait', vendor: 'Amazon', type: 'Electrical', part_number: null, quantity: 1, requested_by: DEMO_PEOPLE.jordan }, '2026-10-29T18:20:00Z'),
  example({ name: 'Timing belt, 60T', status: 'placed', vendor: 'West Coast Products', type: 'Drive Base', part_number: 'EXAMPLE-TB-60', quantity: 4, requested_by: DEMO_PEOPLE.sam, ...ORDERED, estimated_arrival: '2026-12-15' }, '2026-10-24T20:00:00Z'),
  example({ name: 'Hex bearing, 1/2 in', status: 'backordered', vendor: 'Andy Mark', type: 'Hardware', part_number: 'EXAMPLE-HB-12', quantity: 12, requested_by: DEMO_PEOPLE.alex, ...ORDERED, estimated_arrival: '2026-11-01' }, '2026-10-22T23:15:00Z'),
  example({ name: 'Motor controller', status: 'received', vendor: 'CTRE', type: 'Electrical', part_number: 'EXAMPLE-MC-1', quantity: 1, requested_by: DEMO_PEOPLE.pat, ...ORDERED }, '2026-10-21T17:00:00Z'),
  example({ name: 'Polycarbonate sheet, 1/8 in', status: 'in_shop', vendor: 'McMaster', type: 'Mechanical', part_number: 'EXAMPLE-PC-18', quantity: 1, requested_by: DEMO_PEOPLE.jordan, ...ORDERED }, '2026-10-20T18:30:00Z'),
  // In the shop already, so the BOM's Drivetrain shows a part that arrived.
  example({ name: 'Absolute encoder', status: 'in_shop', vendor: 'CTRE', type: 'Drive Base', part_number: 'EXAMPLE-ENC-1', quantity: 4, requested_by: DEMO_PEOPLE.sam, ...ORDERED, bom_part_id: BOM_ABSOLUTE_ENCODER }, '2026-10-19T17:30:00Z'),
  example({ name: 'Field tape, 2 in', status: 'cancelled', vendor: 'Other', type: 'Field', part_number: null, quantity: 3, requested_by: DEMO_PEOPLE.alex, notes: 'Found some in the storage room.' }, '2026-10-18T16:00:00Z'),
]

// Version 3: items have an estimated arrival.
export const itemsTable = createTable<PurchaseItem>('purchase_items', { demo: EXAMPLE_ITEMS, sort: newestFirst, version: 3 })

/** Every item, newest first. */
export function useItems(): PurchaseItem[] {
  return itemsTable.useRows()
}

// ---------------------------------------------------------------------------
// Purchasers: who places orders, along with mentors and admins (#78).

/** One row of the purchasing_buyers table: a member who is a purchaser. */
export interface Buyer extends Row {
  member_id: string
  /** The mentor who added them. */
  created_by: string | null
}

// Made up: one student is a purchaser in demo mode.
const EXAMPLE_BUYERS: Buyer[] = [
  { id: '00000000-0000-4000-8000-0000000c0201', member_id: DEMO_PEOPLE.jordan, created_at: '2026-10-15T18:00:00Z', created_by: DEMO_PEOPLE.pat },
]

export const buyersTable = createTable<Buyer>('purchasing_buyers', { demo: EXAMPLE_BUYERS })

export function useBuyers(): Buyer[] {
  return buyersTable.useRows()
}

/** Mentors, admins and purchasers place and change orders. */
export function canOrder(user: Pick<User, 'id' | 'role'> | null, buyers: Buyer[]): boolean {
  return !!user && (isMentor(user.role) || buyers.some((b) => b.member_id === user.id))
}

/** Whether the signed-in person can place and change orders. */
export function useCanOrder(): boolean {
  return canOrder(useSession(), useBuyers())
}

/** Still being asked for: Wait to Order, or one of the three Order priorities. */
export function isAsking(status: StatusKey): boolean {
  return statusOf(status).ask
}

/**
 * Whether saving `changes` needs a mentor or purchaser: it moves an item
 * into or out of an order status (Order Placed and after), or sets who
 * ordered it, who it ships to or when it arrives. Changing between the
 * asking statuses doesn't.
 */
export function isOrderChange(item: PurchaseItem | null, changes: NewItem): boolean {
  const orderedBy = changes.ordered_by || null
  const shippedTo = changes.shipped_to || null
  const arrival = changes.estimated_arrival || null
  if (!item) return !isAsking(changes.status) || orderedBy !== null || shippedTo !== null || arrival !== null
  const statusMoved = changes.status !== item.status && (!isAsking(item.status) || !isAsking(changes.status))
  return statusMoved || orderedBy !== item.ordered_by || shippedTo !== item.shipped_to || arrival !== item.estimated_arrival
}

// ---------------------------------------------------------------------------
// Estimated arrival.

/** Today's date where the app is used, like "2026-11-05". */
export function today(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** "Nov 12" for "2026-11-12". (A plain date, so no time zone can move it a day.) */
export function dayText(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Ordered and on its way: placed, out of stock or backordered, but not received yet. */
export function isOnItsWay(item: PurchaseItem): boolean {
  return item.status === 'placed' || item.status === 'out_of_stock' || item.status === 'backordered'
}

/** On its way, and its estimated arrival has passed. */
export function isLate(item: PurchaseItem, on: string = today()): boolean {
  return isOnItsWay(item) && !!item.estimated_arrival && item.estimated_arrival < on
}

/** "Arrives Nov 12" while it's on its way, or nothing. */
export function arrivalText(item: PurchaseItem): string | null {
  return isOnItsWay(item) && item.estimated_arrival ? `Arrives ${dayText(item.estimated_arrival)}` : null
}

const NOT_A_BUYER = 'Only mentors and purchasers place and change orders. Ask one of them: they\'re listed at the bottom of this page.'

/** Make someone a purchaser. Mentors and admins only. */
export async function addBuyer(memberId: string): Promise<Result<Buyer>> {
  const me = currentUser()
  if (!me || !isMentor(me.role)) return fail('Only mentors and admins choose the purchasers.')
  if (!memberId) return fail('Pick someone first.')
  if (buyersTable.rows().some((b) => b.member_id === memberId)) return fail("They're already a purchaser.")
  return buyersTable.insert({ member_id: memberId })
}

/** Stop someone being a purchaser. Mentors and admins only. */
export async function removeBuyer(buyer: Buyer): Promise<Result> {
  const me = currentUser()
  if (!me || !isMentor(me.role)) return fail('Only mentors and admins choose the purchasers.')
  return buyersTable.remove(buyer.id)
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

/**
 * The items that match a search: every word typed is in the item's name,
 * vendor, type, part number or notes, ignoring capitals. An empty search
 * matches everything.
 */
export function searchItems(items: PurchaseItem[], search: string): PurchaseItem[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return items
  return items.filter((item) => {
    const text = [item.name, item.vendor, item.type, item.part_number, item.notes].filter(Boolean).join(' ').toLowerCase()
    return words.every((word) => text.includes(word))
  })
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

/** What someone types in. The link, part number, notes, Ordered by and Shipped to can be left empty. */
export interface NewItem {
  name: string
  status: StatusKey
  vendor: string
  type: string
  link: string
  part_number: string
  quantity: number
  notes: string
  /** Members' ids, or empty for nobody yet. Mentors and purchasers only. */
  ordered_by: string
  shipped_to: string
  /** A date like "2026-11-12", or empty. Mentors and purchasers only. */
  estimated_arrival: string
}

export const EMPTY_ITEM: NewItem = {
  name: '', status: FIRST_STATUS, vendor: '', type: '', link: '', part_number: '', quantity: 1, notes: '', ordered_by: '', shipped_to: '', estimated_arrival: '',
}

/**
 * Which order details the form shows: all of them once the order is placed
 * (any status past the asking ones, like Order Placed or Backordered), and
 * before that only the ones already filled in, so nothing saved is hidden.
 */
export function orderFieldsShown(form: Pick<NewItem, 'status' | 'ordered_by' | 'shipped_to' | 'estimated_arrival'>): {
  ordered_by: boolean
  shipped_to: boolean
  estimated_arrival: boolean
} {
  const placed = !isAsking(form.status)
  return {
    ordered_by: placed || !!form.ordered_by,
    shipped_to: placed || !!form.shipped_to,
    estimated_arrival: placed || !!form.estimated_arrival,
  }
}

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
    ordered_by: item.ordered_by ?? '',
    shipped_to: item.shipped_to ?? '',
    estimated_arrival: item.estimated_arrival ?? '',
  }
}

/**
 * A new request filled in from an item, to buy it again. It starts as
 * Order, and whoever sends it is who asked for it, like any new request.
 */
export function duplicateItem(item: PurchaseItem): NewItem {
  return { ...itemToForm(item), status: FIRST_STATUS, ordered_by: '', shipped_to: '', estimated_arrival: '' }
}

/** A real calendar date written like "2026-11-12". */
function isDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
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
  if (item.estimated_arrival && !isDate(item.estimated_arrival)) return 'Pick the estimated arrival from the calendar, or leave it empty.'
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
  ordered_by: item.ordered_by || null,
  shipped_to: item.shipped_to || null,
  estimated_arrival: item.estimated_arrival || null,
})

/**
 * Ask for something, as the person who asked for it. `bomPartId` is the
 * BOM part it's for, when it's asked for from the BOM page.
 */
export async function addItem(item: NewItem, bomPartId: string | null = null): Promise<Result<PurchaseItem>> {
  const problem = checkItem(item)
  if (problem) return fail(problem)
  if (isOrderChange(null, item) && !canOrder(currentUser(), buyersTable.rows())) return fail(NOT_A_BUYER)
  const fields: Fields<PurchaseItem> = {
    ...itemFields(item),
    requested_by: currentUser()?.id ?? null,
    bom_part_id: bomPartId,
  }
  return itemsTable.insert(fields)
}

export async function changeItem(item: PurchaseItem, changes: NewItem): Promise<Result<PurchaseItem>> {
  const problem = checkItem(changes)
  if (problem) return fail(problem)
  if (isOrderChange(item, changes) && !canOrder(currentUser(), buyersTable.rows())) return fail(NOT_A_BUYER)
  const fields = itemFields(changes)
  // Placing an order without picking who ordered it: it's whoever placed it.
  // The team database fills that in itself; demo mode has no database, so
  // it's done here instead.
  const placing = changes.status === 'placed' && item.status !== 'placed' && fields.ordered_by === item.ordered_by
  return itemsTable.update(item.id, !isLive && placing ? { ...fields, ordered_by: currentUser()?.id ?? null } : fields)
}

/** Anyone can delete a request; only mentors and purchasers can delete an order. */
export async function removeItem(item: PurchaseItem): Promise<Result> {
  if (!isAsking(item.status) && !canOrder(currentUser(), buyersTable.rows())) {
    return fail('Only mentors and purchasers can delete an order. To stop it, ask one of them to cancel it.')
  }
  return itemsTable.remove(item.id)
}

// ---------------------------------------------------------------------------
// The BOM: asking for a COTS part from the BOM page, and its status there (#80).

/** Spellings the BOM uses for vendors in the list above. */
const VENDOR_NAMES: Record<string, string> = {
  wcp: 'West Coast Products',
  rev: 'REV Robotics',
  ctrelectronics: 'CTRE',
  mcmastercarr: 'McMaster',
}

/** Letters and digits only, lowercase, so "AndyMark" matches "Andy Mark". */
const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The vendor from the list above that a BOM vendor means, or null if there isn't one. */
export function vendorFor(bomVendor: string | null): string | null {
  if (!bomVendor) return null
  const key = plain(bomVendor)
  return VENDORS.find((v) => plain(v) === key) ?? VENDOR_NAMES[key] ?? null
}

/** The type from the list above that a BOM system's name means, or empty if there isn't one. */
function typeFor(systemName: string | undefined): string {
  if (!systemName) return ''
  const key = plain(systemName)
  if (key === 'drivetrain') return 'Drive Base'
  return TYPES.find((t) => plain(t) === key) ?? ''
}

/**
 * A request filled in from a BOM part, for the person to finish: the name,
 * vendor, vendor part number and quantity, and the system as the type when
 * it's one of the types. A vendor that isn't in the list becomes Other,
 * with the BOM's vendor in the notes.
 */
export function requestFromBomPart(part: Part, system: BomSystem | undefined): NewItem {
  const vendor = vendorFor(part.vendor)
  return {
    ...EMPTY_ITEM,
    name: part.name,
    vendor: vendor ?? 'Other',
    type: typeFor(system?.name),
    part_number: part.vendor_part_number ?? '',
    quantity: Math.min(Math.max(part.quantity, 1), MAX_QUANTITY),
    notes: !vendor && part.vendor ? `Vendor in the BOM: ${part.vendor}` : '',
  }
}

/**
 * Each BOM part's request, by part id: its newest one that isn't cancelled.
 * A part whose requests were all cancelled has none, so it can be asked for again.
 */
export function requestsByBomPart(items: PurchaseItem[]): Map<string, PurchaseItem> {
  const byPart = new Map<string, PurchaseItem>()
  for (const item of [...items].sort(newestFirst)) {
    if (item.bom_part_id && item.status !== 'cancelled' && !byPart.has(item.bom_part_id)) byPart.set(item.bom_part_id, item)
  }
  return byPart
}

/** For the BOM page: each part's request, by part id. */
export function useRequestsByBomPart(): Map<string, PurchaseItem> {
  return requestsByBomPart(useItems())
}
