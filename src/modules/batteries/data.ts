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
import { createTable, fail, newestFirst, type Result, type Row } from '../../core/table'
import { getSchedule, type TbaMatch } from '../scouting/data'

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

/**
 * A battery is tired when its latest internal resistance reading is above
 * this, in ohms. A new battery reads around 0.011 to 0.015.
 *
 * 0.020 is a common starting point, not the team's decision yet: ask the
 * electrical lead what limit to use, and change it here.
 */
export const TIRED_RESISTANCE_OHMS = 0.02

/** Our team, to find our next match in the event schedule. */
export const OUR_TEAM = 4096

/** The status where the page asks which match the battery is for. */
export const IN_THE_ROBOT = 'In the robot'

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

/**
 * Move a battery to its next status, and add it to the battery's history.
 * Anyone on the team can. `match` is which match it's for, when it's going
 * In the robot, like "Qual 12"; it's ignored for other statuses.
 */
export async function moveToNext(battery: Battery, match = ''): Promise<Result<Battery>> {
  if (!currentUser()) return fail('Sign in to change a battery.')
  const status = nextStatus(battery.status)
  const forMatch = status === IN_THE_ROBOT ? match.trim() : ''
  if (forMatch.length > MATCH_LIMIT) return fail(`Keep the match under ${MATCH_LIMIT} characters, like "Qual 12".`)
  // The database sets status_changed_at to its own time; this is for demo mode.
  const moved = await batteriesTable.update(battery.id, { status, status_changed_at: new Date().toISOString() })
  if (!moved.ok) return moved
  // Two steps, like Inventory's changeStock(): the status first, then the history line.
  const logged = await logTable.insert({ battery_id: battery.id, kind: 'status', status, match: forMatch || null, voltage: null, resistance_ohms: null })
  return logged.ok ? moved : fail(`${battery.name} is ${status} now, but its history didn't save: ${logged.error}`)
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

/** Delete a battery, and its history with it. Retiring keeps both on record; delete one added by mistake. */
export async function removeBattery(battery: Battery): Promise<Result> {
  const problem = mentorProblem()
  if (problem) return fail(problem)
  return batteriesTable.remove(battery.id)
}

// ---------------------------------------------------------------------------
// History: status changes and tester readings, in the batteries_log table
// (supabase/migrations/..._batteries_log.sql). Anyone adds to it and reads
// it; nobody edits or deletes it.

/** One row of the batteries_log table. The fields match its columns. */
export interface LogEntry extends Row {
  battery_id: string
  kind: 'status' | 'reading'
  /** For a status change: the status it moved to. */
  status: string | null
  /** For a move to In the robot: which match, like "Qual 12". */
  match: string | null
  /** For a reading: volts. */
  voltage: number | null
  /** For a reading: internal resistance, in ohms. */
  resistance_ohms: number | null
  /** Who did it. Show their name with useMemberNames(). */
  created_by: string
}

export const MATCH_LIMIT = 40

const logExample = (id: string, batteryName: string, minutes: number, fields: Partial<LogEntry>): LogEntry => ({
  id,
  battery_id: EXAMPLE_BATTERIES.find((b) => b.name === batteryName)!.id,
  kind: 'status',
  status: null,
  match: null,
  voltage: null,
  resistance_ohms: null,
  created_at: minutesAgo(minutes),
  created_by: DEMO_PEOPLE.jordan,
  ...fields,
})

// Made-up history. 2026-8 reads tired, so Next up skips it.
const EXAMPLE_LOG: LogEntry[] = [
  logExample('00000000-0000-4000-8000-0000000ba801', '2026-1', 60 * 26, { kind: 'reading', voltage: 12.95, resistance_ohms: 0.013 }),
  logExample('00000000-0000-4000-8000-0000000ba802', '2026-1', 60 * 25, { status: IN_THE_ROBOT, match: 'Practice 4' }),
  logExample('00000000-0000-4000-8000-0000000ba803', '2026-8', 60 * 48, { kind: 'reading', voltage: 12.8, resistance_ohms: 0.024 }),
  logExample('00000000-0000-4000-8000-0000000ba804', '2026-4', 70, { status: IN_THE_ROBOT, match: 'Qual 1' }),
  logExample('00000000-0000-4000-8000-0000000ba805', '2026-4', 12, { status: 'Needs charging' }),
  logExample('00000000-0000-4000-8000-0000000ba806', '2026-3', 6, { status: IN_THE_ROBOT, match: 'Qual 2' }),
]

export const logTable = createTable<LogEntry>('batteries_log', { demo: EXAMPLE_LOG, sort: newestFirst })

/** Every battery's history, newest first. */
export function useLog(): LogEntry[] {
  return logTable.useRows()
}

/** One battery's history, newest first. */
export function historyFor(batteryId: string, log: LogEntry[]): LogEntry[] {
  return log.filter((entry) => entry.battery_id === batteryId).sort(newestFirst)
}

/** A battery's latest tester reading, or null if it has none. */
export function latestReading(batteryId: string, log: LogEntry[]): LogEntry | null {
  return historyFor(batteryId, log).find((entry) => entry.kind === 'reading') ?? null
}

/** Whether a battery's latest internal resistance reading is above TIRED_RESISTANCE_OHMS. */
export function isTired(batteryId: string, log: LogEntry[]): boolean {
  const reading = historyFor(batteryId, log).find((entry) => entry.kind === 'reading' && entry.resistance_ohms !== null)
  return reading !== undefined && Number(reading.resistance_ohms) > TIRED_RESISTANCE_OHMS
}

/** The matches a battery was put in the robot for, newest first. If the robot browned out, this says which battery it was. */
export function matchesFor(batteryId: string, log: LogEntry[]): { match: string; at: string }[] {
  return historyFor(batteryId, log)
    .filter((entry) => entry.kind === 'status' && entry.match)
    .map((entry) => ({ match: entry.match!, at: entry.created_at }))
}

/** A history line in words: "In the robot for Qual 12", or "Reading: 12.9 V, 0.014 Ω". */
export function describeEntry(entry: LogEntry): string {
  if (entry.kind === 'status') return entry.match ? `${entry.status} for ${entry.match}` : `${entry.status}`
  return `Reading: ${readingText(entry)}`
}

/** A reading's numbers: "12.9 V, 0.014 Ω". */
export function readingText(entry: LogEntry): string {
  const parts = []
  if (entry.voltage !== null) parts.push(`${Number(entry.voltage)} V`)
  if (entry.resistance_ohms !== null) parts.push(`${Number(entry.resistance_ohms)} Ω`)
  return parts.join(', ')
}

/**
 * The charged battery to use next: the one that's been Charged longest,
 * leaving out tired ones. Null if there isn't one.
 */
export function nextUp(batteries: Battery[], log: LogEntry[]): Battery | null {
  return groupByStatus(batteries)[0].batteries.find((b) => !isTired(b.id, log)) ?? null
}

/** Why a reading can't be saved, or null if it can. Empty boxes are null. */
export function checkReading(voltage: number | null, resistanceOhms: number | null): string | null {
  if (voltage === null && resistanceOhms === null) return 'Enter the voltage, the internal resistance, or both.'
  if (voltage !== null && !(voltage > 0 && voltage < 20)) return 'Check the voltage: a robot battery reads about 12 to 13.5 V.'
  if (resistanceOhms !== null && !(resistanceOhms > 0 && resistanceOhms < 1)) {
    return 'Check the internal resistance: it should be in ohms, like 0.015. If your tester shows milliohms (mΩ), divide by 1000.'
  }
  return null
}

/** Record a tester reading on a battery. Anyone on the team can. */
export async function recordReading(battery: Battery, voltage: number | null, resistanceOhms: number | null): Promise<Result<LogEntry>> {
  if (!currentUser()) return fail('Sign in to record a reading.')
  const problem = checkReading(voltage, resistanceOhms)
  if (problem) return fail(problem)
  return logTable.insert({ battery_id: battery.id, kind: 'reading', status: null, match: null, voltage, resistance_ohms: resistanceOhms })
}

// ---------------------------------------------------------------------------
// Which match: when a battery goes In the robot, the page suggests our next
// match from the event schedule (getSchedule() in the Scouting module).

/** A match's name the way the team says it: "Qual 12", or "SF 2-1" for a playoff. */
export function matchLabel(match: TbaMatch): string {
  if (match.comp_level === 'qm') return `Qual ${match.match_number}`
  return `${match.comp_level.toUpperCase()} ${match.set_number}-${match.match_number}`
}

/** Our next match that hasn't been played, as "Qual 12", or null. */
export function nextMatch(schedule: TbaMatch[], team = OUR_TEAM): string | null {
  const ours = schedule.find((m) => m.alliances.red.score < 0 && [...m.alliances.red.team_keys, ...m.alliances.blue.team_keys].includes(`frc${team}`))
  return ours ? matchLabel(ours) : null
}

/** Our next match from the event schedule, or '' if it can't be found (no schedule yet, or no connection). */
export async function suggestMatch(): Promise<string> {
  const schedule = await getSchedule()
  return schedule.ok ? (nextMatch(schedule.value) ?? '') : ''
}

// ---------------------------------------------------------------------------
// Labels: find a battery by the number written on it.

/** The batteries whose number contains `query`, ignoring case and spaces. */
export function findBatteries(batteries: Battery[], query: string): Battery[] {
  const wanted = query.replace(/\s/g, '').toLowerCase()
  return wanted ? batteries.filter((b) => b.name.replace(/\s/g, '').toLowerCase().includes(wanted)) : batteries
}
