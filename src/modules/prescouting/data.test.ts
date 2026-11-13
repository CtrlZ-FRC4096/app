// Tests for the Prescouting module's data.ts, in demo mode: the tests never
// call The Blue Alliance or Match 13. The table's permission rules are
// tested in supabase/tests/prescouting-notes.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAllStores } from '../../core/store'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'
import { EVENT_KEY, getTeamEvents, tbaEventUrl, tbaTeamUrl, type TbaMatchWithVideos } from '../scouting/data'
import {
  MAX_PRESCOUT_ANSWER, NO_ANSWERS, cleanEventKey, firstLine, hasAnswers, isEventKey, loadPrescoutTeams, prescoutEventStore, prescoutList, prescoutOverview,
  prescoutFor, prescoutHref, prescoutTable, savePrescout, setPrescoutEvent, type PrescoutNotes,
  PRESCOUT_QUESTIONS, prescoutAverages, prescoutMatchesTable, savePrescoutMatch, seasonMatches, type PrescoutMatch,
  MAX_STAR_REASON, removeTeamStar, starTeam, starsTable, unstarTeam, visibleStars, type PrescoutStar,
} from './data'

describe('prescouting: the teams at an event', () => {
  it('knows an event key when it sees one, and tidies what was typed', () => {
    expect(isEventKey('2026ilch')).toBe(true)
    expect(isEventKey('2026arc')).toBe(true) // a Championship division
    expect(isEventKey('ilch')).toBe(false)
    expect(isEventKey('2026ILCH')).toBe(false)
    expect(isEventKey('')).toBe(false)
    expect(cleanEventKey('  2026ILCH ')).toBe('2026ilch')
  })

  it("puts each team's EPA next to them, sorted by number, with null for a team with no EPA", () => {
    const team = (team_number: number, nickname: string) => ({ key: `frc${team_number}`, team_number, nickname, city: null, state_prov: null, country: null })
    const rating = (teamNumber: number, epa: number | null) => ({ teamNumber, xpStart: 0, xpEnd: 0, xAuto: null, xTele: null, xEnd: null, epa, opr: null, dpr: null })
    expect(prescoutList([team(9992, 'Sample Squad'), team(9991, 'Example Robotics'), team(9993, 'Demo Dynamics')], [rating(9992, 31.5), rating(9993, null)], '2026ilch')).toEqual([
      { team: 9991, name: 'Example Robotics', epa: null, tbaUrl: 'https://www.thebluealliance.com/team/9991/2026' },
      { team: 9992, name: 'Sample Squad', epa: 31.5, tbaUrl: 'https://www.thebluealliance.com/team/9992/2026' },
      { team: 9993, name: 'Demo Dynamics', epa: null, tbaUrl: 'https://www.thebluealliance.com/team/9993/2026' },
    ])
  })

  it("remembers the chosen event on this device, tidied, and refuses one that isn't an event key", () => {
    resetAllStores()
    expect(prescoutEventStore.get()).toBe(EVENT_KEY)
    expect(setPrescoutEvent(' 2026ARC ')).toEqual({ ok: true, value: '2026arc' })
    expect(prescoutEventStore.get()).toBe('2026arc')
    expect(setPrescoutEvent('Archimedes')).toEqual({ ok: false, error: expect.stringMatching(/like 2026ilch/) })
    expect(prescoutEventStore.get()).toBe('2026arc')
  })

  it('loads the list with EPA in demo mode', async () => {
    const result = await loadPrescoutTeams('2026ilch')
    expect(result.ok && result.value.length).toBe(6)
    expect(result.ok && result.value[0]).toEqual({ team: 4096, name: 'Ctrl-Z', epa: expect.any(Number), tbaUrl: 'https://www.thebluealliance.com/team/4096/2026' })
  })

  it("says what to type when the event key isn't one", async () => {
    expect(await loadPrescoutTeams('chicago')).toEqual({ ok: false, error: expect.stringMatching(/like 2026ilch/) })
  })
})

describe('prescouting: answers from the server functions', () => {
  const team = (team_number: number) => ({ key: `frc${team_number}`, team_number, nickname: `Team ${team_number}`, name: 'Long sponsor name', city: null, state_prov: null, country: null, extra: 1 })

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

  it('still lists the teams when Match 13 has no ratings yet, with no EPA', async () => {
    const { data } = await withAnswers({
      tba: { ok: true, value: [team(9992), team(9991)] },
      match13: { ok: false, error: 'Match 13 has nothing for that.' },
    })
    const result = await data.loadPrescoutTeams('2026ilch')
    expect(result.ok && result.value.map((t) => [t.team, t.epa])).toEqual([[9991, null], [9992, null]])
  })

  it("says so when TBA doesn't list any teams yet, or can't be reached", async () => {
    const noRatings = { ok: true as const, value: { teams: [] } }
    let { data } = await withAnswers({ tba: { ok: true, value: [] }, match13: noRatings })
    expect(await data.loadPrescoutTeams('2026ilch')).toEqual({ ok: false, error: expect.stringMatching(/doesn't list any teams for this event yet/) })
    ;({ data } = await withAnswers({ tba: { ok: false, error: "Couldn't reach The Blue Alliance. Try again in a minute." }, match13: noRatings }))
    expect(await data.loadPrescoutTeams('2026ilch')).toEqual({ ok: false, error: expect.stringMatching(/Couldn't reach/) })
  })
})

describe('prescouting notes', () => {
  const ANSWERS = { ...NO_ANSWERS, strengths: '  Quick climber  ', key_task: 'Scoring fuel' }
  const notesFor = (team: number) => prescoutTable.rows().find((r) => r.event_key === EVENT_KEY && r.team_number === team)

  beforeEach(() => {
    prescoutTable.reset()
  })

  it("adds a team's row the first time, trimmed, and signed by whoever saved it", async () => {
    expect(notesFor(9992)).toBeUndefined()
    const result = await savePrescout(EVENT_KEY, 9992, ANSWERS)
    expect(result).toMatchObject({ ok: true, value: { event_key: EVENT_KEY, team_number: 9992, strengths: 'Quick climber', key_task: 'Scoring fuel' } })
    expect(notesFor(9992)?.created_by).toBeTruthy()
  })

  it('changes the same row after that', async () => {
    const before = notesFor(9991)!
    const result = await savePrescout(EVENT_KEY, 9991, { ...ANSWERS, weaknesses: 'Tips over' })
    expect(result).toMatchObject({ ok: true, value: { id: before.id, weaknesses: 'Tips over' } })
    expect(prescoutTable.rows().filter((r) => r.team_number === 9991)).toHaveLength(1)
  })

  it('keeps the same team at different events apart', async () => {
    await savePrescout('2027ilch', 9991, ANSWERS)
    expect(prescoutTable.rows().filter((r) => r.team_number === 9991).map((r) => r.event_key).sort()).toEqual([EVENT_KEY, '2027ilch'].sort())
  })

  it("refuses an empty first save, an answer that's too long, and a wrong event or team", async () => {
    expect(await savePrescout(EVENT_KEY, 9992, { ...NO_ANSWERS, strengths: '   ' })).toEqual({ ok: false, error: 'Write at least one answer before saving.' })
    expect(await savePrescout(EVENT_KEY, 9992, { ...NO_ANSWERS, weaknesses: 'x'.repeat(MAX_PRESCOUT_ANSWER + 1) })).toEqual({ ok: false, error: expect.stringMatching(/^Weaknesses is too long/) })
    expect(await savePrescout('ilch', 9992, ANSWERS)).toEqual({ ok: false, error: expect.stringMatching(/like 2026ilch/) })
    expect(await savePrescout(EVENT_KEY, 0, ANSWERS)).toEqual({ ok: false, error: expect.stringMatching(/team number looks wrong/) })
    expect(notesFor(9992)).toBeUndefined()
  })

  it('lets someone clear the answers of a row that already exists', async () => {
    expect(await savePrescout(EVENT_KEY, 9993, NO_ANSWERS)).toMatchObject({ ok: true, value: { strengths: '', key_task: '' } })
  })

  it('knows whether a team has been prescouted', () => {
    expect(hasAnswers(notesFor(9991))).toBe(true)
    expect(hasAnswers(null)).toBe(false)
    expect(hasAnswers({ ...notesFor(9991)!, ...NO_ANSWERS, other_notes: ' \n ' })).toBe(false)
  })
})

describe('the prescouting overview', () => {
  const team = (n: number, epa: number | null) => ({ team: n, name: `Team ${n}`, epa, tbaUrl: tbaTeamUrl(n, EVENT_KEY) })
  const note = (n: number, strengths = '') => ({
    id: `id-${n}`, event_key: EVENT_KEY, team_number: n, ...NO_ANSWERS, strengths, created_at: '2026-11-05T19:00:00Z', created_by: null,
  })
  const star = (n: number, forTeam: boolean, by = 'me'): PrescoutStar => ({
    id: `star-${n}-${by}-${forTeam}`, event_key: EVENT_KEY, team_number: n, for_team: forTeam, reason: forTeam ? 'Why' : null, created_at: '2026-11-05T19:00:00Z', created_by: by,
  })
  const TEAMS = [team(9995, 22.1), team(9991, 41.7), team(9993, null), team(9992, 35.2), team(9994, null)]
  const order = (rows: { team: number }[]) => rows.map((r) => r.team)

  it('sorts by team number: teams starred for the team first, then ones you starred, then everyone else', () => {
    const stars = [star(9994, false), star(9995, true, 'someone'), star(9992, true, 'me')]
    expect(order(prescoutOverview(TEAMS, [note(9991, 'Fast')], 'Team number', stars, 'me'))).toEqual([9992, 9995, 9994, 9991, 9993])
  })

  it('sorts by EPA best first, teams with no EPA after, starred teams still first', () => {
    expect(order(prescoutOverview(TEAMS, [], 'EPA'))).toEqual([9991, 9992, 9995, 9993, 9994])
    expect(order(prescoutOverview(TEAMS, [], 'EPA', [star(9994, true), star(9995, true)], 'me'))).toEqual([9995, 9994, 9991, 9992, 9993])
  })

  it('puts each team with their notes and stars, and says which are prescouted', () => {
    const rows = prescoutOverview(TEAMS, [note(9991, 'Fast'), note(9993)], 'Team number', [star(9993, true, 'someone'), star(9993, false)], 'me')
    expect(rows.find((r) => r.team === 9991)).toMatchObject({ group: 'rest', prescouted: true, notes: { strengths: 'Fast' } })
    expect(rows.find((r) => r.team === 9993)).toMatchObject({ group: 'team', prescouted: false, teamStars: [{ created_by: 'someone' }], myStars: [{ for_team: false }] })
    expect(rows.find((r) => r.team === 9992)).toMatchObject({ group: 'rest', prescouted: false, notes: null, teamStars: [], myStars: [] })
  })

  it("shows the first line of an answer, cut short if it's long", () => {
    expect(firstLine('Fast cycles')).toBe('Fast cycles')
    expect(firstLine('  Fast cycles\nNever broke down ')).toBe('Fast cycles …')
    expect(firstLine('x'.repeat(120))).toBe('x'.repeat(100) + '…')
    expect(firstLine('')).toBe('')
  })
})

describe('one team’s prescouting, for the Scouting team page (#119)', () => {
  const row = (fields: Partial<PrescoutNotes>): PrescoutNotes => ({
    id: 'p1', event_key: '2026ilch', team_number: 9991, ...NO_ANSWERS, created_at: '2026-11-05T19:00:00Z', created_by: null, ...fields,
  })

  it("finds the team's notes at the event", () => {
    const notes = row({ key_task: 'Defense' })
    expect(prescoutFor([notes, row({ id: 'p2', team_number: 9992, key_task: 'Scoring' })], '2026ilch', 9991)).toBe(notes)
  })

  it('gives nothing for a team nobody prescouted, one at another event, or one with no answers yet', () => {
    expect(prescoutFor([], '2026ilch', 9991)).toBeNull()
    expect(prescoutFor([row({ event_key: '2026mndu', key_task: 'Defense' })], '2026ilch', 9991)).toBeNull()
    expect(prescoutFor([row({})], '2026ilch', 9991)).toBeNull()
  })

  it("links to the team's prescouting page", () => {
    expect(prescoutHref('2026ilch', 9991)).toBe('#/prescouting/2026ilch/9991')
  })
})

// ---------------------------------------------------------------------------
// Stars (#118). In demo mode a student is Alex, a mentor is Pat.

describe('prescouting stars', () => {
  beforeEach(() => {
    starsTable.reset()
    setDemoRole('student')
  })

  const mine = (team: number) => starsTable.rows().filter((s) => s.team_number === team && s.created_by === DEMO_PEOPLE.alex)

  it('stars a team just for you, with no reason needed', async () => {
    expect(await starTeam(EVENT_KEY, 9995, { forTeam: false })).toMatchObject({ ok: true, value: { team_number: 9995, for_team: false, reason: null, created_by: DEMO_PEOPLE.alex } })
  })

  it('stars a team for the whole team only with a reason, trimmed, and says what to do without one', async () => {
    expect(await starTeam(EVENT_KEY, 9995, { forTeam: true })).toEqual({ ok: false, error: 'Say why the team should look at them.' })
    expect(await starTeam(EVENT_KEY, 9995, { forTeam: true, reason: '   ' })).toEqual({ ok: false, error: 'Say why the team should look at them.' })
    expect(await starTeam(EVENT_KEY, 9995, { forTeam: true, reason: 'x'.repeat(MAX_STAR_REASON + 1) })).toMatchObject({ ok: false })
    expect(await starTeam(EVENT_KEY, 9995, { forTeam: true, reason: '  Good second pick  ' })).toMatchObject({ ok: true, value: { reason: 'Good second pick' } })
  })

  it('lets you star a team once of each kind, and remove your own', async () => {
    await starTeam(EVENT_KEY, 9995, { forTeam: false })
    expect(await starTeam(EVENT_KEY, 9995, { forTeam: false })).toMatchObject({ ok: false, error: expect.stringMatching(/already starred/) })
    await starTeam(EVENT_KEY, 9995, { forTeam: true, reason: 'Why' })
    expect(mine(9995)).toHaveLength(2)
    expect(await unstarTeam(EVENT_KEY, 9995, false)).toMatchObject({ ok: true })
    expect(mine(9995).map((s) => s.for_team)).toEqual([true])
    expect(await unstarTeam(EVENT_KEY, 9995, false)).toMatchObject({ ok: false })
  })

  it("shows team stars and your own, but not someone else's star just for them", () => {
    const visible = visibleStars(starsTable.rows(), DEMO_PEOPLE.alex)
    expect(visible.map((s) => [s.team_number, s.for_team])).toEqual([[9991, true], [9991, true], [9993, false]])
    expect(visibleStars(starsTable.rows(), null).every((s) => s.for_team)).toBe(true)
  })

  it("lets a mentor remove anyone's team star, but not a student", async () => {
    const jordans = starsTable.rows().find((s) => s.created_by === DEMO_PEOPLE.jordan)!
    expect(await removeTeamStar(jordans)).toMatchObject({ ok: false, error: expect.stringMatching(/Only mentors/) })
    setDemoRole('mentor')
    expect(await removeTeamStar(jordans)).toMatchObject({ ok: true })
    expect(starsTable.rows().some((s) => s.id === jordans.id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// A team's season (#153).

describe("a team's season", () => {
  beforeEach(() => {
    prescoutMatchesTable.reset()
    prescoutTable.reset()
    setDemoRole('student')
  })

  it("lists a team's events this year, newest first, each linked to The Blue Alliance", async () => {
    const result = await getTeamEvents(9991, 2026)
    if (!result.ok) throw new Error(result.error)
    const starts = result.value.map((e) => e.start_date)
    expect(starts).toEqual([...starts].sort().reverse())
    expect(result.value.length).toBeGreaterThan(0)
    expect(tbaEventUrl('2026ilch')).toBe('https://www.thebluealliance.com/event/2026ilch')
  })

  it("lists the team's matches at an event in the order they're played, with their alliance, result and videos", () => {
    const match = (key: string, level: TbaMatchWithVideos['comp_level'], set: number, n: number, red: number[], redScore: number, blueScore: number, videos: TbaMatchWithVideos['videos'] = []): TbaMatchWithVideos => ({
      key, comp_level: level, set_number: set, match_number: n, winning_alliance: '', predicted_time: null, videos,
      alliances: { red: { score: redScore, team_keys: red.map((t) => `frc${t}`) }, blue: { score: blueScore, team_keys: ['frc9991', 'frc9992', 'frc9993'].filter((t) => !red.includes(Number(t.slice(3)))) } },
    })
    const rows = seasonMatches([
      match('e_sf2m1', 'sf', 2, 1, [9991], 90, 80, [{ type: 'youtube', key: 'abc' }]),
      match('e_qm7', 'qm', 1, 7, [9994], 50, 60),
      match('e_qm3', 'qm', 1, 3, [9995], -1, -1),
      match('e_qm5', 'qm', 1, 5, [9996], 70, 70),
    ], 9991)
    expect(rows.map((r) => [r.label, r.alliance, r.score])).toEqual([
      ['Qual 3', 'blue', null],
      ['Qual 5', 'blue', { ours: 70, theirs: 70 }],
      ['Qual 7', 'blue', { ours: 60, theirs: 50 }],
      ['Semifinal 2', 'red', { ours: 90, theirs: 80 }],
    ])
    expect(rows[3].videos).toEqual(['https://youtu.be/abc'])
  })

  it('saves what a scout saw in a match, then changes their own row, and keeps other scouts apart', async () => {
    const match = `${EVENT_KEY}_qm3`
    const fields = { counts: { autoFuel: 2.4, teleopFuel: -1 }, endgame: 'Level 1', roles: ['Scorer', 'Scorer'], notes: '  Slow intake  ' }
    const first = await savePrescoutMatch(9991, EVENT_KEY, match, fields)
    expect(first).toMatchObject({ ok: true, value: { counts: { autoFuel: 2, teleopFuel: 0 }, roles: ['Scorer'], notes: 'Slow intake', match_key: match } })
    await savePrescoutMatch(9991, EVENT_KEY, match, { ...fields, notes: 'Changed' })
    const mine = prescoutMatchesTable.rows().filter((r) => r.match_key === match)
    expect(mine).toHaveLength(1)
    expect(mine[0].notes).toBe('Changed')
    // Another scout on the same match gets their own row.
    setDemoRole('mentor')
    await savePrescoutMatch(9991, EVENT_KEY, match, fields)
    expect(prescoutMatchesTable.rows().filter((r) => r.match_key === match)).toHaveLength(2)
  })

  it('refuses a match from another event, an endgame that is not a choice, and notes that are too long', async () => {
    const fields = { counts: {}, endgame: 'Level 1', roles: [], notes: '' }
    expect(await savePrescoutMatch(9991, EVENT_KEY, '2025other_qm1', fields)).toMatchObject({ ok: false, error: expect.stringMatching(/isn't from this event/) })
    expect(await savePrescoutMatch(9991, EVENT_KEY, `${EVENT_KEY}_qm1`, { ...fields, endgame: 'Flying' })).toMatchObject({ ok: false, error: expect.stringMatching(/Choose how/) })
    expect(await savePrescoutMatch(9991, EVENT_KEY, `${EVENT_KEY}_qm1`, { ...fields, notes: 'x'.repeat(MAX_PRESCOUT_ANSWER + 1) })).toMatchObject({ ok: false })
    expect(await savePrescoutMatch(9991, EVENT_KEY, `${EVENT_KEY}_qm1`, fields, null)).toMatchObject({ ok: false, error: expect.stringMatching(/Sign in/) })
  })

  it('averages each counter per match, counting two scouts on the same match as one match, and tallies the endgame', () => {
    const look = (match: string, counts: Record<string, number>, endgame: string, by: string): PrescoutMatch => ({
      id: `${match}-${by}`, team_number: 9991, event_key: EVENT_KEY, match_key: match, counts, endgame, roles: [], notes: '',
      created_at: '2026-11-04T19:00:00Z', created_by: by, updated_at: '2026-11-04T19:00:00Z',
    })
    const averages = prescoutAverages([
      look('m1', { autoFuel: 2, teleopFuel: 10 }, 'Level 1', 'a'),
      look('m1', { autoFuel: 4, teleopFuel: 10 }, 'Level 1', 'b'),
      look('m2', { autoFuel: 6 }, 'Level 3', 'a'),
    ])
    expect(averages.matches).toBe(2)
    expect(averages.counters.find((c) => c.key === 'autoFuel')?.average).toBe(4.5)
    expect(averages.counters.find((c) => c.key === 'teleopFuel')?.average).toBe(10)
    expect(averages.counters.find((c) => c.key === 'fuelMissed')?.average).toBeNull()
    expect(averages.endgame.filter((e) => e.count > 0)).toEqual([{ option: 'Level 1', count: 2 }, { option: 'Level 3', count: 1 }])
    expect(prescoutAverages([]).matches).toBe(0)
  })

  it('asks for an overall summary first, and saves it with the other answers', async () => {
    expect(PRESCOUT_QUESTIONS[0].key).toBe('overall')
    const result = await savePrescout(EVENT_KEY, 9995, { ...NO_ANSWERS, overall: '  Good second pick  ' })
    expect(result).toMatchObject({ ok: true, value: { overall: 'Good second pick' } })
  })
})
