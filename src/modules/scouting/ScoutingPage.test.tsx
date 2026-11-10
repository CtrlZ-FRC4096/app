// Tests for the match form. The form's choices come from season.ts, so a
// new role there should show up on the form with no other change.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { setDemoRole } from '../../core/demo'
import { POSITIONS, getRatings, picklistParts, picklistTable, ratingsStore, resetRatings, setWeight, weightsStore } from './data'
import Picklist from './Picklist'
import ScoutingPage from './ScoutingPage'
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
