// Tests for the prescouting pages, drawn in demo mode with the example notes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setDemoRole } from '../../core/demo'
import { renderToString } from 'react-dom/server'
import { EVENT_KEY, tbaTeamUrl } from '../scouting/data'
import { PRESCOUT_QUESTIONS, prescoutViewStore, reloadPrescoutTeams, setPrescoutView } from './data'
import PrescoutPage, { TeamCard, TeamPage, TeamTable } from './PrescoutPage'

describe('the prescouting pages', () => {
  // Prescouting is strategy only (#167). A student leader always counts;
  // Alex, the demo student, isn't on the example strategy team.
  beforeEach(() => setDemoRole('leader'))
  afterEach(() => {
    setDemoRole('student')
    prescoutViewStore.reset()
  })

  it('are only for the strategy team, student leaders, mentors and admins (#167)', () => {
    setDemoRole('student')
    expect(renderToString(<PrescoutPage />)).toContain('Only the strategy team and mentors can see this.')
  })

  it("start on this season's event, and say the teams are loading", () => {
    const html = renderToString(<PrescoutPage />)
    expect(html).toContain(`value="${EVENT_KEY}"`)
    expect(html).toContain('Loading teams…')
  })

  it("have a team's page with a text box for every question, filled in with what's saved, and their team stars", () => {
    const html = renderToString(<TeamPage event={EVENT_KEY} team={9991} />)
    for (const q of PRESCOUT_QUESTIONS) expect(html).toContain(`id="prescout-${q.key}"`)
    expect(html).toContain('Starts center, scores preload')
    expect(html).toContain('Fast, reliable auto. Good second pick.')
    expect(html).toContain('☆ Star')
    // #119: one tap to the team's Scouting page.
    expect(html).toContain('href="#/scouting/team/9991"')
  })

  it('say a team with no notes is not prescouted yet, and link to their page', () => {
    const team = { team: 9995, name: 'Mock Mechanics', epa: null, tbaUrl: tbaTeamUrl(9995, EVENT_KEY), notes: null, prescouted: false, stars: { forTeam: [], mine: null }, group: 'Everyone else' as const }
    const html = renderToString(<TeamCard event={EVENT_KEY} team={team} />)
    expect(html).toContain('Not prescouted yet')
    expect(html).toContain(`href="#/prescouting/${EVENT_KEY}/9995"`)
    expect(html).toContain('EPA —')
    expect(html).toContain('☆ Star')
  })

  it('show the teams as cards until Table is chosen, then as a table with a column for each question', async () => {
    await reloadPrescoutTeams(EVENT_KEY)
    const cards = renderToString(<PrescoutPage />)
    expect(cards).toMatch(/aria-pressed="true"[^>]*>Cards</)
    expect(cards).not.toContain('<table')

    setPrescoutView('Table')
    const html = renderToString(<PrescoutPage />)
    expect(html).toMatch(/aria-pressed="true"[^>]*>Table</)
    // Sideways scrolling stays inside the table's box, with the team column kept in place.
    expect(html).toMatch(/class="table-wrap"[^>]*><table class="grid-table"/)
    const headings = [...html.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])
    expect(headings).toEqual(['Team', ...PRESCOUT_QUESTIONS.map((q) => q.label)])
    // Every example team has a row, with its number linking to its prescouting page.
    for (const team of [4096, 9991, 9992, 9993, 9994, 9995]) {
      expect(html).toMatch(new RegExp(`<a href="#/prescouting/${EVENT_KEY}/${team}"[^>]*><strong class="tnum">${team}</strong>`))
    }
    // The star groups are heading rows, and the search box is still there.
    expect(html).toContain('Team stars')
    expect(html).toContain('Everyone else')
    expect(html).toContain('id="prescout-search"')
  })

  it('give a team with no notes a table row with a dash in every answer, and show how many stars a team has', () => {
    const base = { name: 'Mock Mechanics', epa: null, tbaUrl: tbaTeamUrl(9995, EVENT_KEY), notes: null, prescouted: false, group: 'Everyone else' as const }
    const star = { id: 's', event_key: EVENT_KEY, team_number: 9994, for_team: true, reason: 'Fast', created_at: '', created_by: null }
    const teams = [{ ...base, team: 9995, stars: { forTeam: [], mine: null } }, { ...base, team: 9994, stars: { forTeam: [star, star], mine: star } }]
    const html = renderToString(<TeamTable event={EVENT_KEY} teams={teams} headings={false} />)
    expect(html.match(/<td[^>]*class="muted"[^>]*>—<\/td>/g)).toHaveLength(2 * PRESCOUT_QUESTIONS.length)
    expect(html.match(/★/g)).toHaveLength(1)
    expect(html).toContain('★<!-- -->3')
    expect(html).not.toContain('Everyone else')
  })
})
