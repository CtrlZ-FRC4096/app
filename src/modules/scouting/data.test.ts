// Tests for data.ts, in demo mode: the tests never call The Blue Alliance.
// The server function itself is tested in supabase/tests/functions.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAllStores } from '../../core/store'
import { DEMO_PEOPLE } from '../../core/demo'
import {
  MAX_NOTES_LENGTH, checkEntry, entriesTable, entryStore, getRankings, getSchedule, getTeam, getTeamMatches, saveEntry, syncEntries, syncStatus, teamNumber, toRow,
  type EntryFields,
} from './data'
import { EVENT_KEY } from './season'

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

describe('checkEntry', () => {
  it("refuses what the team database would refuse, so an entry can't get stuck Waiting", () => {
    expect(checkEntry({ ...FORM, team: 100000 })).toMatch(/team number/)
    expect(checkEntry({ ...FORM, match: 1001 })).toMatch(/match number/)
    expect(checkEntry({ ...FORM, notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) })).toMatch(/notes/)
    expect(checkEntry({ ...FORM, notes: 'x'.repeat(MAX_NOTES_LENGTH) })).toBeNull()
  })
})

describe('syncing to the team database', () => {
  beforeEach(async () => {
    // Let any send from an earlier test finish before starting fresh.
    await syncEntries()
    entryStore.reset()
    entriesTable.reset()
    syncStatus.reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const sent = (id: string) => entriesTable.rows().filter((row) => row.id === id)

  it('sends Waiting entries, then marks them Synced', async () => {
    const first = saveEntry(FORM)
    const second = saveEntry({ ...FORM, match: 13 })
    if (!first.ok || !second.ok) throw new Error('not saved')
    expect(await syncEntries()).toEqual({ ok: true, value: expect.any(Number) })
    expect(entryStore.get().every((e) => e.synced)).toBe(true)
    expect(sent(first.value.id)).toEqual([
      expect.objectContaining({
        event_key: EVENT_KEY,
        match_number: 12,
        team_number: 9991,
        counts: FORM.counts,
        endgame: 'Level 2',
        roles: ['Scorer', 'Defender'],
        broke_down: true,
        stop: 'A-stop',
        driver_skill: 4,
        notes: 'Fast cycles',
        scouted_by: DEMO_PEOPLE.alex,
        scouted_at: first.value.created_at,
      }),
    ])
    expect(sent(second.value.id)).toHaveLength(1)
  })

  it('never sends an entry twice, even if the phone sends it again', async () => {
    const saved = saveEntry(FORM)
    if (!saved.ok) throw new Error(saved.error)
    await syncEntries()
    // As if the phone lost the connection before it heard back.
    entryStore.set((entries) => entries.map((e) => ({ ...e, synced: false })))
    await syncEntries()
    expect(sent(saved.value.id)).toHaveLength(1)
    expect(entryStore.get()[0].synced).toBe(true)
  })

  it('keeps entries Waiting with no connection, then sends them once it is back', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const saved = saveEntry(FORM)
    if (!saved.ok) throw new Error(saved.error)
    const offline = await syncEntries()
    expect(offline).toEqual({ ok: false, error: expect.stringMatching(/No connection/) })
    expect(entryStore.get()[0].synced).toBe(false)
    expect(syncStatus.get().problem).toMatch(/No connection/)
    expect(sent(saved.value.id)).toEqual([])

    vi.stubGlobal('navigator', { onLine: true })
    expect(await syncEntries()).toEqual({ ok: true, value: 1 })
    expect(entryStore.get()[0].synced).toBe(true)
    expect(syncStatus.get()).toEqual({ sending: false, problem: null })
  })

  it('has nothing to send when every entry is synced', async () => {
    expect(await syncEntries()).toEqual({ ok: true, value: 0 })
  })

  it("sends an entry saved before #28 with Defender for played defense, and the other new fields left empty", () => {
    const saved = saveEntry(FORM)
    if (!saved.ok) throw new Error(saved.error)
    const { roles: _r, broke_down: _b, stop: _s, driver_skill: _d, ...rest } = saved.value
    expect(toRow({ ...rest, defense: true })).toMatchObject({ roles: ['Defender'], broke_down: false, stop: 'None', driver_skill: null })
    expect(toRow({ ...rest, defense: false }).roles).toEqual([])
  })

  it('sends an entry saved before events were recorded with the current event', () => {
    const saved = saveEntry(FORM)
    if (!saved.ok) throw new Error(saved.error)
    const { event_key: _old, ...older } = saved.value
    expect(toRow(older).event_key).toBe(EVENT_KEY)
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
