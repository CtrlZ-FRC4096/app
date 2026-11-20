// Tests for data.ts. Run them with `npm test`.
// They run in demo mode, starting from the example items, as the made-up
// student Alex. Who is allowed to do what is the database's job: that's
// tested in supabase/tests/purchase-items.test.ts, purchasing-orders.test.ts
// and purchase-receipts.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import type { Member } from '../../core/members'
import { changesTable as inventoryChanges, itemsTable as inventoryTable, type Item as InventoryItem } from '../inventory/data'
import {
  EMPTY_ITEM,
  MAX_NAME_LENGTH,
  MAX_QUANTITY,
  MAX_RECEIPT_BYTES,
  MAX_TRACKING_LENGTH,
  RECEIPT_ACCEPT,
  STATUSES,
  TYPES,
  VENDORS,
  addBuyer,
  canBeBuyer,
  canChooseBuyers,
  addItem,
  arrivalText,
  addReceipt,
  buyersTable,
  canOrder,
  canReceive,
  checkPlan,
  matchParts,
  planFor,
  receiveItem,
  shelveItem,
  FROM_PURCHASING,
  type InventoryPlan,
  cartCsv,
  markOrdered,
  orderCsv,
  orderTotalText,
  waitingByVendor,
  carrierFor,
  changeItem,
  checkItem,
  orderFieldsShown,
  orderedText,
  pickStatus,
  checkReceipt,
  choices,
  dayText,
  duplicateItem,
  formPriceText,
  groupItems,
  isLate,
  isOrderChange,
  removeBuyer,
  setBuyer,
  trackingLink,
  requestFromBomPart,
  requestFromInventoryItem,
  requestsByBomPart,
  searchItems,
  vendorFor,
  isCurrent,
  itemToForm,
  itemsTable,
  lineTotal,
  priceFrom,
  priceProblem,
  priceText,
  prepareReceipt,
  receiptBody,
  receiptAddingShown,
  receiptCountText,
  receiptLink,
  receiptText,
  receiptType,
  receiptsSectionShown,
  receiptsTable,
  removeItem,
  removeReceipt,
  sizeText,
  statusOf,
  summaryText,
  today,
  type NewItem,
  type PurchaseItem,
} from './data'

beforeEach(() => {
  itemsTable.reset()
  buyersTable.reset()
  receiptsTable.reset()
  inventoryTable.reset()
  inventoryChanges.reset()
})

afterEach(() => setDemoRole('student'))

const find = (name: string) => itemsTable.rows().find((i) => i.name === name)!
const valid = { ...EMPTY_ITEM, name: 'Bolts', vendor: 'McMaster', type: 'Hardware' }

describe('the lists', () => {
  it("has the Slack list's 10 statuses, in order, and lets people asking pick only a priority", () => {
    expect(STATUSES.map((s) => s.label)).toEqual([
      'Wait to Order',
      'Order Low Priority',
      'Order',
      'Order High Priority',
      'Order Placed',
      'Out of Stock',
      'Backordered',
      'Received',
      'In Shop',
      'Cancel Item',
    ])
    expect(STATUSES.filter((s) => s.ask).map((s) => s.key)).toEqual(['wait', 'order_low', 'order', 'order_high'])
  })

  it('uses only listed vendors and types in the example items', () => {
    for (const item of itemsTable.rows()) {
      expect(VENDORS).toContain(item.vendor)
      expect(TYPES).toContain(item.type)
    }
  })
})

describe('prices', () => {
  const ordered = () => find('Timing belt, 60T')
  const asked = () => find('Zip ties, 8 in (pack of 100)')

  it('reads what people type, with or without a dollar sign or comma', () => {
    expect(priceFrom('12.5')).toBe(12.5)
    expect(priceFrom('$1,250.00')).toBe(1250)
    expect(priceFrom(' 7 ')).toBe(7)
    expect(priceFrom('0')).toBe(0)
    expect(priceFrom('')).toBeNull()
    expect(priceFrom('  ')).toBeNull()
  })

  it('accepts dollars and cents, or an empty box, and refuses anything else, saying what to do', () => {
    for (const price of ['', '12', '12.', '12.5', '12.50', '.99', '0', '$1,250.00', '99999.99']) {
      expect(priceProblem(price), price).toBeNull()
    }
    for (const price of ['abc', '-5', '12.345', '1e3', '.', '12 dollars']) {
      expect(priceProblem(price), price).toMatch(/like 12\.50/)
    }
    expect(priceProblem('100000')).toMatch(/up to \$99,999\.99/)
  })

  it('works out the line from the price of one and the number needed', () => {
    expect(lineTotal({ price: 12.5, quantity: 4 })).toBe(50)
    expect(lineTotal({ price: 0.07, quantity: 3 })).toBe(0.21)
    expect(lineTotal({ price: 19.99, quantity: 100 })).toBe(1999)
    expect(lineTotal({ price: 0, quantity: 4 })).toBe(0)
    expect(lineTotal({ price: null, quantity: 4 })).toBeNull()
  })

  it('shows the price each and the total, or just the price for one, and in the form only once what is typed is a price', () => {
    expect(priceText({ price: 12.5, quantity: 4 })).toBe('$12.50 each · $50.00 total')
    expect(priceText({ price: 12.5, quantity: 1 })).toBe('$12.50')
    expect(priceText({ price: 0, quantity: 2 })).toBe('$0.00 each · $0.00 total')
    expect(priceText({ price: null, quantity: 4 })).toBeNull()
    expect(formPriceText({ price: '12.5', quantity: 4 })).toBe('$12.50 each · $50.00 total')
    expect(formPriceText({ price: '', quantity: 4 })).toBeNull()
    expect(formPriceText({ price: 'abc', quantity: 4 })).toBeNull()
  })

  it('can be filled in, changed or emptied by a student while it is being asked for', async () => {
    const added = await addItem({ ...valid, price: '$12.50', quantity: 4 })
    expect(added.ok && added.value.price).toBe(12.5)
    const without = await addItem(valid)
    expect(without.ok && without.value.price).toBeNull()
    expect((await changeItem(asked(), { ...itemToForm(asked()), price: '8.00' })).ok).toBe(true)
    expect(asked().price).toBe(8)
    expect((await changeItem(asked(), { ...itemToForm(asked()), price: '' })).ok).toBe(true)
    expect(asked().price).toBeNull()
  })

  it('fills in the form, and comes back the same', () => {
    expect(itemToForm(asked()).price).toBe('7.25')
    expect(itemToForm(find('Ethernet cables, 5 ft (10 pack)')).price).toBe('')
    expect(isOrderChange(ordered(), itemToForm(ordered()))).toBe(false)
  })

  // A student can't change it once it's ordered: see "only mentors and purchasers" below.
  it('can be changed by a mentor or purchaser once it is ordered, along with the number needed and the rest of the order', async () => {
    await buyersTable.insert({ member_id: DEMO_PEOPLE.alex })
    expect((await changeItem(ordered(), { ...itemToForm(ordered()), price: '20.00' })).ok).toBe(true)
    expect(ordered().price).toBe(20)
    await buyersTable.reset()
    setDemoRole('mentor')
    expect((await changeItem(ordered(), { ...itemToForm(ordered()), price: '21.00', quantity: 5, notes: 'Two boxes' })).ok).toBe(true)
    expect(ordered()).toMatchObject({ price: 21, quantity: 5, notes: 'Two boxes' })
  })
})

describe('choices', () => {
  it('is the list, plus the value if it is no longer in the list', () => {
    expect(choices(['A', 'B'], 'B')).toEqual(['A', 'B'])
    expect(choices(['A', 'B'], '')).toEqual(['A', 'B'])
    expect(choices(['A', 'B'], 'Old vendor')).toEqual(['A', 'B', 'Old vendor'])
  })
})

describe('isCurrent', () => {
  it('counts what is in progress, including Backordered', () => {
    const current = STATUSES.filter((s) => isCurrent({ status: s.key } as PurchaseItem)).map((s) => s.label)
    expect(current).toEqual(['Order Low Priority', 'Order', 'Order High Priority', 'Order Placed', 'Out of Stock', 'Backordered', 'Received'])
  })
})

describe('groupItems', () => {
  it('Current: what is in progress, newest first under one heading, with no status grouping', () => {
    const groups = groupItems(itemsTable.rows(), 'Current')
    expect(groups.map((g) => g.title)).toEqual(['In progress'])
    expect(groups[0].status).toBeUndefined()
    expect(groups[0].items).toHaveLength(6)
    expect(groups[0].items[0].name).toBe('Compliant wheel, 2 in')
    expect(groups[0].items.at(-1)!.name).toBe('Motor controller')
    const dates = groups[0].items.map((i) => i.created_at)
    expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)))
    expect(groups[0].items.every(isCurrent)).toBe(true)
    expect(groups[0].items.some((i) => ['wait', 'in_shop', 'cancelled'].includes(i.status))).toBe(false)
  })

  it('All: everything, newest first, under one heading', () => {
    const [all] = groupItems(itemsTable.rows(), 'All')
    expect(all.items).toHaveLength(10)
    expect(all.items[0].name).toBe('Compliant wheel, 2 in')
  })

  it('By status: everything, by status, leaving out empty ones', () => {
    const groups = groupItems(itemsTable.rows(), 'By status')
    expect(groups[0].title).toBe('Wait to Order')
    expect(groups.at(-1)!.title).toBe('Cancel Item')
    expect(groups.map((g) => g.title)).not.toContain('Out of Stock')
    expect(groups.flatMap((g) => g.items)).toHaveLength(10)
  })

  it('By vendor: in the order of the vendor list, with vendors no longer listed at the end', () => {
    const items = [...itemsTable.rows(), { ...find('Brushless motor'), id: 'x', vendor: 'Old Shop' }]
    const groups = groupItems(items, 'By vendor')
    expect(groups.map((g) => g.title)).toEqual(['Amazon', 'West Coast Products', 'Andy Mark', 'REV Robotics', 'McMaster', 'CTRE', 'Other', 'Old Shop'])
    expect(groups.find((g) => g.title === 'Amazon')!.items).toHaveLength(2)
  })

  it('has no headings when there are no items', () => {
    expect(groupItems([], 'All')).toEqual([])
    expect(groupItems([], 'Current')).toEqual([])
  })
})

describe('summaryText', () => {
  it('counts what to order now and how much is high priority, or else what is in progress', () => {
    expect(summaryText(itemsTable.rows())).toBe('2 to order now (1 high priority)')
    const items = itemsTable.rows().filter((i) => i.status !== 'order' && i.status !== 'order_high')
    expect(summaryText(items)).toBe('Nothing to order now · 4 in progress')
    expect(summaryText([])).toBe('Nothing to order now')
  })
})

describe('checkItem', () => {
  it('allows an item with a name, vendor, type and quantity, up to the limits', () => {
    const allowed: [string, Partial<NewItem>][] = [
      ['just the basics', {}],
      ['the longest name', { name: 'x'.repeat(MAX_NAME_LENGTH) }],
      ['the most you can ask for', { quantity: MAX_QUANTITY }],
      ['an https:// link', { link: 'https://example.com/part' }],
      ['a price', { price: '12.50' }],
      ['a real estimated arrival', { estimated_arrival: '2026-11-12' }],
      ['a real date ordered', { ordered_on: '2026-11-10' }],
      ['the longest tracking number', { tracking: 'x'.repeat(MAX_TRACKING_LENGTH) }],
    ]
    for (const [label, change] of allowed) expect(checkItem({ ...valid, ...change }), label).toBeNull()
  })

  it('refuses an item that breaks a rule, and says what to fix', () => {
    const refused: [string, Partial<NewItem>, RegExp][] = [
      ['no name', { name: '  ' }, /what to buy/],
      ['no vendor', { vendor: '' }, /Pick a vendor/],
      ['no type', { type: '' }, /Pick a type/],
      ['a name too long', { name: 'x'.repeat(MAX_NAME_LENGTH + 1) }, /under 200/],
      ['none', { quantity: 0 }, /at least 1/],
      ['half of one', { quantity: 2.5 }, /at least 1/],
      ['too many', { quantity: MAX_QUANTITY + 1 }, /fewer/],
      ['an http:// link', { link: 'http://example.com/part' }, /https:\/\//],
      ['a javascript: link', { link: 'javascript:alert(1)' }, /https:\/\//],
      ['a made-up status', { status: 'lost' as never }, /Pick a status/],
      ['a price that is not dollars and cents', { price: 'abc' }, /like 12\.50/],
      ['a day that does not exist', { estimated_arrival: '2026-02-30' }, /estimated arrival/],
      ['an arrival that is not a date', { estimated_arrival: 'next week' }, /estimated arrival/],
      ['a date ordered that does not exist', { ordered_on: '2026-02-30' }, /date ordered/],
      ['a tracking number too long', { tracking: 'x'.repeat(MAX_TRACKING_LENGTH + 1) }, /tracking number under 200/],
    ]
    for (const [label, change, problem] of refused) expect(checkItem({ ...valid, ...change }), label).toMatch(problem)
  })
})

describe('addItem', () => {
  it('adds an item, trimmed, with empty boxes saved as nothing, requested by you', async () => {
    const result = await addItem({ ...valid, name: '  Shaft collar  ', status: 'order_high', quantity: 6, notes: ' For the arm ' })
    expect(result.ok).toBe(true)
    expect(itemsTable.rows()[0]).toMatchObject({
      name: 'Shaft collar',
      status: 'order_high',
      vendor: 'McMaster',
      type: 'Hardware',
      link: null,
      part_number: null,
      quantity: 6,
      notes: 'For the arm',
      requested_by: DEMO_PEOPLE.alex,
    })
  })

  it('starts as Order unless you pick a priority', async () => {
    await addItem(valid)
    expect(itemsTable.rows()[0].status).toBe('order')
    expect(statusOf(itemsTable.rows()[0].status).label).toBe('Order')
  })

  it('refuses an item without a name and says why', async () => {
    expect((await addItem(EMPTY_ITEM)).ok).toBe(false)
    expect(itemsTable.rows()).toHaveLength(10)
  })
})

describe('changeItem', () => {
  it("changes anyone's request, including its priority", async () => {
    const item = find('Zip ties, 8 in (pack of 100)')
    expect((await changeItem(item, { ...itemToForm(item), status: 'order_high', quantity: 3 })).ok).toBe(true)
    expect(find('Zip ties, 8 in (pack of 100)')).toMatchObject({ status: 'order_high', quantity: 3, requested_by: DEMO_PEOPLE.jordan })
  })

  it('keeps every field the same when nothing is changed in the form', async () => {
    const item = find('Brushless motor')
    expect(await changeItem(item, itemToForm(item))).toEqual({ ok: true, value: item })
  })

  it('refuses a change that breaks a rule', async () => {
    const item = find('Brushless motor')
    expect((await changeItem(item, { ...itemToForm(item), quantity: 0 })).ok).toBe(false)
    expect(find('Brushless motor').quantity).toBe(2)
  })
})

describe('removeItem', () => {
  it('deletes only that item, and says so if it is already gone', async () => {
    const item = find('Ethernet cables, 5 ft (10 pack)')
    expect(await removeItem(item)).toEqual({ ok: true, value: null })
    expect(itemsTable.rows()).toHaveLength(9)
    expect((await removeItem(item)).ok).toBe(false)
  })
})

describe('searchItems', () => {
  it('finds items by name, vendor, type, part number or notes, ignoring capitals, matching every word typed', () => {
    const searches: [string, string[]][] = [
      ['BELT', ['Timing belt, 60T']],
      ['mcmaster', ['Polycarbonate sheet, 1/8 in']],
      ['example-neo', ['Brushless motor']],
      ['storage room', ['Field tape, 2 in']],
      ['amazon cables', ['Ethernet cables, 5 ft (10 pack)']],
      ['unobtainium', []],
    ]
    for (const [search, names] of searches) expect(searchItems(itemsTable.rows(), search).map((i) => i.name), search).toEqual(names)
    expect(searchItems(itemsTable.rows(), '  ')).toHaveLength(10)
  })
})

describe('duplicateItem', () => {
  it('fills in a new request from an item, starting as Order, not ordered or shipped yet', () => {
    const item = find('Timing belt, 60T')
    expect(duplicateItem(item)).toEqual({ ...itemToForm(item), status: 'order', ordered_by: '', shipped_to: '', estimated_arrival: '', ordered_on: '', tracking: '' })
  })

  it('makes a new item requested by you when sent, leaving the old one as it was', async () => {
    const item = find('Timing belt, 60T')
    expect((await addItem(duplicateItem(item))).ok).toBe(true)
    expect(itemsTable.rows()[0]).toMatchObject({ name: 'Timing belt, 60T', status: 'order', requested_by: DEMO_PEOPLE.alex, ordered_by: null })
    expect(find('Timing belt, 60T')).toBeDefined()
    expect(itemsTable.rows().filter((i) => i.name === 'Timing belt, 60T')).toHaveLength(2)
  })
})

describe('placing orders', () => {
  const student = { id: DEMO_PEOPLE.alex, role: 'student' as const }
  const buyer = { id: DEMO_PEOPLE.jordan, role: 'student' as const }
  const mentor = { id: DEMO_PEOPLE.pat, role: 'mentor' as const }

  it('is for mentors, admins and purchasers', () => {
    const buyers = buyersTable.rows()
    expect(canOrder(student, buyers)).toBe(false)
    expect(canOrder(buyer, buyers)).toBe(true)
    expect(canOrder(mentor, buyers)).toBe(true)
    expect(canOrder(null, buyers)).toBe(false)
  })

  it('counts moving into or out of an order status, setting order details, or changing anything about an order as an order change', () => {
    const asked = find('Zip ties, 8 in (pack of 100)')
    const ordered = find('Timing belt, 60T')
    const changes: [string, PurchaseItem | null, Partial<NewItem>, boolean][] = [
      ['a new priority', asked, { status: 'order_high' }, false],
      ['the notes of a request', asked, { notes: 'Two boxes' }, false],
      ['the number needed on a request', asked, { quantity: 5 }, false],
      ['the price of a request', asked, { price: '8.00' }, false],
      ['placing a request', asked, { status: 'placed' }, true],
      ['Shipped to on a request', asked, { shipped_to: DEMO_PEOPLE.pat }, true],
      ['nothing on an order', ordered, {}, false],
      ['an order back to Order', ordered, { status: 'order' }, true],
      ['Ordered by', ordered, { ordered_by: DEMO_PEOPLE.jordan }, true],
      ['the estimated arrival', ordered, { estimated_arrival: '2026-12-20' }, true],
      ['the date ordered', ordered, { ordered_on: '2026-11-11' }, true],
      ['the tracking number', ordered, { tracking: 'EXAMPLE-TRACK-9999' }, true],
      ['spaces around the tracking number', ordered, { tracking: ' EXAMPLE-TRACK-0001 ' }, false],
      ['a tracking number on a request', asked, { tracking: 'EXAMPLE-TRACK-9999' }, true],
      ['the name of an order', ordered, { name: 'Belt' }, true],
      ['the vendor of an order', ordered, { vendor: 'Amazon' }, true],
      ['the type of an order', ordered, { type: 'Field' }, true],
      ['the link of an order', ordered, { link: 'https://example.com/other' }, true],
      ['the part number of an order', ordered, { part_number: 'OTHER' }, true],
      ['the number needed on an order', ordered, { quantity: 5 }, true],
      ['the price of an order', ordered, { price: '1.00' }, true],
      ['emptying the price of an order', ordered, { price: '' }, true],
      ['the notes of an order', ordered, { notes: 'Two boxes' }, true],
      ['a new request', null, {}, false],
      ['a new item that is already placed', null, { status: 'placed' }, true],
    ]
    for (const [label, item, change, expected] of changes) {
      expect(isOrderChange(item, { ...(item ? itemToForm(item) : valid), ...change }), label).toBe(expected)
    }
  })

  it('lets a mentor place an order, filling in Ordered by and Shipped to', async () => {
    setDemoRole('mentor')
    const item = find('Zip ties, 8 in (pack of 100)')
    expect((await changeItem(item, { ...itemToForm(item), status: 'placed', shipped_to: DEMO_PEOPLE.jordan })).ok).toBe(true)
    expect(find('Zip ties, 8 in (pack of 100)')).toMatchObject({ status: 'placed', ordered_by: DEMO_PEOPLE.pat, shipped_to: DEMO_PEOPLE.jordan })
  })

  it('uses who a mentor picks, when they place an order for someone else', async () => {
    setDemoRole('mentor')
    const item = find('Zip ties, 8 in (pack of 100)')
    expect((await changeItem(item, { ...itemToForm(item), status: 'placed', ordered_by: DEMO_PEOPLE.jordan })).ok).toBe(true)
    expect(find('Zip ties, 8 in (pack of 100)').ordered_by).toBe(DEMO_PEOPLE.jordan)
  })

  it('lets a mentor change who ordered something, but not a student', async () => {
    const item = find('Timing belt, 60T')
    const changed = { ...itemToForm(item), ordered_by: DEMO_PEOPLE.jordan }
    expect((await changeItem(item, changed)).ok).toBe(false)
    expect(find('Timing belt, 60T').ordered_by).toBe(DEMO_PEOPLE.pat)
    setDemoRole('mentor')
    expect((await changeItem(item, changed)).ok).toBe(true)
    expect(find('Timing belt, 60T').ordered_by).toBe(DEMO_PEOPLE.jordan)
  })

  it('lets a mentor delete an order', async () => {
    setDemoRole('mentor')
    expect((await removeItem(find('Timing belt, 60T'))).ok).toBe(true)
  })
})

describe('purchasers', () => {
  it('are chosen and removed by mentors, and never added twice', async () => {
    setDemoRole('mentor')
    expect((await addBuyer(DEMO_PEOPLE.alex)).ok).toBe(true)
    expect(buyersTable.rows().map((b) => b.member_id)).toContain(DEMO_PEOPLE.alex)
    expect(await addBuyer(DEMO_PEOPLE.jordan)).toEqual({ ok: false, error: "They're already a purchaser." })
    const jordan = buyersTable.rows().find((b) => b.member_id === DEMO_PEOPLE.jordan)!
    expect((await removeBuyer(jordan)).ok).toBe(true)
    expect(buyersTable.rows().map((b) => b.member_id)).toEqual([DEMO_PEOPLE.alex])
  })

  it('are chosen by mentors and admins, from people whose access is on and who are not mentors or admins', () => {
    expect((['student', 'leader', 'mentor', 'admin'] as const).map(canChooseBuyers)).toEqual([false, false, true, true])
    const cases: [Pick<Member, 'active' | 'role'>, boolean][] = [
      [{ active: true, role: 'student' }, true],
      [{ active: true, role: 'leader' }, true],
      [{ active: true, role: 'mentor' }, false], // already places orders
      [{ active: true, role: 'admin' }, false],
      [{ active: false, role: 'student' }, false], // access switched off
    ]
    for (const [member, expected] of cases) expect(canBeBuyer(member), JSON.stringify(member)).toBe(expected)
  })

  it('are ticked on and off from the Members page, where ticking twice changes nothing', async () => {
    setDemoRole('admin')
    const ids = () => buyersTable.rows().map((b) => b.member_id)
    expect((await setBuyer(DEMO_PEOPLE.alex, true)).ok).toBe(true)
    expect((await setBuyer(DEMO_PEOPLE.alex, true)).ok).toBe(true)
    expect(ids().filter((id) => id === DEMO_PEOPLE.alex)).toHaveLength(1)
    expect((await setBuyer(DEMO_PEOPLE.jordan, false)).ok).toBe(true)
    expect((await setBuyer(DEMO_PEOPLE.jordan, false)).ok).toBe(true)
    expect(ids()).toEqual([DEMO_PEOPLE.alex])
  })
})

describe('marking an order as received', () => {
  it('is for student leaders, mentors, admins and purchasers', () => {
    const buyers = buyersTable.rows()
    const people: [string, Parameters<typeof canReceive>[0], boolean][] = [
      ['a student', { id: DEMO_PEOPLE.alex, role: 'student' }, false],
      ['a purchaser', { id: buyers[0].member_id, role: 'student' }, true],
      ['a student leader', { id: DEMO_PEOPLE.casey, role: 'leader' }, true],
      ['a mentor', { id: DEMO_PEOPLE.pat, role: 'mentor' }, true],
      ['nobody signed in', null, false],
    ]
    for (const [who, user, expected] of people) expect(canReceive(user, buyers), who).toBe(expected)
  })

  it('lets a student leader move an order that is on its way to Received, changing nothing else', async () => {
    setDemoRole('leader')
    const ordered = find('Timing belt, 60T')
    const result = await receiveItem(ordered)
    expect(result).toMatchObject({ ok: true })
    expect(find('Timing belt, 60T')).toEqual({ ...ordered, status: 'received' })
  })

  it('refuses anything that is not on its way, and says why', async () => {
    setDemoRole('leader')
    const cases: [string, RegExp][] = [
      ['Zip ties, 8 in (pack of 100)', /can't be marked as received/],
      ['Motor controller', /already marked as received/],
      ['Polycarbonate sheet, 1/8 in', /can't be marked as received/],
    ]
    const before = itemsTable.rows()
    for (const [name, error] of cases) {
      expect(await receiveItem(find(name)), name).toMatchObject({ ok: false, error: expect.stringMatching(error) })
    }
    expect(itemsTable.rows()).toEqual(before)
  })

  it('tells a student who can, and still stops a student leader changing an order', async () => {
    const ordered = find('Timing belt, 60T')
    const before = itemsTable.rows()
    expect(await receiveItem(ordered)).toMatchObject({ ok: false, error: expect.stringMatching(/student leaders, mentors and purchasers/) })
    setDemoRole('leader')
    expect(await changeItem(ordered, { ...itemToForm(ordered), status: 'cancelled' })).toMatchObject({ ok: false, error: expect.stringMatching(/^Only mentors and purchasers/) })
    expect(itemsTable.rows()).toEqual(before)
  })
})

// The database refuses all of these too (supabase/tests/purchasing-orders.test.ts
// and purchase-receipts.test.ts). Here, a student gets told who can.
describe('only mentors and purchasers', () => {
  it('place and change orders, delete them, handle receipts and choose purchasers: a student is told who can, and nothing changes', async () => {
    const asked = find('Zip ties, 8 in (pack of 100)')
    const ordered = find('Timing belt, 60T')
    const [receipt] = receiptsTable.rows()
    const [buyer] = buyersTable.rows()
    const receiptFile = new File(['receipt'], 'order.pdf', { type: 'application/pdf' })
    const actions: [string, () => Promise<unknown>][] = [
      ['place an order', () => changeItem(asked, { ...itemToForm(asked), status: 'placed' })],
      ["mark a vendor's items as ordered", () => markOrdered([asked.id], { ordered_by: '', ordered_on: '', shipped_to: '', estimated_arrival: '', tracking: '' })],
      ['add an item that is already ordered', () => addItem({ ...valid, status: 'placed' })],
      ['change the price of an order', () => changeItem(ordered, { ...itemToForm(ordered), price: '1.00' })],
      ['empty the price of an order', () => changeItem(ordered, { ...itemToForm(ordered), price: '' })],
      ['change the number needed, and so the total', () => changeItem(ordered, { ...itemToForm(ordered), quantity: 5 })],
      ['change anything else about an order', () => changeItem(ordered, { ...itemToForm(ordered), notes: 'Two boxes' })],
      ['delete an order', () => removeItem(ordered)],
      ['add a receipt', () => addReceipt(ordered, receiptFile)],
      ['open a receipt', () => receiptLink(receipt)],
      ['delete a receipt', () => removeReceipt(receipt)],
      ['choose a purchaser', () => addBuyer(DEMO_PEOPLE.alex)],
      ['remove a purchaser', () => removeBuyer(buyer)],
      ['tick a purchaser on the Members page', () => setBuyer(DEMO_PEOPLE.alex, true)],
      ['untick a purchaser on the Members page', () => setBuyer(buyer.member_id, false)],
    ]
    const everything = () => [itemsTable.rows(), buyersTable.rows(), receiptsTable.rows()]
    const before = everything()
    for (const [action, run] of actions) {
      expect(await run(), action).toMatchObject({ ok: false, error: expect.stringMatching(/^Only mentors and (purchasers|admins)/) })
    }
    expect(everything()).toEqual(before)
  })
})

describe("ordering a vendor's items together", () => {
  const details = { ordered_by: '', ordered_on: '2026-11-16', shipped_to: DEMO_PEOPLE.jordan, estimated_arrival: '2026-11-20', tracking: ' EXAMPLE-TRACK-0003 ' }
  const names = (items: PurchaseItem[] | undefined) => items?.map((i) => i.name)

  it('groups what is waiting to be ordered by vendor, highest priority first, leaving out Wait to Order and what is already ordered', async () => {
    await addItem({ ...valid, name: 'Tape', vendor: 'Amazon', status: 'order_high' })
    await addItem({ ...valid, name: 'Glue', vendor: 'Amazon', status: 'order' })
    const waiting = waitingByVendor(itemsTable.rows())
    expect([...waiting.keys()].sort()).toEqual(['Amazon', 'Andy Mark', 'REV Robotics'])
    // Amazon's Ethernet cables are Wait to Order; Andy Mark's Hex bearing is backordered.
    expect(names(waiting.get('Amazon'))).toEqual(['Tape', 'Glue', 'Zip ties, 8 in (pack of 100)'])
    expect(names(waiting.get('Andy Mark'))).toEqual(['Compliant wheel, 2 in'])
  })

  it('adds up the ticked items, and says how many have no price', () => {
    const totals: [string, { price: number | null; quantity: number }[], string][] = [
      ['nothing ticked', [], 'Nothing ticked.'],
      ['one item', [{ price: 6.5, quantity: 8 }], 'Total $52.00 for 1 item'],
      ['cents that add up exactly', [{ price: 0.1, quantity: 1 }, { price: 0.2, quantity: 1 }], 'Total $0.30 for 2 items'],
      ['one without a price', [{ price: 7.25, quantity: 2 }, { price: null, quantity: 1 }], 'Total $14.50 for 2 items · 1 has no price yet'],
    ]
    for (const [label, items, text] of totals) expect(orderTotalText(items), label).toBe(text)
  })

  it("copies part numbers and quantities for the vendor's cart, leaving out items with no part number, and everything for records", () => {
    const items = [find('Compliant wheel, 2 in'), find('Zip ties, 8 in (pack of 100)')]
    expect(cartCsv(items)).toBe('EXAMPLE-CW-2,8\r\n')
    expect(orderCsv(items, () => 'Alex').split('\r\n').slice(0, 3)).toEqual([
      'Name,Part number,Quantity,Price each,Link,Requested by',
      '"Compliant wheel, 2 in",EXAMPLE-CW-2,8,6.50,https://example.com/parts/EXAMPLE-CW-2,Alex',
      '"Zip ties, 8 in (pack of 100)",,2,7.25,,Alex',
    ])
  })

  it('marks several as ordered at once, with the same order details, ordered by you unless you pick someone', async () => {
    setDemoRole('mentor')
    const ids = [find('Compliant wheel, 2 in').id, find('Brushless motor').id]
    const result = await markOrdered(ids, details)
    expect(result.ok && result.value).toHaveLength(2)
    for (const name of ['Compliant wheel, 2 in', 'Brushless motor']) {
      expect(find(name), name).toMatchObject({
        status: 'placed', ordered_by: DEMO_PEOPLE.pat, ordered_on: '2026-11-16', shipped_to: DEMO_PEOPLE.jordan, estimated_arrival: '2026-11-20', tracking: 'EXAMPLE-TRACK-0003',
      })
    }
    expect(find('Zip ties, 8 in (pack of 100)').status).toBe('order_low')
  })

  it('saves nothing when nothing is ticked, the details are wrong, or an item is no longer waiting', async () => {
    setDemoRole('mentor')
    const wheel = find('Compliant wheel, 2 in').id
    const refused: [string, string[], Partial<typeof details>, RegExp][] = [
      ['nothing ticked', [], {}, /Tick at least one/],
      ['a date that does not exist', [wheel], { ordered_on: '2026-02-30' }, /date ordered/],
      ['one already ordered', [wheel, find('Timing belt, 60T').id], {}, /Timing belt, 60T.*Nothing was saved/],
      ['one that was deleted', [wheel, 'gone'], {}, /deleted.*nothing was saved/],
    ]
    const before = itemsTable.rows()
    for (const [label, ids, change, problem] of refused) {
      expect(await markOrdered(ids, { ...details, ...change }), label).toMatchObject({ ok: false, error: expect.stringMatching(problem) })
    }
    expect(itemsTable.rows()).toEqual(before)
  })

  it('says which item failed and which were already saved, and carries on with the rest', async () => {
    setDemoRole('mentor')
    // An item that can't be saved: its link was never a real one.
    const { id: _id, created_at: _at, ...motor } = find('Brushless motor')
    const broken = await itemsTable.insert({ ...motor, name: 'Broken link', link: 'not a link' })
    if (!broken.ok) throw new Error(broken.error)
    const result = await markOrdered([find('Compliant wheel, 2 in').id, broken.value.id, find('Brushless motor').id], details)
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't mark these as ordered: Broken link \(.*https.*\)\. Already saved as ordered: Compliant wheel, 2 in, Brushless motor\./) })
    expect(find('Broken link').status).toBe('order_high')
    expect(find('Compliant wheel, 2 in').status).toBe('placed')
    expect(find('Brushless motor').status).toBe('placed')
  })
})

describe('ordering more of an Inventory part', () => {
  const part = (more: Partial<InventoryItem>): InventoryItem => ({
    id: 'inv', name: 'Power Distribution Hub (PDH)', vendor: 'REV', vendor_part_number: 'REV-11-1850', location: 'Shelf E1',
    link: 'https://example.com/parts/REV-11-1850', quantity: 1, low_stock_level: 1, created_at: '2026-10-20T18:00:00Z', created_by: null, ...more,
  })

  it("fills in the part's name, vendor from the list, part number and link, with 1 needed", () => {
    const cases: [string, InventoryItem, Partial<NewItem>][] = [
      ['a vendor on the list, by another name', part({}), {
        name: 'Power Distribution Hub (PDH)', vendor: 'REV Robotics', part_number: 'REV-11-1850', link: 'https://example.com/parts/REV-11-1850', notes: '',
      }],
      ['written differently', part({ name: 'roboRIO 2.0', vendor: 'AndyMark', vendor_part_number: 'am-3000a' }), { vendor: 'Andy Mark', part_number: 'am-3000a' }],
      ['no product link', part({ link: null }), { vendor: 'REV Robotics', part_number: 'REV-11-1850', link: '' }],
      // Left to pick, not filled in wrong.
      ['a vendor not on the list', part({ name: 'Battery, 12V 18Ah', vendor: 'MK Battery', vendor_part_number: 'ES17-12' }), {
        vendor: '', part_number: 'ES17-12', notes: 'Vendor in Inventory: MK Battery',
      }],
    ]
    for (const [label, item, expected] of cases) {
      expect(requestFromInventoryItem(item), label).toEqual({ ...EMPTY_ITEM, name: item.name, link: item.link ?? '', notes: '', quantity: 1, ...expected })
    }
  })
})

describe('asking for a BOM part', () => {
  const bomPart = {
    id: 'part', system_id: 'system', part_number: '4096-26-INT-006', name: 'Flanged bearing, 1/2 in hex', revision: null, kind: 'cots' as const,
    material: null, quantity: 6, vendor: 'WCP', vendor_part_number: 'EXAMPLE-BRG-12', product_url: null, onshape_url: null, onshape_id: null,
    removed_in_onshape: false, created_at: '2026-10-20T18:00:00Z', created_by: null,
  }
  const intake = { id: 'system', robot_id: 'robot', name: 'Intake', code: 'INT', onshape_url: null, onshape_imported_at: null, created_at: '2026-10-20T18:00:00Z', created_by: null }

  it("matches the BOM's vendor names to the list", () => {
    expect(vendorFor('WCP')).toBe('West Coast Products')
    expect(vendorFor('AndyMark')).toBe('Andy Mark')
    expect(vendorFor('CTR Electronics')).toBe('CTRE')
    expect(vendorFor('McMaster-Carr')).toBe('McMaster')
    expect(vendorFor('REV Robotics')).toBe('REV Robotics')
    expect(vendorFor('Swerve Drive Specialties')).toBeNull()
    expect(vendorFor(null)).toBeNull()
  })

  it('fills in a request from the part, with its system as the type, or the type left to pick when the system is not one', () => {
    expect(requestFromBomPart(bomPart, intake)).toEqual({
      ...EMPTY_ITEM,
      name: 'Flanged bearing, 1/2 in hex',
      vendor: 'West Coast Products',
      type: 'Intake',
      part_number: 'EXAMPLE-BRG-12',
      quantity: 6,
      notes: '',
    })
    expect(requestFromBomPart(bomPart, { ...intake, name: 'Superstructure' }).type).toBe('')
    expect(requestFromBomPart(bomPart, undefined).type).toBe('')
  })

  it("fills in the link from the part's product page, if it has one", () => {
    expect(requestFromBomPart({ ...bomPart, product_url: 'https://example.com/bearing' }, intake).link).toBe('https://example.com/bearing')
    expect(requestFromBomPart(bomPart, intake).link).toBe('')
  })

  it('uses Other for a vendor not in the list, with the BOM vendor in the notes, and Drive Base for the Drivetrain', () => {
    const request = requestFromBomPart({ ...bomPart, vendor: 'Swerve Drive Specialties' }, { ...intake, name: 'Drivetrain' })
    expect(request).toMatchObject({ vendor: 'Other', type: 'Drive Base', notes: 'Vendor in the BOM: Swerve Drive Specialties' })
  })

  it('links the request to the BOM part when sent', async () => {
    expect((await addItem({ ...requestFromBomPart(bomPart, intake), link: 'https://example.com/bearing' }, 'part')).ok).toBe(true)
    expect(itemsTable.rows()[0]).toMatchObject({ bom_part_id: 'part', name: 'Flanged bearing, 1/2 in hex' })
  })

  it("gives each BOM part its newest request that isn't cancelled", () => {
    const motor = find('Brushless motor')
    const items = [
      { ...motor, id: 'old', created_at: '2026-10-01T00:00:00Z', status: 'in_shop' as const },
      { ...motor, id: 'cancelled', created_at: '2026-11-02T00:00:00Z', status: 'cancelled' as const },
      motor,
    ]
    expect(requestsByBomPart(items).get(motor.bom_part_id!)?.id).toBe(motor.id)
    expect(requestsByBomPart([{ ...motor, status: 'cancelled' }]).size).toBe(0)
  })
})

describe('estimated arrival', () => {
  const placed = () => find('Timing belt, 60T')

  it('writes dates as the team reads them, without a time zone moving them a day', () => {
    expect(dayText('2026-11-12')).toBe('Nov 12')
    expect(dayText('2027-01-01')).toBe('Jan 1')
    expect(today(new Date(2026, 10, 5, 23, 30))).toBe('2026-11-05')
  })

  it('says when an order on its way arrives, and nothing once it has', () => {
    expect(arrivalText({ ...placed(), estimated_arrival: '2026-11-12' })).toBe('Arrives Nov 12')
    expect(arrivalText({ ...placed(), estimated_arrival: null })).toBeNull()
    expect(arrivalText({ ...placed(), status: 'received', estimated_arrival: '2026-11-12' })).toBeNull()
  })

  it('is late once the date has passed and it still is not received', () => {
    const order = { ...placed(), estimated_arrival: '2026-11-12' }
    expect(isLate(order, '2026-11-12')).toBe(false)
    expect(isLate(order, '2026-11-13')).toBe(true)
    expect(isLate({ ...order, status: 'backordered' }, '2026-11-13')).toBe(true)
    expect(isLate({ ...order, status: 'received' }, '2026-11-13')).toBe(false)
    expect(isLate({ ...order, estimated_arrival: null }, '2026-11-13')).toBe(false)
  })

  // checkItem's tests check that it only takes a real date.
  it('is set by mentors and purchasers, not students', async () => {
    const changed = { ...itemToForm(placed()), estimated_arrival: '2026-12-20' }
    expect(isOrderChange(placed(), changed)).toBe(true)
    expect((await changeItem(placed(), changed)).ok).toBe(false)
    setDemoRole('mentor')
    expect((await changeItem(placed(), changed)).ok).toBe(true)
    expect(placed().estimated_arrival).toBe('2026-12-20')
  })
})

describe('date ordered and tracking number', () => {
  it("works out the carrier from a tracking number's shape", () => {
    const cases: [string, string, ReturnType<typeof carrierFor>][] = [
      ['UPS: 1Z and 16 more', '1ZEXAMPLE000000002', 'UPS'],
      ['UPS with spaces and small letters', ' 1z exa mple 0000 0000 2 ', 'UPS'],
      ['UPS one character short', '1ZEXAMPLE00000002', null],
      ['USPS: 22 digits starting with 9', '9400100000000000000000', 'USPS'],
      ['USPS with spaces, as the label prints it', '9400 1000 0000 0000 0000 00', 'USPS'],
      ['USPS: 20 digits starting with 9, not FedEx', '94001000000000000000', 'USPS'],
      ['USPS: 2 letters, 9 digits and US', 'EX000000000US', 'USPS'],
      ['FedEx: 12 digits', '000000000012', 'FedEx'],
      ['FedEx: 12 digits starting with 9', '900000000012', 'FedEx'],
      ['FedEx: 15 digits', '000000000000015', 'FedEx'],
      ['FedEx: 20 digits not starting with 9', '10000000000000000020', 'FedEx'],
      ['13 digits', '0000000000013', null],
      ['a made-up number', 'EXAMPLE-TRACK-0001', null],
      ['nothing', '', null],
    ]
    for (const [what, number, carrier] of cases) expect(carrierFor(number), what).toBe(carrier)
  })

  it("links to the carrier's tracking page, or nothing when it can't tell the carrier", () => {
    expect(trackingLink('1z exa-mple 0000 0000 2')).toEqual({ label: 'Track on UPS', url: 'https://www.ups.com/track?tracknum=1ZEXAMPLE000000002' })
    expect(trackingLink('9400100000000000000000')).toMatchObject({ label: 'Track on USPS', url: expect.stringMatching(/^https:\/\/tools\.usps\.com\/.*9400100000000000000000$/) })
    expect(trackingLink('000000000012')).toMatchObject({ label: 'Track on FedEx', url: expect.stringMatching(/^https:\/\/www\.fedex\.com\/.*000000000012$/) })
    expect(trackingLink('EXAMPLE-TRACK-0001')).toBeNull()
    expect(trackingLink(null)).toBeNull()
  })

  it('says when it was ordered, or nothing without a date', () => {
    expect(orderedText({ ordered_on: '2026-11-10' })).toBe('Ordered Nov 10')
    expect(orderedText({ ordered_on: null })).toBeNull()
  })

  it('are saved by a mentor, with the tracking number trimmed and an empty one saved as nothing', async () => {
    setDemoRole('mentor')
    const item = () => find('Timing belt, 60T')
    expect((await changeItem(item(), { ...itemToForm(item()), ordered_on: '2026-11-11', tracking: '  EXAMPLE-TRACK-9999 ' })).ok).toBe(true)
    expect(item()).toMatchObject({ ordered_on: '2026-11-11', tracking: 'EXAMPLE-TRACK-9999' })
    expect((await changeItem(item(), { ...itemToForm(item()), ordered_on: '', tracking: ' ' })).ok).toBe(true)
    expect(item()).toMatchObject({ ordered_on: null, tracking: null })
  })
})

describe('receiptAddingShown', () => {
  it('allows new receipts for every ordered status, but none of the asking statuses', () => {
    for (const status of STATUSES.filter((s) => s.ask)) expect(receiptAddingShown(status.key), status.label).toBe(false)
    for (const status of STATUSES.filter((s) => !s.ask)) expect(receiptAddingShown(status.key), status.label).toBe(true)
  })
})

describe('receiptsSectionShown', () => {
  it('shows the Receipts section only when it has receipts to list or Add receipt to offer', () => {
    const cases = [
      { canManage: true, count: 0, showAdd: true, shown: true }, // ordered: Add receipt
      { canManage: true, count: 0, showAdd: false, shown: false }, // not ordered yet: no empty heading (#230)
      { canManage: true, count: 2, showAdd: true, shown: true },
      { canManage: true, count: 2, showAdd: false, shown: true }, // back to asking: receipts stay visible
      { canManage: false, count: 0, showAdd: true, shown: false }, // students never add
      { canManage: false, count: 0, showAdd: false, shown: false },
      { canManage: false, count: 1, showAdd: true, shown: true }, // "1 receipt added."
      { canManage: false, count: 1, showAdd: false, shown: true },
    ]
    for (const { shown, ...input } of cases) expect(receiptsSectionShown(input), JSON.stringify(input)).toBe(shown)
  })
})

describe('orderFieldsShown', () => {
  const empty = { ordered_by: '', ordered_on: '', shipped_to: '', estimated_arrival: '', tracking: '' }

  it('hides the order details while asking, shows them once the order is placed, and always shows one that is filled in', () => {
    const all = (shown: boolean) => ({ ordered_by: shown, ordered_on: shown, shipped_to: shown, estimated_arrival: shown, tracking: shown })
    for (const status of ['wait', 'order_low', 'order', 'order_high'] as const) expect(orderFieldsShown({ ...empty, status }), status).toEqual(all(false))
    for (const status of ['placed', 'backordered', 'received'] as const) expect(orderFieldsShown({ ...empty, status }), status).toEqual(all(true))
    // So nothing saved is hidden.
    expect(orderFieldsShown({ ...empty, status: 'order', shipped_to: DEMO_PEOPLE.pat, tracking: 'EXAMPLE-TRACK-0001' })).toEqual({ ...all(false), shipped_to: true, tracking: true })
  })
})

describe('pickStatus', () => {
  const asked = () => find('Compliant wheel, 2 in')
  const me = DEMO_PEOPLE.morgan
  const on = '2026-11-16'

  it("fills in Ordered by with you and Date ordered with today's date when you pick Order Placed", () => {
    expect(pickStatus(itemToForm(asked()), 'placed', asked(), me, on)).toEqual({ status: 'placed', ordered_by: me, ordered_on: on })
  })

  it('keeps someone else, or another date, already picked in the form', () => {
    const form = { ...itemToForm(asked()), ordered_by: DEMO_PEOPLE.pat, ordered_on: '2026-11-10' }
    expect(pickStatus(form, 'placed', asked(), me, on)).toEqual({ status: 'placed' })
  })

  it('puts back what was saved when you move it away from Order Placed again', () => {
    const form = { ...itemToForm(asked()), status: 'placed' as const, ordered_by: me, ordered_on: on }
    expect(pickStatus(form, 'order_high', asked(), me, on)).toEqual({ status: 'order_high', ordered_by: '', ordered_on: '' })
  })

  it('only changes the status otherwise', () => {
    expect(pickStatus(itemToForm(asked()), 'order_high', asked(), me, on)).toEqual({ status: 'order_high' })
    const placed = find('Timing belt, 60T')
    expect(pickStatus(itemToForm(placed), 'received', placed, me, on)).toEqual({ status: 'received' })
  })
})

describe('receipts', () => {
  const pdf = { name: 'order.pdf', type: 'application/pdf', size: 1000 }
  const receiptFile = () => new File(['receipt'], 'my card order.pdf', { type: 'application/pdf' })
  const receiptsOf = (item: PurchaseItem) => receiptsTable.rows().filter((r) => r.item_id === item.id)

  describe('checkReceipt', () => {
    it('takes PDFs and photos, up to 10 MB', () => {
      expect(checkReceipt(pdf)).toBeNull()
      expect(checkReceipt({ ...pdf, name: 'photo.jpg', type: 'image/jpeg' })).toBeNull()
      expect(checkReceipt({ ...pdf, name: 'photo.heic', type: 'image/heic' })).toBeNull()
      expect(checkReceipt({ ...pdf, size: MAX_RECEIPT_BYTES })).toBeNull()
    })

    it('refuses other kinds of file, and empty or too-big ones, and says why', () => {
      const refused: [string, typeof pdf, RegExp][] = [
        ['a Word file', { ...pdf, name: 'list.docx', type: 'application/msword' }, /PDF or a photo/],
        ['no type or ending', { ...pdf, name: 'no-idea', type: '' }, /PDF or a photo/],
        ['an SVG image, which can run code when opened', { ...pdf, name: 'photo.svg', type: 'image/svg+xml' }, /PDF or a photo/],
        ['an SVG with a general type', { ...pdf, name: 'photo.svg', type: 'application/octet-stream' }, /PDF or a photo/],
        ['an empty file', { ...pdf, size: 0 }, /empty/],
        ['a file too big, saying how big', { ...pdf, size: 12_300_000 }, /12\.3 MB.*up to 10 MB/],
      ]
      for (const [label, file, problem] of refused) expect(checkReceipt(file), label).toMatch(problem)
    })
  })

  it('offers the camera on phones: PDFs and images, with no capture', () => {
    expect(RECEIPT_ACCEPT).toBe('application/pdf,image/*')
  })

  it('goes by the ending when the browser leaves the type empty, or gives a general one or another spelling', () => {
    const types: [string, string, string][] = [
      ['IMG_0001.HEIC', '', 'image/heic'], // an iPhone photo
      ['scan.jpeg', '', 'image/jpeg'],
      ['order.pdf', 'application/octet-stream', 'application/pdf'],
      ['IMG_0001.HEIC', 'application/octet-stream', 'image/heic'],
      ['order.pdf', 'application/x-pdf', 'application/pdf'],
      ['photo.jpg', 'image/jpg', 'image/jpeg'],
    ]
    for (const [name, type, expected] of types) expect(receiptType({ ...pdf, name, type }), `${name} ${type}`).toBe(expected)
  })

  it('labels the file to upload with its type, keeping what is in it', async () => {
    const file = new File(['receipt'], 'IMG_0001.HEIC', { type: '' })
    const body = receiptBody(file, 'image/heic')
    expect(body.type).toBe('image/heic')
    expect(body.size).toBe(file.size)
    expect(await body.text()).toBe('receipt')
  })

  it('describes a receipt without its file name, and counts them for the list', () => {
    expect(sizeText(240_000)).toBe('240 KB')
    expect(sizeText(2_400_000)).toBe('2.4 MB')
    expect(sizeText(10)).toBe('1 KB')
    expect(receiptText(receiptsOf(find('Motor controller'))[0])).toBe('PDF, 96 KB')
    expect(receiptText(receiptsOf(find('Motor controller'))[1])).toBe('Photo, 2.4 MB')
    expect(receiptCountText(0)).toBe('')
    expect(receiptCountText(1)).toBe('1 receipt')
    expect(receiptCountText(2)).toBe('2 receipts')
  })

  describe('prepareReceipt', () => {
    it('uses a PDF unchanged, without decoding or compressing it', async () => {
      const original = new File(['PDF bytes'], 'order.pdf', { type: 'application/pdf' })
      let called = false
      const result = await prepareReceipt(original, async () => {
        called = true
        throw new Error('A PDF must not go through the raster decoder')
      })
      expect(called).toBe(false)
      expect(result).toEqual({ ok: true, value: { original, compressed: null, previewable: false } })
    })

    it('refuses active image content before trying to decode it', async () => {
      let called = false
      const result = await prepareReceipt(new File(['<svg/>'], 'photo.svg', { type: 'image/svg+xml' }), async () => {
        called = true
        return new Blob(['compressed'], { type: 'image/webp' })
      })
      expect(called).toBe(false)
      expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/PDF or a photo/) })
    })

    it('offers a smaller image with its actual type, and uploads that size and type to the existing path', async () => {
      const original = new File([new Uint8Array(4000)], 'someone’s card photo.png', { type: 'image/png' })
      const prepared = await prepareReceipt(original, async () => new Blob([new Uint8Array(400)], { type: 'image/webp' }))
      if (!prepared.ok || !prepared.value.compressed) throw new Error('Expected a compressed image')
      expect(prepared.value.original).toBe(original)
      expect(prepared.value.previewable).toBe(true)
      expect(prepared.value.compressed).toMatchObject({ type: 'image/webp', size: 400 })

      setDemoRole('mentor')
      const item = find('Timing belt, 60T')
      const added = await addReceipt(item, prepared.value.compressed)
      expect(added.ok && added.value.content_type).toBe('image/webp')
      expect(added.ok && added.value.size_bytes).toBe(400)
      expect(added.ok && added.value.path).toMatch(new RegExp(`^${item.id}/[0-9a-f-]{36}\\.webp$`))
      expect(added.ok && added.value.path).not.toContain('someone')
    })

    it('keeps the original when compression is larger, fails, produces an invalid type, or is not supported', async () => {
      const original = new File([new Uint8Array(1000)], 'photo.heic', { type: 'image/heic' })
      const larger = await prepareReceipt(original, async () => new Blob([new Uint8Array(2000)], { type: 'image/webp' }))
      expect(larger).toEqual({ ok: true, value: { original, compressed: null, previewable: true } })
      const invalid = await prepareReceipt(original, async () => new Blob(['wrong type'], { type: 'text/html' }))
      expect(invalid).toEqual({ ok: true, value: { original, compressed: null, previewable: true } })
      const failed = await prepareReceipt(original, async () => { throw new Error('HEIC decoding is unavailable') })
      expect(failed).toEqual({ ok: true, value: { original, compressed: null, previewable: false } })
    })
  })

  describe('addReceipt', () => {
    it('adds receipts for a mentor, more than one per item', async () => {
      setDemoRole('mentor')
      const item = find('Timing belt, 60T')
      expect((await addReceipt(item, receiptFile())).ok).toBe(true)
      expect((await addReceipt(item, receiptFile())).ok).toBe(true)
      expect(receiptsOf(item)).toHaveLength(2)
    })

    it('adds a receipt for a purchaser, in the item\'s folder, without the file\'s own name', async () => {
      await buyersTable.insert({ member_id: DEMO_PEOPLE.alex })
      const item = find('Timing belt, 60T')
      const result = await addReceipt(item, receiptFile())
      expect(result.ok && result.value.path).toMatch(new RegExp(`^${item.id}/[0-9a-f-]{36}\\.pdf$`))
      expect(result.ok && result.value.created_by).toBe(DEMO_PEOPLE.alex)
    })

    it('refuses a new receipt while an item is still being asked for', async () => {
      setDemoRole('mentor')
      const item = find('Zip ties, 8 in (pack of 100)')
      expect(await addReceipt(item, receiptFile())).toMatchObject({ ok: false, error: expect.stringMatching(/Order Placed/) })
      expect(receiptsOf(item)).toHaveLength(0)
    })

    it('keeps an existing receipt removable when an ordered item goes back to asking', async () => {
      setDemoRole('mentor')
      const item = find('Motor controller')
      const moved = { ...item, status: 'order' as const }
      expect(receiptAddingShown(moved.status)).toBe(false)
      expect(receiptsOf(moved)).toHaveLength(2)
      expect((await removeReceipt(receiptsOf(moved)[0])).ok).toBe(true)
      expect(receiptsOf(moved)).toHaveLength(1)
    })

    it('refuses a file that is not a receipt', async () => {
      setDemoRole('mentor')
      const item = find('Timing belt, 60T')
      const result = await addReceipt(item, new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }))
      expect(result.ok).toBe(false)
      expect(receiptsOf(item)).toHaveLength(0)
    })
  })

  // A student can't open, add or delete them: see "only mentors and purchasers" above.
  it('open for mentors and purchasers, though demo mode says it has no files', async () => {
    const [receipt] = receiptsTable.rows()
    await buyersTable.insert({ member_id: DEMO_PEOPLE.alex })
    expect(await receiptLink(receipt)).toMatchObject({ ok: false, error: expect.stringMatching(/^Demo mode/) })
    await buyersTable.reset()
    setDemoRole('mentor')
    expect(await receiptLink(receipt)).toMatchObject({ ok: false, error: expect.stringMatching(/^Demo mode/) })
  })

  it('can be deleted by mentors and purchasers', async () => {
    const [first, second] = receiptsTable.rows()
    expect(receiptsTable.rows()).toHaveLength(3)
    await buyersTable.insert({ member_id: DEMO_PEOPLE.alex })
    expect((await removeReceipt(first)).ok).toBe(true)
    expect(receiptsTable.rows()).toHaveLength(2)
    setDemoRole('mentor')
    expect((await removeReceipt(second)).ok).toBe(true)
    expect(receiptsTable.rows()).toHaveLength(1)
  })

  it('stop an item being deleted until a mentor or purchaser deletes them', async () => {
    setDemoRole('mentor')
    const item = find('Polycarbonate sheet, 1/8 in')
    expect(await removeItem(item)).toMatchObject({ ok: false, error: expect.stringMatching(/mentor or purchaser needs to delete the receipt/) })
    const [receipt] = receiptsOf(item)
    await removeReceipt(receipt)
    expect((await removeItem(item)).ok).toBe(true)
  })
})

describe('adding what arrived to Inventory', () => {
  const part = (name: string) => inventoryTable.rows().find((p) => p.name === name)!
  const roborio = () => part('roboRIO 2.0')
  const blank: { name: string; vendor: string; part_number: string | null; link: string | null } = { name: 'Something else', vendor: 'Amazon', part_number: null, link: null }

  it('matches Inventory parts by vendor and part number, part number, link or name, strongest first', () => {
    const cases: [string, Partial<typeof blank>, string | null][] = [
      ['vendor and part number, ignoring capitals', { vendor: 'Andy Mark', part_number: 'AM-3000A' }, 'Same vendor and part number'],
      ['part number from another vendor, ignoring spaces and dashes', { part_number: 'am 3000a' }, 'Same part number'],
      ['link, ignoring www and a trailing slash', { link: 'https://www.example.com/parts/am-3000a/' }, 'Same product link'],
      ['name, ignoring capitals and spaces', { name: '  ROBORIO  2.0 ' }, 'Same name'],
      ['nothing in common', {}, null],
    ]
    for (const [what, item, reason] of cases) {
      const [best] = matchParts({ ...blank, ...item }, inventoryTable.rows())
      expect(best ? [best.part.id, best.reason] : null, what).toEqual(reason ? [roborio().id, reason] : null)
    }
    // A part that matches more than one way is listed once, with its strongest reason.
    expect(matchParts({ ...blank, name: 'roboRIO 2.0', part_number: 'am-3000a', vendor: 'Andy Mark' }, inventoryTable.rows()))
      .toEqual([{ part: roborio(), reason: 'Same vendor and part number' }])
  })

  it('starts ticked on the best match with the number needed, or unticked as a new part when nothing matches', () => {
    const received = find('Motor controller')
    expect(planFor({ ...received, name: 'roboRIO 2.0' }, inventoryTable.rows())).toMatchObject({ add: true, partId: roborio().id, quantity: received.quantity })
    expect(planFor(received, inventoryTable.rows())).toMatchObject({
      add: false, partId: '', quantity: received.quantity, name: received.name, vendor: received.vendor, vendor_part_number: received.part_number, location: '',
    })
  })

  it('checks how many, that the part is still there, and a new part like Inventory does', () => {
    const plan: InventoryPlan = { add: true, partId: roborio().id, quantity: 2, name: 'Gear', vendor: 'WCP', vendor_part_number: 'EXAMPLE-G-1', location: 'Bin M2' }
    const cases: [string, Partial<InventoryPlan>, RegExp | null][] = [
      ['an existing part', {}, null],
      ['unticked, even if empty', { add: false, quantity: 0, partId: '', location: '' }, null],
      ['no parts', { quantity: 0 }, /1 or more/],
      ['a deleted part', { partId: 'gone' }, /deleted/],
      ['a new part', { partId: '' }, null],
      ['a new part with nowhere to live', { partId: '', location: ' ' }, /where it lives/],
      ['a new part already listed', { partId: '', vendor: 'AndyMark', vendor_part_number: 'am-3000a' }, /already listed/],
    ]
    for (const [what, changes, error] of cases) {
      const problem = checkPlan({ ...plan, ...changes }, inventoryTable.rows())
      if (error) expect(problem, what).toMatch(error)
      else expect(problem, what).toBeNull()
    }
  })

  it('adds the count to the matched part, adds a new part, or adds nothing when unticked, as it moves to In Shop', async () => {
    setDemoRole('mentor')
    const received = find('Motor controller')
    const toShop = { ...itemToForm(received), status: 'in_shop' as const }
    const plan = { ...planFor(received, inventoryTable.rows()), add: true, partId: roborio().id, quantity: 3 }
    const before = roborio().quantity

    expect(await changeItem(received, toShop, plan)).toMatchObject({ ok: true })
    expect(find('Motor controller').status).toBe('in_shop')
    expect(roborio().quantity).toBe(before + 3)
    expect(inventoryChanges.rows()[0]).toMatchObject({ item_id: roborio().id, change: 3, note: FROM_PURCHASING })

    itemsTable.reset()
    const count = inventoryTable.rows().length
    await changeItem(received, toShop, { ...plan, partId: '', location: 'Bin E5' })
    expect(part('Motor controller')).toMatchObject({ vendor: 'CTRE', vendor_part_number: 'EXAMPLE-MC-1', location: 'Bin E5', quantity: 3 })

    itemsTable.reset()
    await changeItem(received, toShop, { ...plan, add: false })
    expect(inventoryTable.rows()).toHaveLength(count + 1)
  })

  it("saves nothing when the plan can't be done", async () => {
    setDemoRole('mentor')
    const received = find('Motor controller')
    const before = [itemsTable.rows(), inventoryTable.rows()]
    const result = await changeItem(received, { ...itemToForm(received), status: 'in_shop' }, { ...planFor(received, inventoryTable.rows()), add: true, location: '' })
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/where it lives/) })
    expect([itemsTable.rows(), inventoryTable.rows()]).toEqual(before)
  })

  it('lets a student leader put a received item in the shop and add it, but only from Received', async () => {
    setDemoRole('leader')
    const plan = (item: PurchaseItem) => ({ ...planFor(item, inventoryTable.rows()), add: true, partId: roborio().id, quantity: 1 })
    const before = roborio().quantity
    const received = find('Motor controller')
    expect(await shelveItem(received, plan(received))).toMatchObject({ ok: true })
    expect(find('Motor controller')).toEqual({ ...received, status: 'in_shop' })
    expect(roborio().quantity).toBe(before + 1)

    const ordered = find('Timing belt, 60T')
    expect(await shelveItem(ordered, plan(ordered))).toMatchObject({ ok: false, error: expect.stringMatching(/Only something marked Received/) })
    setDemoRole('student')
    itemsTable.reset()
    expect(await shelveItem(received, plan(received))).toMatchObject({ ok: false, error: expect.stringMatching(/student leaders, mentors and purchasers/) })
  })
})
