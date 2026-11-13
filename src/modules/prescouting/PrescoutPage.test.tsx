// Tests for the prescouting pages, drawn in demo mode with the example notes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setDemoRole } from '../../core/demo'
import { renderToString } from 'react-dom/server'
import { EVENT_KEY, tbaTeamUrl } from '../scouting/data'
import { PRESCOUT_QUESTIONS } from './data'
import PrescoutPage, { TeamCard, TeamPage } from './PrescoutPage'

describe('the prescouting pages', () => {
  // Prescouting is strategy only (#167). A student leader always counts;
  // Alex, the demo student, isn't on the example strategy team.
  beforeEach(() => setDemoRole('leader'))
  afterEach(() => setDemoRole('student'))

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
})
