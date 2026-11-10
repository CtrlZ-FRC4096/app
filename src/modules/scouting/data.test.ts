// Tests for data.ts, in demo mode: the tests never call The Blue Alliance.
// The server function itself is tested in supabase/tests/functions.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAllStores } from '../../core/store'
import {
  checkEntry, checkPitEntry, entryStore, getRankings, getSchedule, getTeam, getTeamMatches, numbersOnly, pitStore, pitTable, saveEntry,
  savePitEntry, syncPitEntries, teamNumber, toNumber, type EntryFields, type PitFields,
} from './data'

// A filled-in form. Each test changes only the part it's about.
const FORM: EntryFields = {
  match: 12,
  team: 9991,
  counts: { autoFuel: 3, teleopFuel: 14, fuelMissed: 2 },
  endgame: 'Level 2',
  roles: ['Scorer', 'Defender'],
  broke_down: true,
  stop: 'A-stop',
  driver_skill: 4,
  notes: '  Fast cycles  ',
}

describe('saveEntry', () => {
  beforeEach(() => {
    entryStore.reset()
  })

  it('saves what the scout entered, marked as not synced yet', () => {
    const result = saveEntry(FORM)
    if (!result.ok) throw new Error(result.error)
    expect(entryStore.get()).toEqual([result.value])
    expect(result.value).toMatchObject({ ...FORM, notes: 'Fast cycles', synced: false })
    expect(result.value.scouted_by).not.toBeNull()
  })

  it('lists entries newest first, each with its own id', () => {
    saveEntry(FORM)
    saveEntry({ ...FORM, match: 13 })
    expect(entryStore.get().map((e) => e.match)).toEqual([13, 12])
    expect(entryStore.get()[0].id).not.toBe(entryStore.get()[1].id)
  })

  it('refuses an entry with no team and says why', () => {
    expect(saveEntry({ ...FORM, team: 0 })).toEqual({ ok: false, error: 'Enter the team number first.' })
    expect(saveEntry({ ...FORM, team: Number.NaN })).toEqual({ ok: false, error: 'Enter the team number first.' })
    expect(entryStore.get()).toEqual([])
  })

  it('refuses an entry with no match number', () => {
    expect(checkEntry({ ...FORM, match: 0 })).toBe('Enter the match number first.')
    expect(checkEntry(FORM)).toBeNull()
  })

  it('refuses an entry until a driver skill from 1 to 5 is chosen', () => {
    // The form sends 0 while no driver skill is chosen.
    expect(saveEntry({ ...FORM, driver_skill: 0 })).toEqual({ ok: false, error: 'Choose a driver skill first.' })
    expect(checkEntry({ ...FORM, driver_skill: 6 })).toBe('Choose a driver skill first.')
    expect(checkEntry({ ...FORM, driver_skill: 1 })).toBeNull()
    expect(checkEntry({ ...FORM, driver_skill: 5 })).toBeNull()
    expect(entryStore.get()).toEqual([])
  })

  it('saves an entry with no role chosen', () => {
    const result = saveEntry({ ...FORM, roles: [] })
    expect(result).toMatchObject({ ok: true, value: { roles: [] } })
  })

  it('keeps entries when the example data is reset', () => {
    saveEntry(FORM)
    resetAllStores()
    expect(entryStore.get()).toHaveLength(1)
  })
})

// A filled-in pit form. Each test changes only the part it's about.
const PIT: PitFields = {
  team: 9991,
  drivetrain: 'Swerve',
  weight_lb: 115.5,
  length_in: 28,
  width_in: 28,
  height_in: 24,
  motors: ' 8 Kraken X60 ',
  auto_side: 'Left',
  auto_path: 'Scores preload, picks up 2',
  partner_strategy: 'Play defense',
  own_strategy: '  Score fuel  ',
}

describe('number boxes on the pit form', () => {
  it('only keep the parts of a number', () => {
    expect(numbersOnly('115.5 lb')).toBe('115.5')
    expect(numbersOnly('28in')).toBe('28')
    expect(numbersOnly('1.2.3')).toBe('1.23')
    expect(numbersOnly('heavy')).toBe('')
  })

  it('turn an empty box into null, not 0', () => {
    expect(toNumber('')).toBeNull()
    expect(toNumber('115.5')).toBe(115.5)
  })
})

describe('savePitEntry', () => {
  beforeEach(() => {
    pitStore.reset()
  })

  it('saves what the scout entered on this device, trimmed and marked as not synced yet', () => {
    const result = savePitEntry(PIT)
    if (!result.ok) throw new Error(result.error)
    expect(pitStore.get()).toEqual([result.value])
    expect(result.value).toMatchObject({ ...PIT, motors: '8 Kraken X60', own_strategy: 'Score fuel', synced: false })
    expect(result.value.created_by).not.toBeNull()
  })

  it('refuses an entry with no team number and says why', () => {
    expect(savePitEntry({ ...PIT, team: 0 })).toEqual({ ok: false, error: 'Enter the team number first.' })
    expect(savePitEntry({ ...PIT, team: Number.NaN })).toEqual({ ok: false, error: 'Enter the team number first.' })
    expect(pitStore.get()).toEqual([])
  })

  it('saves an entry with only a team number', () => {
    const empty: PitFields = { team: 9991, drivetrain: null, weight_lb: null, length_in: null, width_in: null, height_in: null, motors: '', auto_side: null, auto_path: '', partner_strategy: '', own_strategy: '' }
    expect(savePitEntry(empty).ok).toBe(true)
  })

  it('refuses a weight or size that is 0 or not a number', () => {
    expect(checkPitEntry({ ...PIT, weight_lb: 0 })).toBe('Check the weight: it should be a number more than 0, or empty.')
    expect(checkPitEntry({ ...PIT, height_in: Number.NaN })).toMatch(/height/)
  })

  it('refuses text longer than the database allows', () => {
    expect(checkPitEntry({ ...PIT, motors: 'x'.repeat(1001) })).toBe('Keep the motors under 1000 characters. This one is 1001.')
  })

  it('keeps every visit to a team, newest first', () => {
    savePitEntry({ ...PIT, drivetrain: 'Tank' })
    savePitEntry({ ...PIT, drivetrain: 'Swerve' })
    expect(pitStore.get().map((e) => [e.team, e.drivetrain])).toEqual([[9991, 'Swerve'], [9991, 'Tank']])
  })

  it('keeps pit entries when the example data is reset', () => {
    savePitEntry(PIT)
    resetAllStores()
    expect(pitStore.get()).toHaveLength(1)
  })
})

describe('syncPitEntries', () => {
  beforeEach(() => {
    pitStore.reset()
    pitTable.reset()
  })
  afterEach(() => vi.restoreAllMocks())

  it('sends waiting entries to the team database, with the same id, and marks them synced', async () => {
    const saved = savePitEntry(PIT)
    if (!saved.ok) throw new Error(saved.error)
    expect(await syncPitEntries()).toEqual({ ok: true, value: 1 })
    expect(pitStore.get()[0].synced).toBe(true)
    expect(pitTable.rows()).toHaveLength(1)
    expect(pitTable.rows()[0]).toMatchObject({ id: saved.value.id, created_at: saved.value.created_at, team: 9991, motors: '8 Kraken X60' })
    expect(pitTable.rows()[0]).not.toHaveProperty('synced')
  })

  it('sends each entry once', async () => {
    savePitEntry(PIT)
    await syncPitEntries()
    expect(await syncPitEntries()).toEqual({ ok: true, value: 0 })
    expect(pitTable.rows()).toHaveLength(1)
  })

  it('keeps entries Waiting when there is no connection, and says why', async () => {
    savePitEntry(PIT)
    savePitEntry({ ...PIT, team: 9992 })
    const error = "Couldn't reach the team database. Check your connection and try again."
    vi.spyOn(pitTable, 'insert').mockResolvedValue({ ok: false, error })
    expect(await syncPitEntries()).toEqual({ ok: false, error })
    expect(pitStore.get().map((e) => e.synced)).toEqual([false, false])
  })

  it('marks an entry synced when the database already has it, because the answer was lost last time', async () => {
    savePitEntry(PIT)
    vi.spyOn(pitTable, 'insert').mockResolvedValue({ ok: false, error: "That's already there." })
    expect(await syncPitEntries()).toEqual({ ok: true, value: 1 })
    expect(pitStore.get()[0].synced).toBe(true)
  })
})

describe('The Blue Alliance in demo mode', () => {
  it('has a schedule of qualification matches, three teams a side', async () => {
    const result = await getSchedule('2026demo')
    if (!result.ok) throw new Error(result.error)
    expect(result.value.length).toBeGreaterThan(0)
    for (const match of result.value) {
      expect(match.key).toBe(`2026demo_qm${match.match_number}`)
      expect(match.alliances.red.team_keys).toHaveLength(3)
      expect(match.alliances.blue.team_keys).toHaveLength(3)
    }
  })

  it('ranks every team once, in order, from the played matches', async () => {
    const result = await getRankings()
    if (!result.ok) throw new Error(result.error)
    expect(result.value.map((r) => r.rank)).toEqual(result.value.map((_, i) => i + 1))
    expect(new Set(result.value.map((r) => r.team_key)).size).toBe(result.value.length)
    expect(result.value[0].record!.wins).toBeGreaterThanOrEqual(result.value[1].record!.wins)
  })

  it("lists only a team's own matches, with videos for played ones", async () => {
    const result = await getTeamMatches(4096)
    if (!result.ok) throw new Error(result.error)
    for (const match of result.value) {
      expect([...match.alliances.red.team_keys, ...match.alliances.blue.team_keys]).toContain('frc4096')
      expect(match.videos.length > 0).toBe(match.alliances.red.score >= 0)
    }
  })

  it('names teams', async () => {
    expect(await getTeam(4096)).toMatchObject({ ok: true, value: { team_number: 4096, nickname: 'Ctrl-Z' } })
    expect(teamNumber('frc4096')).toBe(4096)
  })
})
