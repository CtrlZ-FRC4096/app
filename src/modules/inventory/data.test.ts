// Tests for data.ts. Run them with `npm test`.
// Who is allowed to do what is the database's job: that's tested in
// supabase/tests/inventory-items.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import { addItem, checkItem, itemsTable, type NewItem } from './data'

beforeEach(() => {
  itemsTable.reset()
})

describe('example parts', () => {
  it('has 8 to 10 parts', () => {
    expect(itemsTable.rows().length).toBeGreaterThanOrEqual(8)
    expect(itemsTable.rows().length).toBeLessThanOrEqual(10)
  })

  it('never lists the same vendor and part number twice, since that is how the BOM finds a part', () => {
    const keys = itemsTable.rows().map((item) => `${item.vendor} ${item.vendor_part_number}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('gives every part a name, vendor, part number and location', () => {
    for (const item of itemsTable.rows()) {
      expect(item.name.trim()).not.toBe('')
      expect(item.vendor.trim()).not.toBe('')
      expect(item.vendor_part_number.trim()).not.toBe('')
      expect(item.location.trim()).not.toBe('')
    }
  })

  it("has no negative quantities or low-stock levels, which the database wouldn't allow", () => {
    for (const item of itemsTable.rows()) {
      expect(item.quantity).toBeGreaterThanOrEqual(0)
      expect(item.low_stock_level).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('itemsTable', () => {
  it('lists parts in order by name', () => {
    const names = itemsTable.rows().map((item) => item.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })
})

const newItem = (changes: Partial<NewItem> = {}): NewItem => ({
  name: 'SPARK MAX',
  vendor: 'REV',
  vendor_part_number: 'REV-11-2158',
  location: 'Bin E5',
  quantity: 4,
  low_stock_level: 2,
  ...changes,
})

describe('checkItem', () => {
  it('allows a complete part', () => {
    expect(checkItem(newItem(), itemsTable.rows())).toBeNull()
  })

  it('needs a name, vendor, part number and location', () => {
    expect(checkItem(newItem({ name: ' ' }), itemsTable.rows())).toBe('Add a name for the part.')
    expect(checkItem(newItem({ vendor: '' }), itemsTable.rows())).toMatch(/vendor/)
    expect(checkItem(newItem({ vendor_part_number: '' }), itemsTable.rows())).toMatch(/part number/)
    expect(checkItem(newItem({ location: '' }), itemsTable.rows())).toMatch(/where it lives/)
  })

  it('needs whole numbers, 0 or more, for the quantity and low-stock level', () => {
    expect(checkItem(newItem({ quantity: 0 }), itemsTable.rows())).toBeNull()
    expect(checkItem(newItem({ quantity: -1 }), itemsTable.rows())).toMatch(/quantity/)
    expect(checkItem(newItem({ quantity: 1.5 }), itemsTable.rows())).toMatch(/quantity/)
    expect(checkItem(newItem({ low_stock_level: -1 }), itemsTable.rows())).toMatch(/low-stock level/)
  })

  it('refuses text longer than the database allows', () => {
    expect(checkItem(newItem({ location: 'x'.repeat(61) }), itemsTable.rows())).toBe('Keep the location under 60 characters. This one is 61.')
  })

  it('refuses a vendor and part number that are already listed, and says where', () => {
    expect(checkItem(newItem({ vendor: ' REV ', vendor_part_number: 'REV-11-1850 ' }), itemsTable.rows())).toBe(
      'REV REV-11-1850 is already listed, as "Power Distribution Hub (PDH)" in Shelf E1.',
    )
  })
})

describe('addItem', () => {
  it('adds a part, trimmed', async () => {
    const result = await addItem(newItem({ name: '  SPARK MAX ', location: ' Bin E5' }))
    expect(result.ok).toBe(true)
    expect(itemsTable.rows().find((i) => i.vendor_part_number === 'REV-11-2158')).toMatchObject({
      name: 'SPARK MAX', vendor: 'REV', location: 'Bin E5', quantity: 4, low_stock_level: 2,
    })
  })

  it("doesn't add a part that breaks the rules, and says why", async () => {
    const before = itemsTable.rows().length
    expect(await addItem(newItem({ name: '' }))).toEqual({ ok: false, error: 'Add a name for the part.' })
    expect(itemsTable.rows()).toHaveLength(before)
  })
})
