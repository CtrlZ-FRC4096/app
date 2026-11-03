// Tests for data.ts. Run them with `npm test`.
// Who is allowed to do what is the database's job: that's tested in
// supabase/tests/inventory-items.test.ts.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { addItem, checkItem, isLow, itemsTable, useLowItems, useLowStockAttention, useLowStockSummary, type NewItem } from './data'

/** Runs a hook the way a page would, and gives back what it returned. */
function runHook<T>(hook: () => T): T {
  let value: T | undefined
  function Component() {
    value = hook()
    return null
  }
  renderToString(createElement(Component))
  return value as T
}

/** An example part with the given quantity and low-stock level. */
const part = (quantity: number, low_stock_level: number) => ({ ...itemsTable.rows()[0], quantity, low_stock_level })

/** Puts every example part well above its low-stock level. */
async function stockEverything() {
  for (const item of itemsTable.rows()) await itemsTable.update(item.id, { quantity: item.low_stock_level + 1 })
}

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

describe('isLow', () => {
  it('is true below the low-stock level', () => {
    expect(isLow(part(1, 2))).toBe(true)
  })

  it('is true exactly at the low-stock level', () => {
    expect(isLow(part(2, 2))).toBe(true)
  })

  it('is false above the low-stock level', () => {
    expect(isLow(part(3, 2))).toBe(false)
  })
})

describe('useLowItems', () => {
  it('gives only the low parts, in order by name', () => {
    expect(runHook(useLowItems).map((item) => item.name)).toEqual(['CANivore', 'Main breaker, 120A', 'roboRIO 2.0'])
  })

  it('gives nothing when no parts are low', async () => {
    await stockEverything()
    expect(runHook(useLowItems)).toEqual([])
  })
})

describe('useLowStockSummary', () => {
  it('says how many parts are low', () => {
    expect(runHook(useLowStockSummary)).toEqual({ tone: 'warn', text: '3 parts low' })
  })

  it('says "1 part" when only one is low', async () => {
    await stockEverything()
    await itemsTable.update(itemsTable.rows()[0].id, { quantity: 0 })
    expect(runHook(useLowStockSummary)).toEqual({ tone: 'warn', text: '1 part low' })
  })

  it('says so when no parts are low', async () => {
    await stockEverything()
    expect(runHook(useLowStockSummary)).toEqual({ tone: 'ok', text: 'No parts low' })
  })
})

describe('useLowStockAttention', () => {
  it('adds one line when parts are low', () => {
    expect(runHook(useLowStockAttention)).toEqual([{ tone: 'warn', text: '3 parts low on stock.' }])
  })

  it('adds nothing when no parts are low', async () => {
    await stockEverything()
    expect(runHook(useLowStockAttention)).toEqual([])
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
