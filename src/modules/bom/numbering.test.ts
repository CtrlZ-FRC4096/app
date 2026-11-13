// Tests for team part numbers (#21): making them (numbering.ts), giving
// parts without one a number, and writing them into Onshape (data.ts), in
// demo mode. That nobody can lower a series' counter is the database's job:
// it's tested in supabase/tests/bom.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import { setDemoRole } from '../../core/demo'
import {
  addPart, countersTable, numberParts, numbersWrittenText, partsTable, partsWithoutTeamNumber, removePart, systemsTable, writePartNumbersToOnshape,
  type BomSystem, type NewPart, type Part,
} from './data'
import { isTeamNumber, nextPartNumber, readTeamNumber } from './numbering'
import { planOnshapeImport } from './onshape'

beforeEach(() => {
  setDemoRole('leader')
  partsTable.reset()
  systemsTable.reset()
  countersTable.reset()
})

const intake = () => systemsTable.rows().find((s) => s.code === 'INT')!
const intakeParts = () => partsTable.rows().filter((p) => p.system_id === intake().id)
const numbers = (...list: string[]) => list.map((part_number) => ({ part_number }))

describe('readTeamNumber and isTeamNumber', () => {
  it('read our numbers, like 4096-26-INT-014, and nothing else', () => {
    const cases: [string, { series: string; number: number } | null][] = [
      ['4096-26-INT-014', { series: '4096-26-INT', number: 14 }],
      [' 4096-27-DRV-1200 ', { series: '4096-27-DRV', number: 1200 }],
      ['BRKT-1', null], // typed into Onshape
      ['WCP-0271', null], // a vendor's
      ['4096-26-int-014', null], // codes are capitals
      ['4096-26-INT-014-A', null],
      ['1234-26-INT-014', null], // another team's
    ]
    for (const [text, expected] of cases) {
      expect(readTeamNumber(text), text).toEqual(expected)
      expect(isTeamNumber(text), text).toBe(expected !== null)
    }
  })
})

describe('nextPartNumber', () => {
  it('starts at 001, goes past gaps instead of filling them, and never reuses a number a deleted part had', () => {
    const counter = (last_number: number) => [{ series: '4096-26-INT', last_number }]
    const cases: [string, { part_number: string }[], { series: string; last_number: number }[], string][] = [
      ['the first part', [], [], '4096-26-INT-001'],
      ['one more than the highest', numbers('4096-26-INT-001', '4096-26-INT-002'), counter(2), '4096-26-INT-003'],
      ['after a gap', numbers('4096-26-INT-001', '4096-26-INT-010'), counter(10), '4096-26-INT-011'],
      ['after the highest was deleted', numbers('4096-26-INT-001'), counter(9), '4096-26-INT-010'],
      ['a part added before its counter arrived', numbers('4096-26-INT-012'), counter(9), '4096-26-INT-013'],
      [
        'only counting its own series',
        numbers('4096-26-SHO-050', '4096-25-INT-099', 'BRKT-1', 'WCP-0271'),
        [{ series: '4096-26-SHO', last_number: 80 }],
        '4096-26-INT-001',
      ],
    ]
    for (const [what, parts, counters, expected] of cases) expect(nextPartNumber({ code: 'INT' }, parts, counters), what).toBe(expected)
  })

  it("doesn't give a deleted part's number to the next part, whether it's added by hand or imported", async () => {
    const part: NewPart = {
      system_id: intake().id, part_number: '4096-26-INT-007', name: 'Roller bracket', revision: 'A', kind: 'made', material: 'Aluminum', quantity: 1,
      vendor: '', vendor_part_number: '', product_url: '',
    }
    const added = await addPart(part)
    if (!added.ok) throw new Error(added.error)
    expect(await removePart(added.value)).toEqual({ ok: true, value: null })

    expect(nextPartNumber(intake(), partsTable.rows(), countersTable.rows())).toBe('4096-26-INT-008')
    const roller = { onshape_id: 'doc/tab/NEW', name: 'Intake roller', part_number: null, revision: null, quantity: 1, material: null, vendor: null, standard: false, url: 'https://cad.onshape.com/x' }
    const plan = planOnshapeImport(intake(), { name: 'Intake assembly', kind: 'assembly', lines: [roller] }, partsTable.rows(), countersTable.rows())
    expect(plan.add.map((p) => p.part_number)).toEqual(['4096-26-INT-008'])
  })
})

describe('numberParts', () => {
  it('gives each custom part without a team number the next one, and leaves COTS and removed parts alone', async () => {
    const [plate, shaft, spacer, motor] = intakeParts()
    await partsTable.update(plate.id, { part_number: 'BRKT-1' })
    await partsTable.update(shaft.id, { part_number: 'SHAFT-2' })
    await partsTable.update(spacer.id, { part_number: 'SP-3', removed_in_onshape: true })
    await partsTable.update(motor.id, { part_number: 'NEO' }) // COTS
    expect(partsWithoutTeamNumber(intakeParts()).map((p) => p.name)).toEqual(['Intake side plate', 'Roller shaft'])

    expect(await numberParts(intake())).toEqual({ ok: true, value: 'Gave 2 parts in Intake team numbers: 4096-26-INT-007 to 4096-26-INT-008.' })
    const numberOf = (part: Part) => partsTable.rows().find((p) => p.id === part.id)?.part_number
    expect([plate, shaft, spacer, motor].map(numberOf)).toEqual(['4096-26-INT-007', '4096-26-INT-008', 'SP-3', 'NEO'])
    expect(await numberParts(intake())).toEqual({ ok: true, value: expect.stringMatching(/already has a team number/) })
  })
})

describe('writePartNumbersToOnshape', () => {
  it("sends the custom parts from Onshape, and needs a workspace link, not a version", async () => {
    // Demo mode pretends Onshape took them all: the example Intake's 3 custom parts.
    expect(await writePartNumbersToOnshape(intake())).toEqual({ ok: true, value: 'Wrote 3 part numbers into Onshape.' })

    const refused: [Partial<BomSystem>, RegExp][] = [
      [{ onshape_url: intake().onshape_url!.replace('/w/', '/v/') }, /link is to a version/],
      [{ onshape_url: null }, /Onshape link first/],
    ]
    for (const [changes, error] of refused) {
      expect(await writePartNumbersToOnshape({ ...intake(), ...changes }), JSON.stringify(changes)).toEqual({ ok: false, error: expect.stringMatching(error) })
    }
    const drivetrain = systemsTable.rows().find((s) => s.code === 'DRV')!
    expect(await writePartNumbersToOnshape({ ...drivetrain, onshape_url: intake().onshape_url })).toEqual({ ok: false, error: expect.stringMatching(/Import from Onshape first/) })
  })

  it('says how many were written, how many already matched, and which were skipped and why', () => {
    const [plate] = intakeParts()
    expect(numbersWrittenText({ written: 1, unchanged: 0, skipped: [] }, intakeParts())).toBe('Wrote 1 part number into Onshape.')
    expect(numbersWrittenText({ written: 4, unchanged: 2, skipped: [{ onshape_id: plate.onshape_id!, reason: "it's from another Onshape document, so number it there" }] }, intakeParts()))
      .toBe("Wrote 4 part numbers into Onshape. 2 already matched. Skipped Intake side plate: it's from another Onshape document, so number it there.")
  })
})
