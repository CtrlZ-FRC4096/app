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
  /** Points the alliance gets for each one, for a team's average points (APS) and the simulator. Leave out for none. */
  points?: number
}

// Points: check them against this season's game manual with the scouting lead.
export const COUNTERS: Counter[] = [
  { key: 'autoFuel', label: 'Auto fuel scored', points: 1 },
  { key: 'teleopFuel', label: 'Teleop fuel scored', points: 1 },
  { key: 'fuelMissed', label: 'Fuel missed', lowerIsBetter: true },
]

/** How the robot finished the match. The first is the starting choice. */
export const ENDGAME: string[] = ['None', 'Level 1', 'Level 2', 'Level 3']

/** Points for each ENDGAME choice. A choice left out scores 0. */
export const ENDGAME_POINTS: Record<string, number> = { 'Level 1': 10, 'Level 2': 20, 'Level 3': 30 }

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

// ---------------------------------------------------------------------------
// The field, for drawing a robot's auto path on the match form (#205).
//
// Everything is in metres, seen from above with the blue driver station wall
// on the left (x = 0) and the field's long side across. y is measured down
// the picture from the top edge. Only the blue alliance's landmarks are
// listed: the red ones are drawn from them with FIELD.symmetry.
//
// The sizes and places come from our robot code (robot/field_const.py and
// robot/simulation/field.py, which use WPILib's 2026 REBUILT AprilTag map).
// CHECK AGAINST THE GAME MANUAL before an event: the field size, and every
// landmark marked "check" below.

/** A shape drawn on the field to help the scout find their way. */
export interface Landmark {
  /** What it is, for the scout. Leave out to draw it with no words. */
  label?: string
  /** Left edge and top edge, from the blue wall and the top of the picture. */
  x: number
  y: number
  width: number
  height: number
  /**
   * 'solid': something robots can't drive through (the hub, the tower).
   * 'floor': something on the floor (bumps, trenches, the depot).
   * 'line': a tape line (give it a width or a height of 0).
   */
  look: 'solid' | 'floor' | 'line'
  /** True if the field has only one of these (the centre line), so it isn't drawn again for red. */
  shared?: boolean
}

export interface Field {
  /** Metres from one driver station wall to the other. */
  length: number
  /** Metres across, from one side wall to the other. */
  width: number
  /**
   * How red's half matches blue's. 'rotate': turn blue's half round 180°
   * (red's depot is on the opposite side from blue's). 'mirror': flip it
   * across the centre line (red's depot is on the same side as blue's).
   */
  symmetry: 'rotate' | 'mirror'
  landmarks: Landmark[]
}

const FIELD_LENGTH = 16.541
const FIELD_WIDTH = 8.069
/** The hub's centre is this far from the blue wall (the robot code's hubCenter). */
const HUB_X = 4.626
const HUB_SIZE = 1.194

export const FIELD: Field = {
  length: FIELD_LENGTH,
  width: FIELD_WIDTH,
  // REBUILT's field is turned round, not mirrored: in the robot code the red
  // tower is at width − blue tower's y. Check against the game manual.
  symmetry: 'rotate',
  landmarks: [
    // The robot starting line: the edge of the alliance zone, at the hub's near face. Check.
    { x: HUB_X - HUB_SIZE / 2, y: 0, width: 0, height: FIELD_WIDTH, look: 'line' },
    // The centre line.
    { x: FIELD_LENGTH / 2, y: 0, width: 0, height: FIELD_WIDTH, look: 'line', shared: true },
    // The two bumps, either side of the hub: 73 in across, 44.4 in deep.
    { x: HUB_X - 0.564, y: FIELD_WIDTH / 2 - HUB_SIZE / 2 - 1.854, width: 1.128, height: 1.854, look: 'floor' },
    { x: HUB_X - 0.564, y: FIELD_WIDTH / 2 + HUB_SIZE / 2, width: 1.128, height: 1.854, look: 'floor' },
    // The two trenches, along the side walls, with their wall next to the bump.
    { label: 'Trench', x: HUB_X - HUB_SIZE / 2, y: 0, width: HUB_SIZE, height: 1.584, look: 'floor' },
    { label: 'Trench', x: HUB_X - HUB_SIZE / 2, y: FIELD_WIDTH - 1.584, width: HUB_SIZE, height: 1.584, look: 'floor' },
    { label: 'Hub', x: HUB_X - HUB_SIZE / 2, y: FIELD_WIDTH / 2 - HUB_SIZE / 2, width: HUB_SIZE, height: HUB_SIZE, look: 'solid' },
    // Against the blue wall, just below the middle: 49.25 in wide, 45 in deep.
    { label: 'Tower', x: 0, y: 3.7, width: 1.143, height: 1.251, look: 'solid' },
    // A floor bin of fuel against the wall, above the middle: 42 in wide, 27 in deep.
    { label: 'Depot', x: 0, y: 1.572, width: 0.686, height: 1.067, look: 'floor' },
    // The human player's chute in the bottom corner, 31.8 in wide. Check where
    // it is: its place here is a guess from AprilTag 29, and its depth is only for drawing.
    { label: 'Outpost', x: 0, y: 6.999, width: 0.25, height: 0.808, look: 'solid' },
  ],
}

/** Something the robot did at one spot in auto, placed on the field as a mark. Keep these few. */
export interface AutoMarkType {
  /** Never change a key once entries are saved with it. */
  key: string
  /** What the scout sees. */
  label: string
  /** One letter shown in the mark on the field. */
  letter: string
}

export const AUTO_MARKS: AutoMarkType[] = [
  { key: 'pickup', label: 'Picked up', letter: 'P' },
  { key: 'shot', label: 'Shot', letter: 'S' },
  { key: 'climb', label: 'Climbed', letter: 'C' },
]
