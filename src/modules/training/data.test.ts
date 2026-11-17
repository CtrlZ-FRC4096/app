// Tests for data.ts. Run them with `npm test`. They run in demo mode, as
// Alex, the made-up student, unless a test says otherwise. Who may do what is
// the database's job: that's tested in supabase/tests/training-progress.test.ts
// and supabase/tests/training-signoffs.test.ts.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import { membersTable } from '../../core/members'
import type { Role } from '../../core/roles'
import {
  COURSES,
  SKILLS,
  WIKI,
  cancelRequest,
  doneLessons,
  everyonesProgress,
  learners,
  markDone,
  markNotDone,
  progress,
  progressTable,
  progressText,
  requestSignOff,
  signOff,
  signOffPeople,
  signOffsTable,
  takeBack,
  turnDown,
  useDoneLessons,
  useLessonSummary,
  useMySignOffs,
  useSignOffAttention,
  waitingRequests,
  waitingTime,
  type LessonDone,
} from './data'

const lessons = COURSES.flatMap((course) => course.lessons)

/** Runs a hook the way a page would, and gives back what it returned. */
function runHook<T>(hook: () => T): T {
  let value: T | undefined
  function Component() {
    value = hook()
    return null
  }
  renderToString(createElement(Component))
  return value as T
}

beforeEach(() => {
  progressTable.reset()
  signOffsTable.reset()
})

afterEach(() => setDemoRole('student'))

describe('COURSES', () => {
  it('gives every lesson a title and an address on the team wiki', () => {
    expect(lessons.length).toBeGreaterThan(0)
    for (const lesson of lessons) {
      expect(lesson.title.trim()).not.toBe('')
      expect(lesson.url.startsWith(WIKI)).toBe(true)
    }
    expect(WIKI).toBe('https://wiki.team4096.org/')
  })

  it('has no empty courses, and no lesson listed twice', () => {
    for (const course of COURSES) expect(course.lessons.length).toBeGreaterThan(0)
    expect(new Set(COURSES.map((course) => course.name)).size).toBe(COURSES.length)
    expect(new Set(lessons.map((lesson) => lesson.url)).size).toBe(lessons.length)
    expect(new Set(lessons.map((lesson) => lesson.id)).size).toBe(lessons.length)
  })

  it('gives every lesson an id of lowercase words joined by dashes', () => {
    for (const lesson of lessons) expect(lesson.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('keeps the ids that people have already saved progress under', () => {
    // These were on the list before, so progress is saved under them. If one
    // fails here, put its id back: changing an id loses everyone's progress.
    const saved = ['code-first-button', 'code-first-sequence', 'code-first-rule', 'controls-tuning-flywheel', 'controls-tuning-elevator']
    expect(lessons.map((lesson) => lesson.id)).toEqual(expect.arrayContaining(saved))
  })

  it('only has example progress for lessons on the list', () => {
    for (const row of progressTable.rows()) expect(lessons.map((lesson) => lesson.id)).toContain(row.lesson_id)
  })
})

describe('doneLessons and progress', () => {
  it("counts only the person's own lessons", () => {
    expect([...doneLessons(progressTable.rows(), DEMO_PEOPLE.alex)].sort()).toEqual(['code-first-button', 'code-first-sequence'])
    expect([...doneLessons(progressTable.rows(), DEMO_PEOPLE.jordan)]).toEqual(['code-first-button'])
  })

  it('says how many are done, ignoring lessons no longer on the list', () => {
    expect(progress(new Set(['code-first-button', 'an-old-lesson']))).toEqual({ done: 1, total: lessons.length })
    expect(progressText(new Set(['code-first-button', 'code-first-rule']))).toBe(`2 of ${lessons.length} done`)
  })
})

describe('markDone and markNotDone', () => {
  it('marks a lesson done, and the progress goes up', async () => {
    expect(runHook(useDoneLessons).has('code-first-rule')).toBe(false)
    expect(await markDone('code-first-rule')).toEqual({ ok: true, value: null })
    expect(runHook(useDoneLessons).has('code-first-rule')).toBe(true)
    expect(progress(runHook(useDoneLessons)).done).toBe(3)
  })

  it('marks a lesson not done, and the progress goes down', async () => {
    expect(await markNotDone('code-first-button')).toEqual({ ok: true, value: null })
    expect(runHook(useDoneLessons).has('code-first-button')).toBe(false)
    expect(progress(runHook(useDoneLessons)).done).toBe(1)
  })

  it("doesn't touch anyone else's progress", async () => {
    await markNotDone('code-first-button')
    expect(doneLessons(progressTable.rows(), DEMO_PEOPLE.jordan).has('code-first-button')).toBe(true)
  })

  it('does nothing when the lesson is already marked that way', async () => {
    const before = progressTable.rows().length
    expect((await markDone('code-first-button')).ok).toBe(true)
    expect((await markNotDone('code-first-rule')).ok).toBe(true)
    expect(progressTable.rows()).toHaveLength(before)
  })

  it("refuses a lesson that isn't on the list, and says what to do", async () => {
    expect(await markDone('an-old-lesson')).toEqual({ ok: false, error: "That lesson isn't on the list anymore. Reload the page." })
  })
})

describe('useLessonSummary', () => {
  it('says how many lessons the signed-in person has done', () => {
    expect(runHook(useLessonSummary)).toEqual({ tone: 'info', text: `2 of ${lessons.length} lessons done` })
  })

  it('turns green when every lesson is done', async () => {
    for (const lesson of lessons) await markDone(lesson.id)
    expect(runHook(useLessonSummary)).toEqual({ tone: 'ok', text: `${lessons.length} of ${lessons.length} lessons done` })
  })
})

describe("everyonesProgress (Everyone's progress, for mentors)", () => {
  const people = [
    { id: 'a', name: 'Avery' },
    { id: 'b', name: 'Blake' },
    { id: 'c', name: 'Cameron' },
    { id: 'd', name: 'Drew' },
  ]
  const finished = (created_by: string, lesson_id: string): LessonDone => ({ id: `${created_by}:${lesson_id}`, created_at: '', created_by, lesson_id })

  it('lists everyone given, least done first, including people with nothing done', () => {
    const rows = [finished('a', 'code-first-button'), finished('a', 'code-first-rule'), finished('c', 'code-first-button')]
    // Blake and Drew have no rows at all. People with the same count stay in the order given.
    expect(everyonesProgress(rows, people).map((person) => [person.name, person.done])).toEqual([
      ['Blake', 0],
      ['Drew', 0],
      ['Cameron', 1],
      ['Avery', 2],
    ])
    expect(everyonesProgress(rows, [])).toEqual([])
  })

  it("counts each course, and leaves out lessons no longer on the list and people who weren't given", () => {
    const rows = [finished('a', 'code-first-button'), finished('a', 'an-old-lesson'), finished('someone-else', 'code-first-rule')]
    const [avery] = everyonesProgress(rows, [people[0]])
    expect(avery).toMatchObject({ personId: 'a', done: 1, total: lessons.length })
    expect(avery.byCourse).toEqual(
      COURSES.map((course) => ({ name: course.name, done: course.lessons.some((l) => l.id === 'code-first-button') ? 1 : 0, total: course.lessons.length })),
    )
  })
})

describe('learners', () => {
  it('lists students and student leaders whose access is on, by name, and not mentors or admins', () => {
    // Sam's access is off; Pat is a mentor and Morgan an admin.
    expect(learners(membersTable.rows()).map((member) => member.name)).toEqual(['Alex Rivera', 'Casey Nguyen', 'Jordan Kim'])
  })
})

describe('SKILLS', () => {
  it('gives every skill a name and its own id, and links only to the team wiki', () => {
    expect(new Set(SKILLS.map((skill) => skill.id)).size).toBe(SKILLS.length)
    for (const skill of SKILLS) {
      expect(skill.name.trim()).not.toBe('')
      if (skill.url) expect(skill.url.startsWith(WIKI)).toBe(true)
    }
  })

  it('only has example sign-offs for skills on the list', () => {
    for (const row of signOffsTable.rows()) expect(SKILLS.map((skill) => skill.id)).toContain(row.skill_id)
  })
})

describe('requestSignOff and cancelRequest', () => {
  it('asks a mentor for a sign-off, and it waits for them', async () => {
    expect(await requestSignOff('band-saw')).toEqual({ ok: true, value: null })
    expect(runHook(useMySignOffs).get('band-saw')).toMatchObject({ status: 'requested', created_by: DEMO_PEOPLE.alex, signed_off_by: null })
  })

  it("refuses to ask twice, for a skill you're signed off on, or one that isn't on the list", async () => {
    // As Alex: drill press is waiting, and shop safety is signed off.
    const cases: [string, RegExp][] = [
      ['drill-press', /already asked/],
      ['shop-safety', /already signed off/],
      ['an-old-skill', /isn't on the list/],
    ]
    for (const [skillId, error] of cases) expect(await requestSignOff(skillId), skillId).toMatchObject({ ok: false, error: expect.stringMatching(error) })
    expect(signOffsTable.rows()).toHaveLength(signOffsTable.demoRows.length)
  })

  it('cancels your own waiting request, but not a sign-off', async () => {
    expect(await cancelRequest('drill-press')).toEqual({ ok: true, value: null })
    expect(runHook(useMySignOffs).has('drill-press')).toBe(false)
    expect(await cancelRequest('shop-safety')).toMatchObject({ ok: false, error: expect.stringMatching(/already signed you off/) })
    expect(runHook(useMySignOffs).get('shop-safety')?.status).toBe('signed_off')
    // Jordan's request is still there.
    expect(signOffsTable.rows().some((row) => row.created_by === DEMO_PEOPLE.jordan && row.status === 'requested')).toBe(true)
  })
})

describe('signing off (mentors and admins)', () => {
  const find = (person: string, skillId: string) => signOffsTable.rows().find((row) => row.created_by === person && row.skill_id === skillId)

  it('lists the waiting requests oldest first', () => {
    expect(waitingRequests(signOffsTable.rows()).map((row) => [row.created_by, row.skill_id])).toEqual([
      [DEMO_PEOPLE.jordan, 'soldering'],
      [DEMO_PEOPLE.alex, 'drill-press'],
    ])
  })

  it('says how long a request has waited, in hours under a day and days after that', () => {
    const now = new Date('2026-11-16T12:00:00Z')
    const cases: [string, string][] = [
      ['2026-11-16T11:30:00Z', 'under an hour'],
      ['2026-11-16T11:00:00Z', '1 hour'],
      ['2026-11-16T00:30:00Z', '11 hours'],
      ['2026-11-15T12:00:00Z', '1 day'],
      ['2026-11-13T09:00:00Z', '3 days'],
    ]
    for (const [since, text] of cases) expect(waitingTime(since, now), since).toBe(text)
  })

  it('signs off a request, recording which mentor and when', async () => {
    setDemoRole('mentor')
    expect(await signOff(find(DEMO_PEOPLE.jordan, 'soldering')!)).toEqual({ ok: true, value: null })
    const row = find(DEMO_PEOPLE.jordan, 'soldering')
    expect(row).toMatchObject({ status: 'signed_off', signed_off_by: DEMO_PEOPLE.pat })
    expect(row?.signed_off_at).not.toBeNull()
  })

  it('turns down a request so they can ask again later, but not a sign-off', async () => {
    setDemoRole('mentor')
    expect(await turnDown(find(DEMO_PEOPLE.jordan, 'soldering')!)).toEqual({ ok: true, value: null })
    expect(find(DEMO_PEOPLE.jordan, 'soldering')).toBeUndefined()
    expect(await turnDown(find(DEMO_PEOPLE.alex, 'shop-safety')!)).toMatchObject({ ok: false, error: expect.stringMatching(/Take back/) })
  })

  it('signs off several people at once, with or without a request, leaving anyone already signed off as they are', async () => {
    setDemoRole('admin')
    const alexsShopSafety = find(DEMO_PEOPLE.alex, 'shop-safety')
    // Alex asked for the drill press; Jordan didn't (and is chosen twice).
    expect(await signOffPeople('drill-press', [DEMO_PEOPLE.alex, DEMO_PEOPLE.jordan, DEMO_PEOPLE.jordan])).toEqual({ ok: true, value: 2 })
    for (const person of [DEMO_PEOPLE.alex, DEMO_PEOPLE.jordan]) {
      expect(find(person, 'drill-press')).toMatchObject({ status: 'signed_off', signed_off_by: DEMO_PEOPLE.morgan })
    }
    // Alex is already signed off on shop safety, by Pat.
    expect(await signOffPeople('shop-safety', [DEMO_PEOPLE.alex])).toEqual({ ok: true, value: 0 })
    expect(find(DEMO_PEOPLE.alex, 'shop-safety')).toEqual(alexsShopSafety)
  })

  it("needs someone chosen, and a skill that's on the list", async () => {
    setDemoRole('mentor')
    const cases: [string, string[], RegExp][] = [
      ['drill-press', [], /Choose who/],
      ['an-old-skill', [DEMO_PEOPLE.jordan], /isn't on the list/],
    ]
    for (const [skillId, people, error] of cases) expect(await signOffPeople(skillId, people), skillId).toMatchObject({ ok: false, error: expect.stringMatching(error) })
  })

  it('takes back a sign-off made by mistake', async () => {
    setDemoRole('mentor')
    expect(await takeBack(find(DEMO_PEOPLE.alex, 'shop-safety')!)).toEqual({ ok: true, value: null })
    expect(find(DEMO_PEOPLE.alex, 'shop-safety')).toBeUndefined()
  })

  it('tells students and student leaders that only mentors and admins sign off', async () => {
    for (const role of ['student', 'leader'] as const) {
      setDemoRole(role)
      const results = [
        await signOff(find(DEMO_PEOPLE.jordan, 'soldering')!),
        await turnDown(find(DEMO_PEOPLE.jordan, 'soldering')!),
        await signOffPeople('band-saw', [DEMO_PEOPLE.jordan]),
        await takeBack(find(DEMO_PEOPLE.alex, 'shop-safety')!),
      ]
      for (const result of results) expect(result, role).toMatchObject({ ok: false, error: expect.stringMatching(/mentors and admins/) })
    }
    expect(signOffsTable.rows()).toHaveLength(signOffsTable.demoRows.length)
  })
})

describe('useSignOffAttention', () => {
  it('tells mentors and admins how many sign-offs are waiting, and nobody else', async () => {
    const cases: [Role, string[]][] = [
      ['mentor', ['2 sign-offs waiting.']],
      ['admin', ['2 sign-offs waiting.']],
      ['leader', []],
      ['student', []],
    ]
    for (const [role, texts] of cases) expect(runHook(() => useSignOffAttention(role)).map((notice) => notice.text), role).toEqual(texts)
    // Nothing waiting: nothing to say.
    for (const request of waitingRequests(signOffsTable.rows())) await signOffsTable.remove(request.id)
    expect(runHook(() => useSignOffAttention('mentor'))).toEqual([])
  })
})
