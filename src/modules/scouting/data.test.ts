// Tests for data.ts, in demo mode: the tests never call The Blue Alliance
// or Match 13. The server functions themselves are tested in
// supabase/tests/functions.test.ts and supabase/tests/match13.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAllStores } from '../../core/store'
import { DEMO_PEOPLE } from '../../core/demo'
import {
  MAX_NOTES_LENGTH, blankOrNumber, checkEntry, checkPitEntry, entriesTable, entryStore, getPredictions, getRankings, getRatings, getSchedule, getTeam, getTeamMatches,
  numberOnly, pitStore, saveEntry, savePitEntry, syncEntries, syncStatus, teamNumber, toRow, type EntryFields, type PitFields,
  DEFAULT_WEIGHTS, picklistCsv, picklistParts, rankTeams, type TeamNumbers, type Weights,
} from './data'
import { COUNTERS, EVENT_KEY } from './season'

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

describe('picklist score', () => {
  // A team with only the numbers given; the rest are missing (null).
  const team = (number: number, values: Record<string, number | null>): TeamNumbers => ({ team: number, values, matches: 1, rated: true })
  // Only the weights given count; every other part is 0.
  const only = (weights: Weights): Weights => ({ ...Object.fromEntries(picklistParts().map((p) => [p.key, 0])), ...weights })
  const order = (teams: TeamNumbers[], weights: Weights) => rankTeams(teams, weights).map((line) => line.team)
  const scores = (teams: TeamNumbers[], weights: Weights) => rankTeams(teams, weights).map((line) => line.score)
  const teamAndScore = (teams: TeamNumbers[], weights: Weights) => rankTeams(teams, weights).map((line) => [line.team, line.score])

  it('scores the best team 100 and the worst 0, and the rest in between', () => {
    const teams = [team(9991, { autoFuel: 5 }), team(9992, { autoFuel: 10 }), team(9993, { autoFuel: 0 })]
    expect(rankTeams(teams, only({ autoFuel: 1 }))).toEqual([
      { rank: 1, team: 9992, score: 100, parts: expect.objectContaining({ autoFuel: 10, xAuto: null }) },
      { rank: 2, team: 9991, score: 50, parts: expect.objectContaining({ autoFuel: 5 }) },
      { rank: 3, team: 9993, score: 0, parts: expect.objectContaining({ autoFuel: 0 }) },
    ])
  })

  it('ranks fewer fuel missed as better', () => {
    const teams = [team(9991, { fuelMissed: 5 }), team(9992, { fuelMissed: 1 })]
    expect(teamAndScore(teams, only({ fuelMissed: 1 }))).toEqual([[9992, 100], [9991, 0]])
  })

  it('re-sorts when a weight changes', () => {
    // 9991 is better on Match 13 auto, 9992 on the auto fuel we scouted.
    const teams = [team(9991, { xAuto: 10, autoFuel: 0 }), team(9992, { xAuto: 0, autoFuel: 10 })]
    expect(order(teams, only({ xAuto: 3, autoFuel: 1 }))).toEqual([9991, 9992])
    expect(scores(teams, only({ xAuto: 3, autoFuel: 1 }))).toEqual([75, 25])
    expect(order(teams, only({ xAuto: 1, autoFuel: 3 }))).toEqual([9992, 9991])
  })

  it('scores a team with no scouting entries yet on its Match 13 numbers only', () => {
    const teams = [
      team(9991, { xAuto: 10, autoFuel: 10 }),
      team(9992, { xAuto: 0, autoFuel: 0 }),
      { team: 9993, values: { xAuto: 5, autoFuel: null }, matches: 0, rated: true },
    ]
    expect(teamAndScore(teams, only({ xAuto: 1, autoFuel: 1 }))).toEqual([[9991, 100], [9993, 50], [9992, 0]])
  })

  it("scores a team Match 13 hasn't rated yet on our scouting only", () => {
    const teams = [
      team(9991, { xAuto: 10, autoFuel: 0 }),
      team(9992, { xAuto: 0, autoFuel: 5 }),
      { team: 9993, values: { xAuto: null, xTele: null, xEnd: null, autoFuel: 10 }, matches: 3, rated: false },
    ]
    expect(teamAndScore(teams, only({ xAuto: 1, autoFuel: 1 }))).toEqual([[9993, 100], [9991, 50], [9992, 25]])
  })

  it('skips a missing Match 13 auto for that team only', () => {
    const teams = [team(9991, { xAuto: null, xTele: 10 }), team(9992, { xAuto: 10, xTele: 0 }), team(9993, { xAuto: 0, xTele: 5 })]
    expect(teamAndScore(teams, only({ xAuto: 1, xTele: 1 }))).toEqual([[9991, 100], [9992, 50], [9993, 25]])
  })

  it('puts a team with none of the weighted numbers at the bottom, with no score', () => {
    const teams = [team(9991, { xTele: 3 }), team(9992, { autoFuel: 1 }), team(9993, { autoFuel: 4 })]
    expect(teamAndScore(teams, only({ autoFuel: 1 }))).toEqual([[9993, 100], [9992, 0], [9991, null]])
  })

  it('gives every team no score, in team number order, when every weight is 0', () => {
    const teams = [team(9993, { xAuto: 1, autoFuel: 2 }), team(9991, { xAuto: 9 }), team(9992, {})]
    const ranked = rankTeams(teams, only({}))
    expect(ranked.map(({ rank, team, score }) => [rank, team, score])).toEqual([[1, 9991, null], [2, 9992, null], [3, 9993, null]])
  })

  it('gives 0.5 (a score of 50) when there is one team, or every team has the same number', () => {
    expect(scores([team(9991, { autoFuel: 7 })], only({ autoFuel: 1 }))).toEqual([50])
    expect(scores([team(9992, { autoFuel: 4 }), team(9991, { autoFuel: 4 })], only({ autoFuel: 1 }))).toEqual([50, 50])
  })

  it('puts the lower team number first when scores are equal', () => {
    const teams = [team(9993, { xAuto: 8 }), team(9991, { xAuto: 8 }), team(9992, { xAuto: 2 })]
    expect(rankTeams(teams, only({ xAuto: 1 })).map(({ rank, team }) => [rank, team])).toEqual([[1, 9991], [2, 9993], [3, 9992]])
  })

  it('counts a part with no saved weight at the default weight', () => {
    const teams = [team(9991, { autoFuel: 10, xAuto: 0 }), team(9992, { autoFuel: 0, xAuto: 10 })]
    const weights = only({ xAuto: 1 })
    delete weights.autoFuel
    expect(scores(teams, weights)).toEqual([50, 50])
    expect(DEFAULT_WEIGHTS).toEqual(Object.fromEntries(picklistParts().map((p) => [p.key, 1])))
  })

  it("scores Match 13's auto, teleop and endgame, then every counter in season.ts", () => {
    const parts = picklistParts()
    expect(parts.slice(0, 3).map((p) => p.key)).toEqual(['xAuto', 'xTele', 'xEnd'])
    expect(parts.slice(3)).toEqual(COUNTERS.map((c) => ({ key: c.key, label: c.label, lowerIsBetter: c.lowerIsBetter ?? false })))
    expect(parts.find((p) => p.key === 'fuelMissed')?.lowerIsBetter).toBe(true)
  })

  it('copies the picklist as CSV, with an empty cell for a missing number', () => {
    const parts = picklistParts().filter((p) => ['xAuto', 'autoFuel'].includes(p.key))
    const ranked = rankTeams([team(9991, { xAuto: 12.34, autoFuel: 2 }), team(9992, { xAuto: 3 }), team(9993, {})], only({ xAuto: 1, autoFuel: 1 }))
    expect(picklistCsv(ranked, parts)).toBe(
      'Rank,Team,Score,Match 13 auto,Auto fuel scored\r\n' +
      '1,9991,75,12.3,2\r\n' +
      '2,9992,0,3,\r\n' +
      '3,9993,,,\r\n',
    )
  })
})
