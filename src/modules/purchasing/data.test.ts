// Tests for data.ts. Run them with `npm test`.
// They run in demo mode, starting from the example items, as the made-up
// student Alex. Who is allowed to do what is the database's job: that's
// tested in supabase/tests/purchase-items.test.ts, purchasing-orders.test.ts
// and purchase-receipts.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import type { Member } from '../../core/members'
import type { Item as InventoryItem } from '../inventory/data'
import {
  EMPTY_ITEM,
  MAX_NAME_LENGTH,
  MAX_QUANTITY,
  MAX_RECEIPT_BYTES,
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
  changeItem,
  checkItem,
  orderFieldsShown,
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
    expect(duplicateItem(item)).toEqual({ ...itemToForm(item), status: 'order', ordered_by: '', shipped_to: '', estimated_arrival: '' })
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

describe('receiptAddingShown', () => {
  it('allows new receipts for every ordered status, but none of the asking statuses', () => {
    for (const status of STATUSES.filter((s) => s.ask)) expect(receiptAddingShown(status.key), status.label).toBe(false)
    for (const status of STATUSES.filter((s) => !s.ask)) expect(receiptAddingShown(status.key), status.label).toBe(true)
  })
})

describe('orderFieldsShown', () => {
  const empty = { ordered_by: '', shipped_to: '', estimated_arrival: '' }

  it('hides the order details while asking, shows them once the order is placed, and always shows one that is filled in', () => {
    const all = (shown: boolean) => ({ ordered_by: shown, shipped_to: shown, estimated_arrival: shown })
    for (const status of ['wait', 'order_low', 'order', 'order_high'] as const) expect(orderFieldsShown({ ...empty, status }), status).toEqual(all(false))
    for (const status of ['placed', 'backordered', 'received'] as const) expect(orderFieldsShown({ ...empty, status }), status).toEqual(all(true))
    // So nothing saved is hidden.
    expect(orderFieldsShown({ ...empty, status: 'order', shipped_to: DEMO_PEOPLE.pat })).toEqual({ ordered_by: false, shipped_to: true, estimated_arrival: false })
  })
})

describe('pickStatus', () => {
  const asked = () => find('Compliant wheel, 2 in')
  const me = DEMO_PEOPLE.morgan

  it('fills in Ordered by with you when you pick Order Placed', () => {
    expect(pickStatus(itemToForm(asked()), 'placed', asked(), me)).toEqual({ status: 'placed', ordered_by: me })
  })

  it('keeps someone else picked in the form', () => {
    const form = { ...itemToForm(asked()), ordered_by: DEMO_PEOPLE.pat }
    expect(pickStatus(form, 'placed', asked(), me)).toEqual({ status: 'placed' })
  })

  it('puts back what was saved when you move it away from Order Placed again', () => {
    const form = { ...itemToForm(asked()), status: 'placed' as const, ordered_by: me }
    expect(pickStatus(form, 'order_high', asked(), me)).toEqual({ status: 'order_high', ordered_by: '' })
  })

  it('only changes the status otherwise', () => {
    expect(pickStatus(itemToForm(asked()), 'order_high', asked(), me)).toEqual({ status: 'order_high' })
    const placed = find('Timing belt, 60T')
    expect(pickStatus(itemToForm(placed), 'received', placed, me)).toEqual({ status: 'received' })
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
