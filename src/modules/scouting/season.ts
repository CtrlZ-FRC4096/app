/**
 * This season's scouting form. The form is drawn from these settings, so
 * next season only this file changes: add, remove or rename counters,
 * endgame choices and roles here, and the page follows.
 *
 * 2026: REBUILT. Check these with the scouting lead before an event.
 */

/** One number the scout counts with − and + buttons. */
export interface Counter {
  /** Never change a key once entries are saved with it. */
  key: string
  /** What the scout sees. */
  label: string
  /** True if fewer is better, like fuel missed. The picklist ranks these the other way round. */
  lowerIsBetter?: boolean
}

export const COUNTERS: Counter[] = [
  { key: 'autoFuel', label: 'Auto fuel scored' },
  { key: 'teleopFuel', label: 'Teleop fuel scored' },
  { key: 'fuelMissed', label: 'Fuel missed', lowerIsBetter: true },
]

/** How the robot finished the match. The first is the starting choice. */
export const ENDGAME: string[] = ['None', 'Level 1', 'Level 2', 'Level 3']

/** What the robot spent the match doing. Scouts can choose more than one, or none. */
export const ROLES: string[] = ['Scorer', 'Defender', 'Feeder']

/** Pit form: the drivetrain choices. */
export const DRIVETRAINS: string[] = ['Swerve', 'Tank', 'Mecanum', 'H-drive', 'Other omni/holonomic']

/** Pit form: which side of the field a robot starts its auto on. */
export const AUTO_SIDES: string[] = ['Left', 'Center', 'Right']

/**
 * The event the app uses until a mentor picks one in the app (Change event,
 * at the top of every Scouting page). The way The Blue Alliance names it:
 * the year and a short code, like 2026ilch. You don't need to change it
 * before each event any more: pick the event in the app instead (see "The
 * event" in README.md). Demo mode's example data is for this event.
 */
export const EVENT_KEY = '2026ilch'
