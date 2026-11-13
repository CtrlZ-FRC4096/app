// Tests for catalog.ts. Run them with `npm test`.
// Who is allowed to do what is the database's job: that's tested in
// supabase/tests/bom-catalog.test.ts. The checks here only explain it first.
// Tests run as a student leader unless they say otherwise.
import { beforeEach, describe, expect, it } from 'vitest'
import { setDemoRole } from '../../core/demo'
import {
  addCatalogEntry, canAddToCatalog, catalogEntryFor, catalogTable, changeCatalogEntry, checkCatalogEntry, entryFromPart, removeCatalogEntry, sameVendor,
  type CatalogEntry, type NewCatalogEntry,
} from './catalog'
import { partsTable, type Part } from './data'

beforeEach(() => {
  setDemoRole('leader')
  catalogTable.reset()
  partsTable.reset()
})

const catalog = () => catalogTable.rows()
const part = (number: string) => partsTable.rows().find((p) => p.part_number === number)!
// Example parts from data.ts.
const motor = () => part('4096-26-INT-004') // REV Robotics EXAMPLE-NEO-01: in the example catalog
const bearing = () => part('4096-26-INT-006') // WCP EXAMPLE-BRG-12: not in the catalog yet
const plate = () => part('4096-26-INT-001') // Custom

const newEntry = (changes: Partial<NewCatalogEntry> = {}): NewCatalogEntry => ({
  vendor: 'West Coast Products',
  vendor_part_number: 'EXAMPLE-BRG-12',
  name: 'Example flanged bearing',
  product_url: 'https://example.com/wcp/example-brg-12',
  ...changes,
})

describe('the example catalog', () => {
  it('has entries for some of the example COTS parts, but not all, so the page shows both', () => {
    const cots = partsTable.rows().filter((p) => p.kind === 'cots')
    const found = cots.filter((p) => catalogEntryFor(p, catalog()))
    expect(found.length).toBeGreaterThan(0)
    expect(found.length).toBeLessThan(cots.length)
  })
})

describe('sameVendor', () => {
  it('treats the ways the team writes a vendor as one vendor', () => {
    const cases: [string, string, boolean][] = [
      ['REV', 'REV Robotics', true],
      ['WCP', 'West Coast Products', true],
      ['AndyMark', 'Andy Mark', true],
      ['swerve drive specialties ', 'Swerve Drive Specialties', true],
      ['REV Robotics', 'Andy Mark', false],
      ['VEX', 'WCP', false],
    ]
    for (const [a, b, same] of cases) expect(sameVendor(a, b), `${a} / ${b}`).toBe(same)
  })
})

describe('catalogEntryFor', () => {
  const entry = (vendor: string, vendor_part_number: string) => ({ ...catalog()[0], id: `${vendor}-${vendor_part_number}`, vendor, vendor_part_number }) as CatalogEntry
  const rev = entry('REV Robotics', 'REV-21-1650')
  const vex = entry('VEX', '217-1234')
  const andyMark = entry('Andy Mark', '217-1234')
  const entries = [rev, vex, andyMark]
  const line = (fields: Partial<Part>) => ({ ...motor(), ...fields }) as Part

  it('matches the same vendor part number from the same vendor, ignoring capitals and spaces', () => {
    const cases: [Partial<Part>, CatalogEntry | undefined][] = [
      [{ vendor: 'REV', vendor_part_number: ' rev-21-1650' }, rev],
      [{ vendor: 'VEX', vendor_part_number: '217-1234' }, vex],
      [{ vendor: 'AndyMark', vendor_part_number: '217-1234' }, andyMark],
      // Another vendor's part with the same number isn't a match.
      [{ vendor: 'WCP', vendor_part_number: 'REV-21-1650' }, undefined],
      // No vendor yet: the number alone, if only one entry has it.
      [{ vendor: null, vendor_part_number: 'REV-21-1650' }, rev],
      [{ vendor: null, vendor_part_number: '217-1234' }, undefined],
      // No vendor part number, or a custom part: nothing to match.
      [{ vendor: 'REV Robotics', vendor_part_number: null }, undefined],
      [{ kind: 'made', vendor: 'REV Robotics', vendor_part_number: 'REV-21-1650' }, undefined],
    ]
    for (const [fields, expected] of cases) expect(catalogEntryFor(line(fields), entries), JSON.stringify(fields)).toBe(expected)
  })
})

describe('canAddToCatalog', () => {
  it('is for COTS lines with a vendor part number that the catalog has no entry for', () => {
    const cases: [Part, boolean][] = [
      [bearing(), true],
      [motor(), false],
      [plate(), false],
      [{ ...bearing(), vendor_part_number: null }, false],
      [{ ...bearing(), removed_in_onshape: true }, false],
    ]
    for (const [line, expected] of cases) expect(canAddToCatalog(line, catalog()), line.name).toBe(expected)
  })
})

describe('entryFromPart', () => {
  it("fills in a new entry from the line, naming the vendor the way Purchasing does", () => {
    expect(entryFromPart({ ...bearing(), product_url: 'https://example.com/b' })).toEqual({
      vendor: 'West Coast Products', vendor_part_number: 'EXAMPLE-BRG-12', name: 'Flanged bearing, 1/2 in hex', product_url: 'https://example.com/b',
    })
    // A vendor Purchasing doesn't list stays as it's written.
    expect(entryFromPart(part('4096-26-DRV-003')).vendor).toBe('Swerve Drive Specialties')
  })
})

describe('checkCatalogEntry', () => {
  it('needs every box filled in, a whole https:// link, short enough text, and no entry already there', () => {
    const cases: [Partial<NewCatalogEntry>, string | null][] = [
      [{}, null],
      [{ vendor: ' ' }, 'Add the vendor'],
      [{ vendor_part_number: '' }, "vendor's part number"],
      [{ name: '' }, "part's name"],
      [{ product_url: '' }, 'link to buy it'],
      [{ product_url: 'javascript:alert(1)' }, 'starting with https://'],
      [{ product_url: 'http://example.com/a' }, 'starting with https://'],
      [{ product_url: 'https://example.com/a b' }, 'starting with https://'],
      [{ name: 'x'.repeat(101) }, 'under 100 characters'],
      [{ product_url: `https://example.com/${'x'.repeat(2000)}` }, 'under 2000 characters'],
      // Already there, however the vendor and number are written.
      [{ vendor: 'REV', vendor_part_number: 'example-neo-01 ' }, 'already in the catalog'],
      // The same number from another vendor is a different part.
      [{ vendor: 'VEX', vendor_part_number: 'EXAMPLE-NEO-01' }, null],
    ]
    for (const [changes, error] of cases) {
      const problem = checkCatalogEntry(newEntry(changes), catalog())
      if (error === null) expect(problem, JSON.stringify(changes)).toBeNull()
      else expect(problem, JSON.stringify(changes)).toContain(error)
    }
  })

  it('lets an entry being changed keep its own vendor part number', () => {
    const [entry] = catalog()
    expect(checkCatalogEntry({ ...entry, name: 'Renamed' }, catalog(), entry.id)).toBeNull()
  })
})

describe('addCatalogEntry, changeCatalogEntry and removeCatalogEntry', () => {
  it('add an entry, trimmed, that the line then matches', async () => {
    const result = await addCatalogEntry(newEntry({ name: '  Example flanged bearing ', product_url: ' https://example.com/wcp/brg ' }))
    expect(result).toMatchObject({ ok: true, value: { name: 'Example flanged bearing', product_url: 'https://example.com/wcp/brg' } })
    expect(catalogEntryFor(bearing(), catalog())?.name).toBe('Example flanged bearing')
  })

  it('change and delete an entry', async () => {
    const entry = catalogEntryFor(motor(), catalog())!
    expect(await changeCatalogEntry(entry, { ...entry, name: 'Renamed motor' })).toMatchObject({ ok: true })
    expect(catalogEntryFor(motor(), catalog())?.name).toBe('Renamed motor')
    expect(await removeCatalogEntry(entry)).toEqual({ ok: true, value: null })
    expect(catalogEntryFor(motor(), catalog())).toBeUndefined()
  })

  it("don't save an entry that breaks the rules, and say why", async () => {
    expect(await addCatalogEntry(newEntry({ product_url: 'javascript:alert(1)' }))).toEqual({ ok: false, error: expect.stringContaining('https://') })
    expect(catalog()).toHaveLength(4)
  })

  it('tell a student who can, and change nothing', async () => {
    setDemoRole('student')
    const [entry] = catalog()
    const tries: [string, () => Promise<unknown>][] = [
      ['add to the catalog', () => addCatalogEntry(newEntry())],
      ['change the catalog', () => changeCatalogEntry(entry, { ...entry, name: 'Changed' })],
      ['delete from the catalog', () => removeCatalogEntry(entry)],
    ]
    for (const [doing, attempt] of tries) {
      expect(await attempt(), doing).toEqual({ ok: false, error: `Only student leaders and mentors can ${doing}. Ask one of them.` })
    }
    expect(catalog()).toContainEqual(entry)
    expect(catalog()).toHaveLength(4)
  })
})
