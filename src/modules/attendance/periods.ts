/**
 * Points periods: the dates attendance points are counted over.
 *
 * Mentors save periods like "2027 build season" (data.ts). Everyone starts a
 * period with the base points and only its meetings count, so last season's
 * points don't carry into this one. The tab opens on the period that
 * includes today; a mentor can switch to another period, all time, or dates
 * they pick.
 */
import { dateLabel } from './time'

export interface Period {
  id: string
  name: string
  /** Like "2026-01-10". */
  first_day: string
  /** Null while the period is still going. */
  last_day: string | null
}

/** What to count over: null for the period that includes today, or what a mentor picked. */
export type Counting = null | { kind: 'all' } | { kind: 'period'; id: string } | { kind: 'custom'; from: string; to: string }

export interface CountRange<P extends Period> {
  /** The picker's value: 'all', 'custom', or a period's id. */
  choice: string
  /** First and last day counted. Missing means no limit. */
  from?: string
  to?: string
  /** The saved period being counted, if it is one. */
  period: P | null
}

export function covers(period: Period, day: string): boolean {
  return period.first_day <= day && (period.last_day === null || day <= period.last_day)
}

/** The period that includes a day. If several do, the narrowest: the one that started last, then ends first. */
export function periodOn<P extends Period>(periods: P[], day: string): P | null {
  const end = (p: Period) => p.last_day ?? '9999-12-31'
  return periods.filter((p) => covers(p, day)).sort((a, b) => b.first_day.localeCompare(a.first_day) || end(a).localeCompare(end(b)))[0] ?? null
}

/** The dates to count. A picked period that has since been removed falls back to today's. */
export function countRange<P extends Period>(counting: Counting, periods: P[], today: string): CountRange<P> {
  if (counting?.kind === 'all') return { choice: 'all', period: null }
  if (counting?.kind === 'custom') return { choice: 'custom', from: counting.from || undefined, to: counting.to || undefined, period: null }
  const picked = counting?.kind === 'period' ? periods.find((p) => p.id === counting.id) : undefined
  const period = picked ?? periodOn(periods, today)
  if (!period) return { choice: 'all', period: null }
  return { choice: period.id, from: period.first_day, to: period.last_day ?? undefined, period }
}

/** "Jan 10 – Apr 18, 2026", "Jan 10, 2026 onward", "Up to Apr 18, 2026" or "All time". */
export function rangeText(from?: string, to?: string): string {
  if (from && from === to) return dateLabel(from)
  if (from && to) {
    const start = dateLabel(from)
    const end = dateLabel(to)
    return from.slice(0, 4) === to.slice(0, 4) ? `${start.replace(/, \d{4}$/, '')} – ${end}` : `${start} – ${end}`
  }
  if (from) return `${dateLabel(from)} onward`
  if (to) return `Up to ${dateLabel(to)}`
  return 'All time'
}
