// Tests for stats.ts: how close each system, and the robot, is to being
// built (#23). Run them with `npm test`.
import { describe, expect, it } from 'vitest'
import { filterParts, partsTable, shortages, robotsTable, stepsTable, systemsTable, type BomSystem, type Part, type Robot, type Step } from './data'
import { itemsTable, type Item } from '../inventory/data'
import { isPartDone, percent, type BuildStats, piecesMade, robotStats, robotSummary, systemStats, waitingText } from './stats'

// Made-up rows to count, copied from the example data with the fields each test needs.
const exampleMade = filterParts(partsTable.rows(), 'Custom')[0]
const exampleCots = filterParts(partsTable.rows(), 'COTS')[0]
const custom = (id: string, quantity: number, fields: Partial<Part> = {}) =>
  ({ ...exampleMade, id, system_id: 'intake', quantity, removed_in_onshape: false, ...fields }) as Part
const cots = (id: string, quantity: number, fields: Partial<Part> = {}) =>
  ({ ...exampleCots, id, system_id: 'intake', quantity, vendor: 'WCP', vendor_part_number: `WCP-${id}`, removed_in_onshape: false, ...fields }) as Part
const stage = (part_id: string, fields: Partial<Step>) =>
  ({ ...stepsTable.rows()[0], id: `${part_id}-${fields.stage}`, part_id, machine: null, status: 'todo', quantity_done: 0, ...fields }) as Step
const shelf = (vendor_part_number: string, quantity: number) =>
  ({ ...itemsTable.rows()[0], id: `item-${vendor_part_number}`, vendor: 'WCP', vendor_part_number, quantity }) as Item
const system = (id: string, name: string) => ({ ...systemsTable.rows()[0], id, name }) as BomSystem

describe('piecesMade and isPartDone', () => {
  it('count a piece as made once it is through every stage, a Done stage as all through, and a part as done when every stage is Done', () => {
    const part = custom('p', 4)
    const cases: { stages: Partial<Step>[]; made: number; done: boolean }[] = [
      // No stages yet: nothing made, and not done.
      { stages: [], made: 0, done: false },
      // Every stage Done.
      { stages: [{ stage: 'design', status: 'done', quantity_done: 4 }, { stage: 'post', status: 'done', quantity_done: 4 }], made: 4, done: true },
      // Marked Done without counting them through: all 4 still count.
      { stages: [{ stage: 'design', status: 'done', quantity_done: 0 }], made: 4, done: true },
      // 3 of 4 through the only stage.
      { stages: [{ stage: 'process1', machine: 'lathe', status: 'in_progress', quantity_done: 3 }], made: 3, done: false },
      // 4 through the lathe but only 1 through post-process: 1 made.
      { stages: [{ stage: 'process1', machine: 'lathe', status: 'done', quantity_done: 4 }, { stage: 'post', status: 'in_progress', quantity_done: 1 }], made: 1, done: false },
    ]
    for (const { stages, made, done } of cases) {
      const steps = stages.map((s) => stage(part.id, s))
      expect([piecesMade(part, steps), isPartDone(steps)], JSON.stringify(stages)).toEqual([made, done])
    }
  })
})

describe('systemStats', () => {
  it('counts parts and how far along they are, each part counting the same, for an empty system, one all done, and partial quantities', () => {
    const shaft = custom('shaft', 4)
    const plate = custom('plate', 2)
    const spacer = custom('spacer', 1)
    const wheel = cots('wheel', 8)
    const steps = [
      stage('shaft', { stage: 'process1', machine: 'lathe', status: 'in_progress', quantity_done: 3 }),
      stage('plate', { stage: 'design', status: 'done', quantity_done: 2 }),
      stage('plate', { stage: 'process1', machine: 'cnc_router', status: 'done', quantity_done: 2 }),
    ]
    const cases: { name: string; parts: Part[]; items: Item[]; expected: Partial<BuildStats> }[] = [
      {
        name: 'an empty system',
        parts: [],
        items: [],
        expected: { parts: 0, custom: 0, cots: 0, customDone: 0, cotsCovered: 0, progress: null, customProgress: null, cotsProgress: null },
      },
      {
        name: 'all done: every stage Done, and enough wheels on the shelf',
        parts: [plate, wheel],
        items: [shelf('WCP-wheel', 10)],
        expected: { parts: 2, custom: 1, cots: 1, customDone: 1, cotsCovered: 1, progress: 1, customProgress: 1, cotsProgress: 1 },
      },
      {
        // The shaft is 3 of 4 (75%), the spacer has no stages (0%), and 6 of 8 wheels are on the shelf (75%).
        name: 'partial quantities',
        parts: [shaft, spacer, wheel],
        items: [shelf('WCP-wheel', 6)],
        expected: { parts: 3, custom: 2, cots: 1, customDone: 0, noStages: 1, cotsCovered: 0, progress: 0.5, customProgress: 0.375, cotsProgress: 0.75 },
      },
      {
        name: 'parts removed in Onshape left out',
        parts: [plate, custom('gone', 3, { removed_in_onshape: true })],
        items: [],
        expected: { parts: 1, custom: 1, customDone: 1, progress: 1 },
      },
    ]
    for (const { name, parts, items, expected } of cases) {
      expect(systemStats(parts, steps, shortages(parts, items)), name).toMatchObject(expected)
    }
  })

  it('counts the parts waiting at each stage, in stage order, with the process stages by their machine', () => {
    const parts = [custom('a', 2), custom('b', 1), custom('c', 3)]
    const steps = [
      stage('a', { stage: 'design', status: 'done' }),
      stage('a', { stage: 'process1', machine: 'cnc_router', status: 'in_progress' }),
      stage('a', { stage: 'post' }),
      stage('b', { stage: 'design', status: 'in_progress' }),
      stage('b', { stage: 'process1', machine: 'cnc_router' }),
      stage('c', { stage: 'process1', machine: 'lathe', status: 'done' }),
      stage('c', { stage: 'process2', machine: 'cnc_router' }),
    ]
    const { waiting } = systemStats(parts, steps, [])
    expect(waiting.map(waitingText)).toEqual(['1 waiting for design', '3 waiting for CNC router', '1 waiting for post-process'])
    expect(waiting[1].station).toEqual({ kind: 'machine', machine: 'cnc_router' })
  })
})

describe('robotStats', () => {
  it('gives each system its own numbers and the robot a total of every part, sharing the shelf fairly between systems that use the same COTS part', () => {
    const intake = system('intake', 'Intake')
    const drivetrain = system('drivetrain', 'Drivetrain')
    // The same bearing in both systems: the robot needs 10 and has 7, so each line is 70% there.
    const bearing = { vendor_part_number: 'WCP-BRG' }
    const parts = [
      cots('in-bearing', 6, bearing),
      custom('in-plate', 1),
      cots('dt-bearing', 4, { ...bearing, system_id: 'drivetrain' }),
      cots('other-robot', 5, { system_id: 'someone-else' }),
    ]
    const steps = [stage('in-plate', { stage: 'design', status: 'done' })]
    const { total, systems } = robotStats([intake, drivetrain], parts, steps, [shelf('WCP-BRG', 7)])
    expect(systems.map((s) => [s.system.name, s.stats.parts, s.stats.progress])).toEqual([['Intake', 2, 0.85], ['Drivetrain', 1, 0.7]])
    expect([total.parts, total.cotsCovered, percent(total.progress)]).toEqual([3, 0, 80])
  })
})

describe('percent and robotSummary', () => {
  it('rounds down, so 100% means done, and says how built the first robot is, or what is missing', () => {
    expect([0, 0.29, 0.996, 1, null].map(percent)).toEqual([0, 29, 99, 100, 0])

    const robot = { ...robotsTable.rows()[0], id: 'robot', name: '2027 robot' } as Robot
    const intake = { ...system('intake', 'Intake'), robot_id: 'robot' }
    const plate = custom('plate', 4)
    const steps = (done: number) => [stage('plate', { stage: 'process1', machine: 'laser', status: 'in_progress', quantity_done: done })]
    const cases: { robots: Robot[]; systems: BomSystem[]; parts: Part[]; done: number; text: string; tone: string }[] = [
      { robots: [], systems: [], parts: [], done: 0, text: 'No robot yet', tone: 'plain' },
      { robots: [robot], systems: [], parts: [], done: 0, text: 'No systems yet', tone: 'plain' },
      { robots: [robot], systems: [intake], parts: [], done: 0, text: '1 system, no parts yet', tone: 'plain' },
      { robots: [robot], systems: [intake], parts: [plate], done: 3, text: 'Robot 75% built', tone: 'info' },
      { robots: [robot], systems: [intake], parts: [plate], done: 4, text: 'Robot 100% built', tone: 'ok' },
      // With more than one robot, it names the one the BOM page opens on.
      { robots: [robot, { ...robot, id: 'next', name: '2028 robot' }], systems: [intake], parts: [plate], done: 1, text: '2027 robot: 25% built', tone: 'info' },
    ]
    for (const c of cases) {
      expect(robotSummary(c.robots, c.systems, c.parts, steps(c.done), []), c.text).toEqual({ text: c.text, tone: c.tone })
    }
  })
})
