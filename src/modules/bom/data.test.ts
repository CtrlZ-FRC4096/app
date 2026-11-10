// Tests for data.ts. Run them with `npm test`.
// Who is allowed to do what is the database's job: that's tested in
// supabase/tests/bom.test.ts and bom-steps.test.ts. The checks here only
// explain it first. Tests run as a student unless they say otherwise.
import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import { membersTable } from '../../core/members'
import {
  addPart, addRobot, addSystem, bomSummary, canEditRobotsAndParts, changePart, changeSystem, checkPart, checkSystem, countParts, filterParts, kindLabel,
  nextPartNumber, partCountText, partsTable, orderWord, identifyCots, removePart, removeSystem, renameRobot, robotsTable, shelfItem, shelfText, shortageFor, shortages, systemsTable, toOrder, toOrderCsv, NO_VENDOR,
  type NewPart, type Part,
} from './data'
import { itemsTable, type Item } from '../inventory/data'
import { STATUSES, itemsTable as purchaseTable, type PurchaseItem } from '../purchasing/data'
import {
  addStep, advance, changeDone, checkStep, moveBack, removeStep, stationName, stationQueue, stepName, stepsFor, stepsTable, type Step,
} from './data'
import { assignStep, checkAssignment, dueText, isOverdue, today } from './data'

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

  it('keeps only custom parts for Custom, and only COTS parts for COTS', () => {
    expect(filterParts(parts(), 'Custom').every((p) => p.kind === 'made')).toBe(true)
    expect(filterParts(parts(), 'COTS').every((p) => p.kind === 'cots')).toBe(true)
    expect(filterParts(parts(), 'Custom').length + filterParts(parts(), 'COTS').length).toBe(parts().length)
  })
})

describe('countParts', () => {
  it('counts each part once, whatever its quantity', () => {
    const [madePart] = filterParts(parts(), 'Custom')
    const [cotsPart] = filterParts(parts(), 'COTS')
    expect(countParts([madePart, cotsPart, { ...cotsPart, quantity: 100 } as Part])).toEqual({ made: 1, cots: 2 })
  })

  it('is zero for no parts', () => {
    expect(countParts([])).toEqual({ made: 0, cots: 0 })
    expect(partCountText([])).toBe('0 custom, 0 COTS')
  })
})

describe('partCountText', () => {
  it('reads like "5 custom, 7 COTS"', () => {
    expect(partCountText(parts())).toBe('5 custom, 7 COTS')
  })
})

describe('kindLabel', () => {
  it('writes the kinds the way the team says them', () => {
    expect(kindLabel('made')).toBe('Custom')
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

describe('canEditRobotsAndParts', () => {
  it('is true for student leaders, mentors and admins, not students', () => {
    expect(canEditRobotsAndParts('student')).toBe(false)
    expect(canEditRobotsAndParts('leader')).toBe(true)
    expect(canEditRobotsAndParts('mentor')).toBe(true)
    expect(canEditRobotsAndParts('admin')).toBe(true)
  })
})

describe('addPart', () => {
  beforeEach(() => setDemoRole('leader'))

  it("doesn't let a student add a part, and says who can", async () => {
    setDemoRole('student')
    expect(await addPart(newMadePart())).toEqual({ ok: false, error: 'Only student leaders and mentors can add parts. Ask one of them.' })
    expect(parts()).toHaveLength(12)
  })

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
  beforeEach(() => setDemoRole('leader'))

  it("doesn't let a student change or delete a part", async () => {
    setDemoRole('student')
    expect(await changePart(plate(), newMadePart({ part_number: '4096-26-INT-001', quantity: 9 }))).toEqual({
      ok: false, error: 'Only student leaders and mentors can change parts. Ask one of them.',
    })
    expect(await removePart(plate())).toEqual({ ok: false, error: 'Only student leaders and mentors can delete parts. Ask one of them.' })
    expect(plate().quantity).not.toBe(9)
  })

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

  it("doesn't let a student add or rename a robot", async () => {
    expect(await addRobot('2027 competition robot')).toEqual({ ok: false, error: 'Only student leaders and mentors can add robots. Ask one of them.' })
    expect(await renameRobot(robotsTable.rows()[0], 'Renamed')).toEqual({
      ok: false, error: 'Only student leaders and mentors can rename robots. Ask one of them.',
    })
    expect(robotsTable.rows().map((r) => r.name)).not.toContain('Renamed')
  })

  it('lets a student leader add and rename a robot', async () => {
    setDemoRole('leader')
    const added = await addRobot('  2027 competition robot ')
    if (!added.ok) throw new Error(added.error)
    expect(added.value.name).toBe('2027 competition robot')
    expect((await renameRobot(added.value, '2027 robot')).ok).toBe(true)
    expect(robotsTable.rows().map((r) => r.name)).toContain('2027 robot')
    expect(await addRobot(' ')).toEqual({ ok: false, error: 'Name the robot, like "2027 competition robot".' })
  })

  it('lets a student add a system, with its code in capitals', async () => {
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

  it('lets a student change a system, keeping its own name and code allowed', async () => {
    const intake = systemsTable.rows().find((s) => s.code === 'INT')!
    const result = await changeSystem(intake, { name: 'Intake', code: 'INT', onshape_url: 'https://cad.onshape.com/documents/0123456789abcdef01234567/w/0123456789abcdef01234567/e/0123456789abcdef01234567' })
    expect(result.ok && result.value.onshape_url).toBe('https://cad.onshape.com/documents/0123456789abcdef01234567/w/0123456789abcdef01234567/e/0123456789abcdef01234567')
  })

  it('only lets a student leader or mentor delete a system, which deletes its parts too', async () => {
    const intake = systemsTable.rows().find((s) => s.code === 'INT')!
    expect(await removeSystem(intake)).toEqual({
      ok: false, error: 'Only student leaders and mentors can delete a system, because it deletes every part in it.',
    })
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

describe('stepsFor', () => {
  it("gives a part's stages in order, and only the ones it has", () => {
    expect(stepsOf('Roller shaft').map((s) => s.stage)).toEqual(['design', 'pre', 'process1'])
    expect(stepsOf('Frame rail').map((s) => s.stage)).toEqual(['design', 'pre', 'process1', 'process2', 'post'])
    expect(stepsOf('Brushless motor')).toEqual([])
  })
})

describe('stepName', () => {
  it('names process stages by their machine', () => {
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

  it("won't go above the part's quantity, and says why", async () => {
    // The side plate's quantity is 2, and both are designed.
    expect(await changeDone(stage('Intake side plate', 'design'), 1)).toEqual({
      ok: false,
      error: 'All 2 are already through Design. The robot needs 2.',
    })
    expect(stage('Intake side plate', 'design').quantity_done).toBe(2)
  })

  it("won't go below 0", async () => {
    expect(await changeDone(stage('Intake side plate', 'post'), -1)).toEqual({ ok: false, error: 'None are through Post-process yet.' })
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

describe('addStep and removeStep', () => {
  it('work for a student too', async () => {
    expect((await addStep(part('Roller shaft'), 'post', null)).ok).toBe(true)
    expect((await removeStep(stage('Roller shaft', 'pre'))).ok).toBe(true)
    expect(stepsOf('Roller shaft').map((s) => s.stage)).toEqual(['design', 'process1', 'post'])
  })

  it("won't add a stage checkStep refuses, and says why", async () => {
    expect(await addStep(part('Roller shaft'), 'process2', null)).toEqual({ ok: false, error: 'Pick the machine for Process 2.' })
  })

  it('add a stage at to do with none done, in its place in the order', async () => {
    expect((await addStep(part('Roller shaft'), 'post', null)).ok).toBe(true)
    expect(stage('Roller shaft', 'post')).toMatchObject({ status: 'todo', quantity_done: 0, machine: null })
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
  const members = () => membersTable.rows()

  it('allows a person, a due date, both or neither', () => {
    expect(checkAssignment({ assigned_to: DEMO_PEOPLE.alex, due_date: '2026-11-20' }, members())).toBeNull()
    expect(checkAssignment({ assigned_to: DEMO_PEOPLE.alex, due_date: null }, members())).toBeNull()
    expect(checkAssignment({ assigned_to: null, due_date: '2026-11-20' }, members())).toBeNull()
    expect(checkAssignment({ assigned_to: null, due_date: null }, members())).toBeNull()
  })

  it("refuses someone who isn't on the team, or whose access is off", () => {
    expect(checkAssignment({ assigned_to: 'nobody', due_date: null }, members())).toMatch(/isn't on the team/)
    expect(checkAssignment({ assigned_to: DEMO_PEOPLE.sam, due_date: null }, members())).toBe(
      "Sam Ortiz's access is switched off, so they can't be given work. Pick someone else.",
    )
  })

  it("refuses a due date that isn't a real day", () => {
    expect(checkAssignment({ assigned_to: null, due_date: 'next Friday' }, members())).toBe('Pick the due date from the calendar.')
    expect(checkAssignment({ assigned_to: null, due_date: '2026-02-30' }, members())).toBe('Pick the due date from the calendar.')
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

  it('starts new stages with nobody assigned and no due date', async () => {
    await addStep(part('Roller shaft'), 'post', null)
    expect(stage('Roller shaft', 'post')).toMatchObject({ assigned_to: null, due_date: null })
  })
})

describe('isOverdue', () => {
  const due = (due_date: string | null, status: Step['status'] = 'todo'): Step => ({ ...stage('Intake side plate', 'post'), due_date, status })

  it('is late the day after its due date, not on the day', () => {
    expect(isOverdue(due('2026-11-20'), '2026-11-19')).toBe(false)
    expect(isOverdue(due('2026-11-20'), '2026-11-20')).toBe(false)
    expect(isOverdue(due('2026-11-20'), '2026-11-21')).toBe(true)
  })

  it('is never late once done, or with no due date', () => {
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

  it("shows one machine's queue: parts with a stage on it that isn't done", () => {
    // The pivot spacer's print is done, so the 3D printer has nothing waiting.
    expect(names(stationQueue(parts(), stepsTable.rows(), { kind: 'machine', machine: '3d_printer' }))).toEqual([])
    const router = stationQueue(parts(), stepsTable.rows(), { kind: 'machine', machine: 'cnc_router' })
    expect(names(router)).toEqual(['Bellypan', 'Frame rail', 'Intake side plate'])
    expect(router.every((q) => q.steps.every((s) => s.machine === 'cnc_router'))).toBe(true)
  })

  it('shows the parts waiting for one stage', () => {
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

  it('finds the Inventory part with the same vendor part number, ignoring capitals and spaces', () => {
    const shelf = item({})
    expect(shelfItem(cotsPart({ vendor_part_number: ' wcp-0001 ' }), [item({ vendor_part_number: 'OTHER' }), shelf])).toBe(shelf)
  })

  it("matches even when the vendor is written differently, like REV and REV Robotics", () => {
    const shelf = item({ vendor: 'REV' })
    expect(shelfItem(cotsPart({ vendor: 'REV Robotics' }), [shelf])).toBe(shelf)
  })

  it('uses the vendor to choose when two Inventory parts have the same number', () => {
    const fromWcp = item({ vendor: 'WCP' })
    const fromRev = item({ vendor: 'REV' })
    expect(shelfItem(cotsPart({ vendor: 'wcp' }), [fromRev, fromWcp])).toBe(fromWcp)
  })

  it('finds nothing for made parts, or COTS parts with no vendor part number', () => {
    expect(shelfItem(filterParts(parts(), 'Custom')[0], [item({})])).toBeUndefined()
    expect(shelfItem(cotsPart({ vendor_part_number: null }), [item({ vendor_part_number: '' })])).toBeUndefined()
  })

  const request = (fields: Partial<PurchaseItem>) => ({ ...purchaseTable.rows()[0], quantity: 3, status: 'order', ...fields }) as PurchaseItem

  it('says how many are on the shelf and where, and how many are missing', () => {
    expect(shelfText(cotsPart({ quantity: 6 }), [item({ quantity: 4 })])).toBe('On the shelf: 4 · Bin M1 · Missing 2')
  })

  it("doesn't say anything is missing when there are enough", () => {
    expect(shelfText(cotsPart({ quantity: 3 }), [item({ quantity: 4 })])).toBe('On the shelf: 4 · Bin M1')
    expect(shelfText(cotsPart({ quantity: 4 }), [item({ quantity: 4 })])).toBe('On the shelf: 4 · Bin M1')
  })

  it('counts a part not in Inventory as all missing', () => {
    expect(shelfText(cotsPart({ quantity: 6 }), [])).toBe('Not in Inventory · Missing 6')
  })

  it('says Ordering, with the quantity on the request, while it is still being asked for', () => {
    for (const status of ['wait', 'order_low', 'order', 'order_high'] as const) {
      expect(shelfText(cotsPart({ quantity: 3 }), [item({ quantity: 2 })], request({ quantity: 3, status }))).toBe('On the shelf: 2 · Bin M1 · Ordering 3')
    }
  })

  it('says Ordered once the order is placed or backordered', () => {
    for (const status of ['placed', 'backordered'] as const) {
      expect(shelfText(cotsPart({ quantity: 6 }), [], request({ quantity: 10, status }))).toBe('Not in Inventory · Ordered 10')
    }
  })

  it('says Received once it has arrived or is in the shop, not Missing', () => {
    for (const status of ['received', 'in_shop'] as const) {
      expect(shelfText(cotsPart({ quantity: 4 }), [], request({ quantity: 4, status }))).toBe('Not in Inventory · Received 4')
    }
  })

  it("says Missing when the request is cancelled, or out of stock so it couldn't be ordered", () => {
    for (const status of ['cancelled', 'out_of_stock'] as const) {
      expect(shelfText(cotsPart({ quantity: 6 }), [item({ quantity: 4 })], request({ status }))).toBe('On the shelf: 4 · Bin M1 · Missing 2')
    }
  })

  it('has a word for every status', () => {
    expect(STATUSES.map((s) => orderWord(s.key))).toEqual(['Ordering', 'Ordering', 'Ordering', 'Ordering', 'Ordered', null, 'Ordered', 'Received', 'Received', null])
  })

  it('shows nothing for custom parts', () => {
    expect(shelfText(filterParts(parts(), 'Custom')[0], [item({})])).toBeNull()
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

  it('counts a part used in two systems once, with both quantities added', () => {
    expect(shortages([intake, drivetrain], [item({ quantity: 7 })])).toEqual([
      { name: intake.name, vendor: 'WCP', vendor_part_number: 'WCP-0001', needed: 10, on_shelf: 7, short: 3, parts: [intake, drivetrain] },
    ])
  })

  it('counts a part that is not in Inventory as fully short, still added up across systems', () => {
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

  it("puts a vendor typed two ways in one group, under Purchasing's name for it", () => {
    const orders = list([cotsPart('a', { vendor: 'AndyMark' }), cotsPart('b', { vendor: 'andy mark' })])
    expect(orders.map((o) => [o.vendor, o.lines.length])).toEqual([['Andy Mark', 2]])
  })

  it('groups parts with no vendor together', () => {
    expect(list([cotsPart('a', { vendor: null }), cotsPart('b', { vendor: ' ' })]).map((o) => o.vendor)).toEqual([NO_VENDOR])
  })

  it("takes off what's already in Purchasing, so nothing is ordered twice", () => {
    const part = cotsPart('a', { quantity: 6 })
    expect(list([part], byPart(request('a', 2, 'order')))[0].lines[0]).toMatchObject({ short: 6, in_purchasing: 2, to_order: 4 })
    expect(list([part], byPart(request('a', 6, 'placed')))).toEqual([])
    expect(list([part], byPart(request('a', 10, 'received')))).toEqual([])
  })

  it("doesn't count a request that was cancelled, is Out of Stock, or is In Shop (so Inventory should have it)", () => {
    const part = cotsPart('a', { quantity: 6 })
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

  it('knows a West Coast Products number: WCP-0123', () => {
    expect(found('WCP-0123')).toEqual({ vendor: 'West Coast Products', vendor_part_number: 'WCP-0123' })
    expect(found(' wcp-0123 ')).toEqual({ vendor: 'West Coast Products', vendor_part_number: 'WCP-0123' })
  })

  it('knows an AndyMark number: am-1234, with or without a letter after', () => {
    expect(found('am-1234')).toEqual({ vendor: 'Andy Mark', vendor_part_number: 'am-1234' })
    expect(found('AM-2161a')).toEqual({ vendor: 'Andy Mark', vendor_part_number: 'am-2161a' })
  })

  it('knows a REV Robotics number: REV-21-1650', () => {
    expect(found('REV-21-1650')).toEqual({ vendor: 'REV Robotics', vendor_part_number: 'REV-21-1650' })
    expect(found('rev-21-1650')).toEqual({ vendor: 'REV Robotics', vendor_part_number: 'REV-21-1650' })
  })

  it('knows a VEX number: 217-1234 and 276-1234', () => {
    expect(found('217-1234')).toEqual({ vendor: 'VEX', vendor_part_number: '217-1234' })
    expect(found('276-1234')).toEqual({ vendor: 'VEX', vendor_part_number: '276-1234' })
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
