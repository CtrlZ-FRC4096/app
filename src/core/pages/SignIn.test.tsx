// Tests for the sign-in page's steps for shared computers. They run in demo
// mode, where Switch user only opens the steps (there's no Slack to sign out of).
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { switchUser } from '../session'
import { SignIn } from './SignIn'

/** Whether the shared-computer steps are open, from the page's HTML. */
const stepsOpen = () => /<details open/.test(renderToString(<SignIn error={null} />))

describe('the sign-in page', () => {
  it('shows how to sign out of Slack on a shared computer, open straight after Switch user', async () => {
    const html = renderToString(<SignIn error={null} />)
    expect(html).toContain('Someone else used Slack on this computer?')
    expect(html).toContain('https://app.slack.com/')
    expect(stepsOpen()).toBe(false)
    await switchUser()
    expect(stepsOpen()).toBe(true)
  })
})
