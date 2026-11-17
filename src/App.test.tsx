import { afterAll, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MenuEntry } from './App'
import { modules } from './modules'
import { demoUserId, setDemoRole } from './core/demo'
import { resetAllStores } from './core/store'
import type { Role } from './core/session'
import { addStrategyMember } from './modules/scouting/data'

afterAll(() => {
  resetAllStores()
  setDemoRole('student')
})

/** Where tapping Scouting's name in the Competition menu goes, for whoever is signed in. */
function scoutingLink(): string | undefined {
  const scouting = modules.find((m) => m.id === 'scouting')!
  const html = renderToString(<MenuEntry module={scouting} id="" subpage="" pagesOpen={false} onTogglePages={() => {}} />)
  // The link with the module's name on it, not the ones in its list of pages.
  return html.match(/href="([^"]*)"><span class="menu-item-name">Scouting</)?.[1]
}

describe('a module with pages in the menu', () => {
  it("opens the first page the person can see: Scouting's Overview for the strategy team, Match for other students", async () => {
    const expected: Record<Role, string> = {
      student: '#/scouting/match',
      leader: '#/scouting',
      mentor: '#/scouting',
      admin: '#/scouting',
    }
    for (const [role, link] of Object.entries(expected)) {
      setDemoRole(role as Role)
      expect(scoutingLink(), `as a ${role}`).toBe(link)
    }

    setDemoRole('mentor')
    await addStrategyMember(demoUserId('student'))
    setDemoRole('student')
    expect(scoutingLink(), 'as a student on the strategy team').toBe('#/scouting')
  })
})
