// Tests for the prescouting pages, drawn in demo mode with the example notes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setDemoRole } from '../../core/demo'
import { renderToString } from 'react-dom/server'
import { EVENT_KEY, tbaTeamUrl } from '../scouting/data'
import { NO_ANSWERS, PRESCOUT_QUESTIONS } from './data'
import PrescoutPage, { Match13Panel, TeamPage, TeamTile } from './PrescoutPage'

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

  it("show each team as a tile linking to their page, with an emptier look and no ✓ until they're prescouted (#183)", () => {
    const team = { team: 9995, name: 'Mock Mechanics', epa: null, xp: null, xpRank: null, auto: null, teleop: null, endgame: null, opr: null, dpr: null, tbaUrl: tbaTeamUrl(9995, EVENT_KEY), notes: null, prescouted: false, stars: { forTeam: [], mine: null }, group: 'Everyone else' as const }
    const html = renderToString(<TeamTile event={EVENT_KEY} team={team} />)
    expect(html).toContain(`href="#/prescouting/${EVENT_KEY}/9995"`)
    expect(html).toContain('prescout-tile-todo')
    expect(html).toContain('EPA —')
    expect(html).toContain('not prescouted yet')
    expect(html).not.toContain('✓')
    expect(html).not.toContain('★')
    // The Star button and notes are on the team's page, not the tile.
    expect(html).not.toContain('☆ Star')
  })

  it('mark a prescouted tile with ✓, and a team star with ★ (#183)', () => {
    const star = { id: 's1', event_key: EVENT_KEY, team_number: 9991, for_team: true, reason: 'Good second pick', created_at: '2026-11-06T19:00:00Z', created_by: null }
    const team = { team: 9991, name: 'Example Robotics', epa: 31.2, xp: 33.4, xpRank: { rank: 2, of: 6 }, auto: null, teleop: null, endgame: null, opr: null, dpr: null, tbaUrl: tbaTeamUrl(9991, EVENT_KEY), notes: null, prescouted: true, stars: { forTeam: [star], mine: null }, group: 'Team stars' as const }
    const html = renderToString(<TeamTile event={EVENT_KEY} team={team} />)
    expect(html).not.toContain('prescout-tile-todo')
    expect(html).toContain('✓')
    expect(html).toContain('★')
    expect(html).toContain('EPA 31.2')
    expect(html).toContain('xP 33.4')
    expect(html).toContain('team star')
  })

  it("show a team's tier on their tile and their page, with S to F buttons to choose it (#191)", () => {
    const notes = { id: 'n1', event_key: EVENT_KEY, team_number: 9993, ...NO_ANSWERS, tier: 'B' as const, created_at: '2026-11-05T19:00:00Z', created_by: null }
    const team = { team: 9993, name: 'Example Robotics', epa: null, xp: null, xpRank: null, auto: null, teleop: null, endgame: null, opr: null, dpr: null, tbaUrl: tbaTeamUrl(9993, EVENT_KEY), notes, prescouted: false, stars: { forTeam: [], mine: null }, group: 'Everyone else' as const }
    let html = renderToString(<TeamTile event={EVENT_KEY} team={team} />)
    expect(html).toContain('data-tier="B"')
    expect(html).toContain('tier B')
    html = renderToString(<TeamTile event={EVENT_KEY} team={{ ...team, notes: null }} />)
    expect(html).not.toContain('data-tier')
    expect(html).toContain('not rated')
    // The example notes give 9993 tier B, and 9992 no tier.
    html = renderToString(<TeamPage event={EVENT_KEY} team={9993} />)
    for (const tier of ['S', 'A', 'B', 'C', 'D', 'F']) expect(html).toContain(`>${tier}</button>`)
    expect(html).toMatch(/aria-pressed="true"[^>]*>B<\/button>/)
    expect(renderToString(<TeamPage event={EVENT_KEY} team={9992} />)).toContain('Not rated')
  })

  it("show Match 13's numbers on a team's page, with — for a missing one, and say when there are none yet (#186)", () => {
    const base = { team: 9991, name: 'Example Robotics', tbaUrl: tbaTeamUrl(9991, EVENT_KEY) }
    const rated = { ...base, xp: 40.25, xpRank: { rank: 5, of: 40 }, auto: 10, teleop: 24.5, endgame: null, epa: 31.5, opr: 42.1, dpr: 12.3 }
    let html = renderToString(<Match13Panel team={rated} />)
    for (const text of ['Rank 5 of 40', '10.0', '24.5', '—', '31.5', '42.1', '12.3', 'Before the event']) expect(html).toContain(text)
    const unrated = { ...base, xp: null, xpRank: null, auto: null, teleop: null, endgame: null, epa: null, opr: null, dpr: null }
    html = renderToString(<Match13Panel team={unrated} />)
    expect(html).toContain('No Match 13 numbers yet')
    expect(html).not.toContain('Rank')
  })
})
