/**
 * This season's scouting form. The form is drawn from these settings, so
 * next season only this file changes: add, remove or rename counters and
 * endgame choices here, and the page follows.
 *
 * 2026: REBUILT. Check these with the scouting lead before an event.
 */

/** One number the scout counts with − and + buttons. */
export interface Counter {
  /** Never change a key once entries are saved with it. */
  key: string
  /** What the scout sees. */
  label: string
}

export const COUNTERS: Counter[] = [
  { key: 'autoFuel', label: 'Auto fuel scored' },
  { key: 'teleopFuel', label: 'Teleop fuel scored' },
  { key: 'fuelMissed', label: 'Fuel missed' },
]

/** How the robot finished the match. The first is the starting choice. */
export const ENDGAME: string[] = ['None', 'Level 1', 'Level 2', 'Level 3']
