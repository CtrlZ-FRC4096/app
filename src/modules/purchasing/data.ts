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
 * Receipts (#79) are files in a private storage bucket. Only mentors, admins
 * and purchasers add, open and delete them, and everyone can see that an
 * item has one. See supabase/migrations/..._purchase_receipts.sql.
 *
 * Prices are public, so everyone on the team sees them. Anyone can fill one
 * in while an item is being asked for. Once an item is ordered (Order Placed
 * or after), only mentors and purchasers change anything about it, its price
 * included. See ..._purchase_items_price.sql.
 *
 * Importing the Slack list comes in a later step: see issue #66.
 */
import { createTable, fail, newestFirst, ok, type Fields, type Result, type Row } from '../../core/table'
import { DEMO_PEOPLE } from '../../core/demo'
import { currentUser, isLeader, isMentor, useSession, type User } from '../../core/session'
import type { Member } from '../../core/members'
import type { Role } from '../../core/roles'
import { isLive, supabase } from '../../core/supabase'
import { money, plural } from '../../core/format'
import type { Notice, Tone } from '../../core/registry'
import { toCsv } from '../attendance/data'
import type { BomSystem, Part } from '../bom/data'
import {
  addItem as addInventoryPart,
  changeStock,
  checkItem as checkInventoryPart,
  itemsTable as inventoryTable,
  type Item as InventoryItem,
} from '../inventory/data'
import { compressReceiptImage, type ImageEncoder } from './receipt-image'

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
  { key: 'wait', label: 'Wait to Order', hint: "Don't order yet", tone: 'warn', current: false, ask: true },
  { key: 'order_low', label: 'Order Low Priority', hint: 'Place with the next order', tone: 'warn', current: true, ask: true },
  { key: 'order', label: 'Order', hint: 'Place the order now', tone: 'warn', current: true, ask: true },
  { key: 'order_high', label: 'Order High Priority', hint: 'Place the order now, with priority shipping', tone: 'crit', current: true, ask: true },
  { key: 'placed', label: 'Order Placed', hint: 'Ordered, on the way', tone: 'info', current: true, ask: false },
  { key: 'out_of_stock', label: 'Out of Stock', hint: "The vendor doesn't have it", tone: 'crit', current: true, ask: false },
  { key: 'backordered', label: 'Backordered', hint: "Ordered, but the vendor is waiting for more", tone: 'info', current: true, ask: false },
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
  /** What ONE costs, in dollars, or null if nobody has filled it in. lineTotal() is the price of them all. */
  price: number | null
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
  /** The date it was ordered, like "2026-11-10". Empty until it's ordered. Set by mentors and purchasers. */
  ordered_on: string | null
  /** The shipping company's tracking number, if there is one. Set by mentors and purchasers. */
  tracking: string | null
  /** The BOM part it's for, when it was asked for from the BOM page. */
  bom_part_id: string | null
  /** Who added it to the app. */
  created_by: string | null
}

/** The database allows the same: see the checks on its columns. */
export const MAX_NAME_LENGTH = 200
export const MAX_QUANTITY = 10000
export const MAX_PRICE = 99999.99
export const MAX_PART_NUMBER_LENGTH = 100
export const MAX_LINK_LENGTH = 2000
export const MAX_NOTES_LENGTH = 1000
export const MAX_TRACKING_LENGTH = 200

let exampleCount = 0
function example(
  fields: Omit<PurchaseItem, 'id' | 'created_at' | 'created_by' | 'link' | 'notes' | 'price' | 'ordered_by' | 'shipped_to' | 'estimated_arrival' | 'ordered_on' | 'tracking' | 'bom_part_id'> &
    Partial<Pick<PurchaseItem, 'price' | 'ordered_by' | 'shipped_to' | 'estimated_arrival' | 'ordered_on' | 'tracking' | 'bom_part_id'>> & { notes?: string },
  created_at: string,
): PurchaseItem {
  exampleCount += 1
  return {
    id: `00000000-0000-4000-8000-0000000c00${String(exampleCount).padStart(2, '0')}`,
    link: fields.part_number ? `https://example.com/parts/${fields.part_number}` : null,
    notes: null,
    price: null,
    ordered_by: null,
    shipped_to: null,
    estimated_arrival: null,
    ordered_on: null,
    tracking: null,
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
  example({ name: 'Compliant wheel, 2 in', status: 'order', vendor: 'Andy Mark', type: 'Intake', part_number: 'EXAMPLE-CW-2', quantity: 8, price: 6.5, requested_by: DEMO_PEOPLE.alex, notes: 'Spares for the intake rollers.', bom_part_id: BOM_COMPLIANT_WHEEL }, '2026-10-31T21:10:00Z'),
  example({ name: 'Brushless motor', status: 'order_high', vendor: 'REV Robotics', type: 'Intake', part_number: 'EXAMPLE-NEO-01', quantity: 2, price: 95, requested_by: DEMO_PEOPLE.sam, notes: 'Needed before Saturday build day.', bom_part_id: BOM_BRUSHLESS_MOTOR }, '2026-10-30T22:00:00Z'),
  example({ name: 'Zip ties, 8 in (pack of 100)', status: 'order_low', vendor: 'Amazon', type: 'Miscellaneous', part_number: null, quantity: 2, price: 7.25, requested_by: DEMO_PEOPLE.jordan }, '2026-10-30T19:45:00Z'),
  example({ name: 'Ethernet cables, 5 ft (10 pack)', status: 'wait', vendor: 'Amazon', type: 'Electrical', part_number: null, quantity: 1, requested_by: DEMO_PEOPLE.jordan }, '2026-10-29T18:20:00Z'),
  example({ name: 'Timing belt, 60T', status: 'placed', vendor: 'West Coast Products', type: 'Drive Base', part_number: 'EXAMPLE-TB-60', quantity: 4, price: 18.75, requested_by: DEMO_PEOPLE.sam, ...ORDERED, estimated_arrival: '2026-12-15', ordered_on: '2026-11-10', tracking: 'EXAMPLE-TRACK-0001' }, '2026-10-24T20:00:00Z'),
  example({ name: 'Hex bearing, 1/2 in', status: 'backordered', vendor: 'Andy Mark', type: 'Hardware', part_number: 'EXAMPLE-HB-12', quantity: 12, price: 3.2, requested_by: DEMO_PEOPLE.alex, ...ORDERED, estimated_arrival: '2026-11-01', ordered_on: '2026-10-23' }, '2026-10-22T23:15:00Z'),
  example({ name: 'Motor controller', status: 'received', vendor: 'CTRE', type: 'Electrical', part_number: 'EXAMPLE-MC-1', quantity: 1, price: 120, requested_by: DEMO_PEOPLE.pat, ...ORDERED, ordered_on: '2026-10-21', tracking: '1ZEXAMPLE000000002' }, '2026-10-21T17:00:00Z'),
  example({ name: 'Polycarbonate sheet, 1/8 in', status: 'in_shop', vendor: 'McMaster', type: 'Mechanical', part_number: 'EXAMPLE-PC-18', quantity: 1, price: 42.5, requested_by: DEMO_PEOPLE.jordan, ...ORDERED }, '2026-10-20T18:30:00Z'),
  // In the shop already, so the BOM's Drivetrain shows a part that arrived.
  example({ name: 'Absolute encoder', status: 'in_shop', vendor: 'CTRE', type: 'Drive Base', part_number: 'EXAMPLE-ENC-1', quantity: 4, price: 39, requested_by: DEMO_PEOPLE.sam, ...ORDERED, bom_part_id: BOM_ABSOLUTE_ENCODER }, '2026-10-19T17:30:00Z'),
  example({ name: 'Field tape, 2 in', status: 'cancelled', vendor: 'Other', type: 'Field', part_number: null, quantity: 3, requested_by: DEMO_PEOPLE.alex, notes: 'Found some in the storage room.' }, '2026-10-18T16:00:00Z'),
]

// Version 5: items have a date ordered and a tracking number.
export const itemsTable = createTable<PurchaseItem>('purchase_items', { demo: EXAMPLE_ITEMS, sort: newestFirst, version: 5 })

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

/** What only mentors and purchasers change once an item is ordered, along with its status and order details. */
const ORDER_LOCKED_FIELDS = ['name', 'vendor', 'type', 'link', 'part_number', 'quantity', 'price', 'notes'] as const

/**
 * Whether saving `changes` needs a mentor or purchaser: it moves an item
 * into or out of an order status (Order Placed and after), sets who ordered
 * it, who it ships to, when it arrives, when it was ordered or its tracking
 * number, or changes anything about an item
 * that's already ordered. Changing between the asking statuses doesn't, and
 * neither does changing anything else about a request.
 */
export function isOrderChange(item: PurchaseItem | null, changes: NewItem): boolean {
  const orderedBy = changes.ordered_by || null
  const shippedTo = changes.shipped_to || null
  const arrival = changes.estimated_arrival || null
  const orderedOn = changes.ordered_on || null
  const tracking = changes.tracking.trim() || null
  if (!item) return !isAsking(changes.status) || [orderedBy, shippedTo, arrival, orderedOn, tracking].some((detail) => detail !== null)
  const statusMoved = changes.status !== item.status && (!isAsking(item.status) || !isAsking(changes.status))
  const fields = itemFields(changes)
  const orderEdited = !isAsking(item.status) && ORDER_LOCKED_FIELDS.some((field) => fields[field] !== item[field])
  const detailsEdited = orderedBy !== item.ordered_by || shippedTo !== item.shipped_to || arrival !== item.estimated_arrival
    || orderedOn !== item.ordered_on || tracking !== item.tracking
  return statusMoved || orderEdited || detailsEdited
}

// ---------------------------------------------------------------------------
// Prices.

/** People type a price their own way, so "$1,250" is fine. */
const plainPrice = (text: string) => text.replace(/[$,\s]/g, '')

/** What's typed in the price box as a number, or null if it's empty. */
export function priceFrom(text: string): number | null {
  const price = plainPrice(text)
  return price ? Number(price) : null
}

/** What's wrong with what's typed in the price box, or null if it's fine. */
export function priceProblem(text: string): string | null {
  const price = plainPrice(text)
  if (!price) return null
  if (!/^(\d+\.?\d{0,2}|\.\d{1,2})$/.test(price)) return 'Type the price of one item in dollars and cents, like 12.50, or leave it empty.'
  if (Number(price) > MAX_PRICE) return `Check the price: one item can be up to ${money(MAX_PRICE)}.`
  return null
}

/** The price of the whole line: one item's price times the number needed. Counted in cents, so it adds up exactly. */
export function lineTotal(item: Pick<PurchaseItem, 'price' | 'quantity'>): number | null {
  return item.price === null ? null : (Math.round(item.price * 100) * item.quantity) / 100
}

/** "$12.50 each · $50.00 total", just "$12.50" for one item, or nothing if there's no price. */
export function priceText(item: Pick<PurchaseItem, 'price' | 'quantity'>): string | null {
  const total = lineTotal(item)
  if (item.price === null || total === null) return null
  return item.quantity === 1 ? money(item.price) : `${money(item.price)} each · ${money(total)} total`
}

/** priceText() for what's in the form, or nothing while what's typed isn't a price yet. */
export function formPriceText(form: Pick<NewItem, 'price' | 'quantity'>): string | null {
  return priceProblem(form.price) ? null : priceText({ price: priceFrom(form.price), quantity: form.quantity })
}

// ---------------------------------------------------------------------------
// Dates: when it was ordered, and its estimated arrival.

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

/** "Ordered Nov 10", or nothing if there's no date ordered. */
export function orderedText(item: Pick<PurchaseItem, 'ordered_on'>): string | null {
  return item.ordered_on ? `Ordered ${dayText(item.ordered_on)}` : null
}

/** The shipping companies the team's orders come by. */
export type Carrier = 'UPS' | 'USPS' | 'FedEx'

/** Each carrier's own tracking page. The tracking number goes on the end. */
const TRACKING_PAGES: Record<Carrier, string> = {
  UPS: 'https://www.ups.com/track?tracknum=',
  USPS: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=',
  FedEx: 'https://www.fedex.com/fedextrack/?trknbr=',
}

/** A tracking number as the carriers write it: no spaces or dashes, in capitals. */
function tidyTracking(number: string): string {
  return number.replace(/[\s-]/g, '').toUpperCase()
}

/**
 * Which carrier a tracking number belongs to, worked out from its shape
 * (#225), or null if it doesn't look like any of them. Spaces, dashes and
 * small letters don't matter. It's a good guess, not a promise: only the
 * carrier knows if the number is real.
 */
export function carrierFor(number: string): Carrier | null {
  const tidy = tidyTracking(number)
  // UPS: "1Z" and 16 more letters and digits.
  if (/^1Z[0-9A-Z]{16}$/.test(tidy)) return 'UPS'
  // USPS: 20 to 22 digits starting with 9, or 2 letters, 9 digits and "US".
  // This comes before FedEx, whose numbers can also be 20 digits.
  if (/^9\d{19,21}$/.test(tidy) || /^[A-Z]{2}\d{9}US$/.test(tidy)) return 'USPS'
  // FedEx: 12, 15 or 20 digits.
  if (/^(\d{12}|\d{15}|\d{20})$/.test(tidy)) return 'FedEx'
  return null
}

/**
 * A link to the carrier's own tracking page for a tracking number, like
 * "Track on UPS", or null if we can't tell whose number it is.
 */
export function trackingLink(number: string | null): { label: string; url: string } | null {
  const carrier = number ? carrierFor(number) : null
  if (!number || !carrier) return null
  return { label: `Track on ${carrier}`, url: TRACKING_PAGES[carrier] + encodeURIComponent(tidyTracking(number)) }
}

const NOT_A_BUYER = 'Only mentors and purchasers place and change orders. Ask a mentor.'

/** Who chooses the purchasers: mentors and admins, on the Members page (#144). */
export function canChooseBuyers(role: Role): boolean {
  return isMentor(role)
}

/** Who can be made a purchaser: anyone whose access is on, except mentors and admins, who already place orders. */
export function canBeBuyer(member: Pick<Member, 'active' | 'role'>): boolean {
  return member.active && !isMentor(member.role)
}

const NOT_CHOOSING = 'Only mentors and admins choose the purchasers.'

/** Make someone a purchaser. Mentors and admins only. */
export async function addBuyer(memberId: string): Promise<Result<Buyer>> {
  const me = currentUser()
  if (!me || !canChooseBuyers(me.role)) return fail(NOT_CHOOSING)
  if (!memberId) return fail('Pick someone first.')
  if (buyersTable.rows().some((b) => b.member_id === memberId)) return fail("They're already a purchaser.")
  return buyersTable.insert({ member_id: memberId })
}

/** Stop someone being a purchaser. Mentors and admins only. */
export async function removeBuyer(buyer: Buyer): Promise<Result> {
  const me = currentUser()
  if (!me || !canChooseBuyers(me.role)) return fail(NOT_CHOOSING)
  return buyersTable.remove(buyer.id)
}

/** The Members page's Purchaser tick: make someone a purchaser, or stop them being one. Doing it twice changes nothing. */
export async function setBuyer(memberId: string, on: boolean): Promise<Result> {
  const buyer = buyersTable.rows().find((b) => b.member_id === memberId)
  if (on === Boolean(buyer)) return ok(null)
  if (!on) return removeBuyer(buyer!)
  const added = await addBuyer(memberId)
  return added.ok ? ok(null) : added
}

// ---------------------------------------------------------------------------
// Receipts (#79): a PDF or photo of a receipt, on an item.
//
// Each receipt is a file in the private purchase-receipts bucket, and a row
// in purchase_receipts, which is how everyone can see that an item has one.
// Who can do what is in supabase/migrations/..._purchase_receipts.sql: the
// checks here only give a clearer message. Demo mode has no file storage, so
// there it only saves the row.

const RECEIPT_BUCKET = 'purchase-receipts'

/** The file types allowed, and how each file's name ends. The database has the same list. */
const RECEIPT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

/**
 * What the file picker offers. There's no `capture`, so a phone or tablet
 * offers the camera as well as files. It's only a hint: checkReceipt() and
 * the bucket are what refuse other kinds of file.
 */
export const RECEIPT_ACCEPT = 'application/pdf,image/*'

/** The database and the bucket have the same limit. */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024

/** How long a link to a receipt works, in seconds. Enough to open it, not to pass it around. */
export const RECEIPT_LINK_SECONDS = 60

/** One row of purchase_receipts. It doesn't hold the file, or the file's own name. */
export interface Receipt extends Row {
  item_id: string
  /** Where the file is in the bucket: the item's id, then a random id. */
  path: string
  content_type: string
  size_bytes: number
  /** Who added it. */
  created_by: string | null
}

// Made up, for the example Motor controller (the 7th item) and Polycarbonate sheet (the 8th).
const exampleReceipt = (n: number, itemNumber: number, content_type: string, ending: string, size_bytes: number, created_at: string): Receipt => {
  const item_id = `00000000-0000-4000-8000-0000000c000${itemNumber}`
  const id = `00000000-0000-4000-8000-0000000c030${n}`
  return { id, item_id, path: `${item_id}/${id}.${ending}`, content_type, size_bytes, created_at, created_by: DEMO_PEOPLE.pat }
}

const EXAMPLE_RECEIPTS: Receipt[] = [
  exampleReceipt(1, 8, 'application/pdf', 'pdf', 184_000, '2026-10-21T15:10:00Z'),
  exampleReceipt(2, 7, 'application/pdf', 'pdf', 96_000, '2026-10-22T14:00:00Z'),
  exampleReceipt(3, 7, 'image/jpeg', 'jpg', 2_400_000, '2026-10-28T19:30:00Z'),
]

export const receiptsTable = createTable<Receipt>('purchase_receipts', { demo: EXAMPLE_RECEIPTS })

/** An item's receipts, oldest first. */
export function useReceipts(itemId: string): Receipt[] {
  return receiptsTable.useRows().filter((r) => r.item_id === itemId)
}

/** The parts of a file that matter here. A real File has them. */
type ReceiptFile = Pick<File, 'name' | 'type' | 'size'>

/**
 * A file's type. Some browsers and phones leave it empty, or give a general
 * one like application/octet-stream or a spelling like image/jpg: then it
 * goes by how the name ends. Whatever comes back is one of RECEIPT_TYPES or
 * empty, so a file is only ever saved as a type on that list.
 */
export function receiptType(file: ReceiptFile): string {
  if (file.type in RECEIPT_TYPES) return file.type
  const ending = file.name.split('.').pop()?.toLowerCase()
  const known = Object.entries(RECEIPT_TYPES).find(([, e]) => e === (ending === 'jpeg' ? 'jpg' : ending))
  return known?.[0] ?? ''
}

/**
 * The file to upload, labelled with its type. Supabase sends the type on the
 * file itself and ignores the upload's contentType option, and the bucket
 * refuses anything else, so a file with the wrong label has to be relabelled.
 */
export function receiptBody(file: Blob, content_type: string): Blob {
  return file.slice(0, file.size, content_type)
}

/** Why a file can't be a receipt, or null if it can. */
export function checkReceipt(file: ReceiptFile): string | null {
  if (!(receiptType(file) in RECEIPT_TYPES)) return 'A receipt has to be a PDF or a photo (JPEG, PNG, WebP or HEIC).'
  if (file.size === 0) return "That file is empty. Try saving it again."
  if (file.size > MAX_RECEIPT_BYTES) return `That file is ${sizeText(file.size)}, and a receipt can be up to 10 MB. Try a smaller photo, or a PDF of just the receipt.`
  return null
}

/** "240 KB" or "2.4 MB". */
export function sizeText(bytes: number): string {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`
}

/** "PDF, 240 KB" or "Photo, 2.4 MB". */
export function receiptText(receipt: Receipt): string {
  return `${receipt.content_type === 'application/pdf' ? 'PDF' : 'Photo'}, ${sizeText(receipt.size_bytes)}`
}

/** "2 receipts", for an item in the list. Empty when it has none. */
export function receiptCountText(count: number): string {
  return count > 0 ? plural(count, 'receipt', 'receipts') : ''
}

/** The original file, plus a smaller alternative if the browser managed to make one. */
export interface PreparedReceipt {
  original: File
  compressed: File | null
  /** A decoded image is safe to preview. A PDF or an image the browser can't decode needs no image preview. */
  previewable: boolean
}

/**
 * Prepare a photo locally, without uploading anything. PDFs are used unchanged.
 * If decoding fails, the caller can still use the original within the same
 * size and type rules. addReceipt() checks again before actually uploading.
 */
export async function prepareReceipt(file: File, encoder?: ImageEncoder): Promise<Result<PreparedReceipt>> {
  const problem = checkReceipt(file)
  if (problem) return fail(problem)
  if (receiptType(file) === 'application/pdf') return ok({ original: file, compressed: null, previewable: false })
  try {
    const compressedFile = await compressReceiptImage(file, encoder)
    const compressed = compressedFile && compressedFile.size < file.size && !checkReceipt(compressedFile) ? compressedFile : null
    return ok({ original: file, compressed, previewable: true })
  } catch {
    return ok({ original: file, compressed: null, previewable: false })
  }
}

/**
 * Add a receipt to an item: the file first, then the row. If the row fails
 * the file stays with nothing pointing at it, but that's better the other
 * way round, where the list would say there's a receipt that isn't there.
 */
export async function addReceipt(item: PurchaseItem, file: File): Promise<Result<Receipt>> {
  if (!receiptAddingShown(item.status)) return fail('Mark the item Order Placed before adding a receipt.')
  if (!canOrder(currentUser(), buyersTable.rows())) return fail('Only mentors and purchasers add receipts. Ask a mentor.')
  const problem = checkReceipt(file)
  if (problem) return fail(problem)
  const content_type = receiptType(file)
  const path = `${item.id}/${crypto.randomUUID()}.${RECEIPT_TYPES[content_type]}`
  if (supabase) {
    const { error } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, receiptBody(file, content_type), { upsert: false })
    if (error) return fail("Couldn't upload that receipt. Check your connection and try again.")
  }
  return receiptsTable.insert({ item_id: item.id, path, content_type, size_bytes: file.size })
}

/** A link to a receipt that stops working soon. Mentors, admins and purchasers only. */
export async function receiptLink(receipt: Receipt): Promise<Result<string>> {
  if (!canOrder(currentUser(), buyersTable.rows())) return fail('Only mentors and purchasers can open receipts.')
  if (!supabase) return fail('Demo mode: there are no files. On the live site, this opens the receipt.')
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(receipt.path, RECEIPT_LINK_SECONDS)
  return error || !data ? fail("Couldn't open that receipt. Try again.") : ok(data.signedUrl)
}

/** Delete a receipt and its file. Mentors, admins and purchasers only. */
export async function removeReceipt(receipt: Receipt): Promise<Result> {
  if (!canOrder(currentUser(), buyersTable.rows())) return fail('Only mentors and purchasers can delete receipts.')
  // The file first: if the row went first and this failed, the file would
  // stay with nothing pointing at it. Trying again is safe.
  if (supabase) {
    const { error } = await supabase.storage.from(RECEIPT_BUCKET).remove([receipt.path])
    if (error) return fail("Couldn't delete that receipt. Try again.")
  }
  return receiptsTable.remove(receipt.id)
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
 *   - Current: what's in progress, newest first, under one heading. Each item shows its status.
 *   - All: everything, newest first.
 *   - By status: everything, by status.
 *   - By vendor: everything, by vendor, for putting one order together per vendor.
 *
 * Headings with nothing under them are left out.
 */
export function groupItems(items: PurchaseItem[], view: View): Group[] {
  if (view === 'Current') {
    const current = items.filter(isCurrent).sort(newestFirst)
    return current.length > 0 ? [{ title: 'In progress', items: current }] : []
  }
  if (view === 'All') return items.length > 0 ? [{ title: 'All items', items }] : []
  if (view === 'By vendor') {
    const vendors = [...VENDORS, ...[...new Set(items.map((i) => i.vendor))].filter((v) => !VENDORS.includes(v)).sort()]
    return vendors.map((vendor) => ({ title: vendor, items: items.filter((i) => i.vendor === vendor) })).filter((g) => g.items.length > 0)
  }
  return STATUSES.map((status) => ({ title: status.label, status, items: items.filter((i) => i.status === status.key) })).filter((g) => g.items.length > 0)
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

/** What someone types in. The link, part number, price, notes and order details can be left empty. */
export interface NewItem {
  name: string
  status: StatusKey
  vendor: string
  type: string
  link: string
  part_number: string
  quantity: number
  /** What one costs, as typed, like "12.50". Empty if nobody knows yet. */
  price: string
  notes: string
  /** Members' ids, or empty for nobody yet. Mentors and purchasers only. */
  ordered_by: string
  shipped_to: string
  /** A date like "2026-11-12", or empty. Mentors and purchasers only. */
  estimated_arrival: string
  /** The date it was ordered, like "2026-11-10", or empty. Mentors and purchasers only. */
  ordered_on: string
  /** The tracking number, or empty. Mentors and purchasers only. */
  tracking: string
}

export const EMPTY_ITEM: NewItem = {
  name: '', status: FIRST_STATUS, vendor: '', type: '', link: '', part_number: '', quantity: 1, price: '', notes: '', ordered_by: '', shipped_to: '', estimated_arrival: '', ordered_on: '', tracking: '',
}

/** The order details, in the order the form shows them. */
const ORDER_FIELDS = ['ordered_by', 'ordered_on', 'shipped_to', 'estimated_arrival', 'tracking'] as const
export type OrderField = (typeof ORDER_FIELDS)[number]

/**
 * Which order details the form shows: all of them once the order is placed
 * (any status past the asking ones, like Order Placed or Backordered), and
 * before that only the ones already filled in, so nothing saved is hidden.
 */
export function orderFieldsShown(form: Pick<NewItem, 'status' | OrderField>): Record<OrderField, boolean> {
  const placed = !isAsking(form.status)
  const shown = {} as Record<OrderField, boolean>
  for (const field of ORDER_FIELDS) shown[field] = placed || !!form[field]
  return shown
}

/** Whether to offer a new receipt: only once the item has been ordered. Existing receipts stay visible at any status. */
export function receiptAddingShown(status: StatusKey): boolean {
  return !isAsking(status)
}

/**
 * Whether an item's form shows its Receipts section at all: when it has
 * receipts to list (or count, for a student), or when a mentor or purchaser
 * can add one. Otherwise the heading would sit there with nothing under it.
 */
export function receiptsSectionShown(props: { canManage: boolean; count: number; showAdd: boolean }): boolean {
  return props.count > 0 || (props.canManage && props.showAdd)
}

/**
 * The form's changes when someone picks a new status. Moving an order to
 * Order Placed fills in Ordered by with them, as saving does (the database
 * does the same), unless someone else was already picked in the form. It
 * also fills in Date ordered with today (`on`), unless there's a date
 * already. Moving it away again puts back what was saved.
 */
export function pickStatus(form: NewItem, status: StatusKey, item: PurchaseItem | null, me: string, on: string = today()): Partial<NewItem> {
  const savedBy = item?.ordered_by ?? ''
  const savedOn = item?.ordered_on ?? ''
  const placing = status === 'placed' && item?.status !== 'placed'
  const undoing = !placing && form.status === 'placed' && item?.status !== 'placed'
  const changes: Partial<NewItem> = { status }
  if (placing && form.ordered_by === savedBy) changes.ordered_by = me
  if (placing && !form.ordered_on) changes.ordered_on = on
  if (undoing && form.ordered_by === me) changes.ordered_by = savedBy
  if (undoing && form.ordered_on === on) changes.ordered_on = savedOn
  return changes
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
    price: item.price === null ? '' : item.price.toFixed(2),
    notes: item.notes ?? '',
    ordered_by: item.ordered_by ?? '',
    shipped_to: item.shipped_to ?? '',
    estimated_arrival: item.estimated_arrival ?? '',
    ordered_on: item.ordered_on ?? '',
    tracking: item.tracking ?? '',
  }
}

/**
 * A new request filled in from an item, to buy it again. It starts as
 * Order, and whoever sends it is who asked for it, like any new request.
 */
export function duplicateItem(item: PurchaseItem): NewItem {
  return { ...itemToForm(item), status: FIRST_STATUS, ordered_by: '', shipped_to: '', estimated_arrival: '', ordered_on: '', tracking: '' }
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
  const badPrice = priceProblem(item.price)
  if (badPrice) return badPrice
  const link = item.link.trim()
  if (link && !/^https:\/\/\S+$/.test(link)) return "The link should be the product's page, starting with https://"
  if (link.length > MAX_LINK_LENGTH) return `That link is too long. Keep it under ${MAX_LINK_LENGTH} characters.`
  if (item.part_number.trim().length > MAX_PART_NUMBER_LENGTH) return `Keep the part number under ${MAX_PART_NUMBER_LENGTH} characters.`
  const notes = item.notes.trim()
  if (notes.length > MAX_NOTES_LENGTH) return `Keep the notes under ${MAX_NOTES_LENGTH} characters. These are ${notes.length}.`
  return orderDetailsProblem(item)
}

/** What's wrong with the dates or tracking number in the order details, or null if they're fine. */
function orderDetailsProblem(details: Pick<NewItem, 'estimated_arrival' | 'ordered_on' | 'tracking'>): string | null {
  if (details.estimated_arrival && !isDate(details.estimated_arrival)) return 'Pick the estimated arrival from the calendar, or leave it empty.'
  if (details.ordered_on && !isDate(details.ordered_on)) return 'Pick the date ordered from the calendar, or leave it empty.'
  const tracking = details.tracking.trim()
  if (tracking.length > MAX_TRACKING_LENGTH) return `Keep the tracking number under ${MAX_TRACKING_LENGTH} characters. This one is ${tracking.length}.`
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
  price: priceFrom(item.price),
  notes: item.notes.trim() || null,
  ordered_by: item.ordered_by || null,
  shipped_to: item.shipped_to || null,
  estimated_arrival: item.estimated_arrival || null,
  ordered_on: item.ordered_on || null,
  tracking: item.tracking.trim() || null,
})

/**
 * Add a new item as the person who asked for it. `bomPartId` is the
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

/**
 * Save changes to an item. When it moves to In Shop and `plan.add` is
 * ticked, what arrived is added to Inventory too.
 */
export async function changeItem(item: PurchaseItem, changes: NewItem, plan: InventoryPlan | null = null): Promise<Result<PurchaseItem>> {
  const problem = checkItem(changes)
  if (problem) return fail(problem)
  if (isOrderChange(item, changes) && !canOrder(currentUser(), buyersTable.rows())) return fail(NOT_A_BUYER)
  const shelving = plan !== null && changes.status === 'in_shop' && item.status !== 'in_shop'
  const planProblem = shelving ? checkPlan(plan, inventoryTable.rows()) : null
  if (planProblem) return fail(planProblem)
  const saved = await saveChanges(item, changes)
  if (!saved.ok || !shelving) return saved
  return addToInventory(saved.value, plan)
}

async function saveChanges(item: PurchaseItem, changes: NewItem): Promise<Result<PurchaseItem>> {
  const fields = itemFields(changes)
  // Placing an order without picking who ordered it: it's whoever placed it.
  // The team database fills that in itself; demo mode has no database, so
  // it's done here instead.
  const placing = changes.status === 'placed' && item.status !== 'placed' && fields.ordered_by === item.ordered_by
  return itemsTable.update(item.id, !isLive && placing ? { ...fields, ordered_by: currentUser()?.id ?? null } : fields)
}

/**
 * Who says an order has arrived, and puts it in the shop: student leaders,
 * as well as the mentors, admins and purchasers who change orders. These
 * two steps are all a student leader can change about an order.
 */
export function canReceive(user: Pick<User, 'id' | 'role'> | null, buyers: Buyer[]): boolean {
  return !!user && (isLeader(user.role) || canOrder(user, buyers))
}

/** Whether the signed-in person can mark an order as received or in the shop. */
export function useCanReceive(): boolean {
  return canReceive(useSession(), useBuyers())
}

const NOT_RECEIVING = 'Only student leaders, mentors and purchasers mark an order as received or in the shop. Ask one of them.'

/** The item as it is now: someone else may have changed it since the page drew it. */
const latestItem = (item: PurchaseItem) => itemsTable.rows().find((i) => i.id === item.id) ?? item

/**
 * Mark an order that's on its way (Order Placed, Out of Stock or
 * Backordered) as Received, changing nothing else about it. The database
 * has the same rule: supabase/migrations/..._purchase_items_leaders_receive.sql.
 */
export async function receiveItem(item: PurchaseItem): Promise<Result<PurchaseItem>> {
  if (!canReceive(currentUser(), buyersTable.rows())) return fail(NOT_RECEIVING)
  const current = latestItem(item)
  if (current.status === 'received') return fail(`${current.name} is already marked as received.`)
  if (!isOnItsWay(current)) {
    return fail(`${current.name} is ${statusOf(current.status).label}, so it can't be marked as received. Only an order that's on its way can. Ask a mentor or purchaser.`)
  }
  return itemsTable.update(current.id, { status: 'received' })
}

/**
 * Mark a received item as In Shop, changing nothing else about it, and
 * add it to Inventory when `plan.add` is ticked. For student leaders (and
 * mentors and purchasers): they can only move it on from Received.
 */
export async function shelveItem(item: PurchaseItem, plan: InventoryPlan): Promise<Result<PurchaseItem>> {
  if (!canReceive(currentUser(), buyersTable.rows())) return fail(NOT_RECEIVING)
  const current = latestItem(item)
  if (current.status !== 'received') {
    return fail(`${current.name} is ${statusOf(current.status).label}, so it can't be put in the shop from here. Only something marked Received can.`)
  }
  const problem = checkPlan(plan, inventoryTable.rows())
  if (problem) return fail(problem)
  const saved = await itemsTable.update(current.id, { status: 'in_shop' })
  if (!saved.ok) return saved
  return addToInventory(saved.value, plan)
}

/** Anyone can delete a request; only mentors and purchasers can delete an order. */
export async function removeItem(item: PurchaseItem): Promise<Result> {
  if (!isAsking(item.status) && !canOrder(currentUser(), buyersTable.rows())) {
    return fail('Only mentors and purchasers can delete an order. To stop it, ask one of them to cancel it.')
  }
  // The database refuses too: a receipt is a record of what was spent.
  if (receiptsTable.rows().some((r) => r.item_id === item.id)) {
    return fail('This item has a receipt, so it can\'t be deleted. A mentor or purchaser needs to delete the receipt first.')
  }
  return itemsTable.remove(item.id)
}

// ---------------------------------------------------------------------------
// Ordering a vendor's items together: purchasers usually buy everything
// waiting from one vendor at once, so the By vendor view has Order these.

/** Waiting to be ordered, highest priority first. (Wait to Order isn't: it says don't order yet.) */
const WAITING: StatusKey[] = ['order_high', 'order', 'order_low']

/** Ready to be ordered: Order High Priority, Order or Order Low Priority. */
export function isWaiting(item: Pick<PurchaseItem, 'status'>): boolean {
  return WAITING.includes(item.status)
}

/**
 * Each vendor's items waiting to be ordered, by vendor name: highest
 * priority first, then newest first. Vendors with nothing waiting are left out.
 */
export function waitingByVendor(items: PurchaseItem[]): Map<string, PurchaseItem[]> {
  const byVendor = new Map<string, PurchaseItem[]>()
  const waiting = items.filter(isWaiting).sort((a, b) => WAITING.indexOf(a.status) - WAITING.indexOf(b.status) || newestFirst(a, b))
  for (const item of waiting) byVendor.set(item.vendor, [...(byVendor.get(item.vendor) ?? []), item])
  return byVendor
}

/** "Total $58.50 for 3 items · 1 has no price yet", for the items ticked to order. */
export function orderTotalText(items: Pick<PurchaseItem, 'price' | 'quantity'>[]): string {
  if (items.length === 0) return 'Nothing ticked.'
  const totals = items.map(lineTotal)
  const cents = totals.reduce<number>((sum, total) => sum + Math.round((total ?? 0) * 100), 0)
  const unpriced = totals.filter((total) => total === null).length
  const missing = unpriced === 0 ? '' : ` · ${unpriced} ${unpriced === 1 ? 'has' : 'have'} no price yet`
  return `Total ${money(cents / 100)} for ${plural(items.length, 'item', 'items')}${missing}`
}

/**
 * Part numbers and quantities, one item per line, to paste into a vendor's
 * quick order or bulk add page. There's no heading line, because those
 * pages would read it as a part. Items with no part number are left out:
 * the page says how many, so they're added by hand.
 */
export function cartCsv(items: PurchaseItem[]): string {
  return toCsv(items.filter((item) => item.part_number).map((item) => [item.part_number!, String(item.quantity)]))
}

/** Everything about the items as CSV, for the team's records. `nameOf` turns a member's id into their name. */
export function orderCsv(items: PurchaseItem[], nameOf: (id: string | null) => string): string {
  return toCsv([
    ['Name', 'Part number', 'Quantity', 'Price each', 'Link', 'Requested by'],
    ...items.map((item) => [
      item.name,
      item.part_number ?? '',
      String(item.quantity),
      item.price === null ? '' : item.price.toFixed(2),
      item.link ?? '',
      nameOf(item.requested_by),
    ]),
  ])
}

/** The order details filled in once for every item ordered together. Empty means not filled in. */
export type OrderDetails = Pick<NewItem, OrderField>

const namesOf = (items: PurchaseItem[]) => items.map((item) => item.name).join(', ')

/**
 * Move several items to Order Placed at once, with the same order details.
 * Leaving Ordered by empty means you. Mentors and purchasers only.
 *
 * Nothing is saved unless every item is still waiting to be ordered. After
 * that each item is saved on its own, so if one fails the error says which,
 * and which were already saved.
 */
export async function markOrdered(ids: string[], details: OrderDetails): Promise<Result<PurchaseItem[]>> {
  if (!canOrder(currentUser(), buyersTable.rows())) return fail(NOT_A_BUYER)
  if (ids.length === 0) return fail('Tick at least one item to order.')
  const problem = orderDetailsProblem(details)
  if (problem) return fail(problem)
  const rows = itemsTable.rows()
  const items = ids.map((id) => rows.find((row) => row.id === id))
  if (!items.every((item) => item !== undefined)) return fail('One of these items has been deleted, so nothing was saved. Close this list, open it again and try again.')
  const moved = items.filter((item) => !isWaiting(item))
  if (moved.length > 0) return fail(`Not waiting to be ordered any more: ${namesOf(moved)}. Nothing was saved. Untick ${moved.length === 1 ? 'it' : 'them'} and try again.`)

  const saved: PurchaseItem[] = []
  const failed: string[] = []
  for (const item of items) {
    const result = await changeItem(item, { ...itemToForm(item), ...details, status: 'placed' })
    if (result.ok) saved.push(result.value)
    else failed.push(`${item.name} (${result.error.replace(/\.$/, '')})`)
  }
  if (failed.length === 0) return ok(saved)
  const done = saved.length > 0 ? `Already saved as ordered: ${namesOf(saved)}.` : 'Nothing was saved.'
  return fail(`Couldn't mark these as ordered: ${failed.join('; ')}. ${done} Open each one that failed to fix it, then try again.`)
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

/** The vendor from the list above that a BOM or Inventory vendor means, or null if there isn't one. */
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
 * vendor, product page, vendor part number and quantity, and the system as the type when
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
    // The product page from the BOM, if it has one (#169).
    link: part.product_url ?? '',
    part_number: part.vendor_part_number ?? '',
    quantity: Math.min(Math.max(part.quantity, 1), MAX_QUANTITY),
    notes: !vendor && part.vendor ? `Vendor in the BOM: ${part.vendor}` : '',
  }
}

/**
 * A request filled in from an Inventory part, to order more of it (#194): its
 * name, product link and vendor part number, and the vendor when it's on the
 * list above. A vendor that isn't is left empty for the person to pick, with
 * Inventory's name for it in the notes. Number needed starts at 1.
 */
export function requestFromInventoryItem(item: InventoryItem): NewItem {
  const vendor = vendorFor(item.vendor)
  return {
    ...EMPTY_ITEM,
    name: item.name,
    vendor: vendor ?? '',
    link: item.link ?? '',
    part_number: item.vendor_part_number,
    quantity: 1,
    notes: vendor ? '' : `Vendor in Inventory: ${item.vendor}`,
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

// ---------------------------------------------------------------------------
// Adding what arrived to Inventory. When an item moves to In Shop, the form
// has an Add to Inventory tick. It finds the Inventory part it most likely
// is (matchParts()), and adds the number that arrived to that part's stock,
// or adds a new part. Anyone on the team can add parts and stock, so this
// needs no new database rule. Inventory's own data.ts does the saving.

/** Why an Inventory part matched, strongest first. */
export const MATCH_REASONS = ['Same vendor and part number', 'Same part number', 'Same product link', 'Same name'] as const
export type MatchReason = (typeof MATCH_REASONS)[number]

export interface PartMatch {
  part: InventoryItem
  reason: MatchReason
}

/** A product link without the bits that change between copies of it: capitals, "www.", a trailing slash or "#...". */
function plainLink(link: string): string {
  return link.trim().toLowerCase().replace(/#.*$/, '').replace(/^https:\/\/www\./, 'https://').replace(/\/+$/, '')
}

/** The name with capitals and extra spaces ignored. */
const plainName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * The Inventory parts a purchase item might be, strongest match first, each
 * listed once with its strongest reason:
 *
 *   1. the same vendor and part number (Inventory's "AndyMark" is Andy Mark)
 *   2. the same part number, from any vendor
 *   3. the same product link
 *   4. the same name
 *
 * Part numbers ignore capitals, spaces and dashes, so "REV-11-1850" matches
 * "rev 11 1850". An empty part number, link or name never matches.
 */
export function matchParts(item: Pick<PurchaseItem, 'name' | 'vendor' | 'part_number' | 'link'>, parts: InventoryItem[]): PartMatch[] {
  const number = plain(item.part_number ?? '')
  const link = item.link ? plainLink(item.link) : ''
  const name = plainName(item.name)
  const reasonFor = (part: InventoryItem): MatchReason | null => {
    const sameNumber = number !== '' && plain(part.vendor_part_number) === number
    if (sameNumber && vendorFor(part.vendor) === item.vendor) return 'Same vendor and part number'
    if (sameNumber) return 'Same part number'
    if (link && part.link && plainLink(part.link) === link) return 'Same product link'
    if (name && plainName(part.name) === name) return 'Same name'
    return null
  }
  return parts
    .map((part) => ({ part, reason: reasonFor(part) }))
    .filter((m): m is PartMatch => m.reason !== null)
    .sort((a, b) => MATCH_REASONS.indexOf(a.reason) - MATCH_REASONS.indexOf(b.reason) || a.part.name.localeCompare(b.part.name))
}

/** What the Add to Inventory tick does when an item moves to In Shop. */
export interface InventoryPlan {
  /** Whether to add it to Inventory at all. One-off parts don't need to be. */
  add: boolean
  /** The Inventory part to add to, or '' for a new part. */
  partId: string
  /** How many single parts go on the shelf. Starts as the number needed; a pack of 100 is 100. */
  quantity: number
  /** For a new part only: what Inventory lists it as. */
  name: string
  vendor: string
  vendor_part_number: string
  location: string
}

/**
 * Where the tick starts: ticked, adding to the best match, when there is
 * one; otherwise unticked, with a new part filled in from the item. The
 * number to add starts as the number needed, as single parts.
 */
export function planFor(item: PurchaseItem, parts: InventoryItem[]): InventoryPlan {
  const [best] = matchParts(item, parts)
  return {
    add: !!best,
    partId: best?.part.id ?? '',
    quantity: item.quantity,
    name: item.name,
    vendor: item.vendor,
    vendor_part_number: item.part_number ?? '',
    location: '',
  }
}

/** Why a plan can't be done, or null if it can (or it isn't ticked). `parts` is every Inventory part. */
export function checkPlan(plan: InventoryPlan, parts: InventoryItem[]): string | null {
  if (!plan.add) return null
  if (!Number.isInteger(plan.quantity) || plan.quantity < 1) return 'Enter how many single parts go on the shelf, 1 or more.'
  if (plan.partId) {
    return parts.some((p) => p.id === plan.partId) ? null : 'That Inventory part has been deleted. Pick another, or add a new part.'
  }
  return checkInventoryPart(newPart(plan, ''), parts)
}

function newPart(plan: InventoryPlan, link: string) {
  return {
    name: plan.name,
    vendor: plan.vendor,
    vendor_part_number: plan.vendor_part_number,
    location: plan.location,
    link,
    quantity: plan.quantity,
    low_stock_level: 0,
  }
}

/** The note on the Inventory history line. */
export const FROM_PURCHASING = 'Arrived (from Purchasing)'

/** Add what arrived to Inventory, for an item already saved as In Shop. */
async function addToInventory(item: PurchaseItem, plan: InventoryPlan): Promise<Result<PurchaseItem>> {
  if (!plan.add) return ok(item)
  const part = inventoryTable.rows().find((p) => p.id === plan.partId)
  const added = part
    ? await changeStock(part, plan.quantity, FROM_PURCHASING)
    : await addInventoryPart(newPart(plan, item.link ?? ''))
  if (added.ok) return ok(item)
  return fail(`${item.name} is saved as In Shop, but it wasn't added to Inventory: ${added.error} Add it on the Inventory page.`)
}
