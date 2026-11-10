// Tests for the Build progress grid. Moved from Robot status (#65, step 1).
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

describe('advanceStage', () => {
  // Not started → In progress → Done → back to Not started, so clicking keeps cycling.
  const transitions: [StageState, StageState][] = [
    ['Not started', 'In progress'],
    ['In progress', 'Done'],
    ['Done', 'Not started'],
  ]

  it('moves each stage on one step, without changing other cells or the input', () => {
    for (const stage of STAGES) {
      for (const [current, next] of transitions) {
        const label = `${stage}: ${current} → ${next}`
        const subsystems = structuredClone(SUBSYSTEMS)
        const subsystem = subsystems[0]
        subsystem.stages[stage] = current
        const before = structuredClone(subsystems)

        const updated = advanceStage(subsystem, stage)

        expect(updated, label).toEqual({
          ...before[0], stages: { ...before[0].stages, [stage]: next },
        })
        expect(updated, label).not.toBe(subsystem)
        expect(updated.stages, label).not.toBe(subsystem.stages)
        expect(subsystems, label).toEqual(before)
      }
    }
  })
})
