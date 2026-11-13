// Tests for data.ts. Run them with `npm test`.
// Who is allowed to do what is the database's job: that's tested in
// supabase/tests/bom.test.ts and bom-steps.test.ts. The checks here only
// explain it first. Tests run as a student unless they say otherwise.
import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import { membersTable } from '../../core/members'
import {
  addPart, addRobot, addSystem, bomSummary, canEditRobotsAndParts, changePart, changeSystem, checkPart, checkSystem, countParts, filterParts, kindChangeWarning, kindLabel,
  nextPartNumber, partCountText, partsTable, identifyCots, removePart, removeSystem, renameRobot, robotsTable, shelfItem, shelfText, shortageFor, shortages, systemsTable, toOrder, toOrderCsv, NO_VENDOR,
  type NewPart, type Part,
} from './data'
import { itemsTable, type Item } from '../inventory/data'
import { STATUSES, itemsTable as purchaseTable, type PurchaseItem, type StatusKey } from '../purchasing/data'
import {
  addStep, advance, changeDone, checkStep, moveBack, removeStep, stationName, stationQueue, stepName, stepsFor, stepsTable, type Step,
} from './data'
import { assignStep, checkAssignment, dueText, isOverdue, today } from './data'
import { partFileName, partFiles } from './data'

beforeEach(() => {
  setDemoRole('student')
  partsTable.reset()
  systemsTable.reset()
  robotsTable.reset()
  stepsTable.reset()
  membersTable.reset()
})

const parts = () => partsTable.rows()

describe('the example data', () => {
  it("has made parts with a material, COTS parts with a vendor, and each part's system code in its part number", () => {
    const codes = new Map(systemsTable.rows().map((s) => [s.id, s.code]))
    for (const part of parts()) {
      if (part.kind === 'made') expect(part.material, part.part_number).toBeTruthy()
      else expect(part.vendor, part.part_number).toBeTruthy()
      expect(part.part_number).toMatch(new RegExp(`^4096-26-${codes.get(part.system_id)}-\\d{3}$`))
    }
  })
})

describe('filterParts and kindLabel', () => {
  it('keep only custom parts for Custom, only COTS parts for COTS, and every part for All, labelled the same way', () => {
    expect(filterParts(parts(), 'Custom').every((p) => p.kind === 'made')).toBe(true)
    expect(filterParts(parts(), 'COTS').every((p) => p.kind === 'cots')).toBe(true)
    expect(filterParts(parts(), 'Custom').length + filterParts(parts(), 'COTS').length).toBe(parts().length)
    expect(filterParts(parts(), 'All')).toEqual(parts())
    expect([kindLabel('made'), kindLabel('cots')]).toEqual(['Custom', 'COTS'])
  })
})

describe('countParts and partCountText', () => {
  it('count each part once, whatever its quantity, and read like "5 custom, 7 COTS"', () => {
    const [madePart] = filterParts(parts(), 'Custom')
    const [cotsPart] = filterParts(parts(), 'COTS')
    expect(countParts([madePart, cotsPart, { ...cotsPart, quantity: 100 } as Part])).toEqual({ made: 1, cots: 2 })
    expect(partCountText(parts())).toBe('5 custom, 7 COTS')
    expect(partCountText([])).toBe('0 custom, 0 COTS')
  })
})

describe('bomSummary', () => {
  it('counts systems and parts, or says there are no systems yet', () => {
    expect(bomSummary(systemsTable.rows(), parts())).toEqual({ tone: 'info', text: '2 systems · 12 parts' })
    expect(bomSummary(systemsTable.rows().slice(0, 1), parts().slice(0, 1)).text).toBe('1 system · 1 part')
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
  product_url: '',
  ...changes,
})

describe('nextPartNumber', () => {
  it('is one more than the highest number in the system, starting at 001, and skips past gaps instead of filling them', () => {
    const [first] = parts()
    expect(nextPartNumber(intake(), parts())).toBe('4096-26-INT-007')
    expect(nextPartNumber({ ...intake(), code: 'SHO' }, parts())).toBe('4096-26-SHO-001')
    expect(nextPartNumber(intake(), [first, { ...first, part_number: '4096-26-INT-010' }])).toBe('4096-26-INT-011')
  })
})

describe('checkPart', () => {
  it('allows a complete made part, and a COTS part with a vendor but no material', () => {
    expect(checkPart(newMadePart(), parts())).toBeNull()
    expect(checkPart(newMadePart({ kind: 'cots', material: '', vendor: 'WCP' }), parts())).toBeNull()
  })

  it('refuses a part that breaks a rule, and says which', () => {
    const refused: [Partial<NewPart>, RegExp][] = [
      [{ part_number: ' 4096-26-INT-001 ' }, /4096-26-INT-001 is already used/],
      [{ part_number: '  ' }, /part number/],
      [{ name: '' }, /name/],
      [{ material: ' ' }, /material/], // made parts need a material
      [{ kind: 'cots', vendor: '' }, /vendor/], // COTS parts need a vendor
      [{ quantity: 0 }, /quantity/], // a whole number, 1 or more
      [{ quantity: 1.5 }, /quantity/],
      [{ revision: 'x'.repeat(11) }, /revision under 10 characters\. This one is 11/], // longer than the database allows
      [{ kind: 'cots', vendor: 'WCP', product_url: 'wcproducts.com/belt' }, /https:\/\//], // only whole https:// links
      [{ kind: 'cots', vendor: 'WCP', product_url: 'javascript:alert(1)' }, /https:\/\//],
    ]
    for (const [changes, error] of refused) expect(checkPart(newMadePart(changes), parts()), JSON.stringify(changes)).toMatch(error)
  })
})

describe('who can change robots and parts', () => {
  it('is student leaders, mentors and admins, not students', () => {
    expect((['student', 'leader', 'mentor', 'admin'] as const).map((role) => canEditRobotsAndParts(role))).toEqual([false, true, true, true])
  })

  it('tells a student who can, and changes nothing', async () => {
    const plate = parts().find((p) => p.part_number === '4096-26-INT-001')!
    const [robot] = robotsTable.rows()
    const robotsBefore = robotsTable.rows()
    const tries: [string, () => Promise<unknown>][] = [
      ['add parts', () => addPart(newMadePart())],
      ['change parts', () => changePart(plate, newMadePart({ part_number: '4096-26-INT-001', quantity: 9 }))],
      ['delete parts', () => removePart(plate)],
      ['add robots', () => addRobot('2027 competition robot')],
      ['rename robots', () => renameRobot(robot, 'Renamed')],
      ['delete a system', () => removeSystem(intake())],
    ]
    for (const [doing, attempt] of tries) {
      expect(await attempt(), doing).toEqual({ ok: false, error: expect.stringContaining(`Only student leaders and mentors can ${doing}`) })
    }
    expect(parts()).toContainEqual(plate)
    expect(parts()).toHaveLength(12)
    expect(robotsTable.rows()).toEqual(robotsBefore)
    expect(systemsTable.rows()).toHaveLength(2)
  })
})

describe('addPart', () => {
  beforeEach(() => setDemoRole('leader'))

  it('adds a made part, trimmed, without vendor details', async () => {
    const result = await addPart(newMadePart({ name: '  Roller bracket ', vendor: 'Left over' }))
    expect(result.ok).toBe(true)
    expect(parts().find((p) => p.part_number === '4096-26-INT-007')).toMatchObject({
      name: 'Roller bracket', kind: 'made', material: '6061 aluminum, 1/8 in plate', vendor: null, vendor_part_number: null,
    })
    expect(parts()).toHaveLength(13)
  })

  it('adds a COTS part without a material, and with no revision if left empty', async () => {
    await addPart(newMadePart({ kind: 'cots', revision: '', material: 'Left over', vendor: 'WCP', vendor_part_number: 'EXAMPLE-COL-12', product_url: ' https://example.com/col ' }))
    expect(parts().find((p) => p.part_number === '4096-26-INT-007')).toMatchObject({
      kind: 'cots', revision: null, material: null, vendor: 'WCP', vendor_part_number: 'EXAMPLE-COL-12', product_url: 'https://example.com/col',
    })
  })

  it("doesn't add a part that breaks the rules, and says why", async () => {
    expect(await addPart(newMadePart({ material: '' }))).toEqual({ ok: false, error: 'Add the material, like "6061 aluminum, 1/4 in plate".' })
    expect(parts()).toHaveLength(12)
  })
})

describe('changePart and removePart', () => {
  const plate = () => parts().find((p) => p.part_number === '4096-26-INT-001')!
  beforeEach(() => setDemoRole('leader'))

  it("changes a part, keeping its own part number allowed but not another part's", async () => {
    expect(await changePart(plate(), newMadePart({ part_number: '4096-26-INT-002' }))).toMatchObject({ ok: false, error: /INT-002 is already used/ })
    const result = await changePart(plate(), newMadePart({ part_number: '4096-26-INT-001', name: 'Intake side plate', revision: 'C', quantity: 4 }))
    expect(result.ok).toBe(true)
    expect(plate()).toMatchObject({ revision: 'C', quantity: 4, material: '6061 aluminum, 1/8 in plate' })
  })

  it('clears the material and removes the stages when a part is changed to COTS, and starts with none when changed back', async () => {
    const others = stepsTable.rows().filter((s) => s.part_id !== plate().id)
    expect(stepsFor(plate(), stepsTable.rows()).length).toBeGreaterThan(0)
    const toCots = newMadePart({ part_number: '4096-26-INT-001', kind: 'cots', vendor: 'WCP', vendor_part_number: 'EXAMPLE-BELT-120', product_url: 'https://example.com/belt' })
    expect((await changePart(plate(), toCots)).ok).toBe(true)
    expect(plate()).toMatchObject({ kind: 'cots', material: null, vendor: 'WCP', vendor_part_number: 'EXAMPLE-BELT-120', product_url: 'https://example.com/belt' })
    expect(stepsFor(plate(), stepsTable.rows())).toEqual([])
    expect(stepsTable.rows()).toEqual(others)

    expect((await changePart(plate(), newMadePart({ part_number: '4096-26-INT-001' }))).ok).toBe(true)
    expect(plate()).toMatchObject({ kind: 'made', vendor: null, vendor_part_number: null, product_url: null })
    expect(stepsFor(plate(), stepsTable.rows())).toEqual([])
  })

  it('says what changing a Custom part to COTS will do, before saving', () => {
    const steps = stepsTable.rows()
    const withStages = plate()
    const done = stepsFor(withStages, steps).filter((s) => s.status === 'done').length
    const motor = parts().find((p) => p.kind === 'cots')!
    const noStages = { ...withStages, id: 'no-stages' }
    const cases: [Part, 'made' | 'cots', number, RegExp | null][] = [
      [withStages, 'cots', 0, new RegExp(`has \\d+ stages \\(${done} done\\)\\. Changing it to COTS removes them\\.$`)],
      [withStages, 'cots', 2, /removes them\. 2 are on the CNC board/],
      [noStages, 'cots', 1, /^1 is on the CNC board/],
      [noStages, 'cots', 0, null], // nothing to lose
      [withStages, 'made', 0, null], // not changing kind
      [motor, 'made', 0, null], // COTS to Custom loses nothing
    ]
    for (const [part, kind, onBoard, expected] of cases) {
      const warning = kindChangeWarning(part, kind, steps, onBoard)
      if (expected) expect(warning, part.name).toMatch(expected)
      else expect(warning, part.name).toBeNull()
    }
  })

  it('deletes a part', async () => {
    expect((await removePart(plate())).ok).toBe(true)
    expect(parts().some((p) => p.part_number === '4096-26-INT-001')).toBe(false)
  })
})

describe('robots and systems', () => {
  const system = { name: 'Shooter', code: ' sho ', onshape_url: '' }

  it('lets a student leader add and rename a robot', async () => {
    setDemoRole('leader')
    const added = await addRobot('  2027 competition robot ')
    if (!added.ok) throw new Error(added.error)
    expect(added.value.name).toBe('2027 competition robot')
    expect((await renameRobot(added.value, '2027 robot')).ok).toBe(true)
    expect(robotsTable.rows().map((r) => r.name)).toContain('2027 robot')
    expect(await addRobot(' ')).toMatchObject({ ok: false, error: /Name the robot/ })
  })

  it('lets a student add a system, with its code in capitals, and change it, keeping its own name and code allowed', async () => {
    const robot = robotsTable.rows()[0]
    const added = await addSystem(robot.id, system)
    if (!added.ok) throw new Error(added.error)
    expect(added.value).toMatchObject({ robot_id: robot.id, name: 'Shooter', code: 'SHO', onshape_url: null })
    const link = 'https://cad.onshape.com/documents/0123456789abcdef01234567/w/0123456789abcdef01234567/e/0123456789abcdef01234567'
    const changed = await changeSystem(added.value, { name: 'Shooter', code: 'SHO', onshape_url: link })
    expect(changed.ok && changed.value.onshape_url).toBe(link)
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

  it('lets a student leader delete a system, which deletes its parts too', async () => {
    const intake = systemsTable.rows().find((s) => s.code === 'INT')!
    setDemoRole('leader')
    expect((await removeSystem(intake)).ok).toBe(true)
    expect(systemsTable.rows().some((s) => s.id === intake.id)).toBe(false)
    expect(parts().some((p) => p.system_id === intake.id)).toBe(false)
    expect(parts()).toHaveLength(6)
  })
})

// ---------------------------------------------------------------------------
// Stages

const part = (name: string) => parts().find((p) => p.name === name)!
const stepsOf = (name: string) => stepsFor(part(name), stepsTable.rows())
const stage = (name: string, which: Step['stage']) => stepsOf(name).find((s) => s.stage === which)!

describe('stepsFor and stepName', () => {
  it("give a part's stages in order, only the ones it has, with process stages named by their machine", () => {
    expect(stepsOf('Roller shaft').map((s) => s.stage)).toEqual(['design', 'pre', 'process1'])
    expect(stepsOf('Frame rail').map((s) => s.stage)).toEqual(['design', 'pre', 'process1', 'process2', 'post'])
    expect(stepsOf('Brushless motor')).toEqual([])
    expect(stepName(stage('Roller shaft', 'process1'))).toBe('Lathe')
    expect(stepName(stage('Roller shaft', 'pre'))).toBe('Pre-process')
  })
})

describe('changeDone', () => {
  it('counts one more or one fewer through a stage', async () => {
    const routing = stage('Intake side plate', 'process1')
    expect(routing.quantity_done).toBe(1)
    expect((await changeDone(routing, 1)).ok).toBe(true)
    expect(stage('Intake side plate', 'process1').quantity_done).toBe(2)
    expect((await changeDone(stage('Intake side plate', 'process1'), -1)).ok).toBe(true)
    expect(stage('Intake side plate', 'process1').quantity_done).toBe(1)
  })

  it("won't go above the part's quantity or below 0, and says why", async () => {
    // The side plate's quantity is 2, and both are designed.
    expect(await changeDone(stage('Intake side plate', 'design'), 1)).toMatchObject({ ok: false, error: /All 2 are already through Design/ })
    expect(stage('Intake side plate', 'design').quantity_done).toBe(2)
    expect(await changeDone(stage('Intake side plate', 'post'), -1)).toMatchObject({ ok: false, error: /None are through Post-process/ })
  })
})

describe('advance and moveBack', () => {
  it('go to do → in progress → done, and back', async () => {
    const id = stage('Intake side plate', 'post').id
    const now = () => stepsTable.rows().find((s) => s.id === id)!
    expect(now().status).toBe('todo')
    await advance(now())
    expect(now().status).toBe('in_progress')
    await advance(now())
    expect(now().status).toBe('done')
    expect(await advance(now())).toEqual({ ok: false, error: 'Post-process is already done.' })
    await moveBack(now())
    expect(now().status).toBe('in_progress')
    await moveBack(now())
    expect(await moveBack(now())).toEqual({ ok: false, error: "Post-process hasn't started yet." })
  })
})

describe('checkStep', () => {
  it('needs a made part, a stage it doesn\'t have yet, and a machine for process stages', () => {
    expect(checkStep(part('Brushless motor'), 'design', null, [])).toMatch(/Only custom parts/)
    expect(checkStep(part('Roller shaft'), 'pre', null, stepsOf('Roller shaft'))).toBe('Roller shaft already has Pre-process.')
    expect(checkStep(part('Roller shaft'), 'process2', null, stepsOf('Roller shaft'))).toBe('Pick the machine for Process 2.')
    expect(checkStep(part('Roller shaft'), 'process2', 'mill', stepsOf('Roller shaft'))).toBeNull()
    expect(checkStep(part('Roller shaft'), 'post', null, stepsOf('Roller shaft'))).toBeNull()
  })
})

// These run as a student, like the rest of the file: everyone can work on stages.
describe('addStep and removeStep', () => {
  it("won't add a stage checkStep refuses, and says why", async () => {
    expect(await addStep(part('Roller shaft'), 'process2', null)).toEqual({ ok: false, error: 'Pick the machine for Process 2.' })
  })

  it('add a stage at to do, with none done and nobody assigned, in its place in the order', async () => {
    expect((await addStep(part('Roller shaft'), 'post', null)).ok).toBe(true)
    expect(stage('Roller shaft', 'post')).toMatchObject({ status: 'todo', quantity_done: 0, machine: null, assigned_to: null, due_date: null })
    expect((await addStep(part('Roller shaft'), 'process2', 'mill')).ok).toBe(true)
    expect(stepsOf('Roller shaft').map((s) => s.stage)).toEqual(['design', 'pre', 'process1', 'process2', 'post'])
  })

  it('keep a machine off stages that are not process stages', async () => {
    await addStep(part('Roller shaft'), 'post', 'lathe')
    expect(stage('Roller shaft', 'post').machine).toBeNull()
  })

  it('remove a stage', async () => {
    expect((await removeStep(stage('Roller shaft', 'pre'))).ok).toBe(true)
    expect(stepsOf('Roller shaft').map((s) => s.stage)).toEqual(['design', 'process1'])
  })
})

describe('the example stages', () => {
  it('are only assigned to people on the team whose access is on', () => {
    const active = new Set(membersTable.rows().filter((m) => m.active).map((m) => m.id))
    const assigned = stepsTable.rows().filter((s) => s.assigned_to)
    expect(assigned.length).toBeGreaterThan(0)
    for (const s of assigned) expect(active.has(s.assigned_to!), s.id).toBe(true)
  })
})

describe('checkAssignment', () => {
  const check = (assigned_to: string | null, due_date: string | null) => checkAssignment({ assigned_to, due_date }, membersTable.rows())

  it('allows a person, a due date, both or neither', () => {
    expect(check(DEMO_PEOPLE.alex, '2026-11-20')).toBeNull()
    expect(check(DEMO_PEOPLE.alex, null)).toBeNull()
    expect(check(null, '2026-11-20')).toBeNull()
    expect(check(null, null)).toBeNull()
  })

  it("refuses someone who isn't on the team or whose access is off, and a due date that isn't a real day", () => {
    expect(check('nobody', null)).toMatch(/isn't on the team/)
    expect(check(DEMO_PEOPLE.sam, null)).toMatch(/Sam Ortiz's access is switched off/)
    expect(check(null, 'next Friday')).toMatch(/Pick the due date from the calendar/)
    expect(check(null, '2026-02-30')).toMatch(/Pick the due date from the calendar/)
  })
})

describe('assignStep', () => {
  it('lets a student assign a stage with a due date, and clear both', async () => {
    const id = stage('Roller shaft', 'pre').id
    const now = () => stepsTable.rows().find((s) => s.id === id)!
    expect((await assignStep(now(), { assigned_to: DEMO_PEOPLE.jordan, due_date: '2026-11-20' })).ok).toBe(true)
    expect(now()).toMatchObject({ assigned_to: DEMO_PEOPLE.jordan, due_date: '2026-11-20' })
    expect((await assignStep(now(), { assigned_to: null, due_date: null })).ok).toBe(true)
    expect(now()).toMatchObject({ assigned_to: null, due_date: null })
  })

  it("won't save an assignment checkAssignment refuses, and says why", async () => {
    const before = stage('Roller shaft', 'pre')
    expect(await assignStep(before, { assigned_to: DEMO_PEOPLE.sam, due_date: null })).toMatchObject({ ok: false, error: /switched off/ })
    expect(stage('Roller shaft', 'pre')).toEqual(before)
  })
})

describe('isOverdue', () => {
  const due = (due_date: string | null, status: Step['status'] = 'todo'): Step => ({ ...stage('Intake side plate', 'post'), due_date, status })

  it('is late the day after its due date, not on the day, and never once done or with no due date', () => {
    expect(isOverdue(due('2026-11-20'), '2026-11-19')).toBe(false)
    expect(isOverdue(due('2026-11-20'), '2026-11-20')).toBe(false)
    expect(isOverdue(due('2026-11-20'), '2026-11-21')).toBe(true)
    expect(isOverdue(due('2026-11-20', 'done'), '2026-12-01')).toBe(false)
    expect(isOverdue(due(null), '2026-12-01')).toBe(false)
  })
})

describe('today and dueText', () => {
  it('write the day where the person is, and a due date like "Nov 20"', () => {
    expect(today(new Date(2026, 10, 9, 23, 30))).toBe('2026-11-09')
    expect(dueText('2026-11-20')).toBe('Nov 20')
  })
})

describe('stationQueue', () => {
  const names = (queue: ReturnType<typeof stationQueue>) => queue.map((q) => q.part.name)

  it('shows every made part, by part number, with all its stages, for Every stage', () => {
    const queue = stationQueue(parts(), stepsTable.rows(), { kind: 'all' })
    expect(names(queue)).toEqual(['Bellypan', 'Frame rail', 'Intake side plate', 'Roller shaft', 'Pivot spacer'])
    expect(queue.find((q) => q.part.name === 'Frame rail')!.steps).toHaveLength(5)
  })

  it("shows one machine's or one stage's queue: parts with a stage there that isn't done", () => {
    // The pivot spacer's print is done, so the 3D printer has nothing waiting.
    expect(names(stationQueue(parts(), stepsTable.rows(), { kind: 'machine', machine: '3d_printer' }))).toEqual([])
    const router = stationQueue(parts(), stepsTable.rows(), { kind: 'machine', machine: 'cnc_router' })
    expect(names(router)).toEqual(['Bellypan', 'Frame rail', 'Intake side plate'])
    expect(router.every((q) => q.steps.every((s) => s.machine === 'cnc_router'))).toBe(true)
    expect(names(stationQueue(parts(), stepsTable.rows(), { kind: 'stage', stage: 'post' }))).toEqual(['Frame rail', 'Intake side plate', 'Pivot spacer'])
  })

  it('names stations the way the filter shows them', () => {
    expect(stationName({ kind: 'machine', machine: '3d_printer' })).toBe('3D printer only')
    expect(stationName({ kind: 'stage', stage: 'post' })).toBe('Waiting for post-process')
  })
})

describe('shelfItem and shelfText', () => {
  const cotsPart = (fields: Partial<Part>) => ({ ...filterParts(parts(), 'COTS')[0], vendor: 'WCP', vendor_part_number: 'WCP-0001', quantity: 6, ...fields }) as Part
  const item = (fields: Partial<Item>) => ({ ...itemsTable.rows()[0], vendor: 'WCP', vendor_part_number: 'WCP-0001', location: 'Bin M1', quantity: 4, ...fields }) as Item

  it('finds the Inventory part with the same vendor part number, ignoring capitals, spaces and how the vendor is written', () => {
    const shelf = item({})
    expect(shelfItem(cotsPart({ vendor_part_number: ' wcp-0001 ' }), [item({ vendor_part_number: 'OTHER' }), shelf])).toBe(shelf)
    const fromRev = item({ vendor: 'REV' })
    expect(shelfItem(cotsPart({ vendor: 'REV Robotics' }), [fromRev])).toBe(fromRev)
    // When two Inventory parts have the same number, the vendor chooses.
    expect(shelfItem(cotsPart({ vendor: 'wcp' }), [fromRev, shelf])).toBe(shelf)
  })

  it('finds and shows nothing for custom parts, and finds nothing for COTS parts with no vendor part number', () => {
    expect(shelfItem(filterParts(parts(), 'Custom')[0], [item({})])).toBeUndefined()
    expect(shelfText(filterParts(parts(), 'Custom')[0], [item({})])).toBeNull()
    expect(shelfItem(cotsPart({ vendor_part_number: null }), [item({ vendor_part_number: '' })])).toBeUndefined()
  })

  it('says how many are on the shelf and where, and how many are missing, if any', () => {
    expect(shelfText(cotsPart({ quantity: 6 }), [item({ quantity: 4 })])).toBe('On the shelf: 4 · Bin M1 · Missing 2')
    expect(shelfText(cotsPart({ quantity: 4 }), [item({ quantity: 4 })])).toBe('On the shelf: 4 · Bin M1')
    expect(shelfText(cotsPart({ quantity: 3 }), [item({ quantity: 4 })])).toBe('On the shelf: 4 · Bin M1')
    expect(shelfText(cotsPart({ quantity: 6 }), [])).toBe('Not in Inventory · Missing 6')
  })

  it("says what Purchasing is doing about it, with the quantity on the request, for every status", () => {
    const request = (status: StatusKey) => ({ ...purchaseTable.rows()[0], quantity: 3, status }) as PurchaseItem
    // Needs 6, 4 on the shelf, a request for 3. Listing every status here means a new one won't be missed.
    const says: Record<StatusKey, string> = {
      wait: 'Ordering 3', order_low: 'Ordering 3', order: 'Ordering 3', order_high: 'Ordering 3',
      placed: 'Ordered 3', backordered: 'Ordered 3',
      received: 'Received 3', in_shop: 'Received 3',
      // Nothing is coming, so it's still missing.
      cancelled: 'Missing 2', out_of_stock: 'Missing 2',
    }
    for (const { key } of STATUSES) {
      expect(shelfText(cotsPart({ quantity: 6 }), [item({ quantity: 4 })], request(key)), key).toBe(`On the shelf: 4 · Bin M1 · ${says[key]}`)
    }
  })

  it('matches the example Intake to the example Inventory', () => {
    const intake = parts().filter((p) => p.part_number.startsWith('4096-26-INT-'))
    const text = (name: string) => shelfText(intake.find((p) => p.name === name)!, itemsTable.rows())
    expect(text('Compliant wheel, 2 in')).toBe('On the shelf: 12 · Bin M3')
    expect(text('Flanged bearing, 1/2 in hex')).toBe('On the shelf: 4 · Bin M1 · Missing 2')
  })
})

describe('shortages', () => {
  const cots = filterParts(parts(), 'COTS')[0]
  const cotsPart = (fields: Partial<Part>) => ({ ...cots, vendor: 'WCP', vendor_part_number: 'WCP-0001', quantity: 6, ...fields }) as Part
  const item = (fields: Partial<Item>) => ({ ...itemsTable.rows()[0], vendor: 'WCP', vendor_part_number: 'WCP-0001', location: 'Bin M1', quantity: 4, ...fields }) as Item
  const intake = cotsPart({ id: 'in-intake', system_id: 'intake', quantity: 6 })
  const drivetrain = cotsPart({ id: 'in-drivetrain', system_id: 'drivetrain', quantity: 4, vendor_part_number: ' wcp-0001' })

  it('counts a part used in two systems once, with both quantities added, and all short if it is not in Inventory', () => {
    expect(shortages([intake, drivetrain], [item({ quantity: 7 })])).toEqual([
      { name: intake.name, vendor: 'WCP', vendor_part_number: 'WCP-0001', needed: 10, on_shelf: 7, short: 3, parts: [intake, drivetrain] },
    ])
    expect(shortages([intake, drivetrain], [])).toMatchObject([{ needed: 10, on_shelf: 0, short: 10 }])
  })

  it('is short by 0 when the shelf has enough or more', () => {
    expect(shortages([intake], [item({ quantity: 6 })])).toMatchObject([{ needed: 6, on_shelf: 6, short: 0 }])
    expect(shortages([intake], [item({ quantity: 9 })])).toMatchObject([{ short: 0 }])
  })

  it('keeps different parts apart, and parts with no vendor part number on their own', () => {
    const other = cotsPart({ id: 'other', vendor_part_number: 'WCP-0002', quantity: 2 })
    const unnumbered = [cotsPart({ id: 'a', vendor_part_number: null }), cotsPart({ id: 'b', vendor_part_number: null })]
    expect(shortages([intake, other, ...unnumbered], [item({})]).map((s) => [s.needed, s.short])).toEqual([[6, 2], [2, 2], [6, 6], [6, 6]])
  })

  it('leaves out custom parts and parts removed in Onshape', () => {
    const removed = cotsPart({ id: 'gone', removed_in_onshape: true })
    expect(shortages([filterParts(parts(), 'Custom')[0], removed, intake], [])).toMatchObject([{ needed: 6 }])
  })

  it('finds the line a part is in', () => {
    const all = shortages([intake, drivetrain], [])
    expect(shortageFor(drivetrain, all)).toBe(all[0])
    expect(shortageFor(cotsPart({ id: 'elsewhere' }), all)).toBeUndefined()
  })

  it('makes the page count every system: Missing is for the whole robot', () => {
    const shelf = [item({ quantity: 7 })]
    const [line] = shortages([intake, drivetrain], shelf)
    // On its own the drivetrain's 4 look covered by 7 on the shelf. With the intake's 6, they aren't.
    expect(shelfText(drivetrain, shelf)).toBe('On the shelf: 7 · Bin M1')
    expect(shelfText(drivetrain, shelf, undefined, line)).toBe('On the shelf: 7 · Bin M1 · Robot needs 10 in 2 systems · Missing 3')
    expect(shelfText(intake, shelf, undefined, shortages([intake], shelf)[0])).toBe('On the shelf: 7 · Bin M1')
  })
})

describe('toOrder', () => {
  const cots = filterParts(parts(), 'COTS')[0]
  const cotsPart = (id: string, fields: Partial<Part>) => ({ ...cots, id, name: id, vendor: 'WCP', vendor_part_number: id, quantity: 6, ...fields }) as Part
  const request = (bom_part_id: string, quantity: number, status: PurchaseItem['status']) =>
    ({ ...purchaseTable.rows()[0], bom_part_id, quantity, status }) as PurchaseItem
  const byPart = (...requests: PurchaseItem[]) => new Map(requests.map((r) => [r.bom_part_id!, r]))
  const list = (all: Part[], requests = byPart()) => toOrder(shortages(all, []), requests)

  it('lists only what is short, grouped by vendor, vendors and parts in ABC order', () => {
    const shelf = [{ ...itemsTable.rows()[0], vendor: 'WCP', vendor_part_number: 'enough', quantity: 6 }]
    const all = [cotsPart('enough', {}), cotsPart('Wheel', { vendor: 'REV Robotics' }), cotsPart('Shaft', {}), cotsPart('Bearing', {})]
    const orders = toOrder(shortages(all, shelf), byPart())
    expect(orders.map((o) => [o.vendor, o.lines.map((l) => l.name)])).toEqual([['REV Robotics', ['Wheel']], ['West Coast Products', ['Bearing', 'Shaft']]])
  })

  it("puts a vendor typed two ways in one group, under Purchasing's name for it, and parts with no vendor together", () => {
    const orders = list([cotsPart('a', { vendor: 'AndyMark' }), cotsPart('b', { vendor: 'andy mark' })])
    expect(orders.map((o) => [o.vendor, o.lines.length])).toEqual([['Andy Mark', 2]])
    expect(list([cotsPart('a', { vendor: null }), cotsPart('b', { vendor: ' ' })]).map((o) => o.vendor)).toEqual([NO_VENDOR])
  })

  it("takes off what's already in Purchasing, so nothing is ordered twice, but not requests that won't arrive or are already In Shop", () => {
    const part = cotsPart('a', { quantity: 6 })
    expect(list([part], byPart(request('a', 2, 'order')))[0].lines[0]).toMatchObject({ short: 6, in_purchasing: 2, to_order: 4 })
    expect(list([part], byPart(request('a', 6, 'placed')))).toEqual([])
    expect(list([part], byPart(request('a', 10, 'received')))).toEqual([])
    // In Shop means Inventory should have it already, so it's counted on the shelf instead.
    for (const status of ['cancelled', 'out_of_stock', 'in_shop'] as const) {
      expect(list([part], byPart(request('a', 6, status)))[0].lines[0]).toMatchObject({ in_purchasing: 0, to_order: 6 })
    }
  })

  it('adds up the requests of every system that uses the part', () => {
    const intake = cotsPart('intake', { vendor_part_number: 'SAME', quantity: 6 })
    const drivetrain = cotsPart('drivetrain', { vendor_part_number: 'SAME', quantity: 4 })
    const orders = list([intake, drivetrain], byPart(request('intake', 3, 'order'), request('drivetrain', 2, 'placed')))
    expect(orders[0].lines[0]).toMatchObject({ needed: 10, in_purchasing: 5, to_order: 5 })
  })
})

describe('toOrderCsv', () => {
  it('has a heading row, then a row for each part with its vendor', () => {
    const line = { name: 'Bearing, 1/2 in', vendor: 'WCP', vendor_part_number: 'WCP-0001', needed: 10, on_shelf: 4, short: 6, parts: [], in_purchasing: 1, to_order: 5 }
    const noNumber = { ...line, name: '=Wheel', vendor_part_number: null, to_order: 2 }
    expect(toOrderCsv([{ vendor: 'WCP', lines: [line] }, { vendor: NO_VENDOR, lines: [noNumber] }])).toBe(
      'Vendor,Vendor part number,Part,Quantity to order\r\nWCP,WCP-0001,"Bearing, 1/2 in",5\r\nNo vendor yet,,\'=Wheel,2\r\n',
    )
  })
})

describe('identifyCots', () => {
  const found = (part_number: string | null, name = 'Part') => identifyCots({ part_number, name })

  it("knows each vendor's part numbers, written the vendor's way", () => {
    const known: [string, string, string][] = [
      ['WCP-0123', 'West Coast Products', 'WCP-0123'],
      [' wcp-0123 ', 'West Coast Products', 'WCP-0123'],
      ['am-1234', 'Andy Mark', 'am-1234'],
      ['AM-2161a', 'Andy Mark', 'am-2161a'], // with a letter after
      ['REV-21-1650', 'REV Robotics', 'REV-21-1650'],
      ['rev-21-1650', 'REV Robotics', 'REV-21-1650'],
      ['217-1234', 'VEX', '217-1234'],
      ['276-1234', 'VEX', '276-1234'],
    ]
    for (const [part_number, vendor, vendor_part_number] of known) expect(found(part_number), part_number).toEqual({ vendor, vendor_part_number })
  })

  it("finds the number in the name when the part number is empty or isn't a vendor's", () => {
    expect(found(null, 'WCP-0123 Hex bearing')).toEqual({ vendor: 'West Coast Products', vendor_part_number: 'WCP-0123' })
    expect(found('', 'Wheel hub (am-1234)')).toEqual({ vendor: 'Andy Mark', vendor_part_number: 'am-1234' })
    expect(found('Part 7', 'NEO motor REV-21-1650')).toEqual({ vendor: 'REV Robotics', vendor_part_number: 'REV-21-1650' })
  })

  it('never takes our own part numbers for bought parts, whatever the name says', () => {
    expect(found('4096-26-INT-001')).toBeNull()
    expect(found('4096-26-INT-001', 'Mount for REV-21-1650')).toBeNull()
    for (const part of filterParts(parts(), 'Custom')) expect(identifyCots(part), part.part_number).toBeNull()
  })

  it("leaves made parts that only look similar", () => {
    const made: [string | null, string][] = [
      [null, 'Intake side plate'],
      [null, 'Rev B bracket'],
      [null, 'WCP style gearbox plate'],
      ['WCP-12', 'Part'], // too short
      ['WCP-01234', 'Part'], // too long
      ['REV-21-16501', 'Part'],
      ['REV-2-1650', 'Part'],
      ['team-1234', 'Part'], // "am-1234" inside a word
      ['PRE-V-217-1234', 'Part'], // inside a longer number
      ['1217-1234', 'Part'],
      ['217-1234-01', 'Part'],
      ['555-1234', 'Part'], // not a VEX number
      [null, 'Plate 2026-11-09'],
    ]
    for (const [part_number, name] of made) expect(found(part_number, name), `${part_number} ${name}`).toBeNull()
  })
})

describe('partFileName', () => {
  it("uses the part number and revision, if there is one, swapping anything a file name can't have for a dash", () => {
    expect(partFileName({ part_number: '4096-26-INT-014', revision: 'B' }, 'step')).toBe('4096-26-INT-014_revB.step')
    expect(partFileName({ part_number: '4096-26-INT-014', revision: 'B' }, '3mf')).toBe('4096-26-INT-014_revB.3mf')
    expect(partFileName({ part_number: '4096-26-INT-014', revision: null }, 'dxf')).toBe('4096-26-INT-014.dxf')
    expect(partFileName({ part_number: '4096-26-INT-014', revision: ' ' }, 'dxf')).toBe('4096-26-INT-014.dxf')
    expect(partFileName({ part_number: ' Side plate/left ', revision: 'B 2' }, 'stl')).toBe('Side-plate-left_revB-2.stl')
    // A part number can't make the file land in another folder.
    expect(partFileName({ part_number: '..\\secret', revision: null }, 'stl')).toBe('..-secret.stl')
  })
})

describe('partFiles', () => {
  const files = (name: string, machine?: Parameters<typeof partFiles>[2]) => partFiles(part(name), stepsOf(name), machine)

  it("gives the file for each machine in the part's stages", () => {
    expect(files('Roller shaft')).toEqual([{ format: 'step', name: '4096-26-INT-002_revA.step', machines: ['lathe'] }])
    expect(files('Pivot spacer')).toEqual([{ format: 'stl', name: '4096-26-INT-003_revA.stl', machines: ['3d_printer'] }])
    // The frame rail is milled, then routed: a STEP for the mill and a DXF for the router.
    expect(files('Frame rail')).toEqual([
      { format: 'step', name: '4096-26-DRV-002_revB.step', machines: ['mill'] },
      { format: 'dxf', name: '4096-26-DRV-002_revB.dxf', machines: ['cnc_router'] },
    ])
  })

  it('gives each kind of file once when two machines use it', () => {
    const shaft = part('Roller shaft')
    const steps = [{ ...stage('Roller shaft', 'process1') }, { ...stage('Roller shaft', 'process1'), id: 'second', stage: 'process2' as const, machine: 'mill' as const }]
    expect(partFiles(shaft, steps)).toEqual([{ format: 'step', name: '4096-26-INT-002_revA.step', machines: ['lathe', 'mill'] }])
  })

  it("gives only one machine's files for its queue", () => {
    expect(files('Frame rail', 'cnc_router')).toEqual([{ format: 'dxf', name: '4096-26-DRV-002_revB.dxf', machines: ['cnc_router'] }])
    expect(files('Frame rail', 'lathe')).toEqual([])
  })

  it('gives nothing for hand tools, or a part with no machine stages', () => {
    const shaft = part('Roller shaft')
    expect(partFiles(shaft, [{ ...stage('Roller shaft', 'process1'), machine: 'hand_tools' }])).toEqual([])
    expect(files('Brushless motor')).toEqual([])
  })
})
