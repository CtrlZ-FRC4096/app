// Tests for data.ts, in demo mode: the tests never call The Blue Alliance.
// The server function itself is tested in supabase/tests/functions.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import { resetAllStores } from '../../core/store'
import {
  blankOrNumber, checkEntry, checkPitEntry, entryStore, getRankings, getSchedule, getTeam, getTeamMatches, numberOnly, pitStore, saveEntry, savePitEntry, teamNumber,
  type EntryFields, type PitFields,
} from './data'

// A filled-in pit form. Each test changes only the part it's about.
const PIT: PitFields = {
  team: 9992,
  match: null,
  drivetrain: 'Swerve',
  weight: 115.5,
  length: 28,
  width: 28,
  height: 36,
  motors: '  4 drive motors, 2 on the shooter  ',
  auto_side: 'Left',
  auto_path: 'Scores 3, then drives out',
  partners_do: 'Play defense',
  they_do: 'Score fuel',
}

describe('savePitEntry', () => {
  beforeEach(() => {
    pitStore.reset()
  })

  it('saves the pit form, newest first, marked as not synced yet', () => {
    const first = savePitEntry(PIT)
    const second = savePitEntry({ ...PIT, team: 9993, match: 4 })
    if (!first.ok || !second.ok) throw new Error('should save')
    expect(pitStore.get()).toEqual([second.value, first.value])
    expect(first.value).toMatchObject({ ...PIT, motors: '4 drive motors, 2 on the shooter', synced: false })
    expect(second.value.match).toBe(4)
  })

  it('needs a team number, but not a match number', () => {
    expect(checkPitEntry({ ...PIT, team: 0 })).toBe('Enter the team number first.')
    expect(checkPitEntry({ ...PIT, match: null })).toBeNull()
    expect(checkPitEntry({ ...PIT, match: 2.5 })).toBe('Check the match number, or leave it blank.')
  })

  it('takes blank weight and size, but not zero', () => {
    expect(checkPitEntry({ ...PIT, weight: null, length: null, width: null, height: null })).toBeNull()
    expect(checkPitEntry({ ...PIT, weight: 0 })).toBe('Check the weight, or leave it blank.')
    expect(checkPitEntry({ ...PIT, height: Number.NaN })).toBe('Check the height, or leave it blank.')
  })

  it('saves nothing when the form has a problem', () => {
    const result = savePitEntry({ ...PIT, team: 0 })
    expect(result.ok).toBe(false)
    expect(pitStore.get()).toEqual([])
  })
})

describe('blankOrNumber', () => {
  it('reads a number box, with blank as null', () => {
    expect(blankOrNumber('115.5')).toBe(115.5)
    expect(blankOrNumber('')).toBeNull()
    expect(blankOrNumber('  ')).toBeNull()
  })
})

describe('numberOnly', () => {
  it('keeps whole numbers and decimals', () => {
    expect(numberOnly('120')).toBe('120')
    expect(numberOnly('115.5')).toBe('115.5')
    expect(numberOnly('')).toBe('')
  })

  it('takes out anything that is not part of a number', () => {
    expect(numberOnly('about 120 lbs')).toBe('120')
    expect(numberOnly('-28')).toBe('28')
    expect(numberOnly('2e3')).toBe('23')
  })

  it('keeps only the first decimal point', () => {
    expect(numberOnly('1.2.3')).toBe('1.23')
    expect(numberOnly('..5')).toBe('.5')
  })
})

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
