/**
 * Robot logs module data, step 1: open a robot's log in the browser and
 * say what's in it. Nothing is uploaded or saved.
 *
 * wpilog.ts reads the file. The functions here sum it up for the page:
 * how long the log is, its entries, and which match it was, from the file
 * name. They're plain functions, tested in data.test.ts. The power summary
 * (step 2) will be more functions here, once the programming team says what
 * the robot logs.
 */
import { fail, ok, type Result } from '../../core/table'
import { readWpilog, type Wpilog } from './wpilog'

/**
 * The match a log is from, read from its file name.
 *
 * WPILib's DataLogManager names a log "FRC_yyyyMMdd_HHmmss.wpilog" once the
 * Driver Station connects (the date and time are UTC), and adds the event
 * and match once the FMS sends them: "FRC_20260313_153000_ILCH_Q12.wpilog".
 * The match letter is P (practice), Q (qualification), E (elimination) or
 * T (anything else). Newer WPILib starts names with "WPILIB_" instead of
 * "FRC_", and a log split into parts ends ".2" before ".wpilog", like
 * "..._Q12.2.wpilog". (From DataLogManager.java and its isMatchLog() in
 * wpilibsuite/allwpilib, 2025 and main.)
 */
export interface LogMatch {
  /** The event name the FMS sent, like "ILCH". */
  event: string
  /** Like "Qual 12", "Playoff 3" or "Practice 2". */
  label: string
}

export interface LogName {
  /** When the log was named, in UTC, as an ISO date and time. Null if the name doesn't say. */
  recordedAt: string | null
  /** Null for a log from a practice session with no FMS, or a renamed file. */
  match: LogMatch | null
}

const MATCH_KINDS: Record<string, string> = { P: 'Practice', Q: 'Qual', E: 'Playoff', T: 'Match' }

const LOG_NAME = /^(?:FRC|WPILIB)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_(.+)_([PQET])(\d+)(?:\.(\d+))?)?\.wpilog$/i

/** Read the date, event and match from a log's file name. */
export function readLogName(fileName: string): LogName {
  const found = LOG_NAME.exec(fileName.split(/[\\/]/).pop() ?? '')
  if (!found) return { recordedAt: null, match: null }
  const [, year, month, day, hour, minute, second, event, kind, number, part] = found
  const recordedAt = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
  if (!event) return { recordedAt, match: null }
  const label = `${MATCH_KINDS[kind.toUpperCase()]} ${Number(number)}${part ? ` (part ${part})` : ''}`
  return { recordedAt, match: { event, label } }
}

/** One entry in the log, for the page's list. */
export interface EntrySummary {
  name: string
  /** Like "double", "boolean" or "struct:Pose2d". */
  type: string
  metadata: string
  /** How many values it has. */
  values: number
}

export interface LogSummary {
  fileName: string
  recordedAt: string | null
  match: LogMatch | null
  /** Seconds from the first value to the last. */
  duration: number
  /** Every entry, in order by name. An entry started twice under the same name shows once, with both counts added. */
  entries: EntrySummary[]
  /** How many values in all. */
  values: number
  /** The file ends partway through, so the last moments may be missing. */
  cutOff: boolean
}

/** Sum up a log that's been read. */
export function summarizeLog(log: Wpilog, fileName: string): LogSummary {
  const byName = new Map<string, EntrySummary>()
  for (const entry of log.entries) {
    if (!byName.has(entry.name)) byName.set(entry.name, { name: entry.name, type: entry.type, metadata: entry.metadata, values: 0 })
    else byName.get(entry.name)!.metadata ||= entry.metadata
  }
  let first = Infinity
  let last = -Infinity
  for (const record of log.records) {
    byName.get(record.entry.name)!.values += 1
    if (record.timestamp < first) first = record.timestamp
    if (record.timestamp > last) last = record.timestamp
  }
  const { recordedAt, match } = readLogName(fileName)
  return {
    fileName,
    recordedAt,
    match,
    duration: log.records.length ? (last - first) / 1e6 : 0,
    entries: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    values: log.records.length,
    cutOff: log.cutOff,
  }
}

/** Read a log file's bytes and sum it up, or say why it can't be read. */
export function openLog(fileName: string, bytes: Uint8Array): Result<LogSummary> {
  if (/\.hoot$/i.test(fileName)) {
    return fail("That's a CTRE signal log (.hoot). Convert it to a .wpilog with CTRE's Phoenix Tuner or owlet first, then open that.")
  }
  const log = readWpilog(bytes)
  return log.ok ? ok(summarizeLog(log.value, fileName)) : log
}

/** How long, plainly: "45 s", "2 min 35 s" or "1 h 4 min". */
export function durationText(seconds: number): string {
  const whole = Math.round(seconds)
  if (whole < 60) return `${whole} s`
  const minutes = Math.floor(whole / 60)
  if (minutes < 60) return `${minutes} min ${whole % 60} s`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/** The entries whose name or type contains `query`, ignoring case. */
export function findEntries(entries: EntrySummary[], query: string): EntrySummary[] {
  const wanted = query.trim().toLowerCase()
  return wanted ? entries.filter((e) => e.name.toLowerCase().includes(wanted) || e.type.toLowerCase().includes(wanted)) : entries
}
