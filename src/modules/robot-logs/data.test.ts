// Tests for wpilog.ts and data.ts. Run them with `npm test`.
// They build tiny made-up logs byte by byte with the writer below, following
// WPILib's format spec, so no real log is kept in the repo.
import { describe, expect, it } from 'vitest'
import { durationText, findEntries, openLog, readLogName, summarizeLog } from './data'
import { decode, readWpilog } from './wpilog'

const utf8 = new TextEncoder()

/** A little-endian unsigned number in exactly `length` bytes. */
function le(value: number, length: number): number[] {
  return Array.from({ length }, (_, i) => Math.floor(value / 256 ** i) % 256)
}

/** The fewest bytes (1 to max) that hold `value`. */
function width(value: number, max: number): number {
  let length = 1
  while (length < max && value >= 256 ** length) length += 1
  return length
}

const string = (s: string) => [...le(utf8.encode(s).length, 4), ...utf8.encode(s)]

/** Builds a .wpilog file the way WPILib writes one. */
class LogWriter {
  private bytes: number[]

  constructor(extraHeader = '') {
    this.bytes = [...utf8.encode('WPILOG'), ...le(0x0100, 2), ...string(extraHeader)]
  }

  record(entry: number, timestamp: number, payload: number[]): this {
    const [id, size, time] = [width(entry, 4), width(payload.length, 4), width(timestamp, 8)]
    this.bytes.push((id - 1) | ((size - 1) << 2) | ((time - 1) << 4), ...le(entry, id), ...le(payload.length, size), ...le(timestamp, time), ...payload)
    return this
  }

  start(entry: number, name: string, type: string, metadata = '', timestamp = 0): this {
    return this.record(0, timestamp, [0, ...le(entry, 4), ...string(name), ...string(type), ...string(metadata)])
  }

  finish(entry: number, timestamp = 0): this {
    return this.record(0, timestamp, [1, ...le(entry, 4)])
  }

  setMetadata(entry: number, metadata: string, timestamp = 0): this {
    return this.record(0, timestamp, [2, ...le(entry, 4), ...string(metadata)])
  }

  build(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

const doubleBytes = (n: number) => [...new Uint8Array(new Float64Array([n]).buffer)]
const floatBytes = (n: number) => [...new Uint8Array(new Float32Array([n]).buffer)]
const int64Bytes = (n: number) => [...new Uint8Array(new BigInt64Array([BigInt(n)]).buffer)]

/** A short made-up match: enabled for 2.5 s, with a voltage, an int, a string and a string array. */
function exampleLog(): Uint8Array {
  return new LogWriter('Made up for tests')
    .start(1, 'DS:enabled', 'boolean')
    .start(2, 'Drive/FrontLeft/SupplyVoltage', 'double', '{"source":"Phoenix6"}')
    .start(3, 'Intake/State', 'string')
    .start(4, 'Loop count', 'int64')
    .start(5, 'Shooter/Speeds', 'float[]')
    .start(6, 'Modes', 'string[]')
    .record(1, 1_000_000, [1])
    .record(2, 1_000_000, doubleBytes(12.6))
    .record(2, 2_500_000, doubleBytes(9.8))
    .record(3, 1_200_000, [...utf8.encode('ACTIVE')])
    .record(4, 1_300_000, int64Bytes(-5))
    .record(5, 1_400_000, [...floatBytes(1.5), ...floatBytes(-2)])
    .record(6, 1_500_000, [...le(2, 4), ...string('IDLE'), ...string('SCORING')])
    .record(1, 3_500_000, [0])
    .build()
}

describe('readWpilog', () => {
  it('reads the header, the entries and every value, by type', () => {
    const result = readWpilog(exampleLog())
    if (!result.ok) throw new Error(result.error)
    const log = result.value
    expect(log).toMatchObject({ version: 0x0100, extraHeader: 'Made up for tests', cutOff: false })
    expect(log.entries.map((e) => [e.name, e.type])).toEqual([
      ['DS:enabled', 'boolean'],
      ['Drive/FrontLeft/SupplyVoltage', 'double'],
      ['Intake/State', 'string'],
      ['Loop count', 'int64'],
      ['Shooter/Speeds', 'float[]'],
      ['Modes', 'string[]'],
    ])
    expect(log.records.map((r) => [r.entry.name, r.timestamp, r.value])).toEqual([
      ['DS:enabled', 1_000_000, true],
      ['Drive/FrontLeft/SupplyVoltage', 1_000_000, 12.6],
      ['Drive/FrontLeft/SupplyVoltage', 2_500_000, 9.8],
      ['Intake/State', 1_200_000, 'ACTIVE'],
      ['Loop count', 1_300_000, -5],
      ['Shooter/Speeds', 1_400_000, [1.5, -2]],
      ['Modes', 1_500_000, ['IDLE', 'SCORING']],
      ['DS:enabled', 3_500_000, false],
    ])
  })

  it('reads the example record from the spec: int64 3 at 1 second, with a 3-byte timestamp', () => {
    const bytes = new LogWriter().start(1, 'test', 'int64').build()
    const spec = new Uint8Array([...bytes, 0x20, 0x01, 0x08, 0x40, 0x42, 0x0f, 3, 0, 0, 0, 0, 0, 0, 0])
    const result = readWpilog(spec)
    expect(result).toMatchObject({ ok: true, value: { records: [{ timestamp: 1_000_000, value: 3 }] } })
  })

  it('reads large entry ids and timestamps that take more bytes', () => {
    const result = readWpilog(new LogWriter().start(70_000, 'Big id', 'double').record(70_000, 4_000_000_000_000, doubleBytes(1)).build())
    expect(result).toMatchObject({ ok: true, value: { records: [{ entry: { name: 'Big id' }, timestamp: 4_000_000_000_000, value: 1 }] } })
  })

  it('updates metadata, and lets an id be reused by a new entry after it finishes', () => {
    const result = readWpilog(
      new LogWriter()
        .start(1, 'First', 'double')
        .setMetadata(1, '{"units":"V"}')
        .record(1, 10, doubleBytes(1))
        .finish(1)
        .start(1, 'Second', 'boolean')
        .record(1, 20, [1])
        .build(),
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.value.entries.map((e) => [e.name, e.metadata])).toEqual([['First', '{"units":"V"}'], ['Second', '']])
    expect(result.value.records.map((r) => [r.entry.name, r.value])).toEqual([['First', 1], ['Second', true]])
  })

  it('skips values for an id that was never started', () => {
    const result = readWpilog(new LogWriter().record(9, 10, [1]).build())
    expect(result).toMatchObject({ ok: true, value: { records: [] } })
  })

  it('refuses a file that isn\'t a WPILib log, and says what to choose', () => {
    expect(readWpilog(utf8.encode('timestamp,voltage\n0,12.6\n'))).toEqual({ ok: false, error: expect.stringMatching(/isn't a WPILib log. Choose a \.wpilog/) })
    expect(readWpilog(new Uint8Array())).toMatchObject({ ok: false })
  })

  it('refuses a future version of the format', () => {
    const bytes = new LogWriter().build()
    bytes[7] = 2
    expect(readWpilog(bytes)).toEqual({ ok: false, error: expect.stringMatching(/version 2\.0/) })
  })

  it('refuses a file cut off inside its header', () => {
    const bytes = new LogWriter('A long extra header').build()
    expect(readWpilog(bytes.subarray(0, 14))).toEqual({ ok: false, error: expect.stringMatching(/cut off before its first record/) })
  })

  it('reads everything before the point where a file is cut off, and says so', () => {
    const whole = exampleLog()
    const result = readWpilog(whole.subarray(0, whole.length - 3))
    if (!result.ok) throw new Error(result.error)
    expect(result.value.cutOff).toBe(true)
    expect(result.value.records).toHaveLength(7)
  })
})

describe('decode', () => {
  it('keeps a value the wrong size for its type, or of an unknown type, as raw bytes', () => {
    expect(decode('double', new Uint8Array([1, 2, 3]))).toEqual(new Uint8Array([1, 2, 3]))
    expect(decode('struct:Pose2d', new Uint8Array([7]))).toEqual(new Uint8Array([7]))
    expect(decode('boolean[]', new Uint8Array([1, 0, 1]))).toEqual([true, false, true])
    expect(decode('double[]', new Uint8Array([...doubleBytes(1), ...doubleBytes(2)]))).toEqual([1, 2])
  })
})

describe('readLogName', () => {
  it('reads the event and match from a DataLogManager file name', () => {
    expect(readLogName('FRC_20260313_153000_ILCH_Q12.wpilog')).toEqual({ recordedAt: '2026-03-13T15:30:00Z', match: { event: 'ILCH', label: 'Qual 12' } })
    expect(readLogName('WPILIB_20260314_180501_ILCH_E3.wpilog').match).toEqual({ event: 'ILCH', label: 'Playoff 3' })
    expect(readLogName('FRC_20260313_090000_ILCH_P2.wpilog').match?.label).toBe('Practice 2')
    expect(readLogName('FRC_20260313_153000_ILCH_Q12.2.wpilog').match?.label).toBe('Qual 12 (part 2)')
  })

  it('has no match for a log made with no field connected, or a renamed file', () => {
    expect(readLogName('FRC_20260313_153000.wpilog')).toEqual({ recordedAt: '2026-03-13T15:30:00Z', match: null })
    expect(readLogName('practice run.wpilog')).toEqual({ recordedAt: null, match: null })
  })
})

describe('summarizeLog and openLog', () => {
  it('says how long the log is, and lists each entry with how many values it has', () => {
    const result = openLog('FRC_20260313_153000_ILCH_Q12.wpilog', exampleLog())
    if (!result.ok) throw new Error(result.error)
    expect(result.value).toMatchObject({ duration: 2.5, values: 8, match: { label: 'Qual 12' }, cutOff: false })
    expect(result.value.entries.find((e) => e.name === 'DS:enabled')).toEqual({ name: 'DS:enabled', type: 'boolean', metadata: '', values: 2 })
    expect(result.value.entries.map((e) => e.name)).toEqual([...result.value.entries.map((e) => e.name)].sort((a, b) => a.localeCompare(b)))
  })

  it('shows an entry started twice under the same name once', () => {
    const bytes = new LogWriter().start(1, 'Battery', 'double').record(1, 1, doubleBytes(12)).finish(1).start(2, 'Battery', 'double').record(2, 2, doubleBytes(11)).build()
    const result = readWpilog(bytes)
    if (!result.ok) throw new Error(result.error)
    expect(summarizeLog(result.value, 'x.wpilog').entries).toEqual([{ name: 'Battery', type: 'double', metadata: '', values: 2 }])
  })

  it('is 0 seconds long with no values', () => {
    expect(openLog('x.wpilog', new LogWriter().start(1, 'Empty', 'double').build())).toMatchObject({ ok: true, value: { duration: 0, values: 0 } })
  })

  it('explains that .hoot files need converting first', () => {
    expect(openLog('rio_2026-03-13.hoot', new Uint8Array([1, 2, 3]))).toEqual({ ok: false, error: expect.stringMatching(/CTRE signal log \(\.hoot\)\. Convert it/) })
  })
})

describe('durationText and findEntries', () => {
  it('writes durations plainly', () => {
    expect(durationText(45.2)).toBe('45 s')
    expect(durationText(155)).toBe('2 min 35 s')
    expect(durationText(3840)).toBe('1 h 4 min')
  })

  it('finds entries by name or type, ignoring case', () => {
    const result = openLog('x.wpilog', exampleLog())
    if (!result.ok) throw new Error(result.error)
    expect(findEntries(result.value.entries, 'supplyvoltage').map((e) => e.name)).toEqual(['Drive/FrontLeft/SupplyVoltage'])
    expect(findEntries(result.value.entries, 'string').map((e) => e.name)).toEqual(['Intake/State', 'Modes'])
    expect(findEntries(result.value.entries, '  ')).toHaveLength(6)
  })
})
