// Tests for the Prescouting module's data.ts, in demo mode: the tests never
// call The Blue Alliance or Match 13. The table's permission rules are
// tested in supabase/tests/prescouting-notes.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAllStores } from '../../core/store'
import { EVENT_KEY, tbaTeamUrl } from '../scouting/data'
import {
  MAX_PRESCOUT_ANSWER, NO_ANSWERS, cleanEventKey, firstLine, hasAnswers, isEventKey, loadPrescoutTeams, prescoutEventStore, prescoutList, prescoutOverview,
  prescoutTable, savePrescout, setPrescoutEvent, canRemoveStar, starTeam, starredFirst, starsFor, starsTable, unstarTeam, visibleStars,
  type PrescoutStar,
} from './data'
import { DEMO_PEOPLE, setDemoRole } from '../../core/demo'

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
  const team = (n: number, epa: number | null) => ({ team: n, name: `Team ${n}`, epa, tbaUrl: tbaTeamUrl(n, EVENT_KEY) })
  const note = (n: number, strengths = '') => ({
    id: `id-${n}`, event_key: EVENT_KEY, team_number: n, ...NO_ANSWERS, strengths, created_at: '2026-11-05T19:00:00Z', created_by: null,
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
