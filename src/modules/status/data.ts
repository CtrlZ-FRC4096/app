export const STAGES = ['Design', 'Built', 'Wired', 'Programmed', 'Tested'] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_STATES = ['Not started', 'In progress', 'Done'] as const
export type StageState = (typeof STAGE_STATES)[number]

export interface Subsystem {
  id: string
  name: string
  stages: Record<Stage, StageState>
}

function subsystem(id: string, name: string): Subsystem {
  return {
    id,
    name,
    stages: {
      Design: 'Not started',
      Built: 'Not started',
      Wired: 'Not started',
      Programmed: 'Not started',
      Tested: 'Not started',
    },
  }
}

// Starting data for the grid. Changes currently last only while the page is open.
export const SUBSYSTEMS: Subsystem[] = [
  subsystem('swerve-drivetrain', 'Swerve drivetrain'),
  subsystem('intake', 'Intake'),
  subsystem('indexer', 'Indexer'),
  subsystem('shooter', 'Shooter'),
  subsystem('climber', 'Climber'),
  subsystem('vision', 'Vision'),
]

/** Return a copy with only the selected stage advanced, wrapping Done to Not started. */
export function advanceStage(subsystem: Subsystem, stage: Stage): Subsystem {
  const nextIndex = (STAGE_STATES.indexOf(subsystem.stages[stage]) + 1) % STAGE_STATES.length
  return {
    ...subsystem,
    stages: { ...subsystem.stages, [stage]: STAGE_STATES[nextIndex] },
  }
}
