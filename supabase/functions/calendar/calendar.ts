/**
 * What the `calendar` server function asks Google Calendar, and how it
 * reads the answers. Kept apart from index.ts so supabase/tests can test
 * it: plain TypeScript, no Deno.
 *
 * It works with one calendar, the team's (the GOOGLE_CALENDAR_ID secret),
 * through a Google service account: a robot Google account the calendar is
 * shared with, whose key is the GOOGLE_SERVICE_ACCOUNT_KEY secret. The app
 * can:
 *
 *   - check: which calendar it is, and whether the app may add events
 *   - events: the events between two times (anyone on the team)
 *   - add, change, remove: mentors only. The app only changes and removes
 *     events it added itself, so it can't wreck ones people made in
 *     Google Calendar.
 */

export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
/** Only events: not the calendar's settings or who it's shared with. */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
export const TEAM_TIME_ZONE = 'America/Chicago'

/** The mark (a private extended property) on events the app adds, so it knows they're its own. */
const APP_MARK = 'teamApp'

/** One event, as the app sees it. The same shape is in src/core/calendar.ts. */
export interface CalendarEvent {
  id: string
  title: string
  /** When it starts: a time like 2026-11-03T18:00:00-06:00, or a day like 2026-11-03 for an all-day event. */
  start: string
  /** When it ends. For an all-day event, its last day: a one-day event starts and ends on the same day. */
  end: string
  allDay: boolean
  location: string | null
  description: string | null
  /** Opens it in Google Calendar. */
  url: string | null
  /** Added by the app, so the app can change or remove it. */
  fromApp: boolean
}

/** A new or changed event, from the app. */
export interface EventInput {
  title: string
  /** A time with its time zone, like 2026-11-03T18:00:00-06:00, or for an all-day event a day like 2026-11-03. */
  start: string
  /** For an all-day event, its last day. */
  end: string
  allDay: boolean
  location: string | null
  description: string | null
}

export type CalendarRequest =
  | { kind: 'check' }
  | { kind: 'events'; from: string; to: string }
  | { kind: 'add'; event: EventInput }
  | { kind: 'change'; id: string; event: EventInput }
  | { kind: 'remove'; id: string }

/** The longest each part of an event can be. src/core/calendar.ts allows the same. */
export const LIMITS = { title: 200, location: 300, description: 4000 }

const DAY_MS = 24 * 60 * 60 * 1000
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
const EVENT_ID = /^[A-Za-z0-9_-]{1,1024}$/

/** A real day like 2026-11-03 (not 2026-02-30). */
function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
}
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

/** A new or changed event, checked, or what's wrong with it. */
export function eventInput(value: unknown): EventInput | { error: string } {
  const e = (value ?? {}) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const title = text(e.title)
  const location = text(e.location) || null
  const description = text(e.description) || null
  const start = text(e.start)
  const end = text(e.end)
  const allDay = e.allDay === true

  if (!title) return { error: 'Give the event a title.' }
  if (title.length > LIMITS.title) return { error: `Keep the title under ${LIMITS.title} characters.` }
  if (location && location.length > LIMITS.location) return { error: `Keep the location under ${LIMITS.location} characters.` }
  if (description && description.length > LIMITS.description) return { error: `Keep the description under ${LIMITS.description} characters.` }
  if (allDay) {
    if (!isDay(start) || !isDay(end)) return { error: 'An all-day event needs its first and last days, like 2026-11-03.' }
    if (end < start) return { error: 'The last day is before the first.' }
    if (Date.parse(end) - Date.parse(start) > 31 * DAY_MS) return { error: 'Keep events to a month or less.' }
  } else {
    if (!TIME.test(start) || !TIME.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
      return { error: 'Give the start and end as times with a time zone, like 2026-11-03T18:00:00-06:00.' }
    }
    if (Date.parse(end) <= Date.parse(start)) return { error: 'The event ends before it starts.' }
    if (Date.parse(end) - Date.parse(start) > 31 * DAY_MS) return { error: 'Keep events to a month or less.' }
  }
  return { title, start, end, allDay, location, description }
}

/** What the app asked for, or why it isn't allowed. */
export function calendarRequest(body: unknown, role: string, now = Date.now()): CalendarRequest | { error: string; status: number } {
  const r = (body ?? {}) as Record<string, unknown>
  if (r.kind === 'check') return { kind: 'check' }
  if (r.kind === 'events') {
    const from = r.from == null ? now : Date.parse(String(r.from))
    const to = r.to == null ? from + 60 * DAY_MS : Date.parse(String(r.to))
    if (Number.isNaN(from) || Number.isNaN(to)) return { error: 'from and to should be times, like 2026-11-03T00:00:00Z.', status: 400 }
    if (to <= from) return { error: 'to should be after from.', status: 400 }
    if (to - from > 366 * DAY_MS) return { error: 'Ask for a year of events or less at once.', status: 400 }
    return { kind: 'events', from: new Date(from).toISOString(), to: new Date(to).toISOString() }
  }
  if (r.kind !== 'add' && r.kind !== 'change' && r.kind !== 'remove') {
    return { error: 'Ask for events, to add, change or remove one, or to check.', status: 400 }
  }
  if (role !== 'mentor' && role !== 'admin') return { error: 'Only mentors can change the team calendar.', status: 403 }
  if (r.kind !== 'add' && !(typeof r.id === 'string' && EVENT_ID.test(r.id))) return { error: "That isn't an event ID.", status: 400 }
  if (r.kind === 'remove') return { kind: 'remove', id: r.id as string }
  const event = eventInput(r.event)
  if ('error' in event) return { error: event.error, status: 400 }
  return r.kind === 'add' ? { kind: 'add', event } : { kind: 'change', id: r.id as string, event }
}

/** An event in Google Calendar's shape, cut down to what the app reads. */
export interface GoogleEvent {
  id?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  start?: { date?: string; dateTime?: string; timeZone?: string }
  end?: { date?: string; dateTime?: string; timeZone?: string }
  extendedProperties?: { private?: Record<string, string> }
}

/** The event as Google Calendar wants it, marked as the app's. Google's all-day end is the day after the last. */
export function toGoogle(event: EventInput): GoogleEvent & Record<string, unknown> {
  return {
    summary: event.title,
    location: event.location ?? '',
    description: event.description ?? '',
    start: event.allDay ? { date: event.start } : { dateTime: event.start, timeZone: TEAM_TIME_ZONE },
    end: event.allDay ? { date: addDays(event.end, 1) } : { dateTime: event.end, timeZone: TEAM_TIME_ZONE },
    extendedProperties: { private: { [APP_MARK]: 'yes' } },
  }
}

/** Did the app add this event? */
export function isAppEvent(item: GoogleEvent): boolean {
  return item.extendedProperties?.private?.[APP_MARK] === 'yes'
}

/** An event from Google Calendar, for the app, or null if it was cancelled. */
export function fromGoogle(item: GoogleEvent): CalendarEvent | null {
  const start = item.start?.dateTime ?? item.start?.date
  if (!item.id || !start || item.status === 'cancelled') return null
  const allDay = !item.start?.dateTime
  const lastDay = item.end?.date ? addDays(item.end.date, -1) : start
  return {
    id: item.id,
    title: item.summary?.trim() || '(No title)',
    start,
    end: allDay ? (lastDay < start ? start : lastDay) : (item.end?.dateTime ?? start),
    allDay,
    location: item.location?.trim() || null,
    description: item.description?.trim() || null,
    url: item.htmlLink ?? null,
    fromApp: isAppEvent(item),
  }
}

/** Where on the team calendar to ask, after .../calendars/<id>/events. */
export const paths = {
  /** One event from now on: enough to see the calendar's name and what the app may do. */
  check: (now: number) => `?${new URLSearchParams({ maxResults: '1', singleEvents: 'true', timeMin: new Date(now).toISOString() })}`,
  /** Events between two times, with repeating ones as separate events, in order. */
  events: (from: string, to: string, pageToken?: string) =>
    `?${new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(pageToken ? { pageToken } : {}) })}`,
  event: (id: string) => `/${encodeURIComponent(id)}`,
}

// ---------------------------------------------------------------------------
// Signing in as the service account, and asking Google.

export interface ServiceAccount {
  /** Like team-app@your-project.iam.gserviceaccount.com: share the calendar with this. */
  email: string
  privateKey: string
}

/** The service account in the GOOGLE_SERVICE_ACCOUNT_KEY secret: the key file from Google Cloud, as is (or base64), or null if it isn't one. */
export function parseServiceAccount(secret: string): ServiceAccount | null {
  let text = secret.trim()
  if (!text) return null
  if (!text.startsWith('{')) {
    try {
      text = atob(text)
    } catch {
      return null
    }
  }
  try {
    const key = JSON.parse(text) as { client_email?: unknown; private_key?: unknown }
    if (typeof key.client_email === 'string' && typeof key.private_key === 'string' && key.private_key.includes('PRIVATE KEY')) {
      return { email: key.client_email, privateKey: key.private_key }
    }
  } catch {
    // Not JSON.
  }
  return null
}

const utf8 = (text: string) => new TextEncoder().encode(text)
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * A signed request for an access token (a JWT, signed with the service
 * account's private key), the way Google's service accounts sign in.
 */
export async function signedAssertion(account: ServiceAccount, now: number): Promise<string> {
  const iat = Math.floor(now / 1000)
  const header = base64url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claims = base64url(utf8(JSON.stringify({ iss: account.email, scope: CALENDAR_SCOPE, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 })))
  const pem = account.privateKey.replace(/\\n/g, '\n').replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(`${header}.${claims}`)))
  return `${header}.${claims}.${base64url(signature)}`
}

/** What a Google Calendar error means, and what to do about it. */
export function calendarProblem(status: number, body: unknown): string {
  const error = (body as { error?: { errors?: { reason?: string }[]; details?: { reason?: string }[] } } | null)?.error
  const reasons = [...(error?.errors ?? []), ...(error?.details ?? [])].map((e) => e.reason ?? '')
  if (reasons.includes('accessNotConfigured') || reasons.includes('SERVICE_DISABLED')) {
    return 'The Google Calendar API is switched off in the Google Cloud project. A mentor turns it on: see supabase/README.md.'
  }
  if (reasons.some((r) => /rate|quota/i.test(r)) || status === 429) return 'Google asked us to slow down. Try again in a minute.'
  if (reasons.includes('requiredAccessLevel')) {
    return 'The app can see the team calendar but not change it. Share the calendar with the service account\'s email with "Make changes to events".'
  }
  if (status === 404) {
    return "Google can't find the team calendar or that event. Check GOOGLE_CALENDAR_ID, and that the calendar is shared with the service account's email."
  }
  if (status === 410) return 'That event was already removed.'
  if (status === 401) return 'Google turned down the app. Try again; if it keeps happening, a mentor should check GOOGLE_SERVICE_ACCOUNT_KEY.'
  if (status === 403) return "Google won't let the app do that. Check the team calendar is shared with the service account's email."
  return `Google Calendar had a problem (${status}). Try again in a minute.`
}

export type CalendarAnswer = { ok: true; data: unknown } | { ok: false; status: number; error: string }

const KEY_WRONG = "Google turned down the service account key. A mentor should make a new key and set GOOGLE_SERVICE_ACCOUNT_KEY again: see supabase/README.md."

/**
 * A small client for the team calendar's events: signs in as the service
 * account (keeping the access token until it runs out), then asks.
 */
export function createCalendar(account: ServiceAccount, calendarId: string, { fetch: get = fetch, now = Date.now }: { fetch?: typeof fetch; now?: () => number } = {}) {
  let token: { value: string; expires: number } | null = null

  async function accessToken(): Promise<{ ok: true; token: string } | { ok: false; status: number; error: string }> {
    if (token && token.expires - 60_000 > now()) return { ok: true, token: token.value }
    let assertion: string
    try {
      assertion = await signedAssertion(account, now())
    } catch {
      return { ok: false, status: 503, error: KEY_WRONG }
    }
    let response: Response
    try {
      response = await get(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      })
    } catch {
      return { ok: false, status: 502, error: "Couldn't reach Google. Try again in a minute." }
    }
    const body = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null
    if (!response.ok || typeof body?.access_token !== 'string') return { ok: false, status: 503, error: KEY_WRONG }
    token = { value: body.access_token, expires: now() + (Number(body.expires_in) || 3600) * 1000 }
    return { ok: true, token: token.value }
  }

  /** Ask the team calendar: `path` is from `paths`. */
  return async function calendar(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<CalendarAnswer> {
    const signedIn = await accessToken()
    if (!signedIn.ok) return signedIn
    let response: Response
    try {
      response = await get(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events${path}`, {
        method,
        headers: { Authorization: `Bearer ${signedIn.token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      return { ok: false, status: 502, error: "Couldn't reach Google Calendar. Try again in a minute." }
    }
    if (response.status === 204) return { ok: true, data: null }
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      if (response.status === 401) token = null
      return { ok: false, status: [403, 404, 410].includes(response.status) ? response.status : 502, error: calendarProblem(response.status, data) }
    }
    return { ok: true, data }
  }
}
