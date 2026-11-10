/**
 * Batteries module data: the team's robot batteries, and where each one is
 * in its cycle, so the pit crew knows which to use next.
 *
 * The batteries table is made by supabase/migrations/..._batteries.sql,
 * which also sets who can do what: anyone on the team moves a battery to
 * its next status; only mentors and admins add, rename, retire and delete
 * batteries. The database checks that too, so these checks are only so the
 * page can say why straight away.
 */
import { DEMO_PEOPLE } from '../../core/demo'
import { plural } from '../../core/format'
import type { Notice } from '../../core/registry'
import { currentUser, isMentor } from '../../core/session'
import { createTable, fail, type Result, type Row } from '../../core/table'

/**
 * The statuses, in the order a battery goes through them. The page shows
 * them in this order too, so Charged comes first. After the last one, a
 * battery goes back to the first.
 *
 * To change them, change this list. Batteries saved with a status that's no
 * longer here still show, under their old status, and move on to Needs
 * charging, so they get checked.
 */
export const STATUSES = [
  { name: 'Charged', hint: 'Ready to use' },
  { name: 'In the robot', hint: 'In the robot now' },
  { name: 'Needs charging', hint: 'Just came out of the robot' },
  { name: 'Charging', hint: 'On the charger' },
  { name: 'Resting', hint: 'Off the charger, cooling down before use' },
]

/** Where a battery with a status that's no longer in STATUSES goes next. */
const AFTER_UNKNOWN = 'Needs charging'

/** One row of the batteries table. The fields match its columns. */
export interface Battery extends Row {
  /** The number written on the battery, like 2026-3. */
  name: string
  /** One of STATUSES. */
  status: string
  /** When the status last changed. The database sets it. */
  status_changed_at: string
  /** No longer used by the team. Retired batteries aren't listed by status. */
  retired: boolean
  notes: string
  /** Who added it. */
  created_by: string | null
}

export const NAME_LIMIT = 30
export const NOTES_LIMIT = 500

// Made-up batteries for demo mode, changed a little while before the page
// opened, so "how long ago" looks like it would in the pit.
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const example = (id: string, name: string, status: string, minutes: number, more: Partial<Battery> = {}): Battery => ({
  id,
  name,
  status,
  status_changed_at: minutesAgo(minutes),
  retired: false,
  notes: '',
  created_at: '2026-01-10T18:00:00Z',
  created_by: DEMO_PEOPLE.pat,
  ...more,
})

const EXAMPLE_BATTERIES: Battery[] = [
  example('00000000-0000-4000-8000-0000000ba701', '2026-1', 'Charged', 95),
  example('00000000-0000-4000-8000-0000000ba702', '2026-2', 'Charged', 40),
  example('00000000-0000-4000-8000-0000000ba703', '2026-3', 'In the robot', 6),
  example('00000000-0000-4000-8000-0000000ba704', '2026-4', 'Needs charging', 12),
  example('00000000-0000-4000-8000-0000000ba705', '2026-5', 'Charging', 25),
  example('00000000-0000-4000-8000-0000000ba706', '2026-6', 'Charging', 50),
  example('00000000-0000-4000-8000-0000000ba707', '2026-7', 'Resting', 15, { notes: 'Terminal bolt was loose, tightened.' }),
  example('00000000-0000-4000-8000-0000000ba708', '2026-8', 'Charged', 180),
  example('00000000-0000-4000-8000-0000000ba709', '2024-5', 'Resting', 60 * 24 * 90, { retired: true, notes: 'Cracked case. Kept for parts.' }),
]

export const batteriesTable = createTable<Battery>('batteries', {
  demo: EXAMPLE_BATTERIES,
  sort: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
})

/** Every battery, retired ones too, in order by number. */
export function useBatteries(): Battery[] {
  return batteriesTable.useRows()
}

/** The status a battery moves to next. */
export function nextStatus(status: string): string {
  const i = STATUSES.findIndex((s) => s.name === status)
  return i === -1 ? AFTER_UNKNOWN : STATUSES[(i + 1) % STATUSES.length].name
}

export interface StatusGroup {
  status: string
  /** What the status means, or '' for one that's no longer in STATUSES. */
  hint: string
  /** The longest in this status first: in Charged, that's the one to use next. */
  batteries: Battery[]
}

/**
 * The batteries in use, grouped by status in the order of STATUSES (Charged
 * first). Every status has a group, even an empty one, so the pit crew can
 * see "Charged: none". Statuses no longer in STATUSES come last.
 */
export function groupByStatus(batteries: Battery[]): StatusGroup[] {
  const inUse = batteries.filter((b) => !b.retired).sort((a, b) => a.status_changed_at.localeCompare(b.status_changed_at))
  const known = STATUSES.map((s) => ({ status: s.name, hint: s.hint, batteries: inUse.filter((b) => b.status === s.name) }))
  const others = [...new Set(inUse.map((b) => b.status).filter((status) => !STATUSES.some((s) => s.name === status)))]
  return [...known, ...others.map((status) => ({ status, hint: '', batteries: inUse.filter((b) => b.status === status) }))]
}

/** How long ago something happened: "just now", "5 minutes ago", "2 hours ago", "3 days ago". */
export function ago(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${plural(minutes, 'minute', 'minutes')} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${plural(hours, 'hour', 'hours')} ago`
  return `${plural(Math.floor(hours / 24), 'day', 'days')} ago`
}

/** Move a battery to its next status. Anyone on the team can. */
export async function moveToNext(battery: Battery): Promise<Result<Battery>> {
  if (!currentUser()) return fail('Sign in to change a battery.')
  // The database sets status_changed_at to its own time; this is for demo mode.
  return batteriesTable.update(battery.id, { status: nextStatus(battery.status), status_changed_at: new Date().toISOString() })
}

/** The home page tile's status: "4 charged · 2 charging". */
export function useBatterySummary(): Notice {
  const inUse = useBatteries().filter((b) => !b.retired)
  if (inUse.length === 0) return { tone: 'plain', text: 'No batteries yet' }
  const charged = inUse.filter((b) => b.status === 'Charged').length
  const charging = inUse.filter((b) => b.status === 'Charging').length
  return { tone: charged > 0 ? 'ok' : 'warn', text: `${charged} charged · ${charging} charging` }
}

// ---------------------------------------------------------------------------
// Adding, renaming, retiring and deleting batteries: mentors and admins only.

const MENTORS_ONLY = 'Only mentors and admins add, rename, retire or delete batteries. Ask one of them.'

/** What a mentor fills in to add or change a battery. */
export interface BatteryFields {
  name: string
  notes: string
}

/** Why a battery can't be saved, or null if it can. `batteries` is every battery, to check the number isn't taken. */
export function checkBattery(fields: BatteryFields, batteries: Battery[], id?: string): string | null {
  const name = fields.name.trim()
  if (!name) return 'Enter the number written on the battery, like 2026-3.'
  if (name.length > NAME_LIMIT) return `Keep the number under ${NAME_LIMIT} characters.`
  if (fields.notes.trim().length > NOTES_LIMIT) return `Keep the notes under ${NOTES_LIMIT} characters.`
  const taken = batteries.find((b) => b.name.toLowerCase() === name.toLowerCase() && b.id !== id)
  if (taken) return `There's already a battery called ${taken.name}${taken.retired ? ' (retired)' : ''}. Give this one a different number.`
  return null
}

function mentorProblem(): string | null {
  const me = currentUser()
  return me && isMentor(me.role) ? null : MENTORS_ONLY
}

/** Add a battery, Charged to start with. */
export async function addBattery(fields: BatteryFields): Promise<Result<Battery>> {
  const problem = mentorProblem() ?? checkBattery(fields, batteriesTable.rows())
  if (problem) return fail(problem)
  return batteriesTable.insert({
    name: fields.name.trim(),
    notes: fields.notes.trim(),
    status: STATUSES[0].name,
    status_changed_at: new Date().toISOString(),
    retired: false,
  })
}

/** Rename a battery, change its notes, or retire it (or bring it back). */
export async function changeBattery(battery: Battery, changes: BatteryFields & { retired: boolean }): Promise<Result<Battery>> {
  const problem = mentorProblem() ?? checkBattery(changes, batteriesTable.rows(), battery.id)
  if (problem) return fail(problem)
  return batteriesTable.update(battery.id, { name: changes.name.trim(), notes: changes.notes.trim(), retired: changes.retired })
}

/** Delete a battery. Retiring keeps it on record; delete one added by mistake. */
export async function removeBattery(battery: Battery): Promise<Result> {
  const problem = mentorProblem()
  if (problem) return fail(problem)
  return batteriesTable.remove(battery.id)
}
