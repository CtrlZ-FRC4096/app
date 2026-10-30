import { describe, expect, it } from 'vitest'
import { countRange, latestPeriod, periodOn, rangeText, type Period } from './periods'

const preseason: Period = { id: 'pre', name: '2026 preseason', first_day: '2026-01-01', last_day: '2026-01-09' }
const build: Period = { id: 'build', name: '2026 build season', first_day: '2026-01-10', last_day: '2026-04-18' }
const week1: Period = { id: 'week1', name: 'Week 1', first_day: '2026-01-10', last_day: '2026-01-16' }
const offseason: Period = { id: 'off', name: '2026 offseason', first_day: '2026-05-01', last_day: null }
const periods = [preseason, build, offseason]

describe('the period that includes a day', () => {
  it('includes its first and last days', () => {
    expect(periodOn(periods, '2026-01-09')).toBe(preseason)
    expect(periodOn(periods, '2026-01-10')).toBe(build)
    expect(periodOn(periods, '2026-04-18')).toBe(build)
  })

  it('goes on forever when it has no last day', () => {
    expect(periodOn(periods, '2027-03-01')).toBe(offseason)
  })

  it('is none between periods', () => {
    expect(periodOn(periods, '2026-04-25')).toBeNull()
  })

  it('is the narrowest when periods overlap', () => {
    expect(periodOn([build, week1], '2026-01-12')).toBe(week1)
    expect(periodOn([build, week1], '2026-02-01')).toBe(build)
  })
})

describe('the most recent period', () => {
  it("is today's period when there is one", () => {
    expect(latestPeriod(periods, '2026-02-01')).toBe(build)
    expect(latestPeriod([build, week1], '2026-01-12')).toBe(week1)
  })

  it('is the last one that started, between periods', () => {
    // Between build season and the offseason, it's still build season.
    expect(latestPeriod(periods, '2026-04-25')).toBe(build)
    // A period that hasn't started yet doesn't count.
    const fall: Period = { id: 'fall', name: 'Fall 2026', first_day: '2026-09-01', last_day: '2026-12-20' }
    const nextBuild: Period = { id: 'next', name: '2027 build season', first_day: '2027-01-09', last_day: null }
    expect(latestPeriod([preseason, build, fall, nextBuild], '2026-12-28')).toBe(fall)
  })

  it('is none before any period has started', () => {
    expect(latestPeriod(periods, '2025-12-01')).toBeNull()
    expect(latestPeriod([], '2026-02-01')).toBeNull()
  })
})

describe('what gets counted', () => {
  it('starts on the most recent period', () => {
    expect(countRange(null, periods, '2026-02-01')).toEqual({ choice: 'build', from: '2026-01-10', to: '2026-04-18', period: build })
    expect(countRange(null, periods, '2026-04-25')).toEqual({ choice: 'build', from: '2026-01-10', to: '2026-04-18', period: build })
    expect(countRange(null, periods, '2026-06-01')).toEqual({ choice: 'off', from: '2026-05-01', to: undefined, period: offseason })
  })

  it('counts everything before any period has started, or with none saved', () => {
    expect(countRange(null, periods, '2025-12-01')).toEqual({ choice: 'all', period: null })
    expect(countRange(null, [], '2026-02-01')).toEqual({ choice: 'all', period: null })
  })

  it('counts a period someone picked, or all time, or their own dates', () => {
    expect(countRange({ kind: 'period', id: 'pre' }, periods, '2026-02-01')).toMatchObject({ choice: 'pre', from: '2026-01-01', to: '2026-01-09' })
    expect(countRange({ kind: 'all' }, periods, '2026-02-01')).toEqual({ choice: 'all', period: null })
    expect(countRange({ kind: 'custom', from: '2026-01-06', to: '' }, periods, '2026-02-01')).toEqual({ choice: 'custom', from: '2026-01-06', to: undefined, period: null })
  })

  it('goes back to the most recent period if the picked one was removed', () => {
    expect(countRange({ kind: 'period', id: 'gone' }, periods, '2026-02-01').period).toBe(build)
  })
})

describe('describing dates', () => {
  it('leaves out the first year when both are in the same one', () => {
    expect(rangeText('2026-01-10', '2026-04-18')).toBe('Jan 10 – Apr 18, 2026')
    expect(rangeText('2025-12-01', '2026-01-09')).toBe('Dec 1, 2025 – Jan 9, 2026')
    expect(rangeText('2026-01-08', '2026-01-08')).toBe('Jan 8, 2026')
  })

  it('says when either end is open', () => {
    expect(rangeText('2026-05-01')).toBe('May 1, 2026 onward')
    expect(rangeText(undefined, '2026-04-18')).toBe('Up to Apr 18, 2026')
    expect(rangeText()).toBe('All time')
  })
})
