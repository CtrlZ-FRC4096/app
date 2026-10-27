import { describe, expect, it } from 'vitest'
import { advanceStage, STAGES, SUBSYSTEMS, type StageState } from './data'

describe('starting grid', () => {
  it('has the six subsystems and five stages, all Not started', () => {
    expect(SUBSYSTEMS.map((subsystem) => subsystem.name)).toEqual([
      'Swerve drivetrain', 'Intake', 'Indexer', 'Shooter', 'Climber', 'Vision',
    ])
    expect(new Set(SUBSYSTEMS.map((subsystem) => subsystem.id)).size).toBe(6)
    expect(STAGES).toEqual(['Design', 'Built', 'Wired', 'Programmed', 'Tested'])
    for (const subsystem of SUBSYSTEMS) {
      expect(subsystem.stages).toEqual({
        Design: 'Not started', Built: 'Not started', Wired: 'Not started',
        Programmed: 'Not started', Tested: 'Not started',
      })
    }
  })
})

describe.each(STAGES)('advanceStage for %s', (stage) => {
  const transitions: [StageState, StageState][] = [
    ['Not started', 'In progress'],
    ['In progress', 'Done'],
    ['Done', 'Not started'],
  ]

  it.each(transitions)('advances %s to %s without changing other cells or the input', (current, next) => {
    const subsystems = structuredClone(SUBSYSTEMS)
    const subsystem = subsystems[0]
    subsystem.stages[stage] = current
    const before = structuredClone(subsystems)

    const updated = advanceStage(subsystem, stage)

    expect(updated).toEqual({
      ...before[0], stages: { ...before[0].stages, [stage]: next },
    })
    expect(updated).not.toBe(subsystem)
    expect(updated.stages).not.toBe(subsystem.stages)
    expect(subsystems).toEqual(before)
  })

  it('can cycle repeatedly without changing the starting data', () => {
    const original = structuredClone(SUBSYSTEMS[0])
    let updated = original
    for (let click = 0; click < 6; click += 1) {
      updated = advanceStage(updated, stage)
    }
    expect(updated).toEqual(original)
  })
})
