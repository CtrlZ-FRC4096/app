// Tests for data.ts. Run them with `npm test`.
// They run in demo mode, starting from the example items, as the made-up
// student Alex. Who is allowed to do what is the database's job: that's
// tested in supabase/tests/purchase-items.test.ts, purchasing-orders.test.ts
// and purchase-receipts.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
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
  requestFromBomPart,
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
  receiptBody,
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
  it('has the Slack list\'s 10 statuses, in order', () => {
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
  })

  it('lets people asking pick only a priority', () => {
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

  it('accepts dollars and cents, or an empty box', () => {
    for (const price of ['', '12', '12.', '12.5', '12.50', '.99', '0', '$1,250.00', '99999.99']) {
      expect(priceProblem(price)).toBeNull()
    }
  })

  it('refuses anything else, and says what to do', () => {
    for (const price of ['abc', '-5', '12.345', '1e3', '.', '12 dollars']) {
      expect(priceProblem(price)).toMatch(/like 12\.50/)
    }
    expect(priceProblem('100000')).toMatch(/up to \$99,999\.99/)
    expect(checkItem({ ...valid, price: 'abc' })).toMatch(/like 12\.50/)
    expect(checkItem({ ...valid, price: '12.50' })).toBeNull()
  })

  it('works out the line from the price of one and the number needed', () => {
    expect(lineTotal({ price: 12.5, quantity: 4 })).toBe(50)
    expect(lineTotal({ price: 0.07, quantity: 3 })).toBe(0.21)
    expect(lineTotal({ price: 19.99, quantity: 100 })).toBe(1999)
    expect(lineTotal({ price: 0, quantity: 4 })).toBe(0)
    expect(lineTotal({ price: null, quantity: 4 })).toBeNull()
  })

  it('shows the price each and the total, or just the price for one', () => {
    expect(priceText({ price: 12.5, quantity: 4 })).toBe('$12.50 each · $50.00 total')
    expect(priceText({ price: 12.5, quantity: 1 })).toBe('$12.50')
    expect(priceText({ price: 0, quantity: 2 })).toBe('$0.00 each · $0.00 total')
    expect(priceText({ price: null, quantity: 4 })).toBeNull()
  })

  it('shows the total in the form only once what is typed is a price', () => {
    expect(formPriceText({ price: '12.5', quantity: 4 })).toBe('$12.50 each · $50.00 total')
    expect(formPriceText({ price: '', quantity: 4 })).toBeNull()
    expect(formPriceText({ price: 'abc', quantity: 4 })).toBeNull()
  })

  it('can be filled in when asking, or left empty', async () => {
    const added = await addItem({ ...valid, price: '$12.50', quantity: 4 })
    expect(added.ok && added.value.price).toBe(12.5)
    const without = await addItem(valid)
    expect(without.ok && without.value.price).toBeNull()
  })

  it('fills in the form, and comes back the same', () => {
    expect(itemToForm(asked()).price).toBe('7.25')
    expect(itemToForm(find('Ethernet cables, 5 ft (10 pack)')).price).toBe('')
    expect(isOrderChange(ordered(), itemToForm(ordered()))).toBe(false)
  })

  it('stays on a duplicate, to buy it again', () => {
    expect(duplicateItem(ordered()).price).toBe('18.75')
  })

  it('can be changed or emptied by a student while it is being asked for', async () => {
    expect(isOrderChange(asked(), { ...itemToForm(asked()), price: '8.00' })).toBe(false)
    expect((await changeItem(asked(), { ...itemToForm(asked()), price: '8.00' })).ok).toBe(true)
    expect(asked().price).toBe(8)
    expect((await changeItem(asked(), { ...itemToForm(asked()), price: '' })).ok).toBe(true)
    expect(asked().price).toBeNull()
  })

  it("can't be changed by a student once it's ordered", async () => {
    const changed = { ...itemToForm(ordered()), price: '1.00' }
    expect(isOrderChange(ordered(), changed)).toBe(true)
    expect(await changeItem(ordered(), changed)).toMatchObject({ ok: false, error: expect.stringMatching(/Only mentors and purchasers/) })
    expect((await changeItem(ordered(), { ...itemToForm(ordered()), price: '' })).ok).toBe(false)
    expect(ordered().price).toBe(18.75)
  })

  it("locks the number needed once it's ordered too, so a student can't change the total", async () => {
    const changed = { ...itemToForm(ordered()), quantity: 5 }
    expect(isOrderChange(ordered(), changed)).toBe(true)
    expect(await changeItem(ordered(), changed)).toMatchObject({ ok: false, error: expect.stringMatching(/Only mentors and purchasers/) })
    expect(ordered().quantity).toBe(4)
    setDemoRole('mentor')
    expect((await changeItem(ordered(), changed)).ok).toBe(true)
    expect(ordered().quantity).toBe(5)
  })

  it('can be changed by a mentor or purchaser once it is ordered', async () => {
    await buyersTable.insert({ member_id: DEMO_PEOPLE.alex })
    expect((await changeItem(ordered(), { ...itemToForm(ordered()), price: '20.00' })).ok).toBe(true)
    expect(ordered().price).toBe(20)
    await buyersTable.reset()
    setDemoRole('mentor')
    expect((await changeItem(ordered(), { ...itemToForm(ordered()), price: '21.00' })).ok).toBe(true)
    expect(ordered().price).toBe(21)
  })

  it("locks everything else about an order for a student too", async () => {
    const changes: Partial<NewItem>[] = [{ name: 'Belt' }, { vendor: 'Amazon' }, { type: 'Field' }, { link: 'https://example.com/other' }, { part_number: 'OTHER' }, { notes: 'Two boxes' }]
    for (const change of changes) {
      expect(await changeItem(ordered(), { ...itemToForm(ordered()), ...change })).toMatchObject({ ok: false, error: expect.stringMatching(/Only mentors and purchasers/) })
    }
    expect(ordered().notes).toBeNull()
    setDemoRole('mentor')
    expect((await changeItem(ordered(), { ...itemToForm(ordered()), notes: 'Two boxes' })).ok).toBe(true)
    expect(ordered().notes).toBe('Two boxes')
  })
})

describe('choices', () => {
  it('is the list when the value is in it, or empty', () => {
    expect(choices(['A', 'B'], 'B')).toEqual(['A', 'B'])
    expect(choices(['A', 'B'], '')).toEqual(['A', 'B'])
  })

  it('keeps a value that is no longer in the list', () => {
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
  it('Current: what is in progress, by status, in the order of the statuses', () => {
    const groups = groupItems(itemsTable.rows(), 'Current')
    expect(groups.map((g) => g.title)).toEqual(['Order Low Priority', 'Order', 'Order High Priority', 'Order Placed', 'Backordered', 'Received'])
    expect(groups.flatMap((g) => g.items).some((i) => ['wait', 'in_shop', 'cancelled'].includes(i.status))).toBe(false)
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
  it('counts what to order now, and how much is high priority', () => {
    expect(summaryText(itemsTable.rows())).toBe('2 to order now (1 high priority)')
  })

  it('says what is in progress when nothing needs ordering now', () => {
    const items = itemsTable.rows().filter((i) => i.status !== 'order' && i.status !== 'order_high')
    expect(summaryText(items)).toBe('Nothing to order now · 4 in progress')
    expect(summaryText([])).toBe('Nothing to order now')
  })
})

describe('checkItem', () => {
  it('allows an item with a name, vendor, type and quantity', () => {
    expect(checkItem(valid)).toBeNull()
  })

  it('needs a name, a vendor and a type', () => {
    expect(checkItem({ ...valid, name: '  ' })).toMatch(/what to buy/)
    expect(checkItem({ ...valid, vendor: '' })).toMatch(/Pick a vendor/)
    expect(checkItem({ ...valid, type: '' })).toMatch(/Pick a type/)
  })

  it('allows the longest name, but not longer', () => {
    expect(checkItem({ ...valid, name: 'x'.repeat(MAX_NAME_LENGTH) })).toBeNull()
    expect(checkItem({ ...valid, name: 'x'.repeat(MAX_NAME_LENGTH + 1) })).toMatch(/under 200/)
  })

  it('needs a whole quantity of at least 1, and not too many', () => {
    expect(checkItem({ ...valid, quantity: 0 })).toBe('Ask for at least 1.')
    expect(checkItem({ ...valid, quantity: 2.5 })).toBe('Ask for at least 1.')
    expect(checkItem({ ...valid, quantity: MAX_QUANTITY })).toBeNull()
    expect(checkItem({ ...valid, quantity: MAX_QUANTITY + 1 })).toMatch(/fewer/)
  })

  it('only takes https:// links', () => {
    expect(checkItem({ ...valid, link: 'https://example.com/part' })).toBeNull()
    expect(checkItem({ ...valid, link: 'http://example.com/part' })).toMatch(/https:\/\//)
    expect(checkItem({ ...valid, link: 'javascript:alert(1)' })).toMatch(/https:\/\//)
  })

  it('refuses a made-up status', () => {
    expect(checkItem({ ...valid, status: 'lost' as never })).toBe('Pick a status.')
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
  it('deletes only that item', async () => {
    expect(await removeItem(find('Ethernet cables, 5 ft (10 pack)'))).toEqual({ ok: true, value: null })
    expect(itemsTable.rows()).toHaveLength(9)
  })

  it('says so if the item is already gone', async () => {
    const item = find('Ethernet cables, 5 ft (10 pack)')
    await removeItem(item)
    expect((await removeItem(item)).ok).toBe(false)
  })
})

describe('searchItems', () => {
  it('finds items by name, vendor, type, part number or notes, ignoring capitals', () => {
    const names = (search: string) => searchItems(itemsTable.rows(), search).map((i) => i.name)
    expect(names('BELT')).toEqual(['Timing belt, 60T'])
    expect(names('mcmaster')).toEqual(['Polycarbonate sheet, 1/8 in'])
    expect(names('example-neo')).toEqual(['Brushless motor'])
    expect(names('storage room')).toEqual(['Field tape, 2 in'])
  })

  it('needs every word typed to match', () => {
    expect(searchItems(itemsTable.rows(), 'amazon cables').map((i) => i.name)).toEqual(['Ethernet cables, 5 ft (10 pack)'])
  })

  it('matches everything when the search is empty, and nothing when nothing matches', () => {
    expect(searchItems(itemsTable.rows(), '  ')).toHaveLength(10)
    expect(searchItems(itemsTable.rows(), 'unobtainium')).toEqual([])
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

  it('counts moving into or out of an order status, or setting Shipped to, as an order change', () => {
    const asked = find('Zip ties, 8 in (pack of 100)')
    const ordered = find('Timing belt, 60T')
    expect(isOrderChange(asked, { ...itemToForm(asked), status: 'order_high' })).toBe(false)
    expect(isOrderChange(asked, { ...itemToForm(asked), status: 'placed' })).toBe(true)
    expect(isOrderChange(asked, { ...itemToForm(asked), shipped_to: DEMO_PEOPLE.pat })).toBe(true)
    expect(isOrderChange(ordered, { ...itemToForm(ordered), ordered_by: DEMO_PEOPLE.jordan })).toBe(true)
    expect(isOrderChange(ordered, { ...itemToForm(ordered), status: 'order' })).toBe(true)
    expect(isOrderChange(ordered, { ...itemToForm(ordered), notes: 'Two boxes' })).toBe(true)
    expect(isOrderChange(ordered, itemToForm(ordered))).toBe(false)
    expect(isOrderChange(asked, { ...itemToForm(asked), notes: 'Two boxes' })).toBe(false)
    expect(isOrderChange(asked, { ...itemToForm(asked), quantity: 5 })).toBe(false)
    expect(isOrderChange(null, valid)).toBe(false)
    expect(isOrderChange(null, { ...valid, status: 'placed' })).toBe(true)
  })

  it("doesn't let a student place an order, and says who can", async () => {
    const item = find('Zip ties, 8 in (pack of 100)')
    const result = await changeItem(item, { ...itemToForm(item), status: 'placed' })
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/Only mentors and purchasers/) })
    expect(find('Zip ties, 8 in (pack of 100)').status).toBe('order_low')
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

  it("doesn't let a student delete an order, but lets a mentor", async () => {
    const item = find('Timing belt, 60T')
    expect((await removeItem(item)).ok).toBe(false)
    setDemoRole('mentor')
    expect((await removeItem(item)).ok).toBe(true)
  })
})

describe('purchasers', () => {
  it('are chosen by mentors', async () => {
    expect((await addBuyer(DEMO_PEOPLE.alex)).ok).toBe(false)
    setDemoRole('mentor')
    expect((await addBuyer(DEMO_PEOPLE.alex)).ok).toBe(true)
    expect(buyersTable.rows().map((b) => b.member_id)).toContain(DEMO_PEOPLE.alex)
  })

  it("won't add someone twice", async () => {
    setDemoRole('mentor')
    expect(await addBuyer(DEMO_PEOPLE.jordan)).toEqual({ ok: false, error: "They're already a purchaser." })
  })

  it('are removed by mentors only', async () => {
    const [jordan] = buyersTable.rows()
    expect((await removeBuyer(jordan)).ok).toBe(false)
    setDemoRole('mentor')
    expect((await removeBuyer(jordan)).ok).toBe(true)
    expect(buyersTable.rows()).toEqual([])
  })
})

describe('asking for a BOM part', () => {
  const bomPart = {
    id: 'part', system_id: 'system', part_number: '4096-26-INT-006', name: 'Flanged bearing, 1/2 in hex', revision: null, kind: 'cots' as const,
    material: null, quantity: 6, vendor: 'WCP', vendor_part_number: 'EXAMPLE-BRG-12', onshape_url: null, onshape_id: null,
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

  it('fills in a request from the part, with its system as the type', () => {
    expect(requestFromBomPart(bomPart, intake)).toEqual({
      ...EMPTY_ITEM,
      name: 'Flanged bearing, 1/2 in hex',
      vendor: 'West Coast Products',
      type: 'Intake',
      part_number: 'EXAMPLE-BRG-12',
      quantity: 6,
      notes: '',
    })
  })

  it('uses Other for a vendor not in the list, with the BOM vendor in the notes, and Drive Base for the Drivetrain', () => {
    const request = requestFromBomPart({ ...bomPart, vendor: 'Swerve Drive Specialties' }, { ...intake, name: 'Drivetrain' })
    expect(request).toMatchObject({ vendor: 'Other', type: 'Drive Base', notes: 'Vendor in the BOM: Swerve Drive Specialties' })
  })

  it('leaves the type to pick when the system is not one of the types', () => {
    expect(requestFromBomPart(bomPart, { ...intake, name: 'Superstructure' }).type).toBe('')
    expect(requestFromBomPart(bomPart, undefined).type).toBe('')
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

  it('only takes a real date', () => {
    expect(checkItem({ ...valid, estimated_arrival: '2026-11-12' })).toBeNull()
    expect(checkItem({ ...valid, estimated_arrival: '2026-02-30' })).toMatch(/estimated arrival/)
    expect(checkItem({ ...valid, estimated_arrival: 'next week' })).toMatch(/estimated arrival/)
  })

  it('is set by mentors and purchasers, not students', async () => {
    const changed = { ...itemToForm(placed()), estimated_arrival: '2026-12-20' }
    expect(isOrderChange(placed(), changed)).toBe(true)
    expect((await changeItem(placed(), changed)).ok).toBe(false)
    setDemoRole('mentor')
    expect((await changeItem(placed(), changed)).ok).toBe(true)
    expect(placed().estimated_arrival).toBe('2026-12-20')
  })
})

describe('orderFieldsShown', () => {
  const empty = { ordered_by: '', shipped_to: '', estimated_arrival: '' }

  it('hides every order detail while the request is still asking', () => {
    for (const status of ['wait', 'order_low', 'order', 'order_high'] as const) {
      expect(orderFieldsShown({ ...empty, status })).toEqual({ ordered_by: false, shipped_to: false, estimated_arrival: false })
    }
  })

  it('shows them all once the order is placed, or past that', () => {
    for (const status of ['placed', 'backordered', 'received'] as const) {
      expect(orderFieldsShown({ ...empty, status })).toEqual({ ordered_by: true, shipped_to: true, estimated_arrival: true })
    }
  })

  it('still shows one that is filled in, so nothing saved is hidden', () => {
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

    it('says how big a file is when it is too big', () => {
      expect(checkReceipt({ ...pdf, size: 12_300_000 })).toMatch(/12\.3 MB.*up to 10 MB/)
    })

    it('refuses other kinds of file and says what it takes', () => {
      expect(checkReceipt({ ...pdf, name: 'list.docx', type: 'application/msword' })).toMatch(/PDF or a photo/)
      expect(checkReceipt({ ...pdf, name: 'no-idea', type: '' })).toMatch(/PDF or a photo/)
    })

    it('refuses SVG images, which can run code when opened', () => {
      expect(checkReceipt({ ...pdf, name: 'photo.svg', type: 'image/svg+xml' })).toMatch(/PDF or a photo/)
    })

    it('refuses an empty file', () => {
      expect(checkReceipt({ ...pdf, size: 0 })).toMatch(/empty/)
    })
  })

  it('offers the camera on phones: PDFs and images, with no capture', () => {
    expect(RECEIPT_ACCEPT).toBe('application/pdf,image/*')
  })

  it('works out the type of an iPhone photo when the browser leaves it empty', () => {
    expect(receiptType({ ...pdf, name: 'IMG_0001.HEIC', type: '' })).toBe('image/heic')
    expect(receiptType({ ...pdf, name: 'scan.jpeg', type: '' })).toBe('image/jpeg')
  })

  it('goes by the ending when the type is a general one or another spelling', () => {
    expect(receiptType({ ...pdf, name: 'order.pdf', type: 'application/octet-stream' })).toBe('application/pdf')
    expect(receiptType({ ...pdf, name: 'IMG_0001.HEIC', type: 'application/octet-stream' })).toBe('image/heic')
    expect(receiptType({ ...pdf, name: 'order.pdf', type: 'application/x-pdf' })).toBe('application/pdf')
    expect(receiptType({ ...pdf, name: 'photo.jpg', type: 'image/jpg' })).toBe('image/jpeg')
  })

  it('still refuses a file whose type and ending are both not allowed', () => {
    expect(checkReceipt({ ...pdf, name: 'photo.svg', type: 'application/octet-stream' })).toMatch(/PDF or a photo/)
  })

  it('labels the file to upload with its type, keeping what is in it', async () => {
    const file = new File(['receipt'], 'IMG_0001.HEIC', { type: '' })
    const body = receiptBody(file, 'image/heic')
    expect(body.type).toBe('image/heic')
    expect(body.size).toBe(file.size)
    expect(await body.text()).toBe('receipt')
  })

  it('describes a receipt without its file name', () => {
    expect(sizeText(240_000)).toBe('240 KB')
    expect(sizeText(2_400_000)).toBe('2.4 MB')
    expect(sizeText(10)).toBe('1 KB')
    expect(receiptText(receiptsOf(find('Motor controller'))[0])).toBe('PDF, 96 KB')
    expect(receiptText(receiptsOf(find('Motor controller'))[1])).toBe('Photo, 2.4 MB')
  })

  it('counts them for the list, and says nothing when there are none', () => {
    expect(receiptCountText(0)).toBe('')
    expect(receiptCountText(1)).toBe('1 receipt')
    expect(receiptCountText(2)).toBe('2 receipts')
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

    it('refuses a student', async () => {
      const item = find('Timing belt, 60T')
      expect((await addReceipt(item, receiptFile())).ok).toBe(false)
      expect(receiptsOf(item)).toHaveLength(0)
    })

    it('refuses a file that is not a receipt', async () => {
      setDemoRole('mentor')
      const item = find('Timing belt, 60T')
      const result = await addReceipt(item, new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }))
      expect(result.ok).toBe(false)
      expect(receiptsOf(item)).toHaveLength(0)
    })
  })

  it('can only be opened by mentors and purchasers', async () => {
    const [receipt] = receiptsTable.rows()
    expect(await receiptLink(receipt)).toEqual({ ok: false, error: 'Only mentors and purchasers can open receipts.' })
    await buyersTable.insert({ member_id: DEMO_PEOPLE.alex })
    expect(await receiptLink(receipt)).toMatchObject({ ok: false, error: expect.stringMatching(/^Demo mode/) })
  })

  it('says there are no files in demo mode, for a mentor', async () => {
    setDemoRole('mentor')
    expect(await receiptLink(receiptsTable.rows()[0])).toMatchObject({ ok: false, error: expect.stringMatching(/^Demo mode/) })
  })

  it('can only be deleted by mentors and purchasers', async () => {
    const [first, second] = receiptsTable.rows()
    expect((await removeReceipt(first)).ok).toBe(false)
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
