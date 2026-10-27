// Google Calendar, for the team calendar: everyone on the team can see its
// events, and mentors can add events from the app (and change or remove
// the ones the app added). Needs the GOOGLE_SERVICE_ACCOUNT_KEY and
// GOOGLE_CALENDAR_ID secrets; see "Server functions" in supabase/README.md.
// The app calls this through src/core/calendar.ts.
import { forMembers, reply } from '../_shared/members.ts'
import { calendarRequest, createCalendar, fromGoogle, isAppEvent, parseServiceAccount, paths, toGoogle, type CalendarEvent, type GoogleEvent } from './calendar.ts'

const keySecret = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY') ?? ''
const calendarId = (Deno.env.get('GOOGLE_CALENDAR_ID') ?? '').trim()
const account = parseServiceAccount(keySecret)
const calendar = account && calendarId ? createCalendar(account, calendarId) : null

/** 250 events a page: 1000 is more than a year of team events. */
const MAX_PAGES = 4

export default {
  fetch: forMembers(async (req, member) => {
    if (!keySecret || !calendarId) {
      return reply({ error: "Google Calendar isn't set up yet. A mentor adds the GOOGLE_SERVICE_ACCOUNT_KEY and GOOGLE_CALENDAR_ID secrets: see supabase/README.md." }, 503)
    }
    if (!account || !calendar) {
      return reply({ error: "GOOGLE_SERVICE_ACCOUNT_KEY isn't a service account key. A mentor should paste in the whole JSON key file from Google Cloud: see supabase/README.md." }, 503)
    }
    const request = calendarRequest(await req.json().catch(() => null), member.role)
    if ('error' in request) return reply({ error: request.error }, request.status)

    if (request.kind === 'check') {
      const answer = await calendar('GET', paths.check(Date.now()))
      if (!answer.ok) return reply({ error: answer.error }, answer.status)
      const data = answer.data as { summary?: string; accessRole?: string }
      return reply({ name: data.summary || 'The team calendar', canAdd: data.accessRole === 'writer' || data.accessRole === 'owner', serviceAccount: account.email })
    }

    if (request.kind === 'events') {
      const events: CalendarEvent[] = []
      let pageToken: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const answer = await calendar('GET', paths.events(request.from, request.to, pageToken))
        if (!answer.ok) return reply({ error: answer.error }, answer.status)
        const data = answer.data as { items?: GoogleEvent[]; nextPageToken?: string }
        for (const item of data.items ?? []) {
          const event = fromGoogle(item)
          if (event) events.push(event)
        }
        pageToken = data.nextPageToken
        if (!pageToken) break
      }
      return reply({ events })
    }

    if (request.kind === 'add') {
      const answer = await calendar('POST', '', toGoogle(request.event))
      return answer.ok ? reply({ event: fromGoogle(answer.data as GoogleEvent) }) : reply({ error: answer.error }, answer.status)
    }

    // Changing or removing: only events the app added.
    const existing = await calendar('GET', paths.event(request.id))
    if (!existing.ok) return reply({ error: existing.error }, existing.status)
    if (!isAppEvent(existing.data as GoogleEvent)) {
      return reply({ error: 'The app only changes events it added. Change this one in Google Calendar.' }, 403)
    }
    if (request.kind === 'remove') {
      const answer = await calendar('DELETE', paths.event(request.id))
      return answer.ok ? reply({ removed: true }) : reply({ error: answer.error }, answer.status)
    }
    const answer = await calendar('PUT', paths.event(request.id), { ...(existing.data as GoogleEvent), ...toGoogle(request.event) })
    return answer.ok ? reply({ event: fromGoogle(answer.data as GoogleEvent) }) : reply({ error: answer.error }, answer.status)
  }),
}
