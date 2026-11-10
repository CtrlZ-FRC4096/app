import { describe, expect, it } from 'vitest'
import { countRange, latestPeriod, periodOn, rangeText, type Period } from './periods'

const preseason: Period = { id: 'pre', name: '2026 preseason', first_day: '2026-01-01', last_day: '2026-01-09' }
const build: Period = { id: 'build', name: '2026 build season', first_day: '2026-01-10', last_day: '2026-04-18' }
const week1: Period = { id: 'week1', name: 'Week 1', first_day: '2026-01-10', last_day: '2026-01-16' }
const offseason: Period = { id: 'off', name: '2026 offseason', first_day: '2026-05-01', last_day: null }
const periods = [preseason, build, offseason]

describe('the period that includes a day', () => {
  it('runs from its first day to its last, forever with no last day, is the narrowest when periods overlap, and is none between periods', () => {
    const cases: [string, Period[], string, Period | null][] = [
      ['last day of preseason', periods, '2026-01-09', preseason],
      ['first day of build season', periods, '2026-01-10', build],
      ['last day of build season', periods, '2026-04-18', build],
      ['no last day', periods, '2027-03-01', offseason],
      ['between periods', periods, '2026-04-25', null],
      ['inside week 1, inside build season', [build, week1], '2026-01-12', week1],
      ['after week 1, still build season', [build, week1], '2026-02-01', build],
    ]
    for (const [label, list, day, expected] of cases) expect(periodOn(list, day), label).toBe(expected)
  })
})

describe('the most recent period', () => {
  it("is today's period, or else the last one that started, or none before any has started", () => {
    // A period that hasn't started yet doesn't count.
    const fall: Period = { id: 'fall', name: 'Fall 2026', first_day: '2026-09-01', last_day: '2026-12-20' }
    const nextBuild: Period = { id: 'next', name: '2027 build season', first_day: '2027-01-09', last_day: null }
    const cases: [string, Period[], string, Period | null][] = [
      ["today's period", periods, '2026-02-01', build],
      ["today's narrowest period", [build, week1], '2026-01-12', week1],
      ['between build season and the offseason, still build season', periods, '2026-04-25', build],
      ['not one that starts later', [preseason, build, fall, nextBuild], '2026-12-28', fall],
      ['before any has started', periods, '2025-12-01', null],
      ['with none saved', [], '2026-02-01', null],
    ]
    for (const [label, list, day, expected] of cases) expect(latestPeriod(list, day), label).toBe(expected)
  })
})

describe('what gets counted', () => {
  it('starts on the most recent period, or counts everything before any period has started or with none saved', () => {
    expect(countRange(null, periods, '2026-02-01')).toEqual({ choice: 'build', from: '2026-01-10', to: '2026-04-18', period: build })
    expect(countRange(null, periods, '2026-04-25')).toEqual({ choice: 'build', from: '2026-01-10', to: '2026-04-18', period: build })
    expect(countRange(null, periods, '2026-06-01')).toEqual({ choice: 'off', from: '2026-05-01', to: undefined, period: offseason })
    expect(countRange(null, periods, '2025-12-01')).toEqual({ choice: 'all', period: null })
    expect(countRange(null, [], '2026-02-01')).toEqual({ choice: 'all', period: null })
  })

  it('counts a period someone picked, or all time, or their own dates, going back to the most recent period if the picked one was removed', () => {
    expect(countRange({ kind: 'period', id: 'pre' }, periods, '2026-02-01')).toMatchObject({ choice: 'pre', from: '2026-01-01', to: '2026-01-09' })
    expect(countRange({ kind: 'all' }, periods, '2026-02-01')).toEqual({ choice: 'all', period: null })
    expect(countRange({ kind: 'custom', from: '2026-01-06', to: '' }, periods, '2026-02-01')).toEqual({ choice: 'custom', from: '2026-01-06', to: undefined, period: null })
    expect(countRange({ kind: 'period', id: 'gone' }, periods, '2026-02-01').period).toBe(build)
  })
})

describe('describing dates', () => {
  it('leaves out the first year when both are in the same one, and says when either end is open', () => {
    const cases: [string | undefined, string | undefined, string][] = [
      ['2026-01-10', '2026-04-18', 'Jan 10 – Apr 18, 2026'],
      ['2025-12-01', '2026-01-09', 'Dec 1, 2025 – Jan 9, 2026'],
      ['2026-01-08', '2026-01-08', 'Jan 8, 2026'],
      ['2026-05-01', undefined, 'May 1, 2026 onward'],
      [undefined, '2026-04-18', 'Up to Apr 18, 2026'],
      [undefined, undefined, 'All time'],
    ]
    for (const [from, to, text] of cases) expect(rangeText(from, to), `${from} to ${to}`).toBe(text)
  })
})
