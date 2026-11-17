/**
 * Training data: the team's lessons, grouped by course, and which ones each
 * person has finished; and the hands-on skills a mentor signs off in person.
 *
 * The lessons live on the wiki, so the list here is only links to them. It
 * doesn't change from the app, so it isn't in a table. The same goes for the
 * list of hands-on skills.
 *
 * Progress is in the training_progress table, made by
 * supabase/migrations/..._training_progress.sql: one row for each lesson a
 * person has finished. People only add and remove their own rows, and
 * mentors can see everyone's.
 *
 * Sign-offs are in the training_signoffs table, made by
 * supabase/migrations/..._training_signoffs.sql: one row for each skill a
 * person has asked for or been signed off on. Only mentors and admins sign
 * anyone off, and the database records who did it and when.
 */
import { DEMO_PEOPLE } from '../../core/demo'
import { plural } from '../../core/format'
import { membersTable, type Member } from '../../core/members'
import type { Notice } from '../../core/registry'
import { currentUser, isMentor, useSession, type Role } from '../../core/session'
import { isLive } from '../../core/supabase'
import { createTable, fail, ok, type Fields, type Result, type Row } from '../../core/table'

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

// ---------------------------------------------------------------------------
// Everyone's progress, for mentors and admins. The database only lets them
// read everyone's rows; everyone else gets just their own.

/** How far one person has got with the lessons. */
export interface PersonProgress {
  personId: string
  name: string
  /** How many lessons in COURSES they've done, out of how many. */
  done: number
  total: number
  /** Each course in COURSES, in order, with how many of its lessons they've done. */
  byCourse: { name: string; done: number; total: number }[]
  /** The ids of the lessons they've done. */
  lessons: Set<string>
}

/**
 * One line for each person in `people`, least done first, so the people who
 * need a nudge are on top. People with the same count stay in the order
 * given. Someone with nothing done has no rows, which is why the list comes
 * from `people` and not from the rows. Lessons no longer in COURSES don't
 * count.
 */
export function everyonesProgress(rows: LessonDone[], people: { id: string; name: string }[]): PersonProgress[] {
  return people
    .map((person) => {
      const lessons = doneLessons(rows, person.id)
      return {
        personId: person.id,
        name: person.name,
        ...progress(lessons),
        byCourse: COURSES.map((course) => ({
          name: course.name,
          done: course.lessons.filter((lesson) => lessons.has(lesson.id)).length,
          total: course.lessons.length,
        })),
        lessons,
      }
    })
    .sort((a, b) => a.done - b.done)
}

/**
 * The people mentors keep track of: students and student leaders whose
 * access is on, by name. Mentors and admins aren't listed.
 */
export function learners(members: Member[]): Member[] {
  return members.filter((member) => member.active && !isMentor(member.role))
}

/** The people mentors keep track of, by name. See learners(). */
export function useLearners(): Member[] {
  return learners(membersTable.useRows())
}

/** Everyone's progress with the lessons, least done first. */
export function useEveryonesProgress(): PersonProgress[] {
  return everyonesProgress(progressTable.useRows(), useLearners())
}

// ---------------------------------------------------------------------------
// Hands-on skills: things a mentor has to watch you do before you use the
// tool on your own. Students ask for a sign-off; mentors sign them off.

export interface Skill {
  /** Never change a skill's id: sign-offs are saved under it. Changing the name or address is fine. */
  id: string
  name: string
  /** Its page on the wiki, if it has one. */
  url?: string
}

// A mentor decides this list. To add a skill, give it a new id and add it
// here; the database doesn't need changing.
export const SKILLS: Skill[] = [
  { id: 'shop-safety', name: 'Shop safety' },
  { id: 'drill-press', name: 'Drill press' },
  { id: 'band-saw', name: 'Band saw' },
  { id: 'crimping', name: 'Crimping', url: `${WIKI}docs/Electrical/Skills/` },
  { id: 'soldering', name: 'Soldering', url: `${WIKI}docs/Electrical/Skills/Soldering/` },
  { id: 'cnc-router', name: 'CNC router' },
]

/** A skill's name, from its id. */
export function skillName(skillId: string): string {
  return SKILLS.find((skill) => skill.id === skillId)?.name ?? 'A skill no longer on the list'
}

/**
 * One row of the training_signoffs table: someone asked for a sign-off
 * ('requested'), or a mentor has signed them off ('signed_off').
 */
export interface SignOff extends Row {
  /** A skill's id from SKILLS. */
  skill_id: string
  /** Whose sign-off it is. */
  created_by: string
  status: 'requested' | 'signed_off'
  /** The mentor who signed it off, and when. Empty until then. The database fills these in. */
  signed_off_by: string | null
  signed_off_at: string | null
}

// Made-up sign-offs for demo mode. As Alex (View as: Student) you see one of
// each: signed off, waiting, and not asked yet.
const EXAMPLE_SIGNOFFS: SignOff[] = [
  {
    id: '00000000-0000-4000-8000-0000007b0001',
    skill_id: 'shop-safety',
    status: 'signed_off',
    signed_off_by: DEMO_PEOPLE.pat,
    signed_off_at: '2026-11-12T23:30:00Z',
    created_at: '2026-11-10T23:00:00Z',
    created_by: DEMO_PEOPLE.alex,
  },
  {
    id: '00000000-0000-4000-8000-0000007b0002',
    skill_id: 'soldering',
    status: 'requested',
    signed_off_by: null,
    signed_off_at: null,
    created_at: '2026-11-09T22:40:00Z',
    created_by: DEMO_PEOPLE.jordan,
  },
  {
    id: '00000000-0000-4000-8000-0000007b0003',
    skill_id: 'drill-press',
    status: 'requested',
    signed_off_by: null,
    signed_off_at: null,
    created_at: '2026-11-13T00:15:00Z',
    created_by: DEMO_PEOPLE.alex,
  },
  {
    id: '00000000-0000-4000-8000-0000007b0004',
    skill_id: 'shop-safety',
    status: 'signed_off',
    signed_off_by: DEMO_PEOPLE.morgan,
    signed_off_at: '2026-11-12T23:30:00Z',
    created_at: '2026-11-12T23:30:00Z',
    created_by: DEMO_PEOPLE.casey,
  },
]

export const signOffsTable = createTable<SignOff>('training_signoffs', { demo: EXAMPLE_SIGNOFFS })

/** `personId`'s sign-offs and requests, by skill id. */
export function signOffsFor(rows: SignOff[], personId: string): Map<string, SignOff> {
  return new Map(rows.filter((row) => row.created_by === personId).map((row) => [row.skill_id, row]))
}

/** The signed-in person's sign-offs and requests, by skill id. */
export function useMySignOffs(): Map<string, SignOff> {
  const { id } = useSession()
  return signOffsFor(signOffsTable.useRows(), id)
}

/** Every sign-off and request the signed-in person can see: their own, or everyone's for mentors. */
export function useAllSignOffs(): SignOff[] {
  return signOffsTable.useRows()
}

/** The signed-in person's row for a skill, if they've asked for it or been signed off. */
function mySignOff(skillId: string): SignOff | undefined {
  const me = currentUser()
  return signOffsTable.rows().find((row) => row.created_by === me?.id && row.skill_id === skillId)
}

/** Ask a mentor to sign the signed-in person off on a skill. */
export async function requestSignOff(skillId: string): Promise<Result> {
  if (!SKILLS.some((skill) => skill.id === skillId)) return fail("That skill isn't on the list anymore. Reload the page.")
  if (!currentUser()) return fail('Sign in to ask for a sign-off.')
  const mine = mySignOff(skillId)
  if (mine?.status === 'requested') return fail("You've already asked for this one. A mentor will sign you off once they've watched you do it.")
  if (mine?.status === 'signed_off') return fail("You're already signed off on this one.")
  // The team database fills in the status and the rest, and doesn't let
  // anyone set them; demo mode needs them here.
  const fields = { skill_id: skillId }
  const row = isLive ? fields : { ...fields, status: 'requested' as const, signed_off_by: null, signed_off_at: null }
  const result = await signOffsTable.insert(row as Fields<SignOff>)
  return result.ok ? ok(null) : result
}

/** Take back the signed-in person's request for a skill, while it's still waiting. Cancelling one that isn't there does nothing. */
export async function cancelRequest(skillId: string): Promise<Result> {
  if (!currentUser()) return fail('Sign in to change your sign-offs.')
  const mine = mySignOff(skillId)
  if (!mine) return ok(null)
  if (mine.status === 'signed_off') return fail("A mentor has already signed you off on this one, so there's nothing to cancel.")
  return signOffsTable.remove(mine.id)
}

// ---------------------------------------------------------------------------
// Signing off, for mentors and admins. The database refuses anyone else, and
// fills in who signed off and when itself, so neither can be faked (see
// supabase/migrations/..._training_signoffs_mentors.sql).

const MENTORS_ONLY = 'Only mentors and admins can sign off skills.'

/** The signed-in person, if they're a mentor or admin. */
function signedInMentor() {
  const me = currentUser()
  return me && isMentor(me.role) ? me : null
}

/** Requests waiting for a mentor, oldest first. */
export function waitingRequests(rows: SignOff[]): SignOff[] {
  return rows.filter((row) => row.status === 'requested').sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** Requests waiting for a mentor, oldest first. */
export function useWaitingRequests(): SignOff[] {
  return waitingRequests(signOffsTable.useRows())
}

const HOUR = 60 * 60 * 1000

/** How long a request has been waiting: "under an hour", "5 hours" or "3 days". */
export function waitingTime(since: string, now: Date = new Date()): string {
  const hours = Math.floor((now.getTime() - Date.parse(since)) / HOUR)
  if (hours < 1) return 'under an hour'
  if (hours < 24) return plural(hours, 'hour', 'hours')
  return plural(Math.floor(hours / 24), 'day', 'days')
}

/** Mark a row signed off by `mentorId`. */
async function markSignedOff(id: string, mentorId: string): Promise<Result> {
  // The team database records who and when itself; demo mode does it here.
  const changes = isLive ? { status: 'signed_off' as const } : { status: 'signed_off' as const, signed_off_by: mentorId, signed_off_at: new Date().toISOString() }
  const result = await signOffsTable.update(id, changes)
  return result.ok ? ok(null) : result
}

/** Sign off a request, after watching the person do the skill. */
export async function signOff(request: SignOff): Promise<Result> {
  const me = signedInMentor()
  if (!me) return fail(MENTORS_ONLY)
  if (request.status === 'signed_off') return ok(null)
  return markSignedOff(request.id, me.id)
}

/** "Not yet": turn down a request. It's deleted, so the person can ask again later. */
export async function turnDown(request: SignOff): Promise<Result> {
  if (!signedInMentor()) return fail(MENTORS_ONLY)
  if (request.status !== 'requested') return fail("That one's already signed off. Use Take back if it was a mistake.")
  return signOffsTable.remove(request.id)
}

/**
 * Sign several people off on a skill at once, with or without a request,
 * such as after a shop safety session. People already signed off are left
 * as they are. Answers how many were newly signed off.
 */
export async function signOffPeople(skillId: string, personIds: string[]): Promise<Result<number>> {
  const me = signedInMentor()
  if (!me) return fail(MENTORS_ONLY)
  if (!SKILLS.some((skill) => skill.id === skillId)) return fail("That skill isn't on the list anymore. Reload the page.")
  if (personIds.length === 0) return fail('Choose who to sign off first.')
  let count = 0
  for (const personId of new Set(personIds)) {
    const existing = signOffsTable.rows().find((row) => row.created_by === personId && row.skill_id === skillId)
    if (existing?.status === 'signed_off') continue
    const result = existing ? await markSignedOff(existing.id, me.id) : await addSignOff(skillId, personId, me.id)
    if (!result.ok) return count === 0 ? result : fail(`${plural(count, 'person was', 'people were')} signed off, then it stopped: ${result.error}`)
    count += 1
  }
  return ok(count)
}

/** Sign off someone who hasn't asked. */
async function addSignOff(skillId: string, personId: string, mentorId: string): Promise<Result> {
  // created_by is whose sign-off it is: the person, not the mentor adding it.
  // Usually the database fills it in, which is why Fields leaves it out.
  const fields = { skill_id: skillId, created_by: personId, status: 'signed_off' as const }
  const row = isLive ? fields : { ...fields, signed_off_by: mentorId, signed_off_at: new Date().toISOString() }
  const result = await signOffsTable.insert(row as unknown as Fields<SignOff>)
  return result.ok ? ok(null) : result
}

/** Take back a sign-off made by mistake. It's deleted, so the person can ask again later. */
export async function takeBack(signOffRow: SignOff): Promise<Result> {
  if (!signedInMentor()) return fail(MENTORS_ONLY)
  return signOffsTable.remove(signOffRow.id)
}

/** For mentors and admins on the home page: how many sign-offs are waiting. */
export function useSignOffAttention(role: Role): Notice[] {
  const waiting = useWaitingRequests()
  if (!isMentor(role) || waiting.length === 0) return []
  return [{ tone: 'warn', text: `${plural(waiting.length, 'sign-off', 'sign-offs')} waiting.` }]
}
