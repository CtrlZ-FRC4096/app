/**
 * Team part numbers (#21), like 4096-26-INT-014: team, year, system code,
 * then a number. The first three make the part's series (4096-26-INT).
 *
 * - nextPartNumber() gives the next number in a series. It never gives out a
 *   number used before, even by a part that's since been deleted, so an old
 *   printed drawing never points at the wrong part.
 * - To know what was used before, the database remembers the highest number
 *   each series has used, in bom_part_counters
 *   (supabase/migrations/..._bom_part_counters.sql). Nobody writes those rows
 *   from the app: a trigger raises them when a part is added or renumbered.
 *   In demo mode there's no database, so rememberNumbers() does it instead.
 *
 * data.ts passes these on, so pages and other modules import them from there.
 * The parts' functions that use them (adding parts, numbering parts,
 * writing numbers into Onshape) are in data.ts.
 */
import { createTable, type Row } from '../../core/table'
import { isLive } from '../../core/supabase'
import type { BomSystem, Part } from './data'

/** The start of this season's part numbers: team and year. */
export const PART_NUMBER_PREFIX = '4096-26'

/** One row of bom_part_counters: the highest number one series has used. */
export interface PartCounter extends Row {
  /** Team, year and system code, like 4096-26-INT. */
  series: string
  /** The highest number used in the series: 6 for 4096-26-INT-006. */
  last_number: number
}

// The example parts in data.ts go up to 006 in both systems.
const EXAMPLE_COUNTERS: PartCounter[] = [
  { id: '00000000-0000-4000-8000-0000000b3001', series: '4096-26-INT', last_number: 6, created_at: '2026-10-20T18:00:00Z' },
  { id: '00000000-0000-4000-8000-0000000b3002', series: '4096-26-DRV', last_number: 6, created_at: '2026-10-20T18:01:00Z' },
]

export const countersTable = createTable<PartCounter>('bom_part_counters', { demo: EXAMPLE_COUNTERS })

/** Every series' counter, for a component. */
export function useCounters(): PartCounter[] {
  return countersTable.useRows()
}

// The same pattern as the database's trigger: 4096, a 2-digit year, a 2 to 4 letter code, and up to 6 digits.
const TEAM_NUMBER = /^(4096-\d{2}-[A-Z]{2,4})-(\d{1,6})$/

/** A team number's series and number: 4096-26-INT-014 is series 4096-26-INT, number 14. Null for any other number. */
export function readTeamNumber(partNumber: string): { series: string; number: number } | null {
  const found = TEAM_NUMBER.exec(partNumber.trim())
  return found ? { series: found[1], number: Number(found[2]) } : null
}

/** Is this one of our numbers, like 4096-26-INT-014? A vendor's number, or one typed into Onshape, isn't. */
export function isTeamNumber(partNumber: string): boolean {
  return readTeamNumber(partNumber) !== null
}

/** A system's series this season, like 4096-26-INT. */
export function seriesFor(system: Pick<BomSystem, 'code'>): string {
  return `${PART_NUMBER_PREFIX}-${system.code}`
}

/**
 * The next part number in a system, like 4096-26-INT-007: one more than the
 * highest number its series has ever used. That's the higher of what the
 * database remembers (`counters`) and the parts there are now (`parts`, so
 * a part added a moment ago counts even before its counter arrives). Gaps
 * are skipped, never filled: a gap is usually a deleted part.
 */
export function nextPartNumber(system: Pick<BomSystem, 'code'>, parts: Pick<Part, 'part_number'>[], counters: Pick<PartCounter, 'series' | 'last_number'>[] = []): string {
  const series = seriesFor(system)
  const remembered = counters.find((c) => c.series === series)?.last_number ?? 0
  const used = parts.map((p) => readTeamNumber(p.part_number)).filter((n) => n?.series === series).map((n) => n!.number)
  const next = Math.max(remembered, ...used) + 1
  return `${series}-${String(next).padStart(3, '0')}`
}

/**
 * Demo mode only: remember part numbers that were just saved, the way the
 * database's trigger does. Raises a series' counter, never lowers it. Does
 * nothing in live mode, where the database does it by itself.
 */
export async function rememberNumbers(partNumbers: string[]): Promise<void> {
  if (isLive) return
  for (const partNumber of partNumbers) {
    const found = readTeamNumber(partNumber)
    if (!found) continue
    const counter = countersTable.rows().find((c) => c.series === found.series)
    if (!counter) await countersTable.insert({ series: found.series, last_number: found.number })
    else if (found.number > counter.last_number) await countersTable.update(counter.id, { last_number: found.number })
  }
}
