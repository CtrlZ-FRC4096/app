// Tests for the prescouting pages, drawn in demo mode with the example notes.
import { describe, expect, it } from 'vitest'
import { setDemoRole } from '../../core/demo'
import { renderToString } from 'react-dom/server'
import { EVENT_KEY, tbaTeamUrl } from '../scouting/data'
import { PRESCOUT_QUESTIONS } from './data'
import PrescoutPage, { TeamCard, TeamPage } from './PrescoutPage'

describe('the prescouting pages', () => {
  it("start on this season's event, and say the teams are loading", () => {
    const html = renderToString(<PrescoutPage />)
    expect(html).toContain(`value="${EVENT_KEY}"`)
    expect(html).toContain('Loading teams…')
  })

  it("have a team's page with a text box for every question, filled in with what's saved, its team stars with their reasons, and a link to its Scouting team page", () => {
    setDemoRole('student')
    const html = renderToString(<TeamPage event={EVENT_KEY} team={9991} />)
    for (const q of PRESCOUT_QUESTIONS) expect(html).toContain(`id="prescout-${q.key}"`)
    expect(html).toContain('Starts center, scores preload')
    expect(html).toContain('Starred for the team')
    expect(html).toContain('Fast, reliable auto. Good first pick.')
    // Alex hasn't starred 9991, so their own button is empty.
    expect(html).toContain('☆ Star')
    expect(html).toContain('href="#/scouting/team/9991"')
  })

  it('say a team with no notes is not prescouted yet, and link to their page', () => {
    const team = { team: 9995, name: 'Mock Mechanics', epa: null, tbaUrl: tbaTeamUrl(9995, EVENT_KEY), notes: null, teamStars: [], myStars: [], group: 'rest' as const, prescouted: false }
    const html = renderToString(<TeamCard event={EVENT_KEY} team={team} />)
    expect(html).toContain('Not prescouted yet')
    expect(html).toContain(`href="#/prescouting/${EVENT_KEY}/9995"`)
    expect(html).toContain('EPA —')
    expect(html).toContain('☆ Star')
  })
})
