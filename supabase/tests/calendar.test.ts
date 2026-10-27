// Tests for what the calendar server function asks Google Calendar, and how
// it reads the answers (supabase/functions/calendar/calendar.ts). The key
// below is made up in the test; Google's answers are cut down to what we read.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  CALENDAR_API,
  CALENDAR_SCOPE,
  calendarProblem,
  calendarRequest,
  createCalendar,
  eventInput,
  fromGoogle,
  GOOGLE_TOKEN_URL,
  isAppEvent,
  parseServiceAccount,
  paths,
  signedAssertion,
  toGoogle,
  type ServiceAccount,
} from '../functions/calendar/calendar.ts'

let account: ServiceAccount
let publicKey: CryptoKey

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const body = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n')
  account = { email: 'team-app@example-project.iam.gserviceaccount.com', privateKey: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n` }
  publicKey = pair.publicKey
})

const fromBase64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')), (c) => c.charCodeAt(0))

describe('parseServiceAccount', () => {
  it('reads the key file Google gives you, as is or in base64', () => {
    const file = JSON.stringify({ type: 'service_account', client_email: account.email, private_key: account.privateKey, project_id: 'x' })
    expect(parseServiceAccount(file)).toEqual(account)
    expect(parseServiceAccount(`  ${file}\n`)).toEqual(account)
    expect(parseServiceAccount(btoa(file))).toEqual(account)
  })

  it("is null for anything that isn't one", () => {
    expect(parseServiceAccount('')).toBeNull()
    expect(parseServiceAccount('AIzaSyExampleApiKey')).toBeNull()
    expect(parseServiceAccount('{"client_email":"a@b.c"}')).toBeNull()
  })
})

describe('signedAssertion', () => {
  it("asks for calendar events only, signed with the service account's key", async () => {
    const jwt = await signedAssertion(account, Date.parse('2026-11-03T12:00:00Z'))
    const [header, claims, signature] = jwt.split('.')
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(header)))).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(claims)))).toEqual({
      iss: account.email, scope: CALENDAR_SCOPE, aud: GOOGLE_TOKEN_URL, iat: 1793707200, exp: 1793710800,
    })
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, fromBase64url(signature), new TextEncoder().encode(`${header}.${claims}`))
    expect(valid).toBe(true)
  })

  it('reads a key whose line breaks were pasted as \\n', async () => {
    const flattened = { ...account, privateKey: account.privateKey.replace(/\n/g, '\\n') }
    await expect(signedAssertion(flattened, 0)).resolves.toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)
  })
})

describe('calendarRequest', () => {
  const now = Date.parse('2026-11-03T12:00:00Z')
  const meeting = { title: ' Parent meeting ', start: '2026-11-05T19:00:00-06:00', end: '2026-11-05T20:00:00-06:00' }

  it('lets anyone check and see events, the next 60 days unless asked', () => {
    expect(calendarRequest({ kind: 'check' }, 'student')).toEqual({ kind: 'check' })
    expect(calendarRequest({ kind: 'events' }, 'student', now)).toEqual({ kind: 'events', from: '2026-11-03T12:00:00.000Z', to: '2027-01-02T12:00:00.000Z' })
    expect(calendarRequest({ kind: 'events', from: '2026-11-01', to: '2026-12-01' }, 'student')).toMatchObject({ from: '2026-11-01T00:00:00.000Z' })
  })

  it('refuses odd ranges', () => {
    expect(calendarRequest({ kind: 'events', from: 'soon' }, 'student')).toMatchObject({ status: 400 })
    expect(calendarRequest({ kind: 'events', from: '2026-12-01', to: '2026-11-01' }, 'student')).toMatchObject({ error: 'to should be after from.' })
    expect(calendarRequest({ kind: 'events', from: '2026-01-01', to: '2028-01-01' }, 'student')).toMatchObject({ error: expect.stringMatching(/a year/) })
  })

  it('lets mentors add, change and remove', () => {
    expect(calendarRequest({ kind: 'add', event: meeting }, 'mentor')).toEqual({
      kind: 'add', event: { title: 'Parent meeting', start: meeting.start, end: meeting.end, allDay: false, location: null, description: null },
    })
    expect(calendarRequest({ kind: 'change', id: 'abc123_20261105', event: meeting }, 'admin')).toMatchObject({ kind: 'change', id: 'abc123_20261105' })
    expect(calendarRequest({ kind: 'remove', id: 'abc123' }, 'mentor')).toEqual({ kind: 'remove', id: 'abc123' })
  })

  it("doesn't let students change the calendar", () => {
    expect(calendarRequest({ kind: 'add', event: meeting }, 'student')).toEqual({ error: 'Only mentors can change the team calendar.', status: 403 })
    expect(calendarRequest({ kind: 'remove', id: 'abc123' }, 'student')).toMatchObject({ status: 403 })
  })

  it('refuses anything else', () => {
    expect(calendarRequest({ kind: 'share' }, 'admin')).toMatchObject({ status: 400 })
    expect(calendarRequest({ kind: 'remove', id: '../acl' }, 'admin')).toEqual({ error: "That isn't an event ID.", status: 400 })
  })
})

describe('eventInput', () => {
  const base = { title: 'Kickoff', start: '2027-01-09T10:00:00-06:00', end: '2027-01-09T14:00:00-06:00' }
  it('checks titles, times and days', () => {
    expect(eventInput({ ...base, title: '' })).toEqual({ error: 'Give the event a title.' })
    expect(eventInput({ ...base, start: '2027-01-09 10:00' })).toMatchObject({ error: expect.stringMatching(/time zone/) })
    expect(eventInput({ ...base, end: base.start })).toEqual({ error: 'The event ends before it starts.' })
    expect(eventInput({ ...base, end: '2027-03-01T10:00:00-06:00' })).toEqual({ error: 'Keep events to a month or less.' })
    expect(eventInput({ ...base, allDay: true, start: '2027-01-09', end: '2027-01-09' })).toMatchObject({ allDay: true })
    expect(eventInput({ ...base, allDay: true, start: '2027-02-30', end: '2027-03-01' })).toMatchObject({ error: expect.stringMatching(/first and last days/) })
    expect(eventInput({ ...base, title: 'x'.repeat(201) })).toMatchObject({ error: expect.stringMatching(/under 200/) })
  })
})

describe('toGoogle and fromGoogle', () => {
  it("marks the app's events, and gives Google the day after an all-day event's last day", () => {
    const google = toGoogle({ title: 'Regional', start: '2027-03-12', end: '2027-03-14', allDay: true, location: null, description: null })
    expect(google).toMatchObject({ summary: 'Regional', start: { date: '2027-03-12' }, end: { date: '2027-03-15' } })
    expect(isAppEvent(google)).toBe(true)
    expect(fromGoogle({ ...google, id: 'x1', htmlLink: 'https://calendar.google.com/event?eid=x1' })).toEqual({
      id: 'x1', title: 'Regional', start: '2027-03-12', end: '2027-03-14', allDay: true, location: null, description: null,
      url: 'https://calendar.google.com/event?eid=x1', fromApp: true,
    })
  })

  it('reads timed events people made in Google Calendar, and skips cancelled ones', () => {
    const item = { id: 'g1', summary: 'Build session', location: 'The shop', start: { dateTime: '2026-11-03T18:00:00-06:00' }, end: { dateTime: '2026-11-03T21:00:00-06:00' } }
    expect(fromGoogle(item)).toMatchObject({ title: 'Build session', start: item.start.dateTime, end: item.end.dateTime, allDay: false, location: 'The shop', fromApp: false })
    expect(fromGoogle({ ...item, summary: undefined })?.title).toBe('(No title)')
    expect(fromGoogle({ ...item, status: 'cancelled' })).toBeNull()
  })

  it('asks for repeating events one by one, in order', () => {
    const query = new URLSearchParams(paths.events('2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z').slice(1))
    expect(Object.fromEntries(query)).toEqual({ timeMin: '2026-11-01T00:00:00.000Z', timeMax: '2026-12-01T00:00:00.000Z', singleEvents: 'true', orderBy: 'startTime', maxResults: '250' })
    expect(paths.event('a/b')).toBe('/a%2Fb')
  })
})

describe('createCalendar', () => {
  const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status })
  const tokenAnswer = () => json(200, { access_token: 'ya29.test', expires_in: 3600 })

  it("signs in as the service account, then asks the team calendar", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(tokenAnswer()).mockResolvedValueOnce(json(200, { summary: 'Ctrl-Z', accessRole: 'writer', items: [] }))
    const calendar = createCalendar(account, 'team@group.calendar.google.com', { fetch, now: () => Date.parse('2026-11-03T12:00:00Z') })
    expect(await calendar('GET', paths.check(0))).toEqual({ ok: true, data: { summary: 'Ctrl-Z', accessRole: 'writer', items: [] } })

    const [tokenUrl, tokenInit] = fetch.mock.calls[0]
    expect(tokenUrl).toBe(GOOGLE_TOKEN_URL)
    expect(new URLSearchParams(tokenInit.body).get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    const [url, init] = fetch.mock.calls[1]
    expect(url).toBe(`${CALENDAR_API}/calendars/team%40group.calendar.google.com/events${paths.check(0)}`)
    expect(init.headers.Authorization).toBe('Bearer ya29.test')
  })

  it('keeps the access token until it nearly runs out', async () => {
    let time = 0
    const fetch = vi.fn(async (url: URL | RequestInfo) => (url === GOOGLE_TOKEN_URL ? tokenAnswer() : json(200, { items: [] })))
    const calendar = createCalendar(account, 'c', { fetch, now: () => time })
    await calendar('GET', '')
    time = 30 * 60 * 1000
    await calendar('GET', '')
    expect(fetch.mock.calls.filter(([url]) => url === GOOGLE_TOKEN_URL)).toHaveLength(1)
    time = 59.5 * 60 * 1000
    await calendar('GET', '')
    expect(fetch.mock.calls.filter(([url]) => url === GOOGLE_TOKEN_URL)).toHaveLength(2)
  })

  it('sends new events as JSON, and reads an empty answer to a removal', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(tokenAnswer()).mockResolvedValueOnce(json(200, { id: 'n1' })).mockResolvedValueOnce(new Response(null, { status: 204 }))
    const calendar = createCalendar(account, 'c', { fetch })
    expect(await calendar('POST', '', { summary: 'x' })).toEqual({ ok: true, data: { id: 'n1' } })
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{"summary":"x"}', headers: { 'Content-Type': 'application/json' } })
    expect(await calendar('DELETE', paths.event('n1'))).toEqual({ ok: true, data: null })
  })

  it('says what to fix when Google turns down the key', async () => {
    const fetch = vi.fn(async () => json(400, { error: 'invalid_grant' }))
    expect(await createCalendar(account, 'c', { fetch })('GET', '')).toMatchObject({ ok: false, error: expect.stringMatching(/make a new key/) })
    const broken = createCalendar({ ...account, privateKey: '-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----' }, 'c', { fetch })
    expect(await broken('GET', '')).toMatchObject({ ok: false, error: expect.stringMatching(/GOOGLE_SERVICE_ACCOUNT_KEY/) })
  })

  it("passes on Google's problems, explained", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(tokenAnswer()).mockResolvedValueOnce(json(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } }))
    expect(await createCalendar(account, 'c', { fetch })('GET', '')).toEqual({ ok: false, status: 404, error: calendarProblem(404, null) })
  })
})

describe('calendarProblem', () => {
  it('says what a mentor should fix', () => {
    expect(calendarProblem(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } })).toMatch(/Calendar API is switched off/)
    expect(calendarProblem(403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } })).toMatch(/Calendar API is switched off/)
    expect(calendarProblem(403, { error: { errors: [{ reason: 'requiredAccessLevel' }] } })).toMatch(/Make changes to events/)
    expect(calendarProblem(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } })).toMatch(/slow down/)
    expect(calendarProblem(404, null)).toMatch(/GOOGLE_CALENDAR_ID/)
    expect(calendarProblem(500, null)).toBe('Google Calendar had a problem (500). Try again in a minute.')
  })
})
