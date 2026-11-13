// Tests for importing from Onshape: planOnshapeImport() in onshape.ts, and
// getOnshapeBom() and applyOnshapeImport() in data.ts, in demo mode.
// Importing is for student leaders, mentors and admins.
import { beforeEach, describe, expect, it } from 'vitest'
import { setDemoRole } from '../../core/demo'
import { applyOnshapeImport, getOnshapeBom, isOnshapeLink, partsTable, systemsTable, type BomSystem, type Part } from './data'
import { planOnshapeImport, type OnshapeBom, type OnshapeLine } from './onshape'

beforeEach(() => {
  setDemoRole('leader')
  partsTable.reset()
  systemsTable.reset()
})

const system: BomSystem = {
  id: 'sys', robot_id: 'robot', name: 'Shooter', code: 'SHO', onshape_url: null, onshape_imported_at: null, created_at: '', created_by: null,
}
let n = 0
const part = (more: Partial<Part>): Part => ({
  id: `p${++n}`, system_id: 'sys', part_number: `4096-26-SHO-00${n}`, name: 'Part', revision: null, kind: 'made', material: 'Aluminum', quantity: 1,
  vendor: null, vendor_part_number: null, product_url: null, onshape_url: null, onshape_id: null, removed_in_onshape: false, created_at: '', created_by: null, ...more,
})
const line = (more: Partial<OnshapeLine>): OnshapeLine => ({
  onshape_id: 'doc/tab/JHD', name: 'Flywheel plate', part_number: null, revision: null, quantity: 1, material: null, vendor: null, standard: false, url: 'https://cad.onshape.com/x', ...more,
})
const bom = (...lines: OnshapeLine[]): OnshapeBom => ({ name: 'Shooter assembly', kind: 'assembly', lines })

describe('planOnshapeImport', () => {
  it('adds new parts, giving made parts without a number the next team number', () => {
    const existing = [part({ part_number: '4096-26-SHO-004' })]
    const plan = planOnshapeImport(system, bom(line({ material: 'Aluminum - 6061' })), existing)
    expect(plan.add).toEqual([
      expect.objectContaining({ part_number: '4096-26-SHO-005', name: 'Flywheel plate', kind: 'made', material: 'Aluminum - 6061', onshape_id: 'doc/tab/JHD', removed_in_onshape: false }),
    ])
  })

  it("uses a made part's Onshape part number, unless another part already has it", () => {
    const other = part({ system_id: 'elsewhere', part_number: '4096-26-SHO-010' })
    const plan = planOnshapeImport(system, bom(line({ part_number: '4096-26-SHO-020' }), line({ onshape_id: 'doc/tab/JID', part_number: '4096-26-SHO-010' })), [other])
    expect(plan.add.map((p) => p.part_number)).toEqual(['4096-26-SHO-020', '4096-26-SHO-021'])
  })

  it("makes a new part with a vendor's part number COTS, from its number or its name", () => {
    const plan = planOnshapeImport(system, bom(
      line({ part_number: 'rev-21-1650', name: 'Motor' }),
      line({ onshape_id: 'x/y/z', name: 'am-1234 Wheel hub' }),
      line({ onshape_id: 'x/y/w', part_number: 'WCP-0271', name: 'Bearing', vendor: 'WestCoast' }),
    ), [])
    expect(plan.add[0]).toMatchObject({ kind: 'cots', vendor: 'REV Robotics', vendor_part_number: 'REV-21-1650', material: null, part_number: '4096-26-SHO-001' })
    expect(plan.add[1]).toMatchObject({ kind: 'cots', vendor: 'Andy Mark', vendor_part_number: 'am-1234', part_number: '4096-26-SHO-002' })
    // The vendor typed into Onshape wins over the guess.
    expect(plan.add[2]).toMatchObject({ kind: 'cots', vendor: 'WestCoast', vendor_part_number: 'WCP-0271' })
  })

  it("keeps a part already in the app as it is, so a wrong guess changed by hand sticks", () => {
    const made = part({ onshape_id: 'doc/tab/JHD', name: 'Spacer for am-1234', kind: 'made', material: 'Nylon' })
    const plan = planOnshapeImport(system, bom(line({ name: 'Spacer for am-1234' })), [made])
    expect(plan.add).toEqual([])
    expect(plan.change.some((c) => 'kind' in c.changes)).toBe(false)
  })

  it('keeps a part changed to COTS by hand COTS, with the vendor details and product page we typed', () => {
    // A belt drawn with a belt generator: Custom in CAD, but we buy it.
    const belt = part({
      onshape_id: 'doc/tab/JBELT', name: 'HTD 5mm 120T 9mm belt', kind: 'cots', material: null,
      vendor: 'WCP', vendor_part_number: 'EXAMPLE-BELT-120', product_url: 'https://example.com/belt',
    })
    const fromCad = line({ onshape_id: 'doc/tab/JBELT', name: 'HTD 5mm 120T 9mm belt', part_number: '4096-26-SHO-009', material: 'Rubber', vendor: 'Another vendor' })
    const plan = planOnshapeImport(system, bom(fromCad), [belt])
    const changes = plan.change[0]?.changes ?? {}
    for (const kept of ['kind', 'material', 'vendor', 'vendor_part_number', 'product_url']) expect(changes, kept).not.toHaveProperty(kept)
  })

  it("makes standard content and parts with a vendor COTS, with Onshape's number as the vendor's", () => {
    const plan = planOnshapeImport(system, bom(line({ standard: true, part_number: '91251A340', name: 'Screw', quantity: 24 }), line({ onshape_id: 'x/y/z', vendor: 'WCP', part_number: 'WCP-0271' })), [])
    expect(plan.add[0]).toMatchObject({ kind: 'cots', vendor: null, vendor_part_number: '91251A340', quantity: 24, material: null, part_number: '4096-26-SHO-001' })
    expect(plan.add[1]).toMatchObject({ kind: 'cots', vendor: 'WCP', vendor_part_number: 'WCP-0271', part_number: '4096-26-SHO-002' })
  })

  it("matches parts by their Onshape identity, so a rename keeps the part and its number", () => {
    const plate = part({ onshape_id: 'doc/tab/JHD', name: 'Plate', quantity: 2 })
    const plan = planOnshapeImport(system, bom(line({ name: 'Flywheel plate', quantity: 3, material: 'Aluminum' })), [plate])
    expect(plan.add).toEqual([])
    expect(plan.change).toEqual([
      { part: plate, changes: expect.objectContaining({ name: 'Flywheel plate', quantity: 3 }), what: ['renamed from Plate', 'quantity 2 → 3'] },
    ])
    expect(plan.change[0].changes).not.toHaveProperty('part_number')
  })

  it("keeps what's already here where Onshape has nothing", () => {
    const motor = part({ onshape_id: 'doc/tab/JHD', name: 'Motor', kind: 'cots', material: null, vendor: 'REV Robotics', vendor_part_number: 'REV-21-1650' })
    const plan = planOnshapeImport(system, bom(line({ name: 'Motor', onshape_url: undefined } as Partial<OnshapeLine>)), [{ ...motor, onshape_url: 'https://cad.onshape.com/x' }])
    expect(plan.unchanged).toBe(1)
    expect(plan.change).toEqual([])
  })

  it('links a part typed in by hand when Onshape has its part number', () => {
    const typed = part({ part_number: '4096-26-SHO-001', name: 'Hood' })
    const plan = planOnshapeImport(system, bom(line({ part_number: '4096-26-SHO-001', name: 'Hood' })), [typed])
    expect(plan.add).toEqual([])
    expect(plan.change[0]).toMatchObject({ part: typed, changes: { onshape_id: 'doc/tab/JHD', onshape_url: 'https://cad.onshape.com/x' }, what: ['linked to Onshape'] })
  })

  it('marks parts gone from Onshape as removed, leaves parts typed in alone, and unmarks parts that come back', () => {
    const gone = part({ onshape_id: 'doc/tab/GONE' })
    const typed = part({})
    const back = part({ onshape_id: 'doc/tab/JHD', name: 'Flywheel plate', removed_in_onshape: true, onshape_url: 'https://cad.onshape.com/x' })
    const plan = planOnshapeImport(system, bom(line({})), [gone, typed, back])
    expect(plan.removed).toEqual([gone])
    expect(plan.change).toEqual([{ part: back, changes: { removed_in_onshape: false }, what: ['back in Onshape'] }])
  })

  it('only looks at parts in this system', () => {
    const elsewhere = part({ system_id: 'other', onshape_id: 'doc/tab/JHD' })
    const plan = planOnshapeImport(system, bom(line({})), [elsewhere])
    expect(plan.add).toHaveLength(1)
    expect(plan.removed).toEqual([])
  })

  it("trims text to the database's limits", () => {
    const plan = planOnshapeImport(system, bom(line({ name: 'x'.repeat(150), revision: 'REV-12345678', material: 'm'.repeat(120) })), [])
    expect(plan.add[0].name).toHaveLength(100)
    expect(plan.add[0].revision).toHaveLength(10)
    expect(plan.add[0].material).toHaveLength(100)
  })
})

describe('importing the example Intake', () => {
  const intake = () => systemsTable.rows().find((s) => s.code === 'INT')!
  const intakeParts = () => partsTable.rows().filter((p) => p.system_id === intake().id)

  it('shows what would change, then makes the changes', async () => {
    const answer = await getOnshapeBom(intake())
    if (!answer.ok) throw new Error(answer.error)
    const plan = planOnshapeImport(intake(), answer.value, partsTable.rows())
    expect(plan.add.map((p) => p.name)).toEqual(['Intake roller', 'Socket head cap screw #10-32 x 0.5'])
    expect(plan.change.map((c) => [c.part.name, c.what])).toEqual([['Intake side plate', ['quantity 2 → 3']]])
    expect(plan.removed.map((p) => p.name)).toEqual(['Pivot spacer'])

    expect(await applyOnshapeImport(intake(), plan)).toEqual({ ok: true, value: 'Imported Intake: 2 added, 1 changed, 1 marked removed in Onshape.' })
    expect(intakeParts()).toHaveLength(8)
    expect(intakeParts().find((p) => p.name === 'Pivot spacer')?.removed_in_onshape).toBe(true)
    expect(intakeParts().find((p) => p.name === 'Intake roller')?.part_number).toBe('4096-26-INT-007')

    // Importing again changes nothing.
    const again = planOnshapeImport(intake(), answer.value, partsTable.rows())
    expect([again.add.length, again.change.length, again.removed.length]).toEqual([0, 0, 0])
  })

  it("doesn't let a student import, and says who can", async () => {
    const answer = await getOnshapeBom(intake())
    if (!answer.ok) throw new Error(answer.error)
    const plan = planOnshapeImport(intake(), answer.value, partsTable.rows())
    setDemoRole('student')
    const leadersOnly = { ok: false, error: 'Only student leaders and mentors can import from Onshape. Ask one of them.' }
    expect(await getOnshapeBom(intake())).toEqual(leadersOnly)
    expect(await applyOnshapeImport(intake(), plan)).toEqual(leadersOnly)
    expect(intakeParts()).toHaveLength(6)
  })

  it('needs an Onshape link first', async () => {
    const drivetrain = systemsTable.rows().find((s) => s.code === 'DRV')!
    expect(await getOnshapeBom(drivetrain)).toMatchObject({ ok: false, error: expect.stringMatching(/Onshape link first/) })
  })
})

describe('isOnshapeLink', () => {
  const link = 'https://cad.onshape.com/documents/0123456789abcdef01234567/w/0123456789abcdef01234567/e/0123456789abcdef01234567'
  it('accepts a link to a tab, and nothing else', () => {
    expect(isOnshapeLink(link)).toBe(true)
    expect(isOnshapeLink(`${link}?renderMode=0`)).toBe(true)
    expect(isOnshapeLink('https://cad.onshape.com/documents/0123456789abcdef01234567')).toBe(false)
    expect(isOnshapeLink('https://example.com/documents/a/w/b/e/c')).toBe(false)
  })
})
