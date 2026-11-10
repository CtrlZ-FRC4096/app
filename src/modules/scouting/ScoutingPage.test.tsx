// Tests for the match form. The form's choices come from season.ts, so a
// new role there should show up on the form with no other change.
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import PitForm from './PitForm'
import ScoutingPage from './ScoutingPage'
import { AUTO_SIDES, DRIVETRAINS, ROLES } from './season'

describe('the Scouting page', () => {
  it('opens on the match form, with a Match / Pit switch', () => {
    const html = renderToString(<ScoutingPage />)
    expect(html).toContain('aria-pressed="true">Match</button>')
    expect(html).toContain('aria-pressed="false">Pit</button>')
    expect(html).toContain('Driver skill')
  })
})

describe('the pit form', () => {
  it('has a button for every drivetrain and auto side in season.ts, none chosen at the start', () => {
    const html = renderToString(<PitForm />)
    for (const option of [...DRIVETRAINS, ...AUTO_SIDES]) expect(html).toContain(`aria-pressed="false">${option}</button>`)
  })

  it('asks for everything in the issue', () => {
    const html = renderToString(<PitForm />)
    for (const label of ['Team number', 'Weight (lb)', 'Length (in)', 'Width (in)', 'Height (in)', 'Motors', 'Path', 'What do they want their partners to do?', 'What will they do?']) {
      expect(html).toContain(label)
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
