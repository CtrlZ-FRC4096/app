// Tests for the Build progress grid. They run in demo mode, as the made-up
// student unless a test views the app as someone else. Who may do what is the
// database's job too: that's tested in supabase/tests/build-subsystems.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setDemoRole } from '../../core/demo'
import type { Role } from '../../core/roles'
import {
  LEADERS_ONLY, STAGES, addSubsystem, advanceStage, changeCell, checkName, moveSubsystem, removeSubsystem, renameSubsystem, stateOf,
  subsystemsTable, type StageState, type Subsystem,
} from './data'

const byName = (name: string) => subsystemsTable.rows().find((s) => s.name === name)!
const names = () => subsystemsTable.rows().map((s) => s.name)

beforeEach(() => {
  subsystemsTable.reset()
})
afterEach(() => setDemoRole('student'))

describe('starting grid', () => {
  it('has the six subsystems in order and five stages, all Not started', () => {
    expect(names()).toEqual(['Swerve drivetrain', 'Intake', 'Indexer', 'Shooter', 'Climber', 'Vision'])
    expect(STAGES).toEqual(['Design', 'Built', 'Wired', 'Programmed', 'Tested'])
    for (const subsystem of subsystemsTable.rows()) {
      for (const stage of STAGES) expect(stateOf(subsystem, stage)).toBe('Not started')
    }
  })

  it('counts a stage that was never set as Not started', () => {
    expect(stateOf({ ...byName('Intake'), stages: {} }, 'Tested')).toBe('Not started')
  })
})

describe('advanceStage', () => {
  // Not started → In progress → Done → back to Not started, so tapping keeps cycling.
  const transitions: [StageState, StageState][] = [
    ['Not started', 'In progress'],
    ['In progress', 'Done'],
    ['Done', 'Not started'],
  ]

  it('moves each stage on one step, without changing other cells or the input', () => {
    for (const stage of STAGES) {
      for (const [current, next] of transitions) {
        const label = `${stage}: ${current} → ${next}`
        const subsystem: Subsystem = structuredClone(byName('Intake'))
        subsystem.stages[stage] = current
        const before = structuredClone(subsystem)

        const updated = advanceStage(subsystem, stage)

        expect(updated, label).toEqual({ ...before, stages: { ...before.stages, [stage]: next } })
        expect(updated.stages, label).not.toBe(subsystem.stages)
        expect(subsystem, label).toEqual(before)
      }
    }
  })
})

describe('checkName', () => {
  it('needs a new name, not too long', () => {
    expect(checkName(' Elevator ', subsystemsTable.rows())).toBeNull()
    expect(checkName('  ', subsystemsTable.rows())).toMatch(/Give the subsystem a name/)
    expect(checkName('x'.repeat(61), subsystemsTable.rows())).toMatch(/under 60/)
    expect(checkName('intake', subsystemsTable.rows())).toBe("There's already a subsystem called Intake.")
  })

  it("doesn't count the subsystem being renamed as taking its own name", () => {
    expect(checkName('Intake', subsystemsTable.rows(), byName('Intake').id)).toBeNull()
  })
})

describe('students', () => {
  it("can't change a cell, or add, rename, move or remove a subsystem, and are told who can", async () => {
    const before = structuredClone(subsystemsTable.rows())
    expect(await changeCell(byName('Intake'), 'Design')).toEqual({ ok: false, error: LEADERS_ONLY })
    expect(await addSubsystem('Elevator')).toEqual({ ok: false, error: LEADERS_ONLY })
    expect(await renameSubsystem(byName('Intake'), 'Ground intake')).toEqual({ ok: false, error: LEADERS_ONLY })
    expect(await moveSubsystem(byName('Intake'), -1)).toEqual({ ok: false, error: LEADERS_ONLY })
    expect(await removeSubsystem(byName('Intake'))).toEqual({ ok: false, error: LEADERS_ONLY })
    expect(LEADERS_ONLY).toBe('Ask a student leader or mentor to update build progress.')
    expect(subsystemsTable.rows()).toEqual(before)
  })
})

describe.each<Role>(['leader', 'mentor', 'admin'])('a %s', (role) => {
  beforeEach(() => setDemoRole(role))

  it('changes a cell, and it stays changed', async () => {
    expect((await changeCell(byName('Intake'), 'Built')).ok).toBe(true)
    expect(stateOf(byName('Intake'), 'Built')).toBe('In progress')
    expect(stateOf(byName('Intake'), 'Design')).toBe('Not started')
  })

  it('adds a subsystem at the bottom, all Not started', async () => {
    expect(await addSubsystem(' Elevator ')).toMatchObject({ ok: true, value: { name: 'Elevator', position: 7, stages: {} } })
    expect(names().at(-1)).toBe('Elevator')
  })

  it('refuses a name that is taken', async () => {
    expect(await addSubsystem('Shooter')).toEqual({ ok: false, error: "There's already a subsystem called Shooter." })
  })

  it('renames and removes a subsystem', async () => {
    expect((await renameSubsystem(byName('Intake'), 'Ground intake')).ok).toBe(true)
    expect(names()).toContain('Ground intake')
    expect((await removeSubsystem(byName('Ground intake'))).ok).toBe(true)
    expect(names()).not.toContain('Ground intake')
  })
})

describe('moveSubsystem', () => {
  beforeEach(() => setDemoRole('leader'))

  it('swaps a subsystem with the one above or below', async () => {
    await moveSubsystem(byName('Intake'), -1)
    expect(names().slice(0, 3)).toEqual(['Intake', 'Swerve drivetrain', 'Indexer'])
    await moveSubsystem(byName('Intake'), 1)
    expect(names().slice(0, 3)).toEqual(['Swerve drivetrain', 'Intake', 'Indexer'])
  })

  it('does nothing past the top or bottom', async () => {
    expect(await moveSubsystem(byName('Swerve drivetrain'), -1)).toEqual({ ok: true, value: null })
    expect(await moveSubsystem(byName('Vision'), 1)).toEqual({ ok: true, value: null })
    expect(names()).toEqual(['Swerve drivetrain', 'Intake', 'Indexer', 'Shooter', 'Climber', 'Vision'])
  })

  it('still swaps two subsystems that share a position', async () => {
    await subsystemsTable.update(byName('Indexer').id, { position: 2 })
    // Intake and Indexer are both at 2, so they're in order by name: Indexer first.
    expect(names().slice(1, 3)).toEqual(['Indexer', 'Intake'])
    await moveSubsystem(byName('Indexer'), 1)
    expect(names().slice(1, 3)).toEqual(['Intake', 'Indexer'])
  })
})
