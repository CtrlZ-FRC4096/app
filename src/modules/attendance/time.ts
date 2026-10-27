/**
 * Days and times in team time.
 *
 * The team meets in Illinois, so a check-in at 6:09 PM belongs to that
 * evening's meeting whatever time zone the computer showing it is in.
 * Times are stored as exact instants (ISO strings); these turn them into
 * Central-time days and clock times and back.
 */

export const TEAM_TIME_ZONE = 'America/Chicago'

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: TEAM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function wallClock(instant: Date) {
  const get = (type: string) => Number(parts.formatToParts(instant).find((p) => p.type === type)!.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The team-time day of an instant, like "2026-01-09". */
export function teamDay(at: string | Date): string {
  const w = wallClock(new Date(at))
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`
}

/** The team-time clock time of an instant, like "18:09". */
export function teamClock(at: string | Date): string {
  const w = wallClock(new Date(at))
  return `${pad(w.hour)}:${pad(w.minute)}`
}

/** The instant (ISO) of a team-time day and clock time, like ("2026-01-09", "18:09"). */
export function teamInstant(day: string, clock: string): string {
  const [year, month, date] = day.split('-').map(Number)
  const [hour, minute] = clock.split(':').map(Number)
  const wanted = Date.UTC(year, month - 1, date, hour, minute)
  // Start from the clock time as if it were UTC, then shift by the
  // difference twice (once more in case the shift crossed a DST change).
  let guess = wanted
  for (let i = 0; i < 2; i++) {
    const w = wallClock(new Date(guess))
    guess += wanted - Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  }
  return new Date(guess).toISOString()
}

/** "Fri, Jan 9" for a day like "2026-01-09". */
export function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
}

/** Today's team-time day. */
export function today(now: Date = new Date()): string {
  return teamDay(now)
}

/** "12 minutes ago", "3 hours ago", "2 days ago". */
export function ago(at: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  return `${Math.round(hours / 24)} days ago`
}
