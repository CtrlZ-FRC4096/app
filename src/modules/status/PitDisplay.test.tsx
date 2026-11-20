// Tests for the pit display (#161), drawn with the example data from demo
// mode. A page drawn with renderToString doesn't load anything by itself,
// so each test saves what it needs first, as the open page would.
import { beforeEach, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { eventTeamsStore, loadEventTeams, loadRatings, rankingsStore, refreshRankings, refreshSchedule, resetRatings, scheduleStore } from '../scouting/data'
import { checksTable, itemsTable } from './data'
import { PitDisplay } from './PitDisplay'

beforeEach(() => {
  scheduleStore.reset()
  rankingsStore.reset()
  eventTeamsStore.reset()
  resetRatings()
  itemsTable.reset()
  checksTable.reset()
})

describe('the pit display', () => {
  it('shows our next match, both alliances and how we are doing, and none of Match 13’s predictions', async () => {
    await Promise.all([refreshSchedule(), refreshRankings(), loadRatings(), loadEventTeams()])
    // The example schedule is saved with Match 13's predictions, as on the live site.
    expect(scheduleStore.get()?.predictions.length).toBeGreaterThan(0)
    const html = renderToString(<PitDisplay />)
    // Our next example match is Qual 3, on blue with 9993 (Demo Dynamics) and 9991. Two of its six checklist items are checked.
    for (const text of ['Qual 3', 'Blue', 'Up next', 'Queue now', 'Demo Dynamics', '48.6 xP', 'Rank 3 of 6 · 1-1-0', 'Last: Qual 2 · Lost 66–90', 'Qual 4', '4 of 6 checklist items left']) {
      expect(html).toContain(text)
    }
    expect(html).not.toMatch(/\d%|predict|likely|toss-up/i)
  })

  it('says it is getting the schedule when nothing is saved, with no Full screen button where the browser has none', () => {
    const html = renderToString(<PitDisplay />)
    expect(html).toContain('Getting the schedule')
    expect(html).not.toContain('Full screen')
  })
})
