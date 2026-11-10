// Tests for the match form. The form's choices come from season.ts, so a
// new role there should show up on the form with no other change.
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import ScoutingPage from './ScoutingPage'
import Schedule from './Schedule'
import { AUTO_SIDES, DRIVETRAINS, ROLES } from './season'

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
