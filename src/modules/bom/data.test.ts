// Tests for data.ts. Run them with `npm test`.
// Who is allowed to do what is the database's job: that's tested in
// supabase/tests/bom.test.ts and bom-steps.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import { setDemoRole } from '../../core/demo'
import {
  addPart, addRobot, addSystem, bomSummary, changePart, changeSystem, checkPart, checkSystem, countParts, filterParts, kindLabel,
  nextPartNumber, partCountText, partsTable, removePart, removeSystem, renameRobot, robotsTable, systemsTable,
  type NewPart, type Part,
} from './data'
import {
  addStep, advance, changeDone, checkStep, moveBack, removeStep, stationName, stationQueue, stepName, stepsFor, stepsTable, type Step,
} from './data'

beforeEach(() => {
  setDemoRole('student')
  partsTable.reset()
  systemsTable.reset()
  robotsTable.reset()
  stepsTable.reset()
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
    const result = await changeSystem(intake, { name: 'Intake', code: 'INT', onshape_url: 'https://cad.onshape.com/documents/0123456789abcdef01234567/w/0123456789abcdef01234567/e/0123456789abcdef01234567' })
    expect(result.ok && result.value.onshape_url).toBe('https://cad.onshape.com/documents/0123456789abcdef01234567/w/0123456789abcdef01234567/e/0123456789abcdef01234567')
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
    expect(checkStep(part('Brushless motor'), 'design', null, [])).toMatch(/Only made parts/)
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
