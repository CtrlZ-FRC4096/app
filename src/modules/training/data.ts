/**
 * Training data: the team's lessons, grouped by course, and which ones each
 * person has finished.
 *
 * The lessons live on the wiki, so the list here is only links to them. It
 * doesn't change from the app, so it isn't in a table.
 *
 * Progress is in the training_progress table, made by
 * supabase/migrations/..._training_progress.sql: one row for each lesson a
 * person has finished. People only add and remove their own rows, and
 * mentors can see everyone's.
 */
import { DEMO_PEOPLE } from '../../core/demo'
import type { Notice } from '../../core/registry'
import { currentUser, useSession } from '../../core/session'
import { createTable, fail, ok, type Result, type Row } from '../../core/table'

/** Every lesson's address starts with this. */
export const WIKI = 'https://wiki.team4096.org/'

export interface Lesson {
  /**
   * Never change a lesson's id: progress is saved under it. Changing the
   * title or address is fine.
   */
  id: string
  /** As the wiki's menu shows it. */
  title: string
  /** The lesson's page on the wiki. */
  url: string
}

export interface Course {
  name: string
  /** In the order to do them. */
  lessons: Lesson[]
}

// To add a lesson, give it a new id, copy its title from the wiki's menu and
// its address from the browser, and add it to its course here. Leave out the
// number in front of some menu titles ("1. "): the order here does that job.
// Courses and lessons are in the wiki menu's order. Pages that are only
// reference, or still empty on the wiki, aren't lessons yet.
export const COURSES: Course[] = [
  {
    name: 'Getting Started with Code',
    lessons: [
      { id: 'code-setup', title: 'Setup', url: `${WIKI}docs/Code/Getting%20Started/setup/` },
      { id: 'code-frc-programming', title: 'Overview of FRC Programming', url: `${WIKI}docs/Code/Getting%20Started/overview/` },
      { id: 'code-subsystems-and-commands', title: 'Subsystems and Commands', url: `${WIKI}docs/Code/Getting%20Started/subystems/` },
      { id: 'code-github', title: 'Github', url: `${WIKI}docs/Code/Getting%20Started/github/` },
      { id: 'code-organization', title: 'Code Organization', url: `${WIKI}docs/Code/Getting%20Started/organization/` },
    ],
  },
  {
    name: 'Python',
    lessons: [
      { id: 'python-variables-and-types', title: 'Variables and Types', url: `${WIKI}docs/Code/Python%20Tutorials/01%20variables%20and%20types/` },
      { id: 'python-conditionals', title: 'Conditionals and Logic', url: `${WIKI}docs/Code/Python%20Tutorials/02%20conditionals/` },
      { id: 'python-lists-and-loops', title: 'Lists and Loops', url: `${WIKI}docs/Code/Python%20Tutorials/03%20lists%20and%20loops/` },
      { id: 'python-functions', title: 'Functions', url: `${WIKI}docs/Code/Python%20Tutorials/04%20functions/` },
      { id: 'python-classes', title: 'Classes and Objects', url: `${WIKI}docs/Code/Python%20Tutorials/05%20classes/` },
      { id: 'python-robotpy-patterns', title: 'RobotPy Patterns', url: `${WIKI}docs/Code/Python%20Tutorials/06%20robotpy%20patterns/` },
      { id: 'python-robotpy-in-our-code', title: 'RobotPy in Our Robot Code', url: `${WIKI}docs/Code/Python%20Tutorials/07%20robotpy%20in%20our%20code/` },
    ],
  },
  {
    name: 'Controls',
    lessons: [
      { id: 'controls-tuning', title: 'How to Tune a Controller', url: `${WIKI}docs/Code/Controls/tuning/` },
      { id: 'controls-tuning-flywheel', title: 'How to Tune a Flywheel', url: `${WIKI}docs/Code/Controls/tuning-flywheel/` },
      { id: 'controls-tuning-arm', title: 'How to Tune an Arm', url: `${WIKI}docs/Code/Controls/tuning-arm/` },
      { id: 'controls-tuning-elevator', title: 'How to Tune an Elevator', url: `${WIKI}docs/Code/Controls/tuning-elevator/` },
      { id: 'controls-operator-interface', title: 'Operator Interface', url: `${WIKI}docs/Code/Controls/operator-interface/` },
    ],
  },
  {
    name: 'Autonomous',
    lessons: [{ id: 'auto-planning-an-auto', title: 'How to Plan an Auto', url: `${WIKI}docs/Code/Autonomous/planning-an-auto/` }],
  },
  {
    name: 'Code Tutorials',
    lessons: [
      { id: 'code-first-button', title: 'Give a Button a Job', url: `${WIKI}docs/Code/Tutorials/first-button/` },
      { id: 'code-first-sequence', title: 'Put the Steps in Order', url: `${WIKI}docs/Code/Tutorials/first-sequence/` },
      { id: 'code-first-rule', title: 'Teach the Robot to Decide', url: `${WIKI}docs/Code/Tutorials/first-rule/` },
      { id: 'code-joystick-deadband', title: 'Joystick Deadbands', url: `${WIKI}docs/Code/Tutorials/joystick-deadband/` },
      { id: 'code-unit-conversions', title: 'Unit Conversions', url: `${WIKI}docs/Code/Tutorials/unit-conversions/` },
      { id: 'code-swerve-module-optimization', title: 'Swerve Module Optimization', url: `${WIKI}docs/Code/Tutorials/swerve-module-optimization/` },
    ],
  },
  {
    name: 'Code Challenges',
    lessons: [
      { id: 'challenge-jam-detector', title: 'Find the Game Piece with the Motor Current', url: `${WIKI}docs/Code/Challenges/jam-detector/` },
      { id: 'challenge-shoot-on-the-fly', title: 'Shoot While You Are Moving', url: `${WIKI}docs/Code/Challenges/shoot-on-the-fly/` },
      { id: 'challenge-vision-latency', title: 'Trust a Camera That Tells You the Past', url: `${WIKI}docs/Code/Challenges/vision-latency/` },
      { id: 'challenge-second-order-swerve', title: 'Drive Straight While You Spin', url: `${WIKI}docs/Code/Challenges/second-order-swerve/` },
    ],
  },
]

const LESSONS = COURSES.flatMap((course) => course.lessons)

/** One row of the training_progress table: someone finished a lesson. */
export interface LessonDone extends Row {
  /** A lesson's id from COURSES. */
  lesson_id: string
  /** Who finished it. */
  created_by: string
}

// Made-up progress for demo mode. Alex is who you are when you view the app
// as a student.
const EXAMPLE_PROGRESS: LessonDone[] = [
  {
    id: '00000000-0000-4000-8000-0000007a0001',
    lesson_id: 'code-first-button',
    created_at: '2026-11-02T00:30:00Z',
    created_by: DEMO_PEOPLE.alex,
  },
  {
    id: '00000000-0000-4000-8000-0000007a0002',
    lesson_id: 'code-first-sequence',
    created_at: '2026-11-04T01:10:00Z',
    created_by: DEMO_PEOPLE.alex,
  },
  {
    id: '00000000-0000-4000-8000-0000007a0003',
    lesson_id: 'code-first-button',
    created_at: '2026-11-03T23:45:00Z',
    created_by: DEMO_PEOPLE.jordan,
  },
]

export const progressTable = createTable<LessonDone>('training_progress', { demo: EXAMPLE_PROGRESS })

/** The ids of the lessons `personId` has finished. */
export function doneLessons(rows: LessonDone[], personId: string): Set<string> {
  return new Set(rows.filter((row) => row.created_by === personId).map((row) => row.lesson_id))
}

/** The ids of the lessons the signed-in person has finished. */
export function useDoneLessons(): Set<string> {
  const { id } = useSession()
  return doneLessons(progressTable.useRows(), id)
}

/** How many of the lessons in COURSES are done, out of how many. Ids of lessons no longer listed don't count. */
export function progress(done: Set<string>): { done: number; total: number } {
  return { done: LESSONS.filter((lesson) => done.has(lesson.id)).length, total: LESSONS.length }
}

/** "3 of 11 done". */
export function progressText(done: Set<string>): string {
  const counts = progress(done)
  return `${counts.done} of ${counts.total} done`
}

/** The signed-in person's row for a lesson, if they've finished it. */
function myRow(lessonId: string): LessonDone | undefined {
  const me = currentUser()
  return progressTable.rows().find((row) => row.created_by === me?.id && row.lesson_id === lessonId)
}

/** Mark a lesson done for the signed-in person. Marking one that's already done does nothing. */
export async function markDone(lessonId: string): Promise<Result> {
  if (!LESSONS.some((lesson) => lesson.id === lessonId)) return fail("That lesson isn't on the list anymore. Reload the page.")
  if (!currentUser()) return fail('Sign in to keep track of your lessons.')
  if (myRow(lessonId)) return ok(null)
  const result = await progressTable.insert({ lesson_id: lessonId })
  return result.ok ? ok(null) : result
}

/** Mark a lesson not done for the signed-in person. Marking one that isn't done does nothing. */
export async function markNotDone(lessonId: string): Promise<Result> {
  if (!currentUser()) return fail('Sign in to keep track of your lessons.')
  const row = myRow(lessonId)
  return row ? progressTable.remove(row.id) : ok(null)
}

/** The home page tile's status: how many lessons the signed-in person has done. */
export function useLessonSummary(): Notice {
  const done = useDoneLessons()
  const counts = progress(done)
  return { tone: counts.done === counts.total ? 'ok' : 'info', text: `${counts.done} of ${counts.total} lessons done` }
}
