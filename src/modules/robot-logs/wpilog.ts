/**
 * A reader for WPILib's data log files (.wpilog), the kind DataLogManager
 * and AdvantageKit write on the roboRIO. It reads the whole file in the
 * browser: nothing is uploaded.
 *
 * The format is WPILib's "Data Log File Format Specification, Version 1.0":
 * https://github.com/wpilibsuite/allwpilib/blob/main/datalog/doc/datalog.adoc
 * In short:
 *
 *   header   "WPILOG", a 2-byte version (0x0100 is 1.0), a 4-byte length,
 *            then that many bytes of "extra header" text
 *   records  one after another, each:
 *              1 byte   how long the next three fields are (bit-packed)
 *              1-4      entry id
 *              1-4      payload size
 *              1-8      timestamp, in microseconds
 *              payload
 *
 * Entry id 0 is for control records: Start (gives an id its name, type and
 * metadata), Finish (the id is done, and may be reused) and Set metadata.
 * Every other record is a value for the entry with that id. All numbers are
 * little-endian.
 */
import { fail, ok, type Result } from '../../core/table'

/** One value from the log. Types the reader doesn't know (structs, protobuf) stay as raw bytes. */
export type WpilogValue = boolean | number | string | boolean[] | number[] | string[] | Uint8Array

/** A data channel in the log, like "DS:enabled", from its Start record. */
export interface WpilogEntry {
  /** The id records use for it. An id can be reused after a Finish record, by a different entry. */
  id: number
  name: string
  /** Like "double", "boolean", "int64[]" or "struct:Pose2d". */
  type: string
  /** Usually JSON, often empty. The latest Set metadata record replaces it. */
  metadata: string
}

/** One timestamped value. */
export interface WpilogRecord {
  entry: WpilogEntry
  /** Microseconds, usually since the robot program started. */
  timestamp: number
  value: WpilogValue
}

export interface Wpilog {
  /** Like 0x0100 for version 1.0. */
  version: number
  /** Text the program that wrote the log put in its header. */
  extraHeader: string
  /** Every entry started in the log, in the order they were started. */
  entries: WpilogEntry[]
  /** Every value, in the order they're in the file (not always time order). */
  records: WpilogRecord[]
  /**
   * True when the file ends partway through a record, as happens when a
   * log is copied while the robot is still writing it. Everything before
   * that point is still read.
   */
  cutOff: boolean
}

const MAGIC = 'WPILOG'
const HEADER_SIZE = 12
const text = new TextDecoder()

/** Thrown inside the reader when a record runs past the end of the file. */
class CutOff extends Error {}

/** Read a .wpilog file's bytes. */
export function readWpilog(bytes: Uint8Array): Result<Wpilog> {
  if (bytes.length < HEADER_SIZE || text.decode(bytes.subarray(0, 6)) !== MAGIC) {
    return fail("That isn't a WPILib log. Choose a .wpilog file, from the roboRIO or its USB stick.")
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint16(6, true)
  if (version >> 8 !== 1) {
    return fail(`This log uses version ${version >> 8}.${version & 0xff} of the format, and this page only reads version 1. Ask a mentor to update it.`)
  }
  const extraLength = view.getUint32(8, true)
  if (HEADER_SIZE + extraLength > bytes.length) return fail('This log is cut off before its first record. Copy it off the robot again.')

  const log: Wpilog = {
    version,
    extraHeader: text.decode(bytes.subarray(HEADER_SIZE, HEADER_SIZE + extraLength)),
    entries: [],
    records: [],
    cutOff: false,
  }
  // Which entry each id means right now. Finish removes an id, so it can be reused.
  const active = new Map<number, WpilogEntry>()
  let at = HEADER_SIZE + extraLength

  /** A little-endian unsigned number of 1 to 8 bytes. Safe up to 2^53, which is centuries of microseconds. */
  function uint(length: number): number {
    if (at + length > bytes.length) throw new CutOff()
    let value = 0
    for (let i = length - 1; i >= 0; i--) value = value * 256 + bytes[at + i]
    at += length
    return value
  }

  try {
    while (at < bytes.length) {
      const lengths = uint(1)
      const entryId = uint((lengths & 0b11) + 1)
      const size = uint(((lengths >> 2) & 0b11) + 1)
      const timestamp = uint(((lengths >> 4) & 0b111) + 1)
      if (at + size > bytes.length) throw new CutOff()
      const payload = bytes.subarray(at, at + size)
      at += size

      if (entryId === 0) {
        try {
          control(payload, active, log.entries)
        } catch (error) {
          // A control record too short for what it says: skip it and keep reading.
          if (!(error instanceof CutOff)) throw error
        }
      } else {
        const entry = active.get(entryId)
        // A value for an id with no Start record breaks the format; skip it rather than guess.
        if (entry) log.records.push({ entry, timestamp, value: decode(entry.type, payload) })
      }
    }
  } catch (error) {
    if (!(error instanceof CutOff)) throw error
    log.cutOff = true
  }
  return ok(log)
}

/** Apply a control record: Start, Finish or Set metadata. */
function control(payload: Uint8Array, active: Map<number, WpilogEntry>, entries: WpilogEntry[]) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  let at = 1
  const uint32 = () => {
    if (at + 4 > payload.length) throw new CutOff()
    at += 4
    return view.getUint32(at - 4, true)
  }
  const string = () => {
    const length = uint32()
    if (at + length > payload.length) throw new CutOff()
    at += length
    return text.decode(payload.subarray(at - length, at))
  }

  if (payload.length === 0) return
  const kind = payload[0]
  if (kind === 0) {
    const id = uint32()
    const entry: WpilogEntry = { id, name: string(), type: string(), metadata: string() }
    active.set(id, entry)
    entries.push(entry)
  } else if (kind === 1) {
    active.delete(uint32())
  } else if (kind === 2) {
    const entry = active.get(uint32())
    const metadata = string()
    if (entry) entry.metadata = metadata
  }
  // Other control record types aren't in version 1.0; skip them.
}

/** A record's payload as a value of the entry's type. */
export function decode(type: string, payload: Uint8Array): WpilogValue {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const each = <T>(size: number, read: (offset: number) => T): T[] =>
    Array.from({ length: Math.floor(payload.length / size) }, (_, i) => read(i * size))
  // A payload the wrong size for its type is kept as raw bytes instead of read wrongly.
  const fits = (size: number) => payload.length === size

  switch (type) {
    case 'boolean':
      return fits(1) ? payload[0] !== 0 : payload.slice()
    case 'int64':
      // Numbers beyond 2^53 lose their last digits, which a robot's values never reach.
      return fits(8) ? Number(view.getBigInt64(0, true)) : payload.slice()
    case 'float':
      return fits(4) ? view.getFloat32(0, true) : payload.slice()
    case 'double':
      return fits(8) ? view.getFloat64(0, true) : payload.slice()
    case 'string':
    // Not in the spec's list, but NetworkTables and AdvantageKit log JSON as its own type.
    case 'json':
      return text.decode(payload)
    case 'boolean[]':
      return Array.from(payload, (byte) => byte !== 0)
    case 'int64[]':
      return payload.length % 8 === 0 ? each(8, (i) => Number(view.getBigInt64(i, true))) : payload.slice()
    case 'float[]':
      return payload.length % 4 === 0 ? each(4, (i) => view.getFloat32(i, true)) : payload.slice()
    case 'double[]':
      return payload.length % 8 === 0 ? each(8, (i) => view.getFloat64(i, true)) : payload.slice()
    case 'string[]':
      return stringArray(payload, view) ?? payload.slice()
    default:
      // raw, and types like struct:Pose2d or proto:... that need their schema to read.
      return payload.slice()
  }
}

/** A string[] payload: a 4-byte count, then each string as a 4-byte length and its text. Null if it doesn't fit. */
function stringArray(payload: Uint8Array, view: DataView): string[] | null {
  if (payload.length < 4) return null
  const count = view.getUint32(0, true)
  const strings: string[] = []
  let at = 4
  for (let i = 0; i < count; i++) {
    if (at + 4 > payload.length) return null
    const length = view.getUint32(at, true)
    at += 4
    if (at + length > payload.length) return null
    strings.push(text.decode(payload.subarray(at, at + length)))
    at += length
  }
  return strings
}
