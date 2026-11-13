// Tests for the match form. The form's choices come from season.ts, so a
// new role there should show up on the form with no other change.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { setDemoRole } from '../../core/demo'
import { POSITIONS, eventStore, getRatings, picklistParts, picklistTable, ratingsStore, resetRatings, setWeight, weightsStore } from './data'
import EventPicker from './EventPicker'
import Picklist from './Picklist'
import ScoutingPage from './ScoutingPage'
import RankingsPage from './RankingsPage'
import { rankingsStore, refreshRankings } from './data'
import Schedule from './Schedule'
import SharedPicklist from './SharedPicklist'
import TeamPage from './TeamPage'
import { AUTO_SIDES, COUNTERS, DRIVETRAINS, EVENT_KEY, ROLES } from './season'

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
  it('starts on the overview (#160), with both forms on the page but hidden, so going back to one keeps what was typed', () => {
    const html = renderToString(<ScoutingPage />)
    expect(html).toContain('aria-pressed="true">Overview</button>')
    expect(html).toContain('Scouting overview')
    expect(html).toMatch(/<div hidden="">.*Match form/)
    expect(html).toMatch(/<div hidden="">.*Pit form/)
  })

  it('has a card for every page, each linking to it, with the match form at #/scouting/match', () => {
    const html = renderToString(<ScoutingPage />)
    for (const path of ['match', 'pit', 'schedule', 'rankings', 'team', 'picklist', 'shared-picklist', 'simulate', 'stats']) {
      expect(html).toContain(`href="#/scouting/${path}"`)
    }
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

describe('the picklist', () => {
  // Save the example Match 13 ratings on this "phone", as useRatings() would.
  beforeEach(async () => {
    const ratings = await getRatings()
    if (!ratings.ok) throw new Error(ratings.error)
    ratingsStore.set({ event: EVENT_KEY, ratings: ratings.value, rankings: [], loadedAt: '2026-11-07T21:40:00Z', error: null })
    weightsStore.reset()
  })
  afterEach(() => {
    resetRatings()
    weightsStore.reset()
  })
  const first = (html: string) => html.match(/>1\. Team (\d+)</)?.[1]

  it('is a choice in the switch, and not on the page until chosen', () => {
    const html = renderToString(<ScoutingPage />)
    expect(html).toContain('aria-pressed="false">Picklist</button>')
    expect(html).not.toContain('Ranked teams')
  })

  it('re-ranks when the weights change', () => {
    // Every weight 1: 4096 has the best Match 13 numbers and isn't scouted, so it's first.
    expect(first(renderToString(<Picklist />))).toBe('4096')
    // Only auto fuel scored: 9991 scored 3 in the example entries, 9992 none.
    for (const part of picklistParts()) setWeight(part.key, part.key === 'autoFuel' ? 1 : 0)
    expect(first(renderToString(<Picklist />))).toBe('9991')
  })

  it('links each team to its team page, and says what we have no numbers for yet', () => {
    const html = renderToString(<Picklist />)
    expect(html).toContain('href="#/scouting/team/9993"')
    expect(html).toContain('No scouting yet')
    expect(html).toContain('saved on this phone')
    expect(html).toContain('Copy as CSV')
  })

  it('asks for a weight above 0 when every weight is 0', () => {
    for (const part of picklistParts()) setWeight(part.key, 0)
    const html = renderToString(<Picklist />)
    expect(html).toContain('Set at least one weight above 0 to rank teams.')
    expect(first(html)).toBeUndefined()
  })

  it("says when Match 13 couldn't be reached, and leaves out its numbers if none are saved", () => {
    resetRatings()
    ratingsStore.set({ event: EVENT_KEY, ratings: [], rankings: [], loadedAt: null, error: 'Match 13 is down.' })
    const html = renderToString(<Picklist />)
    expect(html).toContain("Couldn&#x27;t reach Match 13: Match 13 is down.")
    expect(html).toContain('No Match 13 rating yet')
  })
})

describe('the final picklist', () => {
  // The example list (EXAMPLE_PICKLIST in data.ts), top first: 9991, 9993
  // (Picked), 9992, 9995 (Do not pick), 9994.
  beforeEach(() => picklistTable.reset())
  afterEach(() => {
    setDemoRole('student')
    picklistTable.reset()
  })
  async function emptyList() {
    for (const row of picklistTable.rows()) await picklistTable.remove(row.id)
  }

  it('is a choice in the switch, and not on the page until chosen', () => {
    const html = renderToString(<ScoutingPage />)
    expect(html).toContain('aria-pressed="false">Final picklist</button>')
    expect(html).not.toContain('The order the strategy team wants')
  })

  it('shows a student the list with no buttons to change it', () => {
    setDemoRole('student')
    const html = renderToString(<SharedPicklist />)
    expect(html).toContain('href="#/scouting/team/9991"')
    expect(html).not.toContain('Move team')
    expect(html).not.toContain('Start from the ranked list')
    expect(html).toContain('Only mentors can change it.')
  })

  it('gives a mentor up and down buttons, and a status for each team', () => {
    setDemoRole('mentor')
    const html = renderToString(<SharedPicklist />)
    expect(html).toContain('aria-label="Move team 9992 up"')
    expect(html).toContain('aria-label="Move team 9992 down"')
    expect(html).toContain('aria-label="Team 9992&#x27;s status"')
    // The top team can't go up, and the bottom one can't go down.
    expect(html).toMatch(/aria-label="Move team 9991 up" disabled=""/)
    expect(html).toMatch(/aria-label="Move team 9994 down" disabled=""/)
  })

  it('keeps Picked and Do not pick teams in their place, with their status', () => {
    const html = renderToString(<SharedPicklist />)
    const places = [...html.matchAll(/team\/(\d+)"/g)].map((m) => m[1])
    expect(places).toEqual(['9991', '9993', '9992', '9995', '9994'])
    expect(html).toContain('>Picked</span>')
    expect(html).toContain('>Do not pick</span>')
  })

  it('tells a student the picklist is not made yet, and offers a mentor to start it', async () => {
    await emptyList()
    expect(renderToString(<SharedPicklist />)).toContain('The strategy team hasn&#x27;t made the picklist yet.')
    setDemoRole('mentor')
    expect(renderToString(<SharedPicklist />)).toContain('Start from the ranked list')
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

  it('has a button for each position, none chosen until the scout picks one', () => {
    const html = renderToString(<ScoutingPage />)
    for (const position of POSITIONS) expect(html).toContain(`aria-pressed="false">${position}</button>`)
    expect(html).toContain('Pick your position, and the team fills in from the match number.')
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

  it("opens a team's page when its row is tapped", () => {
    rankingsStore.set({ event: EVENT_KEY, rankings: [ranking], checked_at: new Date().toISOString() })
    expect(renderToString(<RankingsPage />)).toContain('href="#/scouting/team/9991"')
    rankingsStore.reset()
  })
})

describe("the team's event rank", () => {
  it('shows at the top of the team page, with the record', async () => {
    // The example rankings (demo mode), as the Rankings page saves them.
    const result = await refreshRankings()
    if (!result.ok) throw new Error(result.error)
    // In the example rankings 4096 is third, having won one and lost one.
    const html = renderToString(<TeamPage team={4096} />)
    expect(html).toContain('Rank 3 of 6 · 1-1-0')
    expect(html).toContain('Rankings updated just now')
    // Just under the team's name, above everything else.
    expect(html.indexOf('Rank 3 of 6')).toBeLessThan(html.indexOf('Find a team'))
    rankingsStore.reset()
  })

  it('says when a team is not ranked, and shows nothing when no rankings are saved', () => {
    const ranking = { rank: 1, team_key: 'frc9991', record: { wins: 5, losses: 1, ties: 0 }, matches_played: 6, extra_stats: [17] }
    rankingsStore.set({ event: EVENT_KEY, rankings: [ranking], checked_at: new Date().toISOString() })
    expect(renderToString(<TeamPage team={1234} />)).toContain('Not in the event rankings yet')
    rankingsStore.reset()
    const html = renderToString(<TeamPage team={1234} />)
    expect(html).not.toContain('Rank ')
    expect(html).not.toContain('Not in the event rankings yet')
  })
})

describe('the event picker', () => {
  beforeEach(() => eventStore.reset())
  afterEach(() => setDemoRole('student'))

  it("shows a student which event it is, and that a mentor picks it, with no way to change it", () => {
    const html = renderToString(<EventPicker />)
    expect(html).toContain(EVENT_KEY)
    expect(html).toContain('A mentor picks the event for the whole team.')
    expect(html).not.toContain('Change event')
  })

  it('lets a mentor change it, and says when nobody has picked one yet', () => {
    setDemoRole('mentor')
    const html = renderToString(<EventPicker />)
    expect(html).toContain('Change event')
    expect(html).toContain('Nobody has picked the event yet')
  })

  it("shows the picked event's name and key", () => {
    eventStore.set({ key: '2027ilpe', name: 'Example Peoria Regional' })
    const html = renderToString(<EventPicker />)
    expect(html).toContain('Example Peoria Regional')
    expect(html).toContain('2027ilpe')
    expect(html).not.toContain('Nobody has picked')
  })

  it('is at the top of every Scouting page', () => {
    expect(renderToString(<ScoutingPage />)).toContain('Event: <strong>')
  })
})
