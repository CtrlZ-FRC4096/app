// Tests for the match form. The form's choices come from season.ts, so a
// new role there should show up on the form with no other change.
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { POSITIONS } from './data'
import ScoutingPage from './ScoutingPage'
import { AUTO_SIDES, DRIVETRAINS, ROLES } from './season'

describe('the Match / Pit switch', () => {
  it('starts on the match form, with the pit form hidden', () => {
    const html = renderToString(<ScoutingPage />)
    expect(html).toContain('aria-pressed="true">Match</button>')
    expect(html).toMatch(/<div hidden="">.*Pit form/)
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
