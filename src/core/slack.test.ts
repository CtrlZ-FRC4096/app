// Tests for Slack messages from the app (slack.ts), in demo mode.
import { afterEach, describe, expect, it } from 'vitest'
import { DEMO_PEOPLE, setDemoRole } from './demo'
import { APP_ADDRESS, appLink, checkSlackMessage, MAX_SLACK_TEXT, sendSlack, sendSlackToMe, slackEscape, slackLink } from './slack'

afterEach(() => setDemoRole('student'))

describe('message text', () => {
  it('shows what people typed as typed', () => {
    expect(slackEscape('Plates <v2> & spacers')).toBe('Plates &lt;v2&gt; &amp; spacers')
    expect(slackEscape('<!channel>')).toBe('&lt;!channel&gt;')
  })

  it('makes links', () => {
    expect(slackLink('https://example.com/a', 'Open <it>')).toBe('<https://example.com/a|Open &lt;it&gt;>')
    expect(slackLink('https://example.com/a|b', 'x')).toBe('<https://example.com/a%7Cb|x>')
    expect(appLink('bom', 'Open the BOM')).toBe(`<${APP_ADDRESS}#/bom|Open the BOM>`)
  })
})

describe('checkSlackMessage', () => {
  it('needs a Slack ID and some text', () => {
    expect(checkSlackMessage({ to: 'U0ABC1234', text: 'Hi' })).toBeNull()
    expect(checkSlackMessage({ to: 'C0ABC1234', text: 'Hi' })).toBeNull()
    expect(checkSlackMessage({ to: 'Alex Rivera', text: 'Hi' })).toMatch(/isn't a Slack user ID/)
    expect(checkSlackMessage({ to: 'U0ABC1234', text: '  ' })).toBe('A message is empty.')
    expect(checkSlackMessage({ to: 'U0ABC1234', text: 'x'.repeat(MAX_SLACK_TEXT + 1) })).toMatch(/Keep it under 3000/)
  })
})

describe('sendSlackToMe', () => {
  it('lets anyone message themselves (in demo mode nothing is sent)', async () => {
    expect(await sendSlackToMe('  Hi  ')).toEqual({ ok: true, value: { sent: 1, failed: [] } })
  })

  it('needs some text, not too much', async () => {
    expect(await sendSlackToMe(' ')).toEqual({ ok: false, error: 'Write the message first.' })
    expect(await sendSlackToMe('x'.repeat(MAX_SLACK_TEXT + 1))).toMatchObject({ ok: false, error: expect.stringMatching(/under 3000/) })
  })
})

describe('sendSlack', () => {
  it('lets mentors send to people and a channel (in demo mode nothing is sent)', async () => {
    setDemoRole('mentor')
    expect(await sendSlack({ people: [DEMO_PEOPLE.alex, DEMO_PEOPLE.alex, DEMO_PEOPLE.jordan], channel: 'C0ABC1234', text: 'Hi' })).toEqual({
      ok: true,
      value: { sent: 3, failed: [] },
    })
  })

  it("doesn't let students send", async () => {
    expect(await sendSlack({ people: [DEMO_PEOPLE.pat], text: 'Hi' })).toEqual({ ok: false, error: 'Only mentors can send Slack messages from the app.' })
  })

  it('explains what to fix', async () => {
    setDemoRole('admin')
    expect(await sendSlack({ text: 'Hi' })).toMatchObject({ ok: false, error: expect.stringMatching(/who to send it to/) })
    expect(await sendSlack({ channel: '#build', text: 'Hi' })).toMatchObject({ ok: false, error: expect.stringMatching(/isn't a channel ID/) })
    expect(await sendSlack({ channel: 'C0ABC1234', text: ' ' })).toEqual({ ok: false, error: 'Write the message first.' })
  })
})
