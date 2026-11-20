// Tests for the prescouting pages, drawn in demo mode with the example notes.
// In demo mode you're Alex, a student who isn't on the strategy team: every
// scout can use Prescouting (#184).
import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { DEMO_PEOPLE } from '../../../core/demo'
import { EVENT_KEY, tbaTeamUrl } from '../data'
import {
  NO_ANSWERS, NO_FACTS, PRESCOUT_QUESTIONS, PRESCOUT_VIEWS, clearCompare, loadPrescoutTeams, prescoutOverview, prescoutTable, prescoutViewStore, reloadPrescoutTeams, setPrescoutView, starsTable, tickCompare,
} from './data'
import PrescoutPage, { CompactRow, Match13Panel, TeamCard, TeamPage, TeamTable } from './PrescoutPage'

describe('the prescouting pages', () => {
  afterEach(() => {
    prescoutViewStore.reset()
    clearCompare()
  })

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
    const team = { team: 9995, name: 'Mock Mechanics', epa: null, xp: null, xpRank: null, auto: null, teleop: null, endgame: null, opr: null, dpr: null, tbaUrl: tbaTeamUrl(9995, EVENT_KEY), notes: null, prescouted: false, stars: { forTeam: [], mine: null }, group: 'Everyone else' as const }
    const html = renderToString(<TeamCard event={EVENT_KEY} team={team} />)
    expect(html).toContain('Not prescouted yet')
    expect(html).toContain(`href="#/scouting/prescouting/${EVENT_KEY}/9995"`)
    expect(html).toContain('EPA — · xP —')
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
      expect(html).toMatch(new RegExp(`<a href="#/scouting/prescouting/${EVENT_KEY}/${team}"[^>]*><strong class="tnum">${team}</strong>`))
    }
    // The star groups are heading rows, and the search box is still there.
    expect(html).toContain('Team stars')
    expect(html).toContain('Everyone else')
    expect(html).toContain('id="prescout-search"')
  })

  it('show the teams as compact rows when Compact is chosen, each with their overall note, keeping the star groups, sort and search (#233)', async () => {
    await reloadPrescoutTeams(EVENT_KEY)
    setPrescoutView('Compact')
    const html = renderToString(<PrescoutPage />)
    expect(html).toMatch(/aria-pressed="true"[^>]*>Compact</)
    expect(html).not.toContain('<table')
    // Team stars, then your stars, then everyone else, each by number.
    const rows = [...html.matchAll(/class="prescout-row"[^>]*><span[^>]*><strong class="tnum">(\d+)/g)].map((m) => m[1])
    expect(rows).toEqual(['9991', '9994', '9993', '4096', '9992', '9995'])
    for (const text of ['Strong scorer, slow climb. Good first pick.', 'Key task: Playing defense', 'Not prescouted yet', 'Team stars', 'Your stars', 'id="prescout-search"']) {
      expect(html).toContain(text)
    }
    // Every row starts closed.
    expect(html).not.toContain('aria-expanded="true"')
  })

  it('open a compact row in place with all their notes, Open notes and TBA (#233)', async () => {
    const list = await loadPrescoutTeams(EVENT_KEY)
    if (!list.ok) throw new Error(list.error)
    const team = prescoutOverview(list.value, prescoutTable.rows(), starsTable.rows(), DEMO_PEOPLE.alex, 'Team number').find((t) => t.team === 9991)!
    const closed = renderToString(<CompactRow event={EVENT_KEY} team={team} open={false} onToggle={() => {}} />)
    expect(closed).not.toContain('Expected auto paths')
    const html = renderToString(<CompactRow event={EVENT_KEY} team={team} open onToggle={() => {}} />)
    expect(html).toContain('aria-expanded="true"')
    for (const q of PRESCOUT_QUESTIONS) expect(html).toContain(`${q.label}: `)
    // The whole answer, not just its first line.
    expect(html).toContain('Never broke down at their last event.')
    expect(html).toContain('Open notes')
    expect(html).toContain(`href="#/scouting/prescouting/${EVENT_KEY}/9991"`)
    expect(html).toContain(`href="${tbaTeamUrl(9991, EVENT_KEY)}"`)
  })

  it('give every team a Compare tick in each view, and a Compare button once two are ticked (#233)', async () => {
    await reloadPrescoutTeams(EVENT_KEY)
    for (const view of PRESCOUT_VIEWS) {
      setPrescoutView(view)
      expect(renderToString(<PrescoutPage />), view).toContain('aria-label="Compare team 9992"')
    }
    // Before any tick there's no bar, but its empty aria-live words are
    // already on the page, so a screen reader reads the first tick's hint.
    let html = renderToString(<PrescoutPage />)
    expect(html).not.toContain('prescout-compare-bar')
    expect(html).toMatch(/<span aria-live="polite"[^>]*><\/span>/)
    tickCompare(EVENT_KEY, 9991)
    html = renderToString(<PrescoutPage />)
    expect(html).toContain('Tick another team to compare')
    expect(html).not.toContain('Compare (1)')
    tickCompare(EVENT_KEY, 9993)
    html = renderToString(<PrescoutPage />)
    expect(html).toContain(`href="#/scouting/prescouting/${EVENT_KEY}/compare/9991,9993"`)
    expect(html).toContain('Compare (2)')
    expect(html.match(/checked=""/g)).toHaveLength(2)
  })

  it('open the compare page from its address, and say when the address is wrong (#233)', async () => {
    await reloadPrescoutTeams(EVENT_KEY)
    // A repeat in the address shows the team once.
    const html = renderToString(<PrescoutPage event={EVENT_KEY} team="compare" teams="9991,9993,9991" />)
    expect(html).toContain('href="#/scouting/prescouting"')
    expect(html).toContain(`href="#/scouting/prescouting/${EVENT_KEY}/9991"`)
    expect(html).toContain(`href="#/scouting/prescouting/${EVENT_KEY}/9993"`)
    expect(html.match(/aria-label="Team 9991 on The Blue Alliance"/g)).toHaveLength(1)
    for (const q of PRESCOUT_QUESTIONS) expect(html).toContain(`>${q.label}</h3>`)
    for (const text of ['Fast, reliable auto. Good second pick.', 'Strong scorer, slow climb. Good first pick.', 'Playing defense', 'class="prescout-compare"']) {
      expect(html).toContain(text)
    }
    // The highest EPA is bold.
    expect(html).toContain('<strong class="tnum">39.6</strong>')
    expect(html).toContain('28.9')
    expect(html).not.toContain('<strong class="tnum">28.9</strong>')

    for (const [event, teams] of [[EVENT_KEY, '9991'], [EVENT_KEY, 'abc'], ['nope', '9991,9993']]) {
      expect(renderToString(<PrescoutPage event={event} team="compare" teams={teams} />), teams).toContain('tick the teams you want')
    }
  })

  it('give a team with no notes a table row with a dash in every answer, and show how many stars a team has', () => {
    const base = { name: 'Mock Mechanics', epa: null, xp: null, xpRank: null, auto: null, teleop: null, endgame: null, opr: null, dpr: null, tbaUrl: tbaTeamUrl(9995, EVENT_KEY), notes: null, prescouted: false, group: 'Everyone else' as const }
    const star = { id: 's', event_key: EVENT_KEY, team_number: 9994, for_team: true, reason: 'Fast', created_at: '', created_by: null }
    const teams = [{ ...base, team: 9995, stars: { forTeam: [], mine: null } }, { ...base, team: 9994, stars: { forTeam: [star, star], mine: star } }]
    const html = renderToString(<TeamTable event={EVENT_KEY} teams={teams} headings={false} />)
    expect(html.match(/<td[^>]*class="muted"[^>]*>—<\/td>/g)).toHaveLength(2 * PRESCOUT_QUESTIONS.length)
    expect(html.match(/★/g)).toHaveLength(1)
    expect(html).toContain('★<!-- -->3')
    expect(html).not.toContain('Everyone else')
  })

  it("show a team's tier on their card, their table row and their page, with S to F buttons to choose it (#191)", () => {
    const notes = { id: 'n1', event_key: EVENT_KEY, team_number: 9993, ...NO_ANSWERS, ...NO_FACTS, tier: 'B' as const, created_at: '2026-11-05T19:00:00Z', created_by: null }
    const team = { team: 9993, name: 'Example Robotics', epa: null, xp: null, xpRank: null, auto: null, teleop: null, endgame: null, opr: null, dpr: null, tbaUrl: tbaTeamUrl(9993, EVENT_KEY), notes, prescouted: false, stars: { forTeam: [], mine: null }, group: 'Everyone else' as const }
    let html = renderToString(<TeamCard event={EVENT_KEY} team={team} />)
    expect(html).toMatch(/data-tier="B"[^>]*>Tier B</)
    expect(renderToString(<TeamCard event={EVENT_KEY} team={{ ...team, notes: null }} />)).not.toContain('data-tier')
    html = renderToString(<TeamTable event={EVENT_KEY} teams={[team]} headings={false} />)
    expect(html).toMatch(/data-tier="B"[^>]*>B</)
    expect(html).toContain('tier B')
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
