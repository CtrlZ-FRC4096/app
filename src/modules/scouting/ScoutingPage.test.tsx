// Tests for the match form. The form's choices come from season.ts, so a
// new role there should show up on the form with no other change.
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import ScoutingPage from './ScoutingPage'
import { ROLES } from './season'

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
