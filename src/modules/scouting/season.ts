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

/** Match form: the parts a robot can break, asked when Broke down is ticked. Scouts can choose more than one. */
export const BREAKDOWN_PARTS: string[] = ['Drivetrain', 'Intake', 'Shooter', 'Climber', 'Other']

/**
 * Match form: this season's bonus ranking points, so the scout can tick the
 * ones the robot's alliance earned. Check the names with the scouting lead.
 */
export const RANKING_POINTS: string[] = ['Energized', 'Supercharged', 'Traversal']

/**
 * Pit form: the drivetrain choices, the common ones first. Keep 'Other' last:
 * choosing it shows a box to type the drivetrain, and the team page counts
 * anything typed, or no longer on this list, as Other.
 */
export const DRIVETRAINS: string[] = ['Swerve', 'Tank', 'Mecanum', 'H-drive', 'Other']

/**
 * Pit form: "What can their robot see?" Scouts can choose more than one.
 * The requirements mark this as a maybe: check it with the scouting lead.
 */
export const VISION: string[] = ['AprilTags', 'Game piece detection', 'None']

/** Pit form, and the match form's observed auto: which side of the field a robot starts its auto on. */
export const AUTO_SIDES: string[] = ['Left', 'Center', 'Right']

/**
 * The event the app uses until a mentor picks one in the app (Change event,
 * at the top of every Scouting page). The way The Blue Alliance names it:
 * the year and a short code, like 2026ilch. You don't need to change it
 * before each event any more: pick the event in the app instead (see "The
 * event" in README.md). Demo mode's example data is for this event.
 */
export const EVENT_KEY = '2026ilch'
