// Tests for the Notifications page's "What to notify me about" section. It
// runs in demo mode: Alex (the student) hasn't chosen anything, and Morgan
// (the admin) switched off Purchasing -> My requests.
import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { setDemoRole } from '../demo'
import type { Role } from '../session'
import { Notifications } from './Notifications'

afterEach(() => setDemoRole('student'))

/** The page as someone sees it, as text with the tags removed. */
function page(role: Role) {
  setDemoRole(role)
  return renderToString(<Notifications />)
}

/** Whether the My requests switch is on, from the page's HTML. */
const myRequestsOn = (html: string) => /<input[^>]*checked[^>]*>(?:(?!<input).)*My requests/.test(html)

describe('what to notify me about', () => {
  it("shows a switch for each kind, under its module's name, with your choice or the default", () => {
    const cases: [Role, boolean][] = [
      ['student', true],
      ['admin', false],
    ]
    for (const [role, on] of cases) {
      const html = page(role)
      expect(html, role).toContain('What to notify me about')
      expect(html, role).toContain('Purchasing')
      expect(html, role).toContain('When something you asked for is ordered or arrives.')
      expect(myRequestsOn(html), role).toBe(on)
    }
  })
})
