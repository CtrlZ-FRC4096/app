// Tests for data.ts. Run them with `npm test`.
// They run in demo mode, starting from the example items, as the made-up
// student Alex. Who is allowed to do what is the database's job: that's
// tested in supabase/tests/purchase-items.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_PEOPLE } from '../../core/demo'
import {
  EMPTY_ITEM,
  MAX_NAME_LENGTH,
  MAX_QUANTITY,
  STATUSES,
  TYPES,
  VENDORS,
  addItem,
  changeItem,
  checkItem,
  choices,
  groupItems,
  isCurrent,
  itemToForm,
  itemsTable,
  removeItem,
  statusOf,
  summaryText,
  type PurchaseItem,
} from './data'

beforeEach(() => {
  itemsTable.reset()
})

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
    expect(all.items).toHaveLength(9)
    expect(all.items[0].name).toBe('Compliant wheel, 2 in')
  })

  it('By status: everything, by status, leaving out empty ones', () => {
    const groups = groupItems(itemsTable.rows(), 'By status')
    expect(groups[0].title).toBe('Wait to Order')
    expect(groups.at(-1)!.title).toBe('Cancel Item')
    expect(groups.map((g) => g.title)).not.toContain('Out of Stock')
    expect(groups.flatMap((g) => g.items)).toHaveLength(9)
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
    expect(itemsTable.rows()).toHaveLength(9)
  })
})

describe('changeItem', () => {
  it("changes anyone's item, including its status", async () => {
    const item = find('Zip ties, 8 in (pack of 100)')
    expect((await changeItem(item, { ...itemToForm(item), status: 'placed', quantity: 3 })).ok).toBe(true)
    expect(find('Zip ties, 8 in (pack of 100)')).toMatchObject({ status: 'placed', quantity: 3, requested_by: DEMO_PEOPLE.jordan })
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
    expect(await removeItem(find('Field tape, 2 in'))).toEqual({ ok: true, value: null })
    expect(itemsTable.rows()).toHaveLength(8)
  })

  it('says so if the item is already gone', async () => {
    const item = find('Field tape, 2 in')
    await removeItem(item)
    expect((await removeItem(item)).ok).toBe(false)
  })
})
