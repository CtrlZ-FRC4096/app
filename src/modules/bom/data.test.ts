// Tests for data.ts. Run them with `npm test`.
// Who is allowed to do what is the database's job: that's tested in
// supabase/tests/bom.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import { setDemoRole } from '../../core/demo'
import {
  addPart, addRobot, addSystem, bomSummary, changePart, changeSystem, checkPart, checkSystem, countParts, filterParts, kindLabel,
  nextPartNumber, partCountText, partsTable, removePart, removeSystem, renameRobot, robotsTable, systemsTable,
  type NewPart, type Part,
} from './data'

beforeEach(() => {
  setDemoRole('student')
  partsTable.reset()
  systemsTable.reset()
  robotsTable.reset()
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

describe('changePart and removePart', () => {
  const plate = () => parts().find((p) => p.part_number === '4096-26-INT-001')!

  it('changes a part, keeping its own part number allowed', async () => {
    const result = await changePart(plate(), newMadePart({ part_number: '4096-26-INT-001', name: 'Intake side plate', revision: 'C', quantity: 4 }))
    expect(result.ok).toBe(true)
    expect(plate()).toMatchObject({ revision: 'C', quantity: 4, material: '6061 aluminum, 1/8 in plate' })
  })

  it('clears the material when a part is changed to COTS', async () => {
    await changePart(plate(), newMadePart({ part_number: '4096-26-INT-001', kind: 'cots', vendor: 'WCP' }))
    expect(plate()).toMatchObject({ kind: 'cots', material: null, vendor: 'WCP' })
  })

  it("won't take another part's number", async () => {
    expect(await changePart(plate(), newMadePart({ part_number: '4096-26-INT-002' }))).toEqual({
      ok: false, error: '4096-26-INT-002 is already used. Pick another number.',
    })
  })

  it('deletes a part', async () => {
    expect((await removePart(plate())).ok).toBe(true)
    expect(parts().some((p) => p.part_number === '4096-26-INT-001')).toBe(false)
  })
})

describe('robots and systems', () => {
  const system = { name: 'Shooter', code: ' sho ', onshape_url: '' }

  it('adds and renames a robot', async () => {
    const added = await addRobot('  2027 competition robot ')
    if (!added.ok) throw new Error(added.error)
    expect(added.value.name).toBe('2027 competition robot')
    expect((await renameRobot(added.value, '2027 robot')).ok).toBe(true)
    expect(robotsTable.rows().map((r) => r.name)).toContain('2027 robot')
    expect(await addRobot(' ')).toEqual({ ok: false, error: 'Name the robot, like "2027 competition robot".' })
  })

  it('adds a system, with its code in capitals', async () => {
    const robot = robotsTable.rows()[0]
    const added = await addSystem(robot.id, system)
    expect(added.ok && added.value).toMatchObject({ robot_id: robot.id, name: 'Shooter', code: 'SHO', onshape_url: null })
  })

  it("won't repeat a name or code in the same robot, and needs a 2 to 4 letter code and an https link", () => {
    const others = systemsTable.rows()
    expect(checkSystem({ ...system, name: 'intake' }, others)).toBe("There's already a system called intake.")
    expect(checkSystem({ ...system, code: 'INT' }, others)).toBe('INT is already another system\'s code. Pick another.')
    expect(checkSystem({ ...system, code: 'S' }, others)).toMatch(/2 to 4 letters/)
    expect(checkSystem({ ...system, code: 'SH0' }, others)).toMatch(/2 to 4 letters/)
    expect(checkSystem({ ...system, onshape_url: 'cad.onshape.com/documents/1' }, others)).toMatch(/https:/)
    expect(checkSystem(system, others)).toBeNull()
  })

  it('changes a system, keeping its own name and code allowed', async () => {
    const intake = systemsTable.rows().find((s) => s.code === 'INT')!
    const result = await changeSystem(intake, { name: 'Intake', code: 'INT', onshape_url: 'https://cad.onshape.com/documents/1' })
    expect(result.ok && result.value.onshape_url).toBe('https://cad.onshape.com/documents/1')
  })

  it('only lets a mentor delete a system, which deletes its parts too', async () => {
    const intake = systemsTable.rows().find((s) => s.code === 'INT')!
    expect((await removeSystem(intake)).ok).toBe(false)
    setDemoRole('mentor')
    expect((await removeSystem(intake)).ok).toBe(true)
    expect(systemsTable.rows().some((s) => s.id === intake.id)).toBe(false)
    expect(parts().some((p) => p.system_id === intake.id)).toBe(false)
    expect(parts()).toHaveLength(6)
  })
})
