// Tests for data.ts. Run them with `npm test`.
// Who is allowed to do what is the database's job: that's tested in
// supabase/tests/inventory-items.test.ts.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import {
  CORRECTED,
  MAX_STOCK_NOTE_LENGTH,
  addItem,
  changeItem,
  changeStock,
  changesTable,
  checkChanges,
  checkItem,
  checkLink,
  checkStockChange,
  removeItem,
  isLow,
  itemsTable,
  useLowItems,
  useLowStockAttention,
  useLowStockSummary,
  useStockHistory,
  type NewItem,
} from './data'

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
  changesTable.reset()
})

describe('example parts', () => {
  it("has 8 to 10 parts, in order by name, each with a name, vendor, part number and location, and no negative numbers, which the database wouldn't allow", () => {
    expect(itemsTable.rows().length).toBeGreaterThanOrEqual(8)
    expect(itemsTable.rows().length).toBeLessThanOrEqual(10)
    const names = itemsTable.rows().map((item) => item.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    for (const item of itemsTable.rows()) {
      for (const text of [item.name, item.vendor, item.vendor_part_number, item.location]) expect(text.trim(), item.name).not.toBe('')
      expect(item.quantity, item.name).toBeGreaterThanOrEqual(0)
      expect(item.low_stock_level, item.name).toBeGreaterThanOrEqual(0)
    }
  })

  it('never lists the same vendor and part number twice, since that is how the BOM finds a part', () => {
    const keys = itemsTable.rows().map((item) => `${item.vendor} ${item.vendor_part_number}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('isLow', () => {
  it('is true below and exactly at the low-stock level, and false above it', () => {
    expect(isLow(part(1, 2))).toBe(true)
    expect(isLow(part(2, 2))).toBe(true)
    expect(isLow(part(3, 2))).toBe(false)
  })
})

describe('useLowItems', () => {
  it('gives only the low parts, in order by name, or nothing when none are low', async () => {
    expect(runHook(useLowItems).map((item) => item.name)).toEqual(['CANivore', 'Main breaker, 120A', 'roboRIO 2.0'])
    await stockEverything()
    expect(runHook(useLowItems)).toEqual([])
  })
})

describe('useLowStockSummary', () => {
  it('says how many parts are low, "1 part" for one, or that none are', async () => {
    expect(runHook(useLowStockSummary)).toEqual({ tone: 'warn', text: '3 parts low' })
    await stockEverything()
    expect(runHook(useLowStockSummary)).toEqual({ tone: 'ok', text: 'No parts low' })
    await itemsTable.update(itemsTable.rows()[0].id, { quantity: 0 })
    expect(runHook(useLowStockSummary)).toEqual({ tone: 'warn', text: '1 part low' })
  })
})

describe('useLowStockAttention', () => {
  it('adds one line when parts are low, and nothing when none are', async () => {
    expect(runHook(useLowStockAttention)).toEqual([{ tone: 'warn', text: '3 parts low on stock.' }])
    await stockEverything()
    expect(runHook(useLowStockAttention)).toEqual([])
  })
})

const newItem = (changes: Partial<NewItem> = {}): NewItem => ({
  name: 'SPARK MAX',
  vendor: 'REV',
  vendor_part_number: 'REV-11-2158',
  location: 'Bin E5',
  link: '',
  quantity: 4,
  low_stock_level: 2,
  ...changes,
})

describe('checkItem', () => {
  it('allows a complete part, with none on the shelf if need be', () => {
    expect(checkItem(newItem(), itemsTable.rows())).toBeNull()
    expect(checkItem(newItem({ quantity: 0 }), itemsTable.rows())).toBeNull()
  })

  it('refuses a part that breaks a rule, and says which', () => {
    const refused: [string, Partial<NewItem>, RegExp][] = [
      ['no name', { name: ' ' }, /Add a name/],
      ['no vendor', { vendor: '' }, /vendor/],
      ['no part number', { vendor_part_number: '' }, /part number/],
      ['no location', { location: '' }, /where it lives/],
      ['fewer than 0', { quantity: -1 }, /quantity/],
      ['part of one', { quantity: 1.5 }, /quantity/],
      ['a low-stock level under 0', { low_stock_level: -1 }, /low-stock level/],
      ['a location longer than the database allows', { location: 'x'.repeat(61) }, /location under 60 characters\. This one is 61/],
      // Says where the part already is.
      ['a vendor and part number already listed', { vendor: ' REV ', vendor_part_number: 'REV-11-1850 ' }, /REV REV-11-1850 is already listed, as "Power Distribution Hub \(PDH\)" in Shelf E1/],
    ]
    for (const [label, changes, problem] of refused) expect(checkItem(newItem(changes), itemsTable.rows()), label).toMatch(problem)
  })
})

describe('checkLink', () => {
  it('allows no link, or a whole https:// link up to 2000 characters, when adding or changing a part', () => {
    const links: [string, boolean][] = [
      ['', true],
      ['  ', true],
      ['https://www.revrobotics.com/rev-11-1850/', true],
      [' https://example.com/parts/am-3000a ', true], // trimmed
      ['http://example.com/part', false], // not https
      ['www.example.com/part', false],
      ['javascript:alert(1)', false],
      ['https://', false],
      ['https://example.com/a part', false], // a space: not a single link
      [`https://example.com/${'x'.repeat(1981)}`, false], // 2001 characters
    ]
    for (const [link, allowed] of links) {
      const problems = [checkLink(link), checkItem(newItem({ link }), itemsTable.rows()), checkChanges({ quantity: 1, location: 'Bin E2', link })]
      for (const problem of problems) {
        if (allowed) expect(problem, link).toBeNull()
        else expect(problem, link).toMatch(/https:\/\/|under 2000/)
      }
    }
  })
})

describe('addItem', () => {
  it('adds a part, trimmed, with its product link or none', async () => {
    const result = await addItem(newItem({ name: '  SPARK MAX ', location: ' Bin E5', link: ' https://example.com/spark-max ' }))
    expect(result.ok).toBe(true)
    expect(itemsTable.rows().find((i) => i.vendor_part_number === 'REV-11-2158')).toMatchObject({
      name: 'SPARK MAX', vendor: 'REV', location: 'Bin E5', link: 'https://example.com/spark-max', quantity: 4, low_stock_level: 2,
    })
    await addItem(newItem({ vendor_part_number: 'REV-11-2159', link: '  ' }))
    expect(itemsTable.rows().find((i) => i.vendor_part_number === 'REV-11-2159')?.link).toBeNull()
  })

  it("doesn't add a part that breaks the rules, and says why", async () => {
    const before = itemsTable.rows().length
    expect(await addItem(newItem({ name: '' }))).toEqual({ ok: false, error: 'Add a name for the part.' })
    expect(itemsTable.rows()).toHaveLength(before)
  })
})

describe('changing and deleting a part', () => {
  afterEach(() => setDemoRole('student'))
  const pdh = () => itemsTable.rows().find((i) => i.vendor_part_number === 'REV-11-1850')!

  it('checks the location and quantity', () => {
    expect(checkChanges({ quantity: 0, location: 'Bin E2', link: '' })).toBeNull()
    expect(checkChanges({ quantity: 3, location: '  ', link: '' })).toMatch(/where it lives/)
    expect(checkChanges({ quantity: -1, location: 'Bin E2', link: '' })).toMatch(/whole number/)
    expect(checkChanges({ quantity: 1.5, location: 'Bin E2', link: '' })).toMatch(/whole number/)
    expect(checkChanges({ quantity: 1, location: 'x'.repeat(61), link: '' })).toMatch(/under 60/)
  })

  it("lets a mentor change a part's quantity, location and product link, trimmed", async () => {
    setDemoRole('mentor')
    expect((await changeItem(pdh(), { quantity: 7, location: ' Shelf E3 ', link: ' https://example.com/pdh ' })).ok).toBe(true)
    expect(pdh()).toMatchObject({ quantity: 7, location: 'Shelf E3', link: 'https://example.com/pdh' })
    expect((await changeItem(pdh(), { quantity: 7, location: 'Shelf E3', link: '' })).ok).toBe(true)
    expect(pdh().link).toBeNull()
  })

  it("records a mentor's new count in the history, so the history adds up, and adds nothing when the count is left alone", async () => {
    setDemoRole('mentor')
    const before = changesTable.rows().length
    await changeItem(pdh(), { quantity: 2, location: 'Shelf E3', link: '' })
    expect(changesTable.rows()).toHaveLength(before)
    await changeItem(pdh(), { quantity: 7, location: 'Shelf E1', link: '' })
    expect(changesTable.rows()).toHaveLength(before + 1)
    expect(changesTable.rows()[0]).toMatchObject({ item_id: pdh().id, change: 5, note: CORRECTED, created_by: DEMO_PEOPLE.pat })
  })

  it("doesn't let a student change or delete a part, says who can, and changes nothing", async () => {
    const before = [itemsTable.rows(), changesTable.rows()]
    const tries: [string, () => Promise<unknown>][] = [
      ['change', () => changeItem(pdh(), { quantity: 7, location: 'Shelf E3', link: '' })],
      ['delete', () => removeItem(pdh())],
    ]
    for (const [doing, attempt] of tries) expect(await attempt(), doing).toEqual({ ok: false, error: expect.stringMatching(/Only mentors and admins/) })
    expect([itemsTable.rows(), changesTable.rows()]).toEqual(before)
  })

  it('lets a mentor delete a part', async () => {
    const count = itemsTable.rows().length
    setDemoRole('mentor')
    expect((await removeItem(pdh())).ok).toBe(true)
    expect(itemsTable.rows()).toHaveLength(count - 1)
  })
})

describe('taking and adding stock', () => {
  // The demo student, Alex, has 2 of these.
  const pdh = () => itemsTable.rows().find((i) => i.vendor_part_number === 'REV-11-1850')!
  const historyOf = (id: string) => changesTable.rows().filter((c) => c.item_id === id)

  // These run as the demo student: anyone can take and add parts, not just mentors.
  it('takes and adds parts, recording who and the note', async () => {
    expect(await changeStock(pdh(), -2, ' For the intake ')).toMatchObject({ ok: true, value: { quantity: 0 } })
    expect(pdh().quantity).toBe(0)
    expect(historyOf(pdh().id)).toEqual([expect.objectContaining({ change: -2, note: 'For the intake', created_by: DEMO_PEOPLE.alex })])
    expect((await changeStock(pdh(), 10, '')).ok).toBe(true)
    expect(pdh().quantity).toBe(10)
    expect(historyOf(pdh().id)).toHaveLength(2)
    expect(historyOf(pdh().id)).toContainEqual(expect.objectContaining({ change: 10, note: '' }))
  })

  it('refuses to take more than are on the shelf, says how many there are, and changes nothing', async () => {
    expect(await changeStock(pdh(), -3, '')).toEqual({ ok: false, error: "Only 2 on the shelf, so you can't take 3." })
    expect(pdh().quantity).toBe(2)
    expect(historyOf(pdh().id)).toEqual([])
    await changeStock(pdh(), -2, '')
    expect(await changeStock(pdh(), -1, '')).toEqual({ ok: false, error: 'There are no Power Distribution Hub (PDH) on the shelf.' })
  })

  it('counts from the latest quantity, not the one the page drew', async () => {
    const stale = pdh()
    await changeStock(stale, -1, '')
    expect(await changeStock(stale, -2, '')).toEqual({ ok: false, error: "Only 1 on the shelf, so you can't take 2." })
    expect((await changeStock(stale, -1, '')).ok).toBe(true)
    expect(pdh().quantity).toBe(0)
  })

  it('refuses 0, fractions and long notes', () => {
    expect(checkStockChange(pdh(), 0, '')).toBe('Enter how many, 1 or more.')
    expect(checkStockChange(pdh(), 1.5, '')).toBe('Enter how many, 1 or more.')
    expect(checkStockChange(pdh(), 1, 'x'.repeat(MAX_STOCK_NOTE_LENGTH))).toBeNull()
    expect(checkStockChange(pdh(), 1, 'x'.repeat(MAX_STOCK_NOTE_LENGTH + 1))).toMatch(/^Keep the note under/)
  })

  it("shows one part's history, newest first", async () => {
    await changeStock(pdh(), -1, 'first')
    await new Promise((resolve) => setTimeout(resolve, 5))
    await changeStock(pdh(), 3, 'second')
    expect(runHook(() => useStockHistory(pdh())).map((c) => c.note)).toEqual(['second', 'first'])
  })
})
