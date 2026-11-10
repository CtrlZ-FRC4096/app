// Tests for the match form. The form's choices come from season.ts, so a
// new role there should show up on the form with no other change.
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import ScoutingPage from './ScoutingPage'
import RankingsPage from './RankingsPage'
import { rankingsStore } from './data'
import { EVENT_KEY } from './season'
import Schedule from './Schedule'
import TeamPage from './TeamPage'
import { AUTO_SIDES, COUNTERS, DRIVETRAINS, ROLES } from './season'

describe('the team page', () => {
  // Team 9991 is in the example entries (EXAMPLE_ENTRIES in data.ts), in match 1.
  it("shows a team's numbers, answers and notes", () => {
    const html = renderToString(<TeamPage team={9991} />)
    expect(html).toContain('Team 9991')
    for (const counter of COUNTERS) expect(html).toContain(counter.label)
    expect(html).toContain('Match 1: 12')
    expect(html).toContain('aria-label="Endgame: Level 2" aria-valuenow="100"')
    expect(html).toContain('Fast intake')
    // And its pit entry (EXAMPLE_PIT_ENTRIES).
    expect(html).toContain('aria-label="Drivetrain (pit): Swerve" aria-valuenow="100"')
    expect(html).toContain('Feed us fuel')
  })

  it('says when nothing is scouted for a team', () => {
    const html = renderToString(<TeamPage team={1234} />)
    expect(html).toContain('Nothing scouted for team 1234 yet.')
    expect(html).not.toContain('Numbers')
  })

  it('links to every scouted team', () => {
    expect(renderToString(<TeamPage team={null} />)).toContain('href="#/scouting/team/9992"')
  })
})

describe('the Match / Pit switch', () => {
  it('starts on the match form, with the pit form hidden', () => {
    const html = renderToString(<ScoutingPage />)
    expect(html).toContain('aria-pressed="true">Match</button>')
    expect(html).toMatch(/<div hidden="">.*Pit form/)
  })
})

describe('the schedule', () => {
  it('is a third choice in the switch, and not on the page until chosen', () => {
    const html = renderToString(<ScoutingPage />)
    expect(html).toContain('aria-pressed="false">Schedule</button>')
    expect(html).not.toContain('Match schedule')
  })

  it('has a Just ours switch, and says it is getting the schedule before it has one', () => {
    const html = renderToString(<Schedule />)
    expect(html).toContain('Just ours (<!-- -->4096<!-- -->)')
    expect(html).toContain('Getting the schedule…')
  })
})

describe('the pit form', () => {
  it('has a button for every drivetrain and auto side in season.ts, none chosen', () => {
    const html = renderToString(<ScoutingPage />)
    for (const choice of [...DRIVETRAINS, ...AUTO_SIDES]) expect(html).toContain(`aria-pressed="false">${choice}</button>`)
  })

  it('has the number boxes and text boxes', () => {
    const html = renderToString(<ScoutingPage />)
    for (const id of ['pit-match', 'pit-team','pit-weight', 'pit-length', 'pit-width', 'pit-height', 'pit-motors', 'pit-auto-path', 'pit-partners', 'pit-they-do']) {
      expect(html).toContain(`id="${id}"`)
    }
  })
})

describe('the match form', () => {
  it('has a button for every role in season.ts, none chosen at the start', () => {
    const html = renderToString(<ScoutingPage />)
    for (const role of ROLES) expect(html).toContain(`aria-pressed="false">${role}</button>`)
  })

  it('shows a role added to season.ts', () => {
    ROLES.push('Example role')
    try {
      expect(renderToString(<ScoutingPage />)).toContain('>Example role</button>')
    } finally {
      ROLES.pop()
    }
  })

  it('starts with no driver skill chosen', () => {
    const html = renderToString(<ScoutingPage />)
    const driverSkill = html.slice(html.indexOf('aria-label="Driver skill"'))
    expect(driverSkill.slice(0, driverSkill.indexOf('</div>'))).not.toContain('aria-pressed="true"')
  })
})

describe('the rankings page', () => {
  const ranking = { rank: 1, team_key: 'frc9991', record: { wins: 5, losses: 1, ties: 0 }, matches_played: 6, extra_stats: [17] }

  it('shows the rankings kept on this device, with when they are from', () => {
    rankingsStore.set({ event: EVENT_KEY, rankings: [ranking], checked_at: new Date().toISOString() })
    // React puts <!-- --> between text and numbers: take them out to read it.
    const html = renderToString(<RankingsPage />).replaceAll('<!-- -->', '')
    expect(html).toContain('Updated just now')
    expect(html).toContain('Team 9991')
    expect(html).toContain('5-1-0')
    expect(html).toContain('17 RP')
  })

  it("doesn't show rankings kept from another event", () => {
    rankingsStore.set({ event: '2025oldevent', rankings: [ranking], checked_at: new Date().toISOString() })
    const html = renderToString(<RankingsPage />)
    expect(html).not.toContain('Team 9991')
    expect(html).toContain('No rankings on this phone yet')
    rankingsStore.reset()
  })
})
