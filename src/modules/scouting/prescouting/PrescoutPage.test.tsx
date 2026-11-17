// Tests for the prescouting pages, drawn in demo mode with the example notes.
// In demo mode you're Alex, a student who isn't on the strategy team: every
// scout can use Prescouting (#184).
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { EVENT_KEY, tbaTeamUrl } from '../data'
import { PRESCOUT_QUESTIONS } from './data'
import PrescoutPage, { TeamCard, TeamPage } from './PrescoutPage'

describe('the prescouting pages', () => {
  it("start on this season's event, and say the teams are loading, for any scout (#184)", () => {
    const html = renderToString(<PrescoutPage />)
    expect(html).not.toContain('Only the strategy team')
    expect(html).toContain(`value="${EVENT_KEY}"`)
    expect(html).toContain('Loading teams…')
  })

  it("have a team's page with a text box for every question and the quick answers, filled in with what's saved, and their team stars", () => {
    const html = renderToString(<TeamPage event={EVENT_KEY} team={9991} />)
    for (const q of PRESCOUT_QUESTIONS) expect(html).toContain(`id="prescout-${q.key}"`)
    expect(html).toContain('Starts center, scores preload')
    // #184: the quick answers, from the example row (Swerve, Level 2, 5 fuel, 8 seconds, rated 4).
    expect(html).toContain('aria-pressed="true">Swerve</button>')
    expect(html).toContain('aria-pressed="true">Level 2</button>')
    expect(html).toContain('aria-pressed="true">4</button>')
    expect(html).toMatch(/id="prescout-auto_fuel"[^>]*value="5"/)
    expect(html).toMatch(/id="prescout-cycle_seconds"[^>]*value="8"/)
    expect(html).toContain('Fast, reliable auto. Good second pick.')
    expect(html).toContain('☆ Star')
    // #119: one tap to the team's Scouting page.
    expect(html).toContain('href="#/scouting/team/9991"')
    // #184: back to the list in the Prescouting tab.
    expect(html).toContain('href="#/scouting/prescouting"')
  })

  it('open a team from the address the Scouting page passes in, and say when it is not a team', () => {
    expect(renderToString(<PrescoutPage event={EVENT_KEY} team="9991" />)).toContain('id="prescout-overall"')
    expect(renderToString(<PrescoutPage event={EVENT_KEY} team="nope" />)).toContain("That address isn&#x27;t a team&#x27;s prescouting page.")
  })

  it('say a team with no notes is not prescouted yet, and link to their page in the Prescouting tab', () => {
    const team = { team: 9995, name: 'Mock Mechanics', epa: null, tbaUrl: tbaTeamUrl(9995, EVENT_KEY), notes: null, prescouted: false, stars: { forTeam: [], mine: null }, group: 'Everyone else' as const }
    const html = renderToString(<TeamCard event={EVENT_KEY} team={team} />)
    expect(html).toContain('Not prescouted yet')
    expect(html).toContain(`href="#/scouting/prescouting/${EVENT_KEY}/9995"`)
    expect(html).toContain('EPA —')
    expect(html).toContain('☆ Star')
  })
})
