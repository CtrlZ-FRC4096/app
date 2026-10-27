// Tests for the Slack client (supabase/functions/_shared/slack.ts), which
// the slack server function and the scheduled reminders both send with, and
// for what the slack function allows (supabase/functions/slack/slack.ts).
import { describe, expect, it, vi } from 'vitest'
import { createSlack, SLACK_API, slackProblem } from '../functions/_shared/slack.ts'
import { MAX_PEOPLE, MAX_TEXT, slackRequest, testMessage } from '../functions/slack/slack.ts'

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('createSlack', () => {
  it('sends a message with the bot token, without link previews', async () => {
    const fetch = vi.fn(async () => answer(200, { ok: true, ts: '1.2' }))
    const slack = createSlack('xoxb-test', { fetch })
    expect(await slack.send({ to: 'U0ABC1234', text: 'Hi' })).toEqual({ ok: true, data: { ok: true, ts: '1.2' } })
    expect(fetch).toHaveBeenCalledWith(`${SLACK_API}/chat.postMessage`, {
      method: 'POST',
      headers: { Authorization: 'Bearer xoxb-test', 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: 'U0ABC1234', text: 'Hi', unfurl_links: false, unfurl_media: false }),
    })
  })

  it('waits and tries again when Slack asks us to slow down', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer(429, null, { 'retry-after': '2' })).mockResolvedValueOnce(answer(200, { ok: true }))
    const sleep = vi.fn(async () => {})
    expect(await createSlack('t', { fetch, sleep }).call('auth.test')).toMatchObject({ ok: true })
    expect(sleep).toHaveBeenCalledWith(2000)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('gives up after a few tries', async () => {
    const fetch = vi.fn(async () => answer(429, null))
    expect(await createSlack('t', { fetch, sleep: async () => {} }).call('auth.test')).toEqual({ ok: false, error: slackProblem('ratelimited') })
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('explains what Slack turned down', async () => {
    const slack = (body: unknown) => createSlack('t', { fetch: async () => answer(200, body) })
    expect(await slack({ ok: false, error: 'missing_scope', needed: 'chat:write' }).send({ to: 'U0ABC1234', text: 'x' })).toEqual({
      ok: false,
      error: 'The Slack app needs the chat:write permission. A mentor adds it under OAuth & Permissions, then reinstalls the app: see supabase/README.md.',
    })
    expect(await slack({ ok: false, error: 'invalid_auth' }).call('auth.test')).toMatchObject({ error: expect.stringMatching(/SLACK_BOT_TOKEN/) })
    expect(await slack({ ok: false, error: 'not_in_channel' }).call('chat.postMessage')).toMatchObject({ error: expect.stringMatching(/\/invite/) })
    expect(await slack({ ok: false, error: 'something_new' }).call('auth.test')).toMatchObject({ error: 'Slack had a problem (something_new). Try again in a minute.' })
  })

  it("says so when Slack can't be reached", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('network')
    })
    expect(await createSlack('t', { fetch }).call('auth.test')).toEqual({ ok: false, error: "Couldn't reach Slack. Try again in a minute." })
  })
})

describe('slackRequest', () => {
  const PERSON = '00000000-0000-4000-8000-000000000001'
  const send = (more: object) => ({ kind: 'send', people: [PERSON], text: 'Hi', ...more })

  it('lets anyone check, and mentors send to people and a channel', () => {
    expect(slackRequest({ kind: 'check' }, 'student')).toEqual({ kind: 'check' })
    expect(slackRequest(send({ channel: 'C0ABC1234', text: '  Hi  ' }), 'mentor')).toEqual({ kind: 'send', people: [PERSON], channel: 'C0ABC1234', text: 'Hi' })
    expect(slackRequest(send({ people: [PERSON, PERSON] }), 'admin')).toMatchObject({ people: [PERSON] })
  })

  it('lets anyone message themselves', () => {
    expect(slackRequest({ kind: 'me', text: ' Hi ' }, 'student')).toEqual({ kind: 'me', text: 'Hi' })
    expect(slackRequest({ kind: 'me', text: '' }, 'student')).toEqual({ error: 'Write the message first.', status: 400 })
    expect(slackRequest({ kind: 'me', text: 'x'.repeat(MAX_TEXT + 1) }, 'student')).toMatchObject({ status: 400 })
  })

  it("doesn't let students send to others", () => {
    expect(slackRequest(send({}), 'student')).toEqual({ error: 'Only mentors can send Slack messages from the app.', status: 403 })
  })

  it('refuses anything else', () => {
    expect(slackRequest({ kind: 'history' }, 'admin')).toMatchObject({ status: 400 })
    expect(slackRequest(null, 'admin')).toMatchObject({ status: 400 })
    expect(slackRequest(send({ people: ['U0ABC1234'] }), 'mentor')).toMatchObject({ error: 'people should be a list of member IDs.' })
    expect(slackRequest(send({ people: [], channel: 'U0ABC1234' }), 'mentor')).toMatchObject({ error: expect.stringMatching(/channel ID/) })
    expect(slackRequest(send({ people: [] }), 'mentor')).toMatchObject({ error: expect.stringMatching(/who to send it to/) })
    expect(slackRequest(send({ text: '   ' }), 'mentor')).toMatchObject({ error: 'Write the message first.' })
    expect(slackRequest(send({ text: 'x'.repeat(MAX_TEXT + 1) }), 'mentor')).toMatchObject({ error: expect.stringMatching(/under 3000/) })
    const many = Array.from({ length: MAX_PEOPLE + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect(slackRequest(send({ people: many }), 'mentor')).toMatchObject({ error: expect.stringMatching(/100 people or fewer/) })
  })

  it('says hi in the test message', () => {
    expect(testMessage('Pat Chen')).toMatch(/^Hi Pat Chen! This is a test message from the team app/)
  })
})
