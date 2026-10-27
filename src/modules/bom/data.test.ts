// Tests for data.ts. Run them with `npm test`.
// Who is allowed to do what is the database's job: that's tested in
// supabase/tests/bom.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addPart, bomSummary, checkPart, countParts, filterParts, kindLabel, nextPartNumber, partCountText, partsTable, systemsTable,
  type NewPart, type Part,
} from './data'

beforeEach(() => {
  partsTable.reset()
  systemsTable.reset()
})

const parts = () => partsTable.rows()

describe('the example data', () => {
  it('has made parts with a material and COTS parts with a vendor', () => {
    for (const part of parts()) {
      if (part.kind === 'made') expect(part.material, part.part_number).toBeTruthy()
      else expect(part.vendor, part.part_number).toBeTruthy()
    }
  })

  it("puts each part's system code in its part number", () => {
    const codes = new Map(systemsTable.rows().map((s) => [s.id, s.code]))
    for (const part of parts()) expect(part.part_number).toMatch(new RegExp(`^4096-26-${codes.get(part.system_id)}-\\d{3}$`))
  })
})

describe('filterParts', () => {
  it('keeps every part for All', () => {
    expect(filterParts(parts(), 'All')).toEqual(parts())
  })

  it('keeps only made parts for Made, and only COTS parts for COTS', () => {
    expect(filterParts(parts(), 'Made').every((p) => p.kind === 'made')).toBe(true)
    expect(filterParts(parts(), 'COTS').every((p) => p.kind === 'cots')).toBe(true)
    expect(filterParts(parts(), 'Made').length + filterParts(parts(), 'COTS').length).toBe(parts().length)
  })
})

describe('countParts', () => {
  it('counts each part once, whatever its quantity', () => {
    const [madePart] = filterParts(parts(), 'Made')
    const [cotsPart] = filterParts(parts(), 'COTS')
    expect(countParts([madePart, cotsPart, { ...cotsPart, quantity: 100 } as Part])).toEqual({ made: 1, cots: 2 })
  })

  it('is zero for no parts', () => {
    expect(countParts([])).toEqual({ made: 0, cots: 0 })
    expect(partCountText([])).toBe('0 made, 0 COTS')
  })
})

describe('partCountText', () => {
  it('reads like "5 made, 7 COTS"', () => {
    expect(partCountText(parts())).toBe('5 made, 7 COTS')
  })
})

describe('kindLabel', () => {
  it('writes the kinds the way the team says them', () => {
    expect(kindLabel('made')).toBe('Made')
    expect(kindLabel('cots')).toBe('COTS')
  })
})

describe('bomSummary', () => {
  it('counts systems and parts', () => {
    expect(bomSummary(systemsTable.rows(), parts())).toEqual({ tone: 'info', text: '2 systems · 12 parts' })
  })

  it('says "1 system · 1 part" for one of each', () => {
    expect(bomSummary(systemsTable.rows().slice(0, 1), parts().slice(0, 1)).text).toBe('1 system · 1 part')
  })

  it('says so when there are no systems', () => {
    expect(bomSummary([], [])).toEqual({ tone: 'plain', text: 'No systems yet' })
  })
})

const intake = () => systemsTable.rows().find((s) => s.code === 'INT')!

const newMadePart = (changes: Partial<NewPart> = {}): NewPart => ({
  system_id: intake().id,
  part_number: '4096-26-INT-007',
  name: 'Roller bracket',
  revision: 'A',
  kind: 'made',
  material: '6061 aluminum, 1/8 in plate',
  quantity: 2,
  vendor: '',
  vendor_part_number: '',
  ...changes,
})

describe('nextPartNumber', () => {
  it('is one more than the highest number in the system', () => {
    expect(nextPartNumber(intake(), parts())).toBe('4096-26-INT-007')
  })

  it('starts at 001 in a system with no parts', () => {
    expect(nextPartNumber({ ...intake(), code: 'SHO' }, parts())).toBe('4096-26-SHO-001')
  })

  it('skips past gaps instead of filling them', () => {
    const [first] = parts()
    expect(nextPartNumber(intake(), [first, { ...first, part_number: '4096-26-INT-010' }])).toBe('4096-26-INT-011')
  })
})

describe('checkPart', () => {
  it('allows a complete made part', () => {
    expect(checkPart(newMadePart(), parts())).toBeNull()
  })

  it('refuses a part number that is already used', () => {
    expect(checkPart(newMadePart({ part_number: ' 4096-26-INT-001 ' }), parts())).toBe('4096-26-INT-001 is already used. Pick another number.')
  })

  it('needs a part number and a name', () => {
    expect(checkPart(newMadePart({ part_number: '  ' }), parts())).toMatch(/part number/)
    expect(checkPart(newMadePart({ name: '' }), parts())).toBe('Add a name for the part.')
  })

  it('needs a material for made parts and a vendor for COTS parts', () => {
    expect(checkPart(newMadePart({ material: ' ' }), parts())).toMatch(/material/)
    expect(checkPart(newMadePart({ kind: 'cots', vendor: '' }), parts())).toMatch(/vendor/)
    expect(checkPart(newMadePart({ kind: 'cots', material: '', vendor: 'WCP' }), parts())).toBeNull()
  })

  it('needs a whole-number quantity of 1 or more', () => {
    expect(checkPart(newMadePart({ quantity: 0 }), parts())).toMatch(/quantity/)
    expect(checkPart(newMadePart({ quantity: 1.5 }), parts())).toMatch(/quantity/)
  })

  it('refuses text longer than the database allows', () => {
    expect(checkPart(newMadePart({ revision: 'x'.repeat(11) }), parts())).toBe('Keep the revision under 10 characters. This one is 11.')
  })
})

describe('addPart', () => {
  it('adds a made part, trimmed, without vendor details', async () => {
    const result = await addPart(newMadePart({ name: '  Roller bracket ', vendor: 'Left over' }))
    expect(result.ok).toBe(true)
    expect(parts().find((p) => p.part_number === '4096-26-INT-007')).toMatchObject({
      name: 'Roller bracket', kind: 'made', material: '6061 aluminum, 1/8 in plate', vendor: null, vendor_part_number: null,
    })
    expect(parts()).toHaveLength(13)
  })

  it('adds a COTS part without a material, and with no revision if left empty', async () => {
    await addPart(newMadePart({ kind: 'cots', revision: '', material: 'Left over', vendor: 'WCP', vendor_part_number: 'EXAMPLE-COL-12' }))
    expect(parts().find((p) => p.part_number === '4096-26-INT-007')).toMatchObject({
      kind: 'cots', revision: null, material: null, vendor: 'WCP', vendor_part_number: 'EXAMPLE-COL-12',
    })
  })

  it("doesn't add a part that breaks the rules, and says why", async () => {
    expect(await addPart(newMadePart({ material: '' }))).toEqual({ ok: false, error: 'Add the material, like "6061 aluminum, 1/4 in plate".' })
    expect(parts()).toHaveLength(12)
  })
})
