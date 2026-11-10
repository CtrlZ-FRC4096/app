// Tests for data.ts. Run them with `npm test`. They run in demo mode, as
// Alex, the made-up student. Who may do what is the database's job: that's
// tested in supabase/tests/training-progress.test.ts.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_PEOPLE } from '../../core/demo'
import { COURSES, WIKI, doneLessons, markDone, markNotDone, progress, progressTable, progressText, useDoneLessons, useLessonSummary } from './data'

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
})

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
    expect(new Set(lessons.map((lesson) => lesson.url)).size).toBe(lessons.length)
    expect(new Set(lessons.map((lesson) => lesson.id)).size).toBe(lessons.length)
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
