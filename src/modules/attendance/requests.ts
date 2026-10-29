/**
 * Requests for missing hours: someone asks for hours Jibble missed (a
 * forgotten check-out, or a session they didn't check in for), and a
 * mentor approves or declines. Approving adds the times as check-ins and
 * check-outs made by hand, so hours and points update.
 *
 * Plain rules with no data here, tested in requests.test.ts. The table,
 * asking and deciding are in data.ts.
 */
import type { Tone } from '../../core/registry'
import { teamClock } from './time'

export type RequestStatus = 'pending' | 'approved' | 'declined'

/** What someone fills in to ask. Leave a time empty ('') when Jibble has it already. */
export interface HoursRequestInput {
  /** The meeting day, like "2026-01-13". */
  day: string
  /** When they checked in, like "18:00", or '' if Jibble has it. */
  inClock: string
  /** When they checked out, like "20:30", or '' if Jibble has it. */
  outClock: string
  /** What happened, for the mentor deciding. */
  note: string
}

/** The database allows the same: see the note column in the requests migration. */
export const MAX_REQUEST_NOTE = 300

const DAY = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

/** Why a request can't be sent, or null if it can. `today` is like "2026-01-20". */
export function checkRequest(input: HoursRequestInput, today: string): string | null {
  if (!DAY.test(input.day)) return 'Pick the day.'
  if (input.day > today) return "That day hasn't happened yet."
  if (!input.inClock && !input.outClock) return 'Fill in when you checked in, when you checked out, or both.'
  if (input.inClock && !CLOCK.test(input.inClock)) return 'Enter the check-in time like 18:00.'
  if (input.outClock && !CLOCK.test(input.outClock)) return 'Enter the check-out time like 20:30.'
  if (input.inClock && input.outClock && input.outClock <= input.inClock) return 'The check-out has to be after the check-in.'
  const note = input.note.trim()
  if (!note) return 'Say what happened, like "Forgot to check out" or "Jibble was down".'
  if (note.length > MAX_REQUEST_NOTE) return `Keep it under ${MAX_REQUEST_NOTE} characters. This is ${note.length}.`
  return null
}

/** "In 18:00, out 20:30", or just "Out 20:30". */
export function requestTimes(request: { in_at: string | null; out_at: string | null }): string {
  const parts = [request.in_at && `in ${teamClock(request.in_at)}`, request.out_at && `out ${teamClock(request.out_at)}`].filter(Boolean)
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const STATUS_LABEL: Record<RequestStatus, string> = { pending: 'Waiting', approved: 'Approved', declined: 'Declined' }
export const STATUS_TONE: Record<RequestStatus, Tone> = { pending: 'info', approved: 'ok', declined: 'warn' }
