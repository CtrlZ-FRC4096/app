// Tests for data.ts, in demo mode: the tests never call The Blue Alliance
// or Match 13. The server functions themselves are tested in
// supabase/tests/functions.test.ts and supabase/tests/match13.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAllStores } from '../../core/store'
import { DEMO_PEOPLE } from '../../core/demo'
import {
  MAX_NOTES_LENGTH, blankOrNumber, checkEntry, checkPitEntry, entriesTable, entryStore, getPredictions, getRankings, getRatings, getSchedule, getTeam, getTeamMatches,
  MAX_PIT_NUMBER, numberOnly, pitStore, pitTable, pitToRow, saveEntry, savePitEntry, syncEntries, syncStatus, teamNumber, toRow, type EntryFields, type PitFields,
} from './data'
import { loadSchedule, positionStore, scheduleStore, setPosition, teamFor, type SavedSchedule, type TbaMatch } from './data'
import { EVENT_KEY } from './season'

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
    pitStore.reset()
    pitTable.reset()
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

describe('checkPitEntry and the team database', () => {
  it("refuses what the team database would refuse, so a pit entry can't get stuck Waiting", () => {
    expect(checkPitEntry({ ...PIT, team: 100000 })).toMatch(/team number/)
    expect(checkPitEntry({ ...PIT, match: 1001 })).toMatch(/match number/)
    expect(checkPitEntry({ ...PIT, weight: MAX_PIT_NUMBER })).toMatch(/weight/)
    expect(checkPitEntry({ ...PIT, they_do: 'x'.repeat(MAX_NOTES_LENGTH + 1) })).toMatch(/under 1000/)
    expect(checkPitEntry({ ...PIT, motors: 'x'.repeat(MAX_NOTES_LENGTH) })).toBeNull()
  })
})

describe('syncing pit entries', () => {
  beforeEach(async () => {
    await syncEntries()
    entryStore.reset()
    entriesTable.reset()
    pitStore.reset()
    pitTable.reset()
    syncStatus.reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const sent = (id: string) => pitTable.rows().filter((row) => row.id === id)

  it('sends Waiting pit entries, then marks them Synced', async () => {
    const saved = savePitEntry(PIT)
    if (!saved.ok) throw new Error(saved.error)
    await syncEntries()
    expect(pitStore.get()[0].synced).toBe(true)
    expect(sent(saved.value.id)).toEqual([
      expect.objectContaining({
        event_key: EVENT_KEY,
        team_number: 9992,
        match_number: null,
        drivetrain: 'Swerve',
        weight: 115.5,
        height: 36,
        motors: '4 drive motors, 2 on the shooter',
        auto_side: 'Left',
        partners_do: 'Play defense',
        scouted_by: DEMO_PEOPLE.alex,
        scouted_at: saved.value.created_at,
      }),
    ])
  })

  it('sends match and pit entries together', async () => {
    saveEntry(FORM)
    savePitEntry(PIT)
    await syncEntries()
    expect([...entryStore.get(), ...pitStore.get()].every((e) => e.synced)).toBe(true)
  })

  it('never sends a pit entry twice, even if the phone sends it again', async () => {
    const saved = savePitEntry(PIT)
    if (!saved.ok) throw new Error(saved.error)
    await syncEntries()
    pitStore.set((entries) => entries.map((e) => ({ ...e, synced: false })))
    await syncEntries()
    expect(sent(saved.value.id)).toHaveLength(1)
  })

  it('keeps every visit to a team', async () => {
    const first = savePitEntry({ ...PIT, drivetrain: 'Tank' })
    const second = savePitEntry(PIT)
    if (!first.ok || !second.ok) throw new Error('not saved')
    await syncEntries()
    expect([...sent(first.value.id), ...sent(second.value.id)].map((row) => [row.team_number, row.drivetrain])).toEqual([[9992, 'Tank'], [9992, 'Swerve']])
  })

  it('keeps pit entries Waiting with no connection, then sends them once it is back', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    savePitEntry(PIT)
    expect((await syncEntries()).ok).toBe(false)
    expect(pitStore.get()[0].synced).toBe(false)
    vi.stubGlobal('navigator', { onLine: true })
    expect(await syncEntries()).toEqual({ ok: true, value: 1 })
    expect(pitStore.get()[0].synced).toBe(true)
  })

  it('sends blank choices and boxes as empty, and an entry saved before events were recorded with the current event', () => {
    const saved = savePitEntry({ ...PIT, drivetrain: '', auto_side: '', motors: '  ', weight: null })
    if (!saved.ok) throw new Error(saved.error)
    const { event_key: _old, ...older } = saved.value
    expect(pitToRow(older)).toMatchObject({ event_key: EVENT_KEY, drivetrain: null, auto_side: null, motors: null, weight: null })
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

describe('Match 13 in demo mode', () => {
  it('rates every example team once, best first', async () => {
    const result = await getRatings()
    if (!result.ok) throw new Error(result.error)
    expect(result.value.map((r) => r.teamNumber).sort()).toEqual([4096, 9991, 9992, 9993, 9994, 9995])
    const ratings = result.value.map((r) => r.xpEnd)
    expect(ratings).toEqual([...ratings].sort((a, b) => b - a))
  })

  it('predicts every match in the schedule, with the same keys', async () => {
    const schedule = await getSchedule('2026demo')
    const predictions = await getPredictions('2026demo')
    if (!schedule.ok || !predictions.ok) throw new Error('No example data')
    expect(predictions.value.map((p) => p.key)).toEqual(schedule.value.map((m) => m.key))
    for (const p of predictions.value) {
      expect(p.redWinChance).toBeGreaterThanOrEqual(0)
      expect(p.redWinChance).toBeLessThanOrEqual(1)
      expect(p.redWinChance > 0.5).toBe(p.redScore > p.blueScore)
    }
  })
})

describe('Match 13 answers', () => {
  // Shaped like Match 13's real answers, which have more in them than we use.
  const row = (teamNumber: number, xpEnd: number) => ({
    teamNumber, xpStart: 40, xpEnd, xAuto: 10, xTele: 25, xEnd: 5, epa: 38, opr: 41, dpr: 20, sos: 0.5, components: { fuel: 3 },
  })
  const match = { key: '2026ilch_qm1', pred: { winProb: 0.81, redScore: 120.4, blueScore: 95.2, redVar: 500, blueVar: 480 }, teams: {} }

  async function withAnswer(answer: { ok: true; value: unknown } | { ok: false; error: string }) {
    vi.resetModules()
    const callFunction = vi.fn(async () => answer)
    vi.doMock('../../core/functions', () => ({ callFunction }))
    return { data: await import('./data'), callFunction }
  }
  afterEach(() => {
    vi.doUnmock('../../core/functions')
    vi.resetModules()
  })

  it('asks the match13 function for the event, and ranks the ratings best first', async () => {
    const { data, callFunction } = await withAnswer({ ok: true, value: { eventKey: '2026ilch', teams: [row(9991, 30), row(4096, 50), row(9992, 50)], year: 2026 } })
    const result = await data.getRatings('2026ilch')
    expect(callFunction).toHaveBeenCalledWith('match13', { kind: 'ratings', event: '2026ilch' }, expect.any(Function))
    expect(result.ok && result.value.map((r) => r.teamNumber)).toEqual([4096, 9992, 9991])
  })

  it('turns a prediction into who is likely to win, and by how much', async () => {
    const { data, callFunction } = await withAnswer({ ok: true, value: { eventKey: '2026ilch', matches: [match], year: 2026 } })
    expect(await data.getPredictions('2026ilch')).toEqual({ ok: true, value: [{ key: '2026ilch_qm1', redWinChance: 0.81, redScore: 120.4, blueScore: 95.2 }] })
    expect(callFunction).toHaveBeenCalledWith('match13', { kind: 'predictions', event: '2026ilch' }, expect.any(Function))
  })

  it('passes on what went wrong, written for the person', async () => {
    const { data } = await withAnswer({ ok: false, error: 'Match 13 turned down the key. A mentor should check the MATCH13_KEY secret.' })
    expect(await data.getRatings()).toEqual({ ok: false, error: expect.stringMatching(/MATCH13_KEY/) })
    expect(await data.getPredictions()).toEqual({ ok: false, error: expect.stringMatching(/MATCH13_KEY/) })
  })
})

/** A match shaped like TBA's, not played yet: Red 1, 2, 3, then Blue 1, 2, 3. */
function tbaMatch(n: number, red: number[], blue: number[], comp_level: TbaMatch['comp_level'] = 'qm'): TbaMatch {
  return {
    key: `${EVENT_KEY}_${comp_level}${n}`, comp_level, set_number: 1, match_number: n, winning_alliance: '', predicted_time: null,
    alliances: { red: { score: -1, team_keys: red.map((t) => `frc${t}`) }, blue: { score: -1, team_keys: blue.map((t) => `frc${t}`) } },
  }
}

describe('filling in the team from the schedule', () => {
  // An example schedule, as it's saved on the device.
  const SCHEDULE: SavedSchedule = {
    event: EVENT_KEY,
    matches: [tbaMatch(1, [4096, 9991, 9992], [9993, 9994, 9995]), tbaMatch(2, [9993, 9995, 4096], [9991, 9992, 9994])],
    savedAt: '2026-03-13T14:00:00Z',
  }

  beforeEach(() => {
    scheduleStore.reset()
    positionStore.reset()
  })

  it('finds the team for each position in a match', () => {
    expect(teamFor(SCHEDULE, 1, 'Red 1')).toBe(4096)
    expect(teamFor(SCHEDULE, 1, 'Red 3')).toBe(9992)
    expect(teamFor(SCHEDULE, 1, 'Blue 2')).toBe(9994)
    expect(teamFor(SCHEDULE, 2, 'Red 3')).toBe(4096)
    expect(teamFor(SCHEDULE, 2, 'Blue 1')).toBe(9991)
  })

  it("finds nothing for a match that isn't in the schedule, with no position, or with no schedule", () => {
    expect(teamFor(SCHEDULE, 3, 'Red 1')).toBeNull()
    expect(teamFor(SCHEDULE, 0, 'Red 1')).toBeNull()
    expect(teamFor(SCHEDULE, 1, '')).toBeNull()
    expect(teamFor(null, 1, 'Red 1')).toBeNull()
  })

  it('remembers the position on this device, even when the example data is reset', () => {
    setPosition('Blue 2')
    resetAllStores()
    expect(positionStore.get()).toBe('Blue 2')
  })

  it('gets the schedule and saves it on this device', async () => {
    const result = await loadSchedule()
    if (!result.ok) throw new Error(result.error)
    expect(scheduleStore.get()).toEqual(result.value)
    expect(result.value.event).toBe(EVENT_KEY)
    expect(teamFor(result.value, 1, 'Red 1')).toBe(4096)
    expect(teamFor(result.value, 1, 'Blue 3')).toBe(9995)
  })
})

describe('the saved schedule when The Blue Alliance has none to give', () => {
  const SAVED: SavedSchedule = { event: EVENT_KEY, matches: [tbaMatch(1, [4096, 9991, 9992], [9993, 9994, 9995])], savedAt: '2026-03-13T14:00:00Z' }
  const NO_CONNECTION = { ok: false as const, error: "Couldn't reach the server. Check your connection and try again." }

  // data.ts again, with callFunction answering `answer`, like "Match 13 answers" above.
  async function withAnswer(answer: { ok: true; value: unknown } | { ok: false; error: string }) {
    vi.resetModules()
    vi.doMock('../../core/functions', () => ({ callFunction: vi.fn(async () => answer) }))
    return import('./data')
  }
  afterEach(() => {
    vi.doUnmock('../../core/functions')
    vi.resetModules()
  })

  it('saves every match, but fills in the team only from qualification matches', async () => {
    const final = tbaMatch(1, [7, 8, 9], [10, 11, 12], 'f')
    const data = await withAnswer({ ok: true, value: [final, tbaMatch(1, [1, 2, 3], [4, 5, 6]), tbaMatch(2, [1, 2, 3], [4, 5, 6])] })
    const result = await data.loadSchedule()
    if (!result.ok) throw new Error(result.error)
    expect(result.value.matches).toHaveLength(3)
    expect(data.teamFor(result.value, 1, 'Red 1')).toBe(1)
    expect(data.teamFor(result.value, 1, 'Blue 3')).toBe(6)
  })

  it('uses the saved copy with no connection', async () => {
    const data = await withAnswer(NO_CONNECTION)
    data.scheduleStore.set(SAVED)
    expect(await data.loadSchedule()).toEqual({ ok: true, value: SAVED })
  })

  it('says what went wrong with no connection and nothing saved, so the scout can type the team in', async () => {
    const data = await withAnswer(NO_CONNECTION)
    data.scheduleStore.reset()
    expect(await data.loadSchedule()).toEqual({ ok: false, error: `Couldn't get the match schedule. ${NO_CONNECTION.error}` })
  })

  it("doesn't use a schedule saved for another event", async () => {
    const data = await withAnswer(NO_CONNECTION)
    data.scheduleStore.set({ ...SAVED, event: '2025old' })
    expect((await data.loadSchedule()).ok).toBe(false)
  })

  it("keeps the saved copy when TBA's schedule is empty", async () => {
    const data = await withAnswer({ ok: true, value: [] })
    data.scheduleStore.set(SAVED)
    expect(await data.loadSchedule()).toEqual({ ok: true, value: SAVED })
    expect(data.scheduleStore.get()).toEqual(SAVED)
    data.scheduleStore.reset()
    expect(await data.loadSchedule()).toEqual({ ok: false, error: "The Blue Alliance doesn't have the match schedule yet." })
  })
})
