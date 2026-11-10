// Tests for the Match 13 panel on the team page (#37), with the example
// ratings from demo mode. A page drawn with renderToString doesn't load
// anything by itself, so each test puts what it needs in the saved copy.
import { beforeEach, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { loadRatings, ratingsStore, resetRatings, type Match13Rating, type RatingsState } from './data'
import { EVENT_KEY } from './season'
import TeamRatings from './TeamRatings'

const LOADED_AT = '2026-03-13T20:40:00Z'
// A saved copy, as useRatings() would have it. Each test changes only the part it's about.
const saved = (fields: Partial<RatingsState>): RatingsState => ({ event: EVENT_KEY, ratings: [], rankings: [], loadedAt: LOADED_AT, error: null, ...fields })
const rating = (teamNumber: number, fields: Partial<Match13Rating> = {}): Match13Rating => ({
  teamNumber, xpStart: 40, xpEnd: 50, xAuto: 10, xTele: 30, xEnd: 10, epa: 47, opr: null, dpr: null, ...fields,
})
const draw = (team: number) => renderToString(<TeamRatings team={team} />)

describe('the Match 13 panel', () => {
  beforeEach(() => resetRatings())

  it("shows a team's rank, xP, change, parts and record", async () => {
    await loadRatings()
    const html = draw(4096)
    expect(html).toContain('Rank 1 of 6')
    expect(html).toContain('48.6 xP')
    expect(html).toContain('+4.6 since the event started (44.0 → 48.6)')
    for (const label of ['Auto', 'Teleop', 'Endgame', 'Statbotics EPA', 'Record']) expect(html).toContain(label)
    expect(html).toMatch(/Record<\/span><strong[^>]*>\d+-\d+-\d+</)
    expect(html).toContain('Updated ')
    expect(html).toContain('Refresh')
    expect(html).not.toContain("Couldn't reach")
  })

  it('says when Match 13 has not rated a team, and still shows its record', () => {
    ratingsStore.set(saved({
      ratings: [rating(4096)],
      rankings: [{ rank: 3, team_key: 'frc1234', record: { wins: 1, losses: 1, ties: 0 }, matches_played: 2, extra_stats: [3] }],
    }))
    const html = draw(1234)
    expect(html).toContain('No Match 13 rating yet')
    expect(html).toContain('1-1-0')
    expect(html).not.toContain('Rank ')
  })

  it("shows the saved numbers, and says so, when it can't reach Match 13", () => {
    ratingsStore.set(saved({ ratings: [rating(4096)], error: 'No connection.' }))
    const html = draw(4096)
    expect(html).toContain("Couldn&#x27;t reach Match 13. Showing numbers from ")
    expect(html).toContain('Rank 1 of 1')
  })

  it("says to try again when it can't reach Match 13 and nothing is saved", () => {
    ratingsStore.set(saved({ loadedAt: null, error: 'No connection.' }))
    expect(draw(4096)).toContain('Couldn&#x27;t reach Match 13 and nothing is saved on this phone yet. Try again with a connection.')
  })

  it('says "not given" for a part Match 13 left out', () => {
    ratingsStore.set(saved({ ratings: [rating(4096, { xAuto: null, epa: null })] }))
    const html = draw(4096)
    expect(html.match(/not given/g)).toHaveLength(3) // Auto, EPA, and the record (no rankings saved)
  })
})
