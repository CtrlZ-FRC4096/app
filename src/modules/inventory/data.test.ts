// Tests for data.ts. Run them with `npm test`.
// Who is allowed to do what is the database's job: that's tested in
// supabase/tests/inventory-items.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import { itemsTable } from './data'

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
