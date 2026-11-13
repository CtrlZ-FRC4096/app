// Tests for the Prescouting module's data.ts, in demo mode: the tests never
// call The Blue Alliance or Match 13. The table's permission rules are
// tested in supabase/tests/prescouting-notes.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAllStores } from '../../core/store'
import { EVENT_KEY, tbaTeamUrl } from '../scouting/data'
import {
  MAX_PRESCOUT_ANSWER, NO_ANSWERS, cleanEventKey, firstLine, hasAnswers, isEventKey, loadPrescoutTeams, prescoutEventStore, prescoutList, prescoutOverview,
  prescoutFor, prescoutHref, prescoutTable, savePrescout, setPrescoutEvent, toggleMark, type PrescoutNotes,
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
    expect(result).toMatchObject({ ok: true, value: { event_key: EVENT_KEY, team_number: 9992, strengths: 'Quick climber', key_task: 'Scoring fuel', marked: false } })
    expect(notesFor(9992)?.created_by).toBeTruthy()
  })

  it('changes the same row after that, keeping the mark', async () => {
    const before = notesFor(9991)!
    expect(before.marked).toBe(true)
    const result = await savePrescout(EVENT_KEY, 9991, { ...ANSWERS, weaknesses: 'Tips over' })
    expect(result).toMatchObject({ ok: true, value: { id: before.id, weaknesses: 'Tips over', marked: true } })
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

  it('marks and unmarks a team, adding their row if they have no notes yet', async () => {
    expect(await toggleMark(EVENT_KEY, 9994)).toEqual({ ok: true, value: true })
    expect(notesFor(9994)).toMatchObject({ ...NO_ANSWERS, marked: true })
    expect(hasAnswers(notesFor(9994))).toBe(false)
    expect(await toggleMark(EVENT_KEY, 9994)).toEqual({ ok: true, value: false })
    expect(await toggleMark(EVENT_KEY, 9991)).toEqual({ ok: true, value: false })
    expect(notesFor(9991)?.strengths).toMatch(/Fast cycles/)
  })

  it('knows whether a team has been prescouted', () => {
    expect(hasAnswers(notesFor(9991))).toBe(true)
    expect(hasAnswers(null)).toBe(false)
    expect(hasAnswers({ ...notesFor(9991)!, ...NO_ANSWERS, other_notes: ' \n ' })).toBe(false)
  })
})

describe('the prescouting overview', () => {
  const team = (n: number, epa: number | null) => ({ team: n, name: `Team ${n}`, epa, tbaUrl: tbaTeamUrl(n, EVENT_KEY) })
  const note = (n: number, marked: boolean, strengths = '') => ({
    id: `id-${n}`, event_key: EVENT_KEY, team_number: n, ...NO_ANSWERS, strengths, marked, created_at: '2026-11-05T19:00:00Z', created_by: null,
  })
  const TEAMS = [team(9995, 22.1), team(9991, 41.7), team(9993, null), team(9992, 35.2), team(9994, null)]
  const order = (rows: { team: number }[]) => rows.map((r) => r.team)

  it('sorts by team number, with marked teams first', () => {
    expect(order(prescoutOverview(TEAMS, [note(9994, true), note(9992, true), note(9991, false, 'Fast')], 'Team number'))).toEqual([9992, 9994, 9991, 9993, 9995])
  })

  it('sorts by EPA best first, teams with no EPA after, marked teams still first', () => {
    expect(order(prescoutOverview(TEAMS, [], 'EPA'))).toEqual([9991, 9992, 9995, 9993, 9994])
    expect(order(prescoutOverview(TEAMS, [note(9994, true), note(9995, true)], 'EPA'))).toEqual([9995, 9994, 9991, 9992, 9993])
  })

  it('puts each team with their notes, and says which are prescouted', () => {
    const rows = prescoutOverview(TEAMS, [note(9991, false, 'Fast'), note(9993, true)], 'Team number')
    expect(rows.find((r) => r.team === 9991)).toMatchObject({ marked: false, prescouted: true, notes: { strengths: 'Fast' } })
    expect(rows.find((r) => r.team === 9993)).toMatchObject({ marked: true, prescouted: false })
    expect(rows.find((r) => r.team === 9992)).toMatchObject({ marked: false, prescouted: false, notes: null })
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
    id: 'p1', event_key: '2026ilch', team_number: 9991, ...NO_ANSWERS, marked: false, created_at: '2026-11-05T19:00:00Z', created_by: null, ...fields,
  })

  it("finds the team's notes at the event", () => {
    const notes = row({ key_task: 'Defense' })
    expect(prescoutFor([notes, row({ id: 'p2', team_number: 9992, key_task: 'Scoring' })], '2026ilch', 9991)).toBe(notes)
  })

  it('gives nothing for a team nobody prescouted, one at another event, or one with only a mark', () => {
    expect(prescoutFor([], '2026ilch', 9991)).toBeNull()
    expect(prescoutFor([row({ event_key: '2026mndu', key_task: 'Defense' })], '2026ilch', 9991)).toBeNull()
    expect(prescoutFor([row({ marked: true })], '2026ilch', 9991)).toBeNull()
  })

  it("links to the team's prescouting page", () => {
    expect(prescoutHref('2026ilch', 9991)).toBe('#/prescouting/2026ilch/9991')
  })
})
