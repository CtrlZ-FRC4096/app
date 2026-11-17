// Tests for Prescouting's data.ts (Scouting's Prescouting tab, #184), in demo mode: the tests never
// call The Blue Alliance or Match 13. The table's permission rules are
// tested in supabase/tests/prescouting-notes.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAllStores } from '../../../core/store'
import { EVENT_KEY, getTeamEvents, tbaEventUrl, tbaTeamUrl, type Match13Rating, type TbaMatchWithVideos } from '../data'
import {
  PRESCOUT_QUESTIONS, prescoutAverages, prescoutMatchesTable, savePrescoutMatch, seasonMatches, prescoutFor, prescoutHref, type PrescoutMatch, type PrescoutNotes,
  MAX_PRESCOUT_ANSWER, NO_ANSWERS, NO_FACTS, checkFacts, prescoutFacts, cleanEventKey, firstLine, hasAnswers, isEventKey, loadPrescoutTeams, prescoutEventStore, prescoutList, prescoutOverview, prescoutViewStore, searchPrescout, setPrescoutView, starCount,
  prescoutTable, savePrescout, setPrescoutEvent, setTier, canRemoveStar, starTeam, starredFirst, starsFor, starsTable, unstarTeam, visibleStars,
  type PrescoutStar, type Tier,
} from './data'
import { DEMO_PEOPLE, setDemoRole } from '../../../core/demo'

describe('prescouting: the teams at an event', () => {
  it('knows an event key when it sees one, and tidies what was typed', () => {
    expect(isEventKey('2026ilch')).toBe(true)
    expect(isEventKey('2026arc')).toBe(true) // a Championship division
    expect(isEventKey('ilch')).toBe(false)
    expect(isEventKey('2026ILCH')).toBe(false)
    expect(isEventKey('')).toBe(false)
    expect(cleanEventKey('  2026ILCH ')).toBe('2026ilch')
  })

  const tbaTeam = (team_number: number, nickname = `Team ${team_number}`) => ({ key: `frc${team_number}`, team_number, nickname, city: null, state_prov: null, country: null })
  const rating = (teamNumber: number, xpEnd: number, more: Partial<Match13Rating> = {}): Match13Rating =>
    ({ teamNumber, xpStart: 0, xpEnd, xAuto: null, xTele: null, xEnd: null, epa: null, opr: null, dpr: null, ...more })

  it("puts each team's Match 13 numbers next to them, sorted by number, with null for any Match 13 didn't give (#186)", () => {
    const ratings = [rating(9992, 40.2, { xAuto: 10.1, xTele: 24.5, xEnd: 5.6, epa: 31.5, opr: 42, dpr: 12.3 }), rating(9993, 20, { epa: null })]
    expect(prescoutList([tbaTeam(9992, 'Sample Squad'), tbaTeam(9991, 'Example Robotics'), tbaTeam(9993, 'Demo Dynamics')], ratings, '2026ilch')).toEqual([
      // Match 13 hasn't rated 9991: every number is null, and there's no rank.
      { team: 9991, name: 'Example Robotics', xp: null, xpRank: null, auto: null, teleop: null, endgame: null, epa: null, opr: null, dpr: null, tbaUrl: 'https://www.thebluealliance.com/team/9991/2026' },
      { team: 9992, name: 'Sample Squad', xp: 40.2, xpRank: { rank: 1, of: 2 }, auto: 10.1, teleop: 24.5, endgame: 5.6, epa: 31.5, opr: 42, dpr: 12.3, tbaUrl: 'https://www.thebluealliance.com/team/9992/2026' },
      { team: 9993, name: 'Demo Dynamics', xp: 20, xpRank: { rank: 2, of: 2 }, auto: null, teleop: null, endgame: null, epa: null, opr: null, dpr: null, tbaUrl: 'https://www.thebluealliance.com/team/9993/2026' },
    ])
  })

  it("ranks each team's xP among the rated teams at the event, best first, with equal xP sharing a rank (#186)", () => {
    // [team, xP or null if Match 13 hasn't rated them, the rank it should get]
    const cases: [number, number | null, { rank: number; of: number } | null][] = [
      [9991, 30, { rank: 2, of: 4 }],
      [9992, 45.5, { rank: 1, of: 4 }],
      [9993, 30, { rank: 2, of: 4 }],
      [9994, null, null],
      [9995, 12, { rank: 4, of: 4 }],
    ]
    const teams = cases.map(([n]) => tbaTeam(n))
    // A rating for a team that isn't at this event doesn't count.
    const ratings = [...cases.flatMap(([n, xp]) => (xp === null ? [] : [rating(n, xp)])), rating(9999, 99)]
    expect(prescoutList(teams, ratings, '2026ilch').map((t) => [t.team, t.xpRank])).toEqual(cases.map(([n, , rank]) => [n, rank]))
  })

  it("remembers the chosen event on this device, tidied, and refuses one that isn't an event key", () => {
    resetAllStores()
    expect(prescoutEventStore.get()).toBe(EVENT_KEY)
    expect(setPrescoutEvent(' 2026ARC ')).toEqual({ ok: true, value: '2026arc' })
    expect(prescoutEventStore.get()).toBe('2026arc')
    expect(setPrescoutEvent('Archimedes')).toEqual({ ok: false, error: expect.stringMatching(/like 2026ilch/) })
    expect(prescoutEventStore.get()).toBe('2026arc')
  })

  it('loads the list with Match 13 numbers in demo mode', async () => {
    const result = await loadPrescoutTeams('2026ilch')
    expect(result.ok && result.value.length).toBe(6)
    expect(result.ok && result.value[0]).toEqual({
      team: 4096, name: 'Ctrl-Z', xp: expect.any(Number), xpRank: { rank: expect.any(Number), of: 6 }, auto: expect.any(Number), teleop: expect.any(Number), endgame: expect.any(Number),
      epa: expect.any(Number), opr: expect.any(Number), dpr: expect.any(Number), tbaUrl: 'https://www.thebluealliance.com/team/4096/2026',
    })
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
    vi.doMock('../../../core/functions', () => ({ callFunction }))
    return { data: await import('./data'), callFunction }
  }
  afterEach(() => {
    vi.doUnmock('../../../core/functions')
    vi.resetModules()
  })

  it('still lists the teams when Match 13 has no ratings yet, with no numbers', async () => {
    const { data } = await withAnswers({
      tba: { ok: true, value: [team(9992), team(9991)] },
      match13: { ok: false, error: 'Match 13 has nothing for that.' },
    })
    const result = await data.loadPrescoutTeams('2026ilch')
    expect(result.ok && result.value.map((t) => [t.team, t.epa, t.xp, t.xpRank])).toEqual([[9991, null, null, null], [9992, null, null, null]])
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

  it("sets a team's tier, adds their row if they have no notes yet, changes it, clears it, and keeps their answers (#191)", async () => {
    // 9992 has no notes yet: setting a tier adds a row with empty answers, so they're still not prescouted.
    expect(await setTier(EVENT_KEY, 9992, 'A')).toMatchObject({ ok: true, value: { event_key: EVENT_KEY, team_number: 9992, tier: 'A', strengths: '' } })
    expect(hasAnswers(notesFor(9992))).toBe(false)
    const steps: [number, Tier | null][] = [[9992, 'C'], [9992, null], [9991, 'F'], [9991, null]]
    for (const [n, tier] of steps) {
      expect(await setTier(EVENT_KEY, n, tier)).toMatchObject({ ok: true, value: { tier } })
      expect(prescoutTable.rows().filter((r) => r.team_number === n)).toHaveLength(1)
    }
    expect(notesFor(9991)).toMatchObject({ tier: null, key_task: 'Scoring fuel in teleop' })
    // Saving answers afterwards leaves the tier alone.
    await setTier(EVENT_KEY, 9993, 'S')
    await savePrescout(EVENT_KEY, 9993, ANSWERS)
    expect(notesFor(9993)?.tier).toBe('S')
    // Wrong event, team or tier.
    expect(await setTier('ilch', 9992, 'A')).toMatchObject({ ok: false, error: expect.stringMatching(/like 2026ilch/) })
    expect(await setTier(EVENT_KEY, 0, 'A')).toMatchObject({ ok: false, error: expect.stringMatching(/team number looks wrong/) })
    expect(await setTier(EVENT_KEY, 9992, 'E' as Tier)).toMatchObject({ ok: false, error: expect.stringMatching(/S to F/) })
  })

  it('knows whether a team has been prescouted, from its answers or its quick answers', () => {
    const empty = { ...notesFor(9991)!, ...NO_ANSWERS, ...NO_FACTS }
    expect(hasAnswers(notesFor(9991))).toBe(true)
    expect(hasAnswers(null)).toBe(false)
    expect(hasAnswers({ ...empty, other_notes: ' \n ' })).toBe(false)
    expect(hasAnswers({ ...empty, rating: 3 })).toBe(true)
  })
})

describe('prescouting quick answers (#184)', () => {
  const FACTS = { drivetrain: 'Swerve', best_climb: 'Level 3', auto_fuel: 6, cycle_seconds: 9, rating: 5 }
  const notesFor = (team: number) => prescoutTable.rows().find((r) => r.event_key === EVENT_KEY && r.team_number === team)

  beforeEach(() => {
    prescoutTable.reset()
  })

  it('saves the quick answers with the notes, alone on a first save, and keeps them when they are left out', async () => {
    expect(await savePrescout(EVENT_KEY, 9992, NO_ANSWERS, FACTS)).toMatchObject({ ok: true, value: FACTS })
    expect(await savePrescout(EVENT_KEY, 9992, { ...NO_ANSWERS, strengths: 'Fast' })).toMatchObject({ ok: true, value: { ...FACTS, strengths: 'Fast' } })
    expect(await savePrescout(EVENT_KEY, 9992, NO_ANSWERS, NO_FACTS)).toMatchObject({ ok: true, value: NO_FACTS })
    expect(await savePrescout(EVENT_KEY, 9994, NO_ANSWERS, NO_FACTS)).toEqual({ ok: false, error: 'Write at least one answer before saving.' })
  })

  it('refuses a choice not on the list, or a number out of range, saying what to fix', async () => {
    const cases: [Partial<typeof FACTS>, RegExp | null][] = [
      [{}, null],
      [{ drivetrain: 'Hovercraft' }, /drivetrain/],
      [{ best_climb: 'Level 9' }, /best climb/],
      [{ auto_fuel: 100 }, /Fuel in auto/],
      [{ auto_fuel: 2.5 }, /Fuel in auto/],
      [{ cycle_seconds: 0 }, /Seconds per cycle/],
      [{ cycle_seconds: Number.NaN }, /Seconds per cycle/],
      [{ rating: 6 }, /Rate them/],
    ]
    for (const [change, problem] of cases) {
      const facts = { ...FACTS, ...change }
      if (problem) expect(checkFacts(facts), JSON.stringify(change)).toMatch(problem)
      else expect(checkFacts(facts)).toBeNull()
    }
    expect(await savePrescout(EVENT_KEY, 9992, { ...NO_ANSWERS, strengths: 'Fast' }, { ...FACTS, rating: 0 })).toEqual({ ok: false, error: expect.stringMatching(/Rate them/) })
    expect(notesFor(9992)).toBeUndefined()
  })

  it('shows the filled-in quick answers as words, leaving out the empty ones', () => {
    expect(prescoutFacts(FACTS).map((f) => `${f.label}: ${f.value}`)).toEqual(['Rating: 5 of 5', 'Drivetrain: Swerve', 'Best climb: Level 3', 'Fuel in auto: about 6', 'Seconds per cycle: about 9'])
    expect(prescoutFacts({ ...NO_FACTS, best_climb: 'None' }).map((f) => f.value)).toEqual(["Can't climb"])
    expect(prescoutFacts(NO_FACTS)).toEqual([])
  })
})

describe('stars', () => {
  // In demo mode you're Alex as a student, or Pat as a mentor.
  const alex = DEMO_PEOPLE.alex
  const forTeam = (team: number) => starsTable.rows().filter((r) => r.event_key === EVENT_KEY && r.team_number === team && r.for_team)

  beforeEach(() => {
    starsTable.reset()
    setDemoRole('student')
  })
  afterEach(() => setDemoRole('student'))

  it('stars a team just for you, signed as you, with no reason needed', async () => {
    const result = await starTeam(EVENT_KEY, 9992, { forTeam: false, reason: '' })
    expect(result).toMatchObject({ ok: true, value: { team_number: 9992, for_team: false, reason: '', created_by: alex } })
  })

  it('stars a team for the whole team, with the reason trimmed', async () => {
    const result = await starTeam(EVENT_KEY, 9992, { forTeam: true, reason: '  Great auto  ' })
    expect(result).toMatchObject({ ok: true, value: { for_team: true, reason: 'Great auto', created_by: alex } })
  })

  it('refuses a team star with no reason, and says what to do', async () => {
    expect(await starTeam(EVENT_KEY, 9992, { forTeam: true, reason: '   ' })).toEqual({ ok: false, error: expect.stringMatching(/^Say why the team should look at them/) })
    expect(forTeam(9992)).toEqual([])
  })

  it('refuses a second star of the same kind, a long reason, and a wrong event or team', async () => {
    expect(await starTeam(EVENT_KEY, 9993, { forTeam: false, reason: '' })).toEqual({ ok: false, error: "You've already starred this team for yourself." })
    expect(await starTeam(EVENT_KEY, 9992, { forTeam: true, reason: 'x'.repeat(501) })).toEqual({ ok: false, error: expect.stringMatching(/under 500 characters/) })
    expect(await starTeam('ilch', 9992, { forTeam: false, reason: '' })).toEqual({ ok: false, error: expect.stringMatching(/like 2026ilch/) })
    expect(await starTeam(EVENT_KEY, 0, { forTeam: false, reason: '' })).toEqual({ ok: false, error: expect.stringMatching(/team number looks wrong/) })
  })

  it('lets several people star the same team for the whole team', async () => {
    expect(forTeam(9991)).toHaveLength(2)
    await starTeam(EVENT_KEY, 9991, { forTeam: true, reason: 'Good intake' })
    expect(forTeam(9991).map((s) => s.reason)).toContain('Good intake')
  })

  it("lets you remove your own stars, but not other people's", async () => {
    const mine = starsTable.rows().find((s) => s.created_by === alex)!
    const jordans = forTeam(9991).find((s) => s.created_by === DEMO_PEOPLE.jordan)!
    expect(await unstarTeam(jordans.id)).toEqual({ ok: false, error: expect.stringMatching(/only remove your own stars/) })
    expect(await unstarTeam(mine.id)).toEqual({ ok: true, value: null })
    expect(await unstarTeam(mine.id)).toEqual({ ok: false, error: 'That star has already been removed.' })
  })

  it("lets a mentor remove anyone's team star, but not someone's star just for them", async () => {
    setDemoRole('mentor')
    const jordans = forTeam(9991).find((s) => s.created_by === DEMO_PEOPLE.jordan)!
    const alexsOwn = starsTable.rows().find((s) => s.created_by === alex && !s.for_team)!
    expect(await unstarTeam(jordans.id)).toEqual({ ok: true, value: null })
    expect(await unstarTeam(alexsOwn.id)).toMatchObject({ ok: false })
  })

  it('says who can remove a star', () => {
    const star = { for_team: true, created_by: DEMO_PEOPLE.jordan } as PrescoutStar
    expect(canRemoveStar(star, { id: DEMO_PEOPLE.jordan, role: 'student' })).toBe(true)
    expect(canRemoveStar(star, { id: alex, role: 'student' })).toBe(false)
    expect(canRemoveStar(star, { id: DEMO_PEOPLE.pat, role: 'mentor' })).toBe(true)
    expect(canRemoveStar(star, { id: DEMO_PEOPLE.casey, role: 'leader' })).toBe(true)
    expect(canRemoveStar({ ...star, for_team: false }, { id: DEMO_PEOPLE.pat, role: 'mentor' })).toBe(false)
    expect(canRemoveStar(star, null)).toBe(false)
  })
})

const at = (team: number, forTeam: boolean, by: string | null, reason = forTeam ? 'Why' : ''): PrescoutStar => ({
  id: `star-${team}-${forTeam}-${by}`, event_key: EVENT_KEY, team_number: team, for_team: forTeam, reason, created_at: '2026-11-05T19:00:00Z', created_by: by,
})
const ME = DEMO_PEOPLE.alex
const SOMEONE = DEMO_PEOPLE.jordan

describe('who sees which stars', () => {
  it("shows every team star and your own stars, but not other people's stars just for them", () => {
    const stars = [at(9991, true, SOMEONE), at(9992, false, ME), at(9993, false, SOMEONE), at(9994, true, null)]
    expect(visibleStars(stars, ME).map((s) => s.team_number)).toEqual([9991, 9992, 9994])
  })

  it("gathers a team's stars: the team stars, oldest first, and your own", () => {
    const later = { ...at(9991, true, ME, 'Second'), created_at: '2026-11-06T00:00:00Z' }
    const stars = [later, at(9991, true, SOMEONE, 'First'), at(9991, false, ME)]
    const result = starsFor(stars, 9991, ME)
    expect(result.forTeam.map((s) => s.reason)).toEqual(['First', 'Second'])
    expect(result.mine?.for_team).toBe(false)
    expect(starsFor(stars, 9992, ME)).toEqual({ forTeam: [], mine: null })
  })

  it('puts team stars first, then your own, then the rest, for the Scouting Teams page', () => {
    const stars = [at(9995, false, ME), at(9993, true, SOMEONE), at(9992, false, SOMEONE), at(254, true, SOMEONE)]
    // 254 hasn't been scouted yet, but it's starred, so it's listed.
    expect(starredFirst([9991, 9992, 9993, 9995], stars, ME)).toEqual([
      { team: 254, group: 'Team stars' },
      { team: 9993, group: 'Team stars' },
      { team: 9995, group: 'Your stars' },
      { team: 9991, group: 'Everyone else' },
      { team: 9992, group: 'Everyone else' },
    ])
  })
})

describe('the prescouting overview', () => {
  const team = (n: number, epa: number | null, xp: number | null = null) => ({
    team: n, name: `Team ${n}`, epa, xp, xpRank: null, auto: null, teleop: null, endgame: null, opr: null, dpr: null, tbaUrl: tbaTeamUrl(n, EVENT_KEY),
  })
  const note = (n: number, strengths = '', tier: Tier | null = null) => ({
    id: `id-${n}`, event_key: EVENT_KEY, team_number: n, ...NO_ANSWERS, ...NO_FACTS, strengths, tier, created_at: '2026-11-05T19:00:00Z', created_by: null,
  })
  const TEAMS = [team(9995, 22.1), team(9991, 41.7), team(9993, null), team(9992, 35.2), team(9994, null)]
  const order = (rows: { team: number }[]) => rows.map((r) => r.team)

  it('sorts by team number, with team stars first, then your own', () => {
    const stars = [at(9994, true, SOMEONE), at(9992, false, ME), at(9993, false, SOMEONE)]
    expect(order(prescoutOverview(TEAMS, [], stars, ME, 'Team number'))).toEqual([9994, 9992, 9991, 9993, 9995])
  })

  it("ignores other people's stars just for them", () => {
    expect(order(prescoutOverview(TEAMS, [], [at(9995, false, SOMEONE)], ME, 'Team number'))).toEqual([9991, 9992, 9993, 9994, 9995])
  })

  it('sorts by EPA best first within each group, teams with no EPA after', () => {
    expect(order(prescoutOverview(TEAMS, [], [], ME, 'EPA'))).toEqual([9991, 9992, 9995, 9993, 9994])
    const stars = [at(9994, true, SOMEONE), at(9995, true, SOMEONE), at(9993, false, ME), at(9992, false, ME)]
    expect(order(prescoutOverview(TEAMS, [], stars, ME, 'EPA'))).toEqual([9995, 9994, 9992, 9993, 9991])
  })

  it('sorts by tier, S to F, then Not rated, by number within a tier, with starred teams still first (#191)', () => {
    const teams = [9991, 9992, 9993, 9994, 9995, 9996, 9997].map((n) => team(n, null))
    const tiers: [number, Tier | null][] = [[9991, 'F'], [9992, null], [9993, 'S'], [9994, 'B'], [9995, 'S'], [9996, 'A']]
    const notes = tiers.map(([n, tier]) => note(n, '', tier))
    // 9992 has notes but no tier, and 9997 has no notes at all: both Not rated.
    const cases: { stars: PrescoutStar[]; expected: number[] }[] = [
      { stars: [], expected: [9993, 9995, 9996, 9994, 9991, 9992, 9997] },
      { stars: [at(9991, true, SOMEONE), at(9997, false, ME)], expected: [9991, 9997, 9993, 9995, 9996, 9994, 9992] },
    ]
    for (const { stars, expected } of cases) expect(order(prescoutOverview(teams, notes, stars, ME, 'Tier'))).toEqual(expected)
  })

  it('sorts by xP best first within each group, teams with no xP after (#186)', () => {
    const teams = [team(9995, 22.1, 18), team(9991, 41.7, null), team(9993, null, 33.3), team(9992, 35.2, 25), team(9994, null, 25)]
    expect(order(prescoutOverview(teams, [], [], ME, 'xP'))).toEqual([9993, 9992, 9994, 9995, 9991])
    const stars = [at(9991, true, SOMEONE), at(9995, true, SOMEONE), at(9993, false, ME)]
    expect(order(prescoutOverview(teams, [], stars, ME, 'xP'))).toEqual([9995, 9991, 9993, 9992, 9994])
  })

  it('puts each team with their notes and stars, and says which are prescouted', () => {
    const rows = prescoutOverview(TEAMS, [note(9991, 'Fast'), note(9993)], [at(9993, true, SOMEONE, 'Good defense')], ME, 'Team number')
    expect(rows.find((r) => r.team === 9991)).toMatchObject({ group: 'Everyone else', prescouted: true, notes: { strengths: 'Fast' } })
    expect(rows.find((r) => r.team === 9993)).toMatchObject({ group: 'Team stars', prescouted: false, stars: { forTeam: [{ reason: 'Good defense' }], mine: null } })
    expect(rows.find((r) => r.team === 9992)).toMatchObject({ prescouted: false, notes: null })
  })

  it("shows the first line of an answer, cut short if it's long", () => {
    expect(firstLine('Fast cycles')).toBe('Fast cycles')
    expect(firstLine('  Fast cycles\nNever broke down ')).toBe('Fast cycles …')
    expect(firstLine('x'.repeat(120))).toBe('x'.repeat(100) + '…')
    expect(firstLine('')).toBe('')
  })
})

describe('the Cards / Table choice', () => {
  afterEach(() => prescoutViewStore.reset())

  it('starts as Cards, and remembers Table once chosen', () => {
    expect(prescoutViewStore.get()).toBe('Cards')
    setPrescoutView('Table')
    expect(prescoutViewStore.get()).toBe('Table')
  })

  it("counts a team's stars: the team's, plus your own just for you", () => {
    const star = at(9991, true, SOMEONE)
    expect(starCount({ forTeam: [], mine: null })).toBe(0)
    expect(starCount({ forTeam: [star, star], mine: null })).toBe(2)
    expect(starCount({ forTeam: [star], mine: at(9991, false, ME) })).toBe(2)
  })
})

describe('searching the prescouting overview', () => {
  it('finds teams by part of their number or name, ignoring capitals, and keeps their order', () => {
    const teams = [
      { team: 4096, name: 'Ctrl-Z' },
      { team: 1640, name: 'Sab-BOT-age' },
      { team: 9991, name: 'Robo Raccoons' },
      { team: 254, name: 'The Cheesy Poofs' },
      { team: 2540, name: 'Iron Robotics' },
    ]
    const searches: [string, number[]][] = [
      ['', [4096, 1640, 9991, 254, 2540]],
      ['   ', [4096, 1640, 9991, 254, 2540]],
      ['40', [4096, 1640, 2540]],
      ['4096', [4096]],
      ['254', [254, 2540]],
      ['robo', [9991, 2540]],
      ['ROBO', [9991, 2540]],
      [' ctrl ', [4096]],
      ['cheesy poofs', [254]],
      ['poofs cheesy', [254]],
      ['iron 25', [2540]],
      ['robo 99', [9991]],
      ['zebra', []],
      ['40 zebra', []],
    ]
    for (const [text, found] of searches) expect(searchPrescout(teams, text).map((t) => t.team), `"${text}"`).toEqual(found)
  })
})

describe('one team’s prescouting, for the Scouting team page (#119)', () => {
  const row = (fields: Partial<PrescoutNotes>): PrescoutNotes => ({
    id: 'p1', event_key: '2026ilch', team_number: 9991, ...NO_ANSWERS, ...NO_FACTS, tier: null, created_at: '2026-11-05T19:00:00Z', created_by: null, ...fields,
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

  it("links to the team's prescouting page, or the list, in Scouting's Prescouting tab (#184)", () => {
    expect(prescoutHref('2026ilch', 9991)).toBe('#/scouting/prescouting/2026ilch/9991')
    expect(prescoutHref()).toBe('#/scouting/prescouting')
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
