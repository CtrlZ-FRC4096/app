// Tests for the rules for requests for missing hours (requests.ts).
import { describe, expect, it } from 'vitest'
import { checkRequest, MAX_REQUEST_NOTE, requestTimes } from './requests'
import { teamInstant } from './time'

const TODAY = '2026-01-20'
const ok = { day: '2026-01-13', inClock: '18:00', outClock: '20:30', note: 'Jibble was down' }

describe('checkRequest', () => {
  it('allows a whole session, or just a missing check-in or check-out', () => {
    expect(checkRequest(ok, TODAY)).toBeNull()
    expect(checkRequest({ ...ok, inClock: '' }, TODAY)).toBeNull()
    expect(checkRequest({ ...ok, outClock: '' }, TODAY)).toBeNull()
    expect(checkRequest({ ...ok, day: TODAY }, TODAY)).toBeNull()
  })

  it('says what to fix', () => {
    expect(checkRequest({ ...ok, day: '' }, TODAY)).toBe('Pick the day.')
    expect(checkRequest({ ...ok, day: '2026-01-21' }, TODAY)).toBe("That day hasn't happened yet.")
    expect(checkRequest({ ...ok, inClock: '', outClock: '' }, TODAY)).toMatch(/^Fill in when you checked in/)
    expect(checkRequest({ ...ok, outClock: '17:00' }, TODAY)).toBe('The check-out has to be after the check-in.')
    expect(checkRequest({ ...ok, inClock: '6pm' }, TODAY)).toMatch(/like 18:00/)
    expect(checkRequest({ ...ok, note: '  ' }, TODAY)).toMatch(/^Say what happened/)
    expect(checkRequest({ ...ok, note: 'x'.repeat(MAX_REQUEST_NOTE + 1) }, TODAY)).toMatch(/under 300/)
  })
})

describe('requestTimes', () => {
  it('lists the times asked for, in Central time', () => {
    const day = '2026-01-13'
    expect(requestTimes({ in_at: teamInstant(day, '18:00'), out_at: teamInstant(day, '20:30') })).toBe('In 18:00, out 20:30')
    expect(requestTimes({ in_at: null, out_at: teamInstant(day, '20:30') })).toBe('Out 20:30')
  })
})
