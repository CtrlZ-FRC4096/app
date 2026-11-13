// Tests for data.ts, in demo mode: the tests never call The Blue Alliance
// or Match 13. The server functions themselves are tested in
// supabase/tests/functions.test.ts and supabase/tests/match13.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAllStores } from '../../core/store'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import {
  MAX_NOTES_LENGTH, blankOrNumber, checkEntry, checkPitEntry, getEventTeams, tbaTeamUrl, entriesTable, entryStore, getPredictions, getRankings, getRatings, getSchedule, getTeam, getTeamMatches,
  MAX_PIT_NUMBER, numberOnly, pitAnswers, pitStore, pitTable, pitToRow, saveEntry, savePitEntry, scoutedTeams, syncEntries, syncStatus, teamNumber,
  teamSummary, toRow, type EntryFields, type MatchRow, type PitFields, type PitRow, type TeamSummary,
  qualVideoRows, videoLink, type TbaMatchWithVideos,
  loadRatings, needsLoading, ratingsStore, resetRatings, savedRatings, savedWhen, signed, STALE_MS, teamRating, teamRecord, type Match13Rating,
  DEFAULT_WEIGHTS, picklistCsv, picklistParts, rankTeams, type TeamNumbers, type Weights,
  MAX_WEIGHT, allWeightsZero, picklistTeams, resetWeights, setWeight, weightOf, weightsStore,
} from './data'
import {
  SCHEDULE_REFRESH_MS, keepScheduleFresh, likelyWinner, matchLabel, matchesWithPredictions, refreshSchedule, savedSchedule, scheduleStatus, scheduleStore, updatedAgo,
  type MatchPrediction, type TbaMatch,
} from './data'
import { addMissingTeams, byPosition, moveTeam, picklist, picklistTable, positionBetween, setPickStatus, startPicklist, type PicklistRow } from './data'
import { COUNTERS, DRIVETRAINS, EVENT_KEY } from './season'
import { loadSchedule, positionStore, setPosition, teamFor, type SavedSchedule } from './data'
import { rankOf } from './data'
import { chooseEvent, currentEvent, eventStore, eventWhenWhere, eventsTable, getOurEvents, latestEvent, lookupSeasons, searchEvents, type TbaEvent } from './data'

// A filled-in pit form. Each test changes only the part it's about.
const PIT: PitFields = {
  team: 9992,
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
    const second = savePitEntry({ ...PIT, team: 9993 })
    if (!first.ok || !second.ok) throw new Error('should save')
    expect(pitStore.get()).toEqual([second.value, first.value])
    expect(first.value).toMatchObject({ ...PIT, motors: '4 drive motors, 2 on the shooter', synced: false })
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
  it('keeps whole numbers and decimals, takes out anything else, and keeps only the first decimal point', () => {
    const typed: [string, string][] = [
      ['120', '120'],
      ['115.5', '115.5'],
      ['', ''],
      ['about 120 lbs', '120'],
      ['-28', '28'],
      ['2e3', '23'],
      ['1.2.3', '1.23'],
      ['..5', '.5'],
    ]
    for (const [text, kept] of typed) expect(numberOnly(text), text).toBe(kept)
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

  it('lists entries newest first, each with its own id, with no role chosen allowed', () => {
    saveEntry(FORM)
    saveEntry({ ...FORM, match: 13, roles: [] })
    expect(entryStore.get().map((e) => e.match)).toEqual([13, 12])
    expect(entryStore.get()[0].id).not.toBe(entryStore.get()[1].id)
    expect(entryStore.get()[0].roles).toEqual([])
  })

  it('saves nothing when the form has a problem, and says why', () => {
    expect(saveEntry({ ...FORM, team: 0 })).toEqual({ ok: false, error: 'Enter the team number first.' })
    // The form sends 0 while no driver skill is chosen.
    expect(saveEntry({ ...FORM, driver_skill: 0 })).toEqual({ ok: false, error: 'Choose a driver skill first.' })
    expect(entryStore.get()).toEqual([])
  })

  it('keeps entries when the example data is reset', () => {
    saveEntry(FORM)
    resetAllStores()
    expect(entryStore.get()).toHaveLength(1)
  })
})

describe('checkEntry', () => {
  it("allows a complete entry, and refuses what the team database would refuse, so an entry can't get stuck Waiting", () => {
    const allowed: [string, Partial<EntryFields>][] = [
      ['the whole form', {}],
      ['driver skill 1', { driver_skill: 1 }],
      ['driver skill 5', { driver_skill: 5 }],
      ['the longest notes', { notes: 'x'.repeat(MAX_NOTES_LENGTH) }],
    ]
    for (const [label, change] of allowed) expect(checkEntry({ ...FORM, ...change }), label).toBeNull()
    const refused: [string, Partial<EntryFields>, RegExp][] = [
      ['no team', { team: 0 }, /team number/],
      ['a team that is not a number', { team: Number.NaN }, /team number/],
      ['a team number too big', { team: 100000 }, /team number/],
      ['no match', { match: 0 }, /match number/],
      ['a match number too big', { match: 1001 }, /match number/],
      ['driver skill 6', { driver_skill: 6 }, /driver skill/],
      ['notes too long', { notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) }, /notes/],
    ]
    for (const [label, change, problem] of refused) expect(checkEntry({ ...FORM, ...change }), label).toMatch(problem)
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

  it('sends Waiting entries, then marks them Synced, with nothing to send after that', async () => {
    expect(await syncEntries()).toEqual({ ok: true, value: 0 })
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
    expect(await syncEntries()).toEqual({ ok: true, value: 0 })
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

  it('sends an entry saved by an older version of the app on this phone', () => {
    const saved = saveEntry(FORM)
    if (!saved.ok) throw new Error(saved.error)
    // Saved before #28: Defender for played defense, and the other new fields left empty.
    const { roles: _r, broke_down: _b, stop: _s, driver_skill: _d, ...rest } = saved.value
    expect(toRow({ ...rest, defense: true })).toMatchObject({ roles: ['Defender'], broke_down: false, stop: 'None', driver_skill: null })
    expect(toRow({ ...rest, defense: false }).roles).toEqual([])
    // Saved before events were recorded: the current event.
    const { event_key: _old, ...older } = saved.value
    expect(toRow(older).event_key).toBe(EVENT_KEY)
  })
})

describe('checkPitEntry', () => {
  it("needs a team number, but takes a blank weight and size, and refuses what the team database would refuse, so a pit entry can't get stuck Waiting", () => {
    const allowed: [string, Partial<PitFields>][] = [
      ['the whole form', {}],
      ['no weight or size', { weight: null, length: null, width: null, height: null }],
      ['the longest answer', { motors: 'x'.repeat(MAX_NOTES_LENGTH) }],
    ]
    for (const [label, change] of allowed) expect(checkPitEntry({ ...PIT, ...change }), label).toBeNull()
    const refused: [string, Partial<PitFields>, RegExp][] = [
      ['no team', { team: 0 }, /Enter the team number/],
      ['a team number too big', { team: 100000 }, /team number/],
      ['a weight of zero', { weight: 0 }, /Check the weight, or leave it blank/],
      ['a weight too big', { weight: MAX_PIT_NUMBER }, /weight/],
      ['a height that is not a number', { height: Number.NaN }, /Check the height, or leave it blank/],
      ['an answer too long', { they_do: 'x'.repeat(MAX_NOTES_LENGTH + 1) }, /under 1000/],
    ]
    for (const [label, change, problem] of refused) expect(checkPitEntry({ ...PIT, ...change }), label).toMatch(problem)
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

  it('sends Waiting pit entries along with match entries, then marks them Synced', async () => {
    saveEntry(FORM)
    const saved = savePitEntry(PIT)
    if (!saved.ok) throw new Error(saved.error)
    await syncEntries()
    expect([...entryStore.get(), ...pitStore.get()].every((e) => e.synced)).toBe(true)
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

  it('sends blank choices and boxes as empty, an entry saved before events were recorded with the current event, and an older entry\'s match number', () => {
    const saved = savePitEntry({ ...PIT, drivetrain: '', auto_side: '', motors: '  ', weight: null })
    if (!saved.ok) throw new Error(saved.error)
    expect(pitToRow(saved.value)).toMatchObject({ match_number: null, drivetrain: null, auto_side: null, motors: null, weight: null })
    const { event_key: _old, ...older } = saved.value
    expect(pitToRow({ ...older, match: 4 })).toMatchObject({ event_key: EVENT_KEY, match_number: 4 })
  })
})

describe('the shared picklist', () => {
  beforeEach(() => {
    picklistTable.reset()
  })

  // The example list, top first: 9991, 9993 (Picked), 9992, 9995 (Do not pick), 9994.
  const teams = () => picklist().map((row) => row.team_number)
  const idOf = (team: number) => picklist().find((row) => row.team_number === team)!.id

  it('puts a position halfway between two teams, or 1000 past the top or bottom', () => {
    expect(positionBetween(1000, 2000)).toBe(1500)
    expect(positionBetween(undefined, 1000)).toBe(0)
    expect(positionBetween(5000, undefined)).toBe(6000)
    expect(positionBetween()).toBe(1000)
  })

  it('moves a team up and down one place', async () => {
    expect(await moveTeam(idOf(9992), -1)).toEqual({ ok: true, value: null })
    expect(teams()).toEqual([9991, 9992, 9993, 9995, 9994])
    await moveTeam(idOf(9992), 1)
    await moveTeam(idOf(9992), 1)
    expect(teams()).toEqual([9991, 9993, 9995, 9992, 9994])
  })

  it('moves a team to the very top and the very bottom', async () => {
    await moveTeam(idOf(9993), -1)
    expect(teams()).toEqual([9993, 9991, 9992, 9995, 9994])
    await moveTeam(idOf(9995), 1)
    expect(teams()).toEqual([9993, 9991, 9992, 9994, 9995])
  })

  it('does nothing when moving the top team up or the bottom team down', async () => {
    const before = picklist()
    expect(await moveTeam(idOf(9991), -1)).toEqual({ ok: true, value: null })
    expect(await moveTeam(idOf(9994), 1)).toEqual({ ok: true, value: null })
    expect(picklist()).toEqual(before)
  })

  it('changes only the moved team in one move', async () => {
    const before = picklist()
    await moveTeam(idOf(9995), -1)
    const changed = picklist().filter((row) => !before.some((old) => JSON.stringify(old) === JSON.stringify(row)))
    expect(changed.map((row) => row.team_number)).toEqual([9995])
  })

  it('keeps working when moves leave no room between two teams, by numbering the list again', async () => {
    // Moving the same two teams past each other over and over halves the gap each time.
    for (let i = 0; i < 100; i++) await moveTeam(idOf(i % 2 === 0 ? 9992 : 9993), -1)
    expect(teams()).toEqual([9991, 9993, 9992, 9995, 9994])
    expect(new Set(picklist().map((row) => row.position)).size).toBe(5)
  })

  it('puts teams with the same position in team number order', () => {
    const row = (team_number: number, position: number) => ({ team_number, position }) as PicklistRow
    expect([row(9993, 1000), row(9991, 1000), row(9992, 500)].sort(byPosition).map((r) => r.team_number)).toEqual([9992, 9991, 9993])
  })

  it('says a team is gone if someone else removed it', async () => {
    expect(await moveTeam('00000000-0000-4000-8000-000000000000', 1)).toEqual({ ok: false, error: expect.stringMatching(/isn't on the picklist/) })
  })

  it('marks a team Picked, Do not pick, or Open again, and it keeps its place', async () => {
    for (const status of ['Picked', 'Do not pick', 'Open'] as const) {
      expect(await setPickStatus(idOf(9992), status)).toEqual({ ok: true, value: null })
      expect(picklist()[2]).toMatchObject({ team_number: 9992, status })
    }
  })

  it('starts an empty picklist in the order given, 1000 apart', async () => {
    const result = await startPicklist([4096, 9991, 9992], '2026test')
    expect(result.ok).toBe(true)
    expect(picklist('2026test').map((row) => [row.team_number, row.position, row.status])).toEqual([
      [4096, 1000, 'Open'],
      [9991, 2000, 'Open'],
      [9992, 3000, 'Open'],
    ])
  })

  it("won't start a picklist that already has teams, or with no teams", async () => {
    expect(await startPicklist([4096])).toEqual({ ok: false, error: expect.stringMatching(/already started/) })
    expect(teams()).toEqual([9991, 9993, 9992, 9995, 9994])
    expect(await startPicklist([], '2026test')).toEqual({ ok: false, error: expect.stringMatching(/no teams/) })
    expect(await startPicklist([0], '2026test')).toEqual({ ok: false, error: expect.stringMatching(/Check the team number/) })
  })

  it('adds only the missing teams, to the bottom', async () => {
    const result = await addMissingTeams([9992, 4096, 9991, 9996])
    expect(result.ok && result.value.map((row) => row.team_number)).toEqual([4096, 9996])
    expect(teams()).toEqual([9991, 9993, 9992, 9995, 9994, 4096, 9996])
    expect(await addMissingTeams([9991, 4096])).toEqual({ ok: true, value: [] })
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

describe('match videos', () => {
  // A made-up match with 4096 on red. Each test changes only the part it's about.
  const match = (number: number, change: Partial<TbaMatchWithVideos> = {}): TbaMatchWithVideos => ({
    key: `2026test_qm${number}`,
    comp_level: 'qm',
    set_number: 1,
    match_number: number,
    alliances: {
      red: { score: 80, team_keys: ['frc4096', 'frc9991', 'frc9992'] },
      blue: { score: 60, team_keys: ['frc9993', 'frc9994', 'frc9995'] },
    },
    winning_alliance: 'red',
    predicted_time: null,
    videos: [{ type: 'youtube', key: 'abc123' }],
    ...change,
  })
  const scores = (red: number, blue: number) => ({
    red: { score: red, team_keys: ['frc4096', 'frc9991', 'frc9992'] },
    blue: { score: blue, team_keys: ['frc9993', 'frc9994', 'frc9995'] },
  })

  it('links to YouTube videos, keeping a start time', () => {
    expect(videoLink({ type: 'youtube', key: 'dQw4w9WgXcQ' })).toBe('https://youtu.be/dQw4w9WgXcQ')
    expect(videoLink({ type: 'youtube', key: 'abc_123-x?t=30' })).toBe('https://youtu.be/abc_123-x?t=30')
  })

  it("gives no link for other kinds of video, or keys that don't look right", () => {
    expect(videoLink({ type: 'tba', key: 'abc123' })).toBeNull()
    for (const key of ['', 'abc/123', 'abc 123', 'abc"123', 'abc123?t=soon', 'javascript:alert(1)']) {
      expect(videoLink({ type: 'youtube', key })).toBeNull()
    }
  })

  it('lists only qualification matches, in order', () => {
    const matches = [match(3), match(1, { comp_level: 'sf', key: '2026test_sf1m1' }), match(1), match(2)]
    expect(qualVideoRows(matches, 4096).map((r) => r.key)).toEqual(['2026test_qm1', '2026test_qm2', '2026test_qm3'])
  })

  it("finds the team's alliance and whether they won, lost or tied", () => {
    expect(qualVideoRows([match(1)], 4096)[0]).toEqual({
      key: '2026test_qm1', number: 1, alliance: 'red', result: 'Won', ourScore: 80, theirScore: 60, links: ['https://youtu.be/abc123'],
    })
    expect(qualVideoRows([match(1)], 9994)[0]).toMatchObject({ alliance: 'blue', result: 'Lost', ourScore: 60, theirScore: 80 })
    expect(qualVideoRows([match(1, { alliances: scores(70, 70) })], 4096)[0].result).toBe('Tied')
  })

  it('tells a match not played yet from one played with no video yet', () => {
    const notPlayed = qualVideoRows([match(1, { alliances: scores(-1, -1), winning_alliance: '', videos: [] })], 4096)[0]
    expect(notPlayed).toMatchObject({ result: null, links: [] })
    const noVideo = qualVideoRows([match(1, { videos: [] })], 4096)[0]
    expect(noVideo).toMatchObject({ result: 'Won', links: [] })
  })

  it('gives a link for each video, leaving out ones that are not YouTube', () => {
    const videos = [{ type: 'youtube', key: 'first' }, { type: 'tba', key: 'other' }, { type: 'youtube', key: 'second?t=12' }]
    expect(qualVideoRows([match(1, { videos })], 4096)[0].links).toEqual(['https://youtu.be/first', 'https://youtu.be/second?t=12'])
  })

  it("works with the example data: 4096's four matches, with videos for the two played", async () => {
    const result = await getTeamMatches(4096)
    if (!result.ok) throw new Error(result.error)
    const rows = qualVideoRows(result.value, 4096)
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3, 4])
    expect(rows.map((r) => r.links.length > 0)).toEqual([true, true, false, false])
    expect(rows.map((r) => r.result)).toEqual(['Won', 'Lost', null, null])
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

  it('asks the match13 function for the event, ranks the ratings best first, and turns a prediction into who is likely to win, and by how much', async () => {
    const ratings = await withAnswer({ ok: true, value: { eventKey: '2026ilch', teams: [row(9991, 30), row(4096, 50), row(9992, 50)], year: 2026 } })
    const result = await ratings.data.getRatings('2026ilch')
    expect(ratings.callFunction).toHaveBeenCalledWith('match13', { kind: 'ratings', event: '2026ilch' }, expect.any(Function))
    expect(result.ok && result.value.map((r) => r.teamNumber)).toEqual([4096, 9992, 9991])

    const predictions = await withAnswer({ ok: true, value: { eventKey: '2026ilch', matches: [match], year: 2026 } })
    expect(await predictions.data.getPredictions('2026ilch')).toEqual({ ok: true, value: [{ key: '2026ilch_qm1', redWinChance: 0.81, redScore: 120.4, blueScore: 95.2 }] })
    expect(predictions.callFunction).toHaveBeenCalledWith('match13', { kind: 'predictions', event: '2026ilch' }, expect.any(Function))
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

describe("the picklist page: each team's numbers and the weights", () => {
  // A match entry as the team database has it, for team 9991 unless changed.
  let next = 0
  const row = (match: number, fields: Partial<MatchRow> = {}): MatchRow => ({
    id: `picklist-entry-${++next}`,
    event_key: EVENT_KEY,
    match_number: match,
    team_number: 9991,
    counts: { autoFuel: 2, teleopFuel: 10, fuelMissed: 1 },
    endgame: 'Level 1',
    roles: ['Scorer'],
    broke_down: false,
    stop: 'None',
    driver_skill: 3,
    notes: null,
    scouted_by: DEMO_PEOPLE.alex,
    scouted_at: '2026-11-07T15:00:00Z',
    ...fields,
  })
  const rated = (teamNumber: number, xAuto: number): Match13Rating => ({
    teamNumber, xpStart: 30, xpEnd: 40, xAuto, xTele: 20, xEnd: 5, epa: null, opr: null, dpr: null,
  })

  beforeEach(() => weightsStore.reset())

  it("uses the team page's averages and Match 13's auto, teleop and endgame", () => {
    const entries = [row(1, { counts: { autoFuel: 1, teleopFuel: 10, fuelMissed: 2 } }), row(2, { counts: { autoFuel: 4, teleopFuel: 6, fuelMissed: 0 } })]
    const [team] = picklistTeams([rated(9991, 12)], entries, [])
    expect(team).toEqual({ team: 9991, values: { xAuto: 12, xTele: 20, xEnd: 5, autoFuel: 2.5, teleopFuel: 8, fuelMissed: 1 }, matches: 2, rated: true })
    const summary = teamSummary(9991, entries, [])
    for (const c of summary.counters) expect(team.values[c.key]).toBe(c.average)
  })

  it('lists every team rated by Match 13 or scouted at this event, each once, lowest number first', () => {
    const entries = [row(1, { team_number: 9993 }), row(2), row(3, { team_number: 9995, event_key: '2025ilch' })]
    const pit = pitToRow({ ...PIT, team: 9992, id: 'picklist-pit', created_at: '2026-11-07T14:00:00Z', event_key: EVENT_KEY, scouted_by: null, synced: false })
    expect(picklistTeams([rated(9991, 1), rated(4096, 2)], entries, [pit]).map((t) => t.team)).toEqual([4096, 9991, 9992, 9993])
  })

  it("leaves our numbers empty for a team with no scouting yet, and Match 13's for a team it hasn't rated", () => {
    const [notScouted, notRated] = picklistTeams([rated(4096, 9)], [row(1, { team_number: 9991 })], [])
    expect(notScouted).toMatchObject({ team: 4096, matches: 0, rated: true, values: { xAuto: 9, autoFuel: null, fuelMissed: null } })
    expect(notRated).toMatchObject({ team: 9991, matches: 1, rated: false, values: { xAuto: null, xTele: null, xEnd: null, autoFuel: 2 } })
  })

  it('counts two scouts watching the same match as one match', () => {
    expect(picklistTeams([], [row(5), row(5), row(6)], [])[0].matches).toBe(2)
  })

  it('keeps each weight a whole number from 0 to 5, and resets them', () => {
    setWeight('autoFuel', 9)
    setWeight('xAuto', -2)
    setWeight('xTele', 2.4)
    expect(weightsStore.get()).toMatchObject({ autoFuel: MAX_WEIGHT, xAuto: 0, xTele: 2 })
    resetWeights()
    expect(weightsStore.get()).toEqual(DEFAULT_WEIGHTS)
  })

  it('knows when every weight is 0, counting a missing weight as the default', () => {
    const zero = Object.fromEntries(picklistParts().map((p) => [p.key, 0]))
    expect(allWeightsZero(zero)).toBe(true)
    expect(allWeightsZero({ ...zero, xEnd: 1 })).toBe(false)
    const missingOne = { ...zero }
    delete missingOne.autoFuel
    expect(weightOf(missingOne, 'autoFuel')).toBe(1)
    expect(allWeightsZero(missingOne)).toBe(false)
  })
})

describe('event rankings that update live', () => {
  // A fresh copy of data.ts, with The Blue Alliance's answers made up by each
  // test. Once they run out, it answers with the demo rankings.
  async function withAnswers(...answers: ({ ok: true; value: unknown } | { ok: false; error: string })[]) {
    vi.resetModules()
    const callFunction = vi.fn(async (_name: string, _body: unknown, demo: () => unknown) => answers.shift() ?? { ok: true, value: demo() })
    vi.doMock('../../core/functions', () => ({ callFunction }))
    return { data: await import('./data'), callFunction }
  }
  afterEach(() => {
    vi.doUnmock('../../core/functions')
    vi.resetModules()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps the rankings on this device, with when they came', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-07T15:00:00Z') })
    const { data } = await withAnswers()
    const result = await data.refreshRankings()
    if (!result.ok) throw new Error(result.error)
    expect(data.rankingsStore.get()).toEqual({ event: EVENT_KEY, rankings: result.value.rankings, checked_at: '2026-11-07T15:00:00.000Z' })
    expect(result.value.rankings[0]).toMatchObject({ rank: 1, extra_stats: [expect.any(Number)] })
    expect(data.rankingsStatus.get()).toEqual({ checking: false, problem: null })
  })

  it('keeps showing the last rankings with no connection, and says why they are old', async () => {
    const { data, callFunction } = await withAnswers()
    await data.refreshRankings()
    const before = data.rankingsStore.get()
    vi.stubGlobal('navigator', { onLine: false })
    expect(await data.refreshRankings()).toEqual({ ok: false, error: expect.stringMatching(/No connection/) })
    expect(callFunction).toHaveBeenCalledTimes(1)
    expect(data.rankingsStore.get()).toBe(before)
    expect(data.rankingsStatus.get().problem).toMatch(/No connection/)
  })

  it('keeps the last rankings when The Blue Alliance has a problem', async () => {
    const { data } = await withAnswers({ ok: true, value: { rankings: [] } }, { ok: false, error: 'The Blue Alliance had a problem (500). Try again in a minute.' })
    await data.refreshRankings()
    const before = data.rankingsStore.get()
    expect(await data.refreshRankings()).toMatchObject({ ok: false })
    expect(data.rankingsStore.get()).toBe(before)
    expect(data.rankingsStatus.get().problem).toMatch(/Try again in a minute/)
  })

  it('checks now, every minute, when the app comes back on screen and when the phone comes back online, until stopped', async () => {
    vi.useFakeTimers()
    // Stand-ins for the browser's window and document, which the tests don't have.
    const window = new EventTarget()
    const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    vi.stubGlobal('addEventListener', window.addEventListener.bind(window))
    vi.stubGlobal('removeEventListener', window.removeEventListener.bind(window))
    vi.stubGlobal('document', document)
    const { data, callFunction } = await withAnswers()

    const stop = data.watchRankings()
    expect(callFunction).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(data.RANKINGS_EVERY_MS)
    expect(callFunction).toHaveBeenCalledTimes(2)
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    expect(callFunction).toHaveBeenCalledTimes(4)

    // Not every minute while the app is off screen: it checks when it comes back.
    document.visibilityState = 'hidden'
    await vi.advanceTimersByTimeAsync(data.RANKINGS_EVERY_MS)
    expect(callFunction).toHaveBeenCalledTimes(4)

    stop()
    document.visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(data.RANKINGS_EVERY_MS)
    expect(callFunction).toHaveBeenCalledTimes(4)
  })

  it('finds one team in the rankings', async () => {
    const result = await getRankings()
    if (!result.ok) throw new Error(result.error)
    expect(rankOf(result.value, 4096)).toMatchObject({ team_key: 'frc4096', rank: expect.any(Number) })
    expect(rankOf(result.value, 1234)).toBeNull()
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
    predictions: [],
    savedAt: '2026-03-13T14:00:00Z',
  }

  beforeEach(() => {
    scheduleStore.reset()
    positionStore.reset()
  })

  it("finds the team for each position in a match, and nothing for a match that isn't in the schedule, with no position, or with no schedule", () => {
    const found: [SavedSchedule | null, number, Parameters<typeof teamFor>[2], number | null][] = [
      [SCHEDULE, 1, 'Red 1', 4096],
      [SCHEDULE, 1, 'Red 3', 9992],
      [SCHEDULE, 1, 'Blue 2', 9994],
      [SCHEDULE, 2, 'Red 3', 4096],
      [SCHEDULE, 2, 'Blue 1', 9991],
      [SCHEDULE, 3, 'Red 1', null],
      [SCHEDULE, 0, 'Red 1', null],
      [SCHEDULE, 1, '', null],
      [null, 1, 'Red 1', null],
    ]
    for (const [schedule, match, position, team] of found) expect(teamFor(schedule, match, position), `${schedule ? 'match' : 'no schedule'} ${match} ${position}`).toBe(team)
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
  const SAVED: SavedSchedule = { event: EVENT_KEY, matches: [tbaMatch(1, [4096, 9991, 9992], [9993, 9994, 9995])], predictions: [], savedAt: '2026-03-13T14:00:00Z' }
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

  it("uses the saved copy with no connection, but not one for another event, and otherwise says what went wrong, so the scout can type the team in", async () => {
    const data = await withAnswer(NO_CONNECTION)
    data.scheduleStore.set(SAVED)
    expect(await data.loadSchedule()).toEqual({ ok: true, value: SAVED })
    data.scheduleStore.set({ ...SAVED, event: '2025old' })
    expect((await data.loadSchedule()).ok).toBe(false)
    data.scheduleStore.reset()
    expect(await data.loadSchedule()).toEqual({ ok: false, error: `Couldn't get the match schedule. ${NO_CONNECTION.error}` })
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

describe('the match schedule with Match 13 predictions', () => {
  // A TBA match, shaped like the real ones. Scores are -1 until played.
  const tbaMatch = (comp_level: TbaMatch['comp_level'], set_number: number, match_number: number, red: number[], blue: number[], scores: [number, number] = [-1, -1]): TbaMatch => ({
    key: `2026test_${comp_level}${comp_level === 'qm' ? '' : `${set_number}m`}${match_number}`,
    comp_level,
    set_number,
    match_number,
    alliances: {
      red: { score: scores[0], team_keys: red.map((t) => `frc${t}`) },
      blue: { score: scores[1], team_keys: blue.map((t) => `frc${t}`) },
    },
    winning_alliance: '',
    predicted_time: null,
  })
  const prediction = (key: string, redWinChance: number): MatchPrediction => ({ key, redWinChance, redScore: 80, blueScore: 70 })

  it('puts every example match with its prediction, and shows real scores once played', async () => {
    const schedule = await getSchedule('2026demo')
    const predictions = await getPredictions('2026demo')
    if (!schedule.ok || !predictions.ok) throw new Error('No example data')
    const rows = matchesWithPredictions(schedule.value, predictions.value)
    expect(rows.map((r) => r.label)).toEqual(['Qual 1', 'Qual 2', 'Qual 3', 'Qual 4'])
    for (const row of rows) expect(row.prediction?.key).toBe(row.key)
    expect(rows[0]).toMatchObject({ red: [4096, 9991, 9992], blue: [9993, 9994, 9995], score: { red: 84, blue: 71 }, ours: true })
    expect(rows[2].score).toBeNull()
    expect(rows.every((r) => r.ours)).toBe(true)
    // A team that isn't at the event has no matches marked as theirs.
    expect(matchesWithPredictions(schedule.value, predictions.value, 1234).some((r) => r.ours)).toBe(false)
  })

  it('still shows a match Match 13 has not predicted, with no prediction', () => {
    const qm1 = tbaMatch('qm', 1, 1, [1, 2, 3], [4, 5, 6])
    const qm2 = tbaMatch('qm', 1, 2, [1, 2, 3], [4, 5, 6])
    const rows = matchesWithPredictions([qm1, qm2], [prediction(qm2.key, 0.6), prediction('2026test_qm99', 0.9)])
    expect(rows.map((r) => r.prediction?.redWinChance ?? null)).toEqual([null, 0.6])
    expect(matchesWithPredictions([qm1], []).map((r) => r.prediction)).toEqual([null])
  })

  it('puts matches in the order they are played, whatever order TBA sends them in, named the way the team says them', () => {
    const rows = matchesWithPredictions([
      tbaMatch('f', 1, 2, [1], [2]),
      tbaMatch('sf', 2, 1, [1], [2]),
      tbaMatch('qm', 1, 10, [1], [2]),
      tbaMatch('qm', 1, 2, [1], [2]),
      tbaMatch('sf', 1, 1, [1], [2]),
      tbaMatch('f', 1, 1, [1], [2]),
    ], [])
    expect(rows.map((r) => r.label)).toEqual(['Qual 2', 'Qual 10', 'Semifinal 1', 'Semifinal 2', 'Final 1', 'Final 2'])
    expect(matchLabel({ comp_level: 'sf', set_number: 3, match_number: 1 })).toBe('Semifinal 3')
    expect(matchLabel({ comp_level: 'qf', set_number: 1, match_number: 2 })).toBe('Quarterfinal 1 match 2')
  })

  it('counts a match as played only when both scores are in', () => {
    const played = tbaMatch('qm', 1, 1, [1], [2], [0, 12])
    const notYet = tbaMatch('qm', 1, 2, [1], [2])
    // TBA sometimes sends null instead of -1. In JavaScript null >= 0 is true, so this checks null isn't counted as a score.
    const nulls = tbaMatch('qm', 1, 3, [1], [2], [null as unknown as number, null as unknown as number])
    expect(matchesWithPredictions([played, notYet, nulls], []).map((r) => r.score)).toEqual([{ red: 0, blue: 12 }, null, null])
  })

  it('says who is likely to win and their chance', () => {
    expect(likelyWinner(prediction('k', 0.72))).toBe('Red 72%')
    expect(likelyWinner(prediction('k', 0.28))).toBe('Blue 72%')
    expect(likelyWinner(prediction('k', 0.5))).toBe('Toss-up')
    expect(likelyWinner(prediction('k', 0.504))).toBe('Toss-up')
    expect(likelyWinner(prediction('k', 1))).toBe('Red 100%')
  })

  it('says how long ago it was updated', () => {
    const now = new Date('2026-03-13T15:00:00Z')
    expect(updatedAgo('2026-03-13T14:59:30Z', now)).toBe('just now')
    expect(updatedAgo('2026-03-13T14:59:00Z', now)).toBe('1 minute ago')
    expect(updatedAgo('2026-03-13T14:57:59Z', now)).toBe('2 minutes ago')
    expect(updatedAgo('2026-03-13T13:00:00Z', now)).toBe('2 hours ago')
    expect(updatedAgo('2026-03-10T15:00:00Z', now)).toBe('3 days ago')
  })
})

describe('keeping the schedule on this device', () => {
  beforeEach(() => {
    scheduleStore.reset()
    scheduleStatus.reset()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('saves the schedule and predictions, for this event only', async () => {
    vi.useFakeTimers({ now: new Date('2026-03-13T15:00:00Z'), toFake: ['Date'] })
    const result = await refreshSchedule('2026demo')
    if (!result.ok) throw new Error(result.error)
    expect(savedSchedule('2026demo')).toEqual({
      event: '2026demo', matches: expect.any(Array), predictions: expect.any(Array), savedAt: '2026-03-13T15:00:00.000Z',
    })
    expect(savedSchedule('2026demo')!.matches).toHaveLength(4)
    expect(savedSchedule('2026demo')!.predictions).toHaveLength(4)
    expect(savedSchedule('2026other')).toBeNull()
    expect(scheduleStatus.get()).toEqual({ loading: false, problem: null })
  })

  it('keeps the saved copy when there is no connection, and says so', async () => {
    await refreshSchedule('2026demo')
    const before = savedSchedule('2026demo')
    vi.stubGlobal('navigator', { onLine: false })
    expect(await refreshSchedule('2026demo')).toEqual({ ok: false, error: 'No connection.' })
    expect(savedSchedule('2026demo')).toBe(before)
    expect(scheduleStatus.get().problem).toBe('No connection.')
  })

  it('asks now, every 2 minutes, when the app is back on screen and when back online, until the page closes', async () => {
    vi.useFakeTimers({ now: new Date('2026-03-13T15:00:00Z') })
    const page = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    vi.stubGlobal('addEventListener', page.addEventListener.bind(page))
    vi.stubGlobal('removeEventListener', page.removeEventListener.bind(page))
    vi.stubGlobal('document', doc)
    const savedAt = () => savedSchedule('2026demo')?.savedAt

    const stop = keepScheduleFresh('2026demo')
    await vi.advanceTimersByTimeAsync(0)
    expect(savedAt()).toBe('2026-03-13T15:00:00.000Z')

    await vi.advanceTimersByTimeAsync(SCHEDULE_REFRESH_MS)
    expect(savedAt()).toBe('2026-03-13T15:02:00.000Z')

    await vi.advanceTimersByTimeAsync(30_000)
    page.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(savedAt()).toBe('2026-03-13T15:02:30.000Z')

    await vi.advanceTimersByTimeAsync(10_000)
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(savedAt()).toBe('2026-03-13T15:02:40.000Z')

    stop()
    await vi.advanceTimersByTimeAsync(5 * SCHEDULE_REFRESH_MS)
    page.dispatchEvent(new Event('online'))
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(savedAt()).toBe('2026-03-13T15:02:40.000Z')
  })
})

describe('when The Blue Alliance or Match 13 has a problem', () => {
  let scheduleWorks = true
  let predictionsWork = true
  const match = { key: '2026ilch_qm1', comp_level: 'qm', set_number: 1, match_number: 1, alliances: { red: { score: -1, team_keys: ['frc4096'] }, blue: { score: -1, team_keys: ['frc9991'] } }, winning_alliance: '', predicted_time: null }

  async function fresh() {
    vi.resetModules()
    const callFunction = vi.fn(async (_name: string, body: { kind: string }) => {
      if (body.kind === 'schedule') return scheduleWorks ? { ok: true, value: [match] } : { ok: false, error: 'The Blue Alliance is down. Try again in a minute.' }
      return predictionsWork
        ? { ok: true, value: { matches: [{ key: match.key, pred: { winProb: 0.7, redScore: 90, blueScore: 70 } }] } }
        : { ok: false, error: 'Match 13 is down.' }
    })
    vi.doMock('../../core/functions', () => ({ callFunction }))
    return await import('./data')
  }
  afterEach(() => {
    vi.doUnmock('../../core/functions')
    vi.resetModules()
    scheduleWorks = true
    predictionsWork = true
  })

  it('keeps the last predictions when only Match 13 fails, and says they may be old', async () => {
    const data = await fresh()
    await data.refreshSchedule('2026ilch')
    predictionsWork = false
    const result = await data.refreshSchedule('2026ilch')
    expect(result.ok).toBe(true)
    expect(data.savedSchedule('2026ilch')!.predictions).toEqual([{ key: match.key, redWinChance: 0.7, redScore: 90, blueScore: 70 }])
    expect(data.scheduleStatus.get().problem).toMatch(/Match 13.*may be old.*Match 13 is down/)
  })

  it('keeps the saved schedule when The Blue Alliance fails', async () => {
    const data = await fresh()
    await data.refreshSchedule('2026ilch')
    const before = data.savedSchedule('2026ilch')
    scheduleWorks = false
    expect(await data.refreshSchedule('2026ilch')).toEqual({ ok: false, error: 'The Blue Alliance is down. Try again in a minute.' })
    expect(data.savedSchedule('2026ilch')).toBe(before)
    expect(data.scheduleStatus.get()).toEqual({ loading: false, problem: 'The Blue Alliance is down. Try again in a minute.' })
  })
})

describe("The Blue Alliance: an event's teams", () => {
  const team = (team_number: number) => ({ key: `frc${team_number}`, team_number, nickname: `Team ${team_number}`, city: null, state_prov: null, country: null })

  async function withAnswers(answers: Record<string, { ok: true; value: unknown } | { ok: false; error: string }>) {
    vi.resetModules()
    const callFunction = vi.fn(async (name: string) => answers[name])
    vi.doMock('../../core/functions', () => ({ callFunction }))
    return { data: await import('./data'), callFunction }
  }
  afterEach(() => {
    vi.doUnmock('../../core/functions')
    vi.resetModules()
  })

  it("lists the example event's teams by number in demo mode", async () => {
    const result = await getEventTeams()
    expect(result.ok && result.value.map((t) => t.team_number)).toEqual([4096, 9991, 9992, 9993, 9994, 9995])
  })

  it("links to a team's page on The Blue Alliance for the event's season", () => {
    expect(tbaTeamUrl(4096, '2026ilch')).toBe('https://www.thebluealliance.com/team/4096/2026')
    expect(tbaTeamUrl(9991, '2027cmptx')).toBe('https://www.thebluealliance.com/team/9991/2027')
    expect(tbaTeamUrl(4096)).toBe(`https://www.thebluealliance.com/team/4096/${EVENT_KEY.slice(0, 4)}`)
  })

  it("asks the tba function for the event's teams, and sorts them by number", async () => {
    const { data, callFunction } = await withAnswers({ tba: { ok: true, value: [team(9993), team(254), team(9991)] } })
    const result = await data.getEventTeams('2026arc')
    expect(callFunction).toHaveBeenCalledWith('tba', { kind: 'teams', event: '2026arc' }, expect.any(Function))
    expect(result.ok && result.value.map((t) => t.team_number)).toEqual([254, 9991, 9993])
  })
})

describe('teamSummary', () => {
  // A match entry as the team database has it. Each test changes only the part it's about.
  let next = 0
  const row = (match: number, fields: Partial<MatchRow> = {}): MatchRow => ({
    id: `entry-${++next}`,
    event_key: EVENT_KEY,
    match_number: match,
    team_number: 9991,
    counts: { autoFuel: 2, teleopFuel: 10, fuelMissed: 1 },
    endgame: 'Level 1',
    roles: ['Scorer'],
    broke_down: false,
    stop: 'None',
    driver_skill: 3,
    notes: null,
    scouted_by: DEMO_PEOPLE.alex,
    scouted_at: `2026-11-07T15:${String(match).padStart(2, '0')}:00Z`,
    ...fields,
  })
  const pit = (fields: Partial<PitRow> = {}): PitRow => ({
    ...pitToRow({ ...PIT, team: 9991, id: `pit-${++next}`, created_at: '2026-11-07T14:00:00Z', event_key: EVENT_KEY, scouted_by: DEMO_PEOPLE.jordan, synced: false }),
    ...fields,
  })
  const counter = (summary: TeamSummary, key: string) => summary.counters.find((c) => c.key === key)

  it("averages each counter over the entries that have it, lists each match, and follows the counters in season.ts", () => {
    const summary = teamSummary(9991, [row(4, { counts: { autoFuel: 1 } }), row(2, { counts: { autoFuel: 4 } })], [])
    expect(summary.matchCount).toBe(2)
    expect(counter(summary, 'autoFuel')).toEqual({ key: 'autoFuel', label: 'Auto fuel scored', average: 2.5, perMatch: [{ match: 2, count: 4 }, { match: 4, count: 1 }] })
    // Only entries that have the counter count, it's null when none do, and counters season.ts doesn't have are ignored.
    const partly = teamSummary(9991, [row(1, { counts: { autoFuel: 3, oldCounter: 9 } }), row(2, { counts: {} })], [])
    expect(counter(partly, 'autoFuel')).toMatchObject({ average: 3, perMatch: [{ match: 1, count: 3 }] })
    expect(counter(partly, 'teleopFuel')).toMatchObject({ average: null, perMatch: [] })
    expect(counter(partly, 'oldCounter')).toBeUndefined()
    // A counter added to season.ts shows with no other change.
    const added = teamSummary(9991, [row(1, { counts: { climbs: 2 } }), row(2, { counts: { climbs: 4 } })], [], [...COUNTERS, { key: 'climbs', label: 'Climbs' }])
    expect(counter(added, 'climbs')).toMatchObject({ label: 'Climbs', average: 3 })
  })

  it('leaves out other teams and other events, and counts two scouts on the same robot in the same match as two entries', () => {
    const summary = teamSummary(9991, [row(1), row(2, { team_number: 9992 }), row(3, { event_key: '2025ilch' })], [pit({ team_number: 9992 }), pit({ event_key: '2025ilch' })])
    expect(summary.matchCount).toBe(1)
    expect(summary.pitCount).toBe(0)
    expect(teamSummary(9991, [row(5), row(5)], []).matchCount).toBe(2)
  })

  it('counts every endgame choice in order, including ones that never came up, and each role an entry chose, out of the number of matches', () => {
    const summary = teamSummary(9991, [row(1, { endgame: 'Level 2' }), row(2, { endgame: 'Level 2' }), row(3, { endgame: 'None' }), row(4, { endgame: 'Level 2' })], [])
    expect(summary.endgame).toEqual([
      { option: 'None', count: 1, share: 0.25 },
      { option: 'Level 1', count: 0, share: 0 },
      { option: 'Level 2', count: 3, share: 0.75 },
      { option: 'Level 3', count: 0, share: 0 },
    ])
    const roles = teamSummary(9991, [row(1, { roles: ['Scorer', 'Defender'] }), row(2, { roles: ['Scorer'] }), row(3, { roles: [] })], []).roles
    expect(roles.map((t) => [t.option, t.count])).toEqual([['Scorer', 2], ['Defender', 1], ['Feeder', 0]])
    expect(roles[0].share).toBeCloseTo(2 / 3)
  })

  it('counts driver skill, skipping entries with none, and stops, break-downs and the drivetrain from the pit form', () => {
    const skill = teamSummary(9991, [row(1, { driver_skill: 4 }), row(2, { driver_skill: null })], []).driverSkill
    expect(skill.map((t) => t.option)).toEqual(['1', '2', '3', '4', '5'])
    expect(skill[3]).toEqual({ option: '4', count: 1, share: 1 })
    const summary = teamSummary(9991, [row(1, { stop: 'E-stop', broke_down: true }), row(2)], [pit({ drivetrain: 'Tank' }), pit({ drivetrain: '' })])
    expect(summary.stops.find((t) => t.option === 'E-stop')).toEqual({ option: 'E-stop', count: 1, share: 0.5 })
    expect(summary.brokeDown).toBe(1)
    expect(summary.drivetrain.find((t) => t.option === 'Tank')).toEqual({ option: 'Tank', count: 1, share: 1 })
    expect(summary.drivetrain).toHaveLength(DRIVETRAINS.length)
  })

  it('lists notes and pit answers newest first, leaving out blank ones', () => {
    const blankPit = { motors: null, auto_path: null, partners_do: null, auto_side: null, weight: null, length: null, width: null, height: null }
    const summary = teamSummary(
      9991,
      [row(1, { notes: 'Slow intake' }), row(3, { notes: '  ' }), row(2, { notes: 'Fast cycles', scouted_by: DEMO_PEOPLE.jordan })],
      [pit({ ...blankPit, they_do: 'Score fuel' })],
    )
    expect(summary.written).toEqual([
      { kind: 'match', question: 'Notes', text: 'Fast cycles', match: 2, by: DEMO_PEOPLE.jordan, at: '2026-11-07T15:02:00Z' },
      { kind: 'match', question: 'Notes', text: 'Slow intake', match: 1, by: DEMO_PEOPLE.alex, at: '2026-11-07T15:01:00Z' },
      { kind: 'pit', question: 'What they will do', text: 'Score fuel', match: null, by: DEMO_PEOPLE.jordan, at: '2026-11-07T14:00:00Z' },
    ])
  })

  it('gives nothing for a team with no entries', () => {
    const summary = teamSummary(1234, [row(1)], [pit()])
    expect(summary).toMatchObject({ matchCount: 0, pitCount: 0, brokeDown: 0, written: [] })
    expect(summary.counters.every((c) => c.average === null && c.perMatch.length === 0)).toBe(true)
    expect(summary.endgame.every((t) => t.count === 0 && t.share === 0)).toBe(true)
  })

  it("counts an entry once when it's both Waiting on this phone and in the team database", () => {
    const waiting = toRow({ ...FORM, id: 'entry-on-phone', created_at: '2026-11-07T15:00:00Z', event_key: EVENT_KEY, scouted_by: null, synced: false })
    const pitWaiting = pitToRow({ ...PIT, id: 'pit-on-phone', created_at: '2026-11-07T14:00:00Z', scouted_by: null, synced: false })
    expect(teamSummary(FORM.team, [waiting, { ...waiting }], []).matchCount).toBe(1)
    expect(teamSummary(PIT.team, [], [pitWaiting, { ...pitWaiting }]).pitCount).toBe(1)
  })

  it('lists the teams scouted at this event, each once', () => {
    const entries = [row(1, { team_number: 9993 }), row(2), row(3), row(4, { team_number: 9995, event_key: '2025ilch' })]
    expect(scoutedTeams(entries, [pit({ team_number: 9992 })])).toEqual([9991, 9992, 9993])
  })
})

describe('pitAnswers', () => {
  it("gives each answer the scout filled in, with the robot's size together", () => {
    const answers = pitAnswers(pitToRow({ ...PIT, id: 'pit-1', created_at: '2026-11-07T14:00:00Z', scouted_by: null, synced: false, motors: '' }))
    expect(answers.map((a) => a.question)).toEqual(['Weight', 'Size', 'Auto starting side', 'Auto path', 'What they want partners to do', 'What they will do'])
    expect(answers[1].text).toBe('28 × 28 × 36 inches (length × width × height)')
  })
})

// ---------------------------------------------------------------------------
// One team's Match 13 numbers (#37), with the example ratings.

// A hand-made rating: only the team and the two xP numbers matter here.
const rating = (teamNumber: number, xpEnd: number, xpStart = 40): Match13Rating => ({
  teamNumber, xpStart, xpEnd, xAuto: null, xTele: null, xEnd: null, epa: null, opr: null, dpr: null,
})

describe('teamRating', () => {
  async function exampleRatings() {
    const result = await getRatings()
    if (!result.ok) throw new Error(result.error)
    return result.value
  }

  it('ranks us first of six, up 4.6 since the event started', async () => {
    const us = teamRating(await exampleRatings(), 4096)
    expect(us).toMatchObject({ rank: 1, teams: 6, change: 4.6, rating: { teamNumber: 4096, xpEnd: 48.6 } })
  })

  it('ranks the lowest-rated team last', async () => {
    expect(teamRating(await exampleRatings(), 9995)).toMatchObject({ rank: 6, teams: 6 })
  })

  it('gives a negative change for a team that went down', async () => {
    expect(teamRating(await exampleRatings(), 9992)?.change).toBe(-1.4)
  })

  it('gives tied teams the same rank, and skips the next one', () => {
    const ratings = [rating(4096, 50), rating(9991, 50), rating(9992, 40)]
    expect(teamRating(ratings, 4096)?.rank).toBe(1)
    expect(teamRating(ratings, 9991)?.rank).toBe(1)
    expect(teamRating(ratings, 9992)?.rank).toBe(3)
  })

  it("gives null for a team Match 13 hasn't rated", async () => {
    expect(teamRating(await exampleRatings(), 1234)).toBeNull()
    expect(teamRating([], 4096)).toBeNull()
  })
})

describe('teamRecord', () => {
  it("finds a team's record in The Blue Alliance's rankings", async () => {
    const rankings = await getRankings()
    if (!rankings.ok) throw new Error(rankings.error)
    expect(teamRecord(rankings.value, 4096)).toEqual({ wins: 1, losses: 1, ties: 0 })
    expect(teamRecord(rankings.value, 1234)).toBeNull()
  })
})

describe('signed', () => {
  it('shows the sign, to one decimal place', () => {
    expect(signed(4.6)).toBe('+4.6')
    expect(signed(-1.4)).toBe('−1.4')
    expect(signed(3)).toBe('+3.0')
    expect(signed(0)).toBe('0.0')
    expect(signed(-0.04)).toBe('0.0')
  })
})

describe('savedWhen', () => {
  // Intl puts thin spaces before AM and PM; the tests compare plain ones.
  const plain = (text: string) => text.replace(/[  ]/g, ' ')
  // Monday, Nov 9, 3:40 PM in Chicago.
  const now = new Date('2026-11-09T21:40:00Z')

  it('says Today, or the day, in Chicago time', () => {
    expect(plain(savedWhen('2026-11-09T21:40:00Z', now))).toBe('Today at 3:40 PM')
    expect(plain(savedWhen('2026-11-08T21:40:00Z', now))).toBe('Nov 8 at 3:40 PM')
    // 5:30 AM UTC on the 9th is still the evening of the 8th in Chicago.
    expect(plain(savedWhen('2026-11-09T05:30:00Z', now))).toBe('Nov 8 at 11:30 PM')
  })
})

describe('the saved copy of the ratings', () => {
  const now = new Date('2026-11-09T21:40:00Z')
  const minutesLater = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

  beforeEach(async () => {
    // Let any load from an earlier test finish before starting fresh.
    await loadRatings(now)
    resetRatings()
  })

  it('loads every rating and ranking and saves them for this event', async () => {
    await loadRatings(now)
    const saved = savedRatings()
    expect(saved).toMatchObject({ event: EVENT_KEY, loadedAt: now.toISOString(), error: null })
    expect(saved.ratings).toHaveLength(6)
    expect(saved.rankings).toHaveLength(6)
  })

  it('shares a load already under way', async () => {
    const first = loadRatings(now)
    expect(loadRatings(now)).toBe(first)
    await first
  })

  it('loads when nothing is saved, or the copy is old', async () => {
    expect(needsLoading(ratingsStore.get(), now)).toBe(true)
    await loadRatings(now)
    expect(needsLoading(ratingsStore.get(), minutesLater(1))).toBe(false)
    expect(needsLoading(ratingsStore.get(), minutesLater(STALE_MS / 60_000 + 1))).toBe(true)
  })

  it('treats a copy for another event as nothing saved', () => {
    ratingsStore.set({ event: '2025old', ratings: [rating(4096, 50)], rankings: [], loadedAt: now.toISOString(), error: null })
    expect(savedRatings()).toEqual({ event: null, ratings: [], rankings: [], loadedAt: null, error: null })
    expect(needsLoading(ratingsStore.get(), now)).toBe(true)
  })

  it('is cleared by Reset example data, since it is only a copy', async () => {
    await loadRatings(now)
    resetAllStores()
    expect(savedRatings().loadedAt).toBeNull()
  })
})

describe("the saved copy when Match 13 or The Blue Alliance can't be reached", () => {
  const now = new Date('2026-11-09T21:40:00Z')
  const later = new Date('2026-11-09T22:00:00Z')
  const rankings = [{ rank: 1, team_key: 'frc4096', record: { wins: 2, losses: 0, ties: 0 }, matches_played: 2, extra_stats: [6] }]
  const DOWN = "Couldn't reach Match 13. Try again in a minute."
  type Answer = { ok: true; value: unknown } | { ok: false; error: string }
  const works: Record<string, Answer> = { match13: { ok: true, value: { teams: [rating(4096, 50)] } }, tba: { ok: true, value: { rankings } } }

  // What each server function answers. A test can change them between loads.
  async function withAnswers(first: Record<string, Answer>) {
    vi.resetModules()
    const answers = { ...first }
    const callFunction = vi.fn(async (name: string) => answers[name])
    vi.doMock('../../core/functions', () => ({ callFunction }))
    const data = await import('./data')
    data.resetRatings()
    return { data, answers }
  }
  afterEach(() => {
    vi.doUnmock('../../core/functions')
    vi.resetModules()
  })

  it("keeps the saved numbers, and says why, when it can't load", async () => {
    const { data, answers } = await withAnswers(works)
    await data.loadRatings(now)
    answers.match13 = { ok: false, error: DOWN }
    answers.tba = { ok: false, error: "Couldn't reach the server. Check your connection and try again." }
    await data.loadRatings(later)
    expect(data.savedRatings()).toEqual({ event: EVENT_KEY, ratings: [rating(4096, 50)], rankings, loadedAt: now.toISOString(), error: DOWN })
  })

  it('saves the part that worked when only one does', async () => {
    const { data, answers } = await withAnswers(works)
    await data.loadRatings(now)
    answers.match13 = { ok: false, error: DOWN }
    answers.tba = { ok: true, value: { rankings: [] } }
    await data.loadRatings(later)
    expect(data.savedRatings()).toMatchObject({ ratings: [rating(4096, 50)], rankings: [], loadedAt: now.toISOString(), error: DOWN })
  })

  it('treats Match 13 having nothing for the event as nobody rated yet, not a problem', async () => {
    const { data } = await withAnswers({
      ...works,
      match13: { ok: false, error: 'Match 13 has nothing for that event yet. Check EVENT_KEY in season.ts, or try again once the event starts.' },
    })
    await data.loadRatings(now)
    expect(data.savedRatings()).toMatchObject({ ratings: [], loadedAt: now.toISOString(), error: null })
    expect(data.teamRating(data.savedRatings().ratings, 4096)).toBeNull()
  })

  it("never mixes in another event's saved copy", async () => {
    const { data } = await withAnswers({ match13: { ok: false, error: DOWN }, tba: { ok: false, error: 'No connection.' } })
    data.ratingsStore.set({ event: '2025old', ratings: [rating(9991, 30)], rankings, loadedAt: now.toISOString(), error: null })
    await data.loadRatings(later)
    expect(data.savedRatings()).toEqual({ event: EVENT_KEY, ratings: [], rankings: [], loadedAt: null, error: DOWN })
  })
})

describe('the event the team is scouting', () => {
  beforeEach(() => {
    eventStore.reset()
    eventsTable.reset()
    resetAllStores()
  })
  afterEach(() => setDemoRole('student'))

  const regional: TbaEvent = {
    key: '2027ilpe', name: 'Example Peoria Regional', city: 'Peoria', state_prov: 'Illinois', country: 'USA', start_date: '2027-03-25', end_date: '2027-03-27', year: 2027,
  }

  it("is season.ts's EVENT_KEY until a mentor picks one on this phone", () => {
    expect(currentEvent()).toBe(EVENT_KEY)
  })

  it('is the newest pick in the table', () => {
    const pick = (event_key: string, created_at: string) => ({ id: event_key, event_key, name: event_key, created_at, created_by: null })
    expect(latestEvent([pick('2027new', '2026-11-10T12:00:00Z'), pick('2026old', '2026-11-01T12:00:00Z')])).toEqual({ key: '2027new', name: '2027new' })
    expect(latestEvent([])).toBeNull()
  })

  it("lets a mentor pick it, and then everything uses it: the schedule's event and new entries", async () => {
    setDemoRole('mentor')
    expect(await chooseEvent(regional)).toEqual({ ok: true, value: { key: '2027ilpe', name: 'Example Peoria Regional' } })
    expect(currentEvent()).toBe('2027ilpe')
    expect(latestEvent(eventsTable.rows())).toEqual({ key: '2027ilpe', name: 'Example Peoria Regional' })
    const saved = saveEntry(FORM)
    expect(saved.ok && saved.value.event_key).toBe('2027ilpe')
    const schedule = await getSchedule()
    expect(schedule.ok && schedule.value[0].key).toBe('2027ilpe_qm1')
  })

  it("doesn't let a student pick it, and says who can", async () => {
    expect(await chooseEvent(regional)).toEqual({ ok: false, error: 'Only a mentor can change the event. Ask a mentor to pick it.' })
    expect(currentEvent()).toBe(EVENT_KEY)
  })
})

describe('looking up an event', () => {
  const event = (key: string, name: string, city: string, state_prov: string, start_date: string, end_date = start_date): TbaEvent => ({
    key, name, city, state_prov, country: 'USA', start_date, end_date, year: Number(key.slice(0, 4)),
  })
  const EVENTS = [
    event('2027ilch', 'Central Illinois Regional', 'Peoria', 'Illinois', '2027-03-11', '2027-03-13'),
    event('2027mosl', 'St. Louis Regional', 'St. Louis', 'Missouri', '2027-03-30', '2027-04-02'),
    event('2027arc', 'Archimedes Division', 'Houston', 'Texas', '2027-04-21', '2027-04-24'),
  ]

  it('finds events by any part of the name, city, state or key, ignoring capitals', () => {
    expect(searchEvents(EVENTS, 'regional').map((e) => e.key)).toEqual(['2027ilch', '2027mosl'])
    expect(searchEvents(EVENTS, 'ARCHIMEDES').map((e) => e.key)).toEqual(['2027arc'])
    expect(searchEvents(EVENTS, 'houston').map((e) => e.key)).toEqual(['2027arc'])
    expect(searchEvents(EVENTS, '2027mosl').map((e) => e.key)).toEqual(['2027mosl'])
  })

  it('needs every word to match, and shows nothing until something is typed', () => {
    expect(searchEvents(EVENTS, 'illinois regional').map((e) => e.key)).toEqual(['2027ilch'])
    expect(searchEvents(EVENTS, 'illinois houston')).toEqual([])
    expect(searchEvents(EVENTS, '   ')).toEqual([])
  })

  it('shows at most 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => event(`2027r${i}`, `Regional ${i}`, 'Town', 'Ohio', '2027-03-01'))
    expect(searchEvents(many, 'regional')).toHaveLength(20)
  })

  it('says when and where, joining dates in the same month', () => {
    expect(eventWhenWhere(EVENTS[0])).toBe('Mar 11–13, 2027 · Peoria, Illinois')
    expect(eventWhenWhere(EVENTS[1])).toBe('Mar 30–Apr 2, 2027 · St. Louis, Missouri')
    expect(eventWhenWhere({ ...EVENTS[2], city: null, state_prov: null, end_date: EVENTS[2].start_date })).toBe('Apr 21, 2027')
  })

  it("looks in this year's and next year's events, since next season's are out in the fall", () => {
    expect(lookupSeasons(new Date('2026-11-10T12:00:00'))).toEqual([2026, 2027])
  })

  it("lists our team's events soonest first in demo mode, including the example event", async () => {
    const result = await getOurEvents(Number(EVENT_KEY.slice(0, 4)))
    if (!result.ok) throw new Error(result.error)
    expect(result.value.map((e) => e.key)[0]).toBe(EVENT_KEY)
    expect(result.value.map((e) => e.start_date)).toEqual([...result.value.map((e) => e.start_date)].sort())
  })
})
