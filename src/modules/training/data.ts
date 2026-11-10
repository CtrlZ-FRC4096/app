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
// its address from the browser, and add it to its course here.
export const COURSES: Course[] = [
  {
    name: 'Code',
    lessons: [
      { id: 'code-first-button', title: 'Give a Button a Job', url: `${WIKI}docs/Code/Tutorials/first-button/` },
      { id: 'code-first-sequence', title: 'Put the Steps in Order', url: `${WIKI}docs/Code/Tutorials/first-sequence/` },
      { id: 'code-first-rule', title: 'Teach the Robot to Decide', url: `${WIKI}docs/Code/Tutorials/first-rule/` },
    ],
  },
  {
    name: 'Controls',
    lessons: [
      { id: 'controls-tuning-flywheel', title: 'How to Tune a Flywheel', url: `${WIKI}docs/Code/Controls/tuning-flywheel/` },
      { id: 'controls-tuning-elevator', title: 'How to Tune an Elevator', url: `${WIKI}docs/Code/Controls/tuning-elevator/` },
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
