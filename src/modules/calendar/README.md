# Calendar

What's coming up on the team's Google Calendar: build sessions, outreach
and competitions, for the next 8 weeks. The home page tile shows the next
event, like "Next: Build session, Tue 6 PM". This is the first step of #12.

The events live in Google Calendar, not in the app's database, so this
module has no table. To add or change an event, change it in Google
Calendar. The page loads the events when it opens, at most every 10
minutes, or when someone clicks **Refresh**.

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module, and gives the home page tile the next event. |
| `data.ts` | Loads the events and works out what to show: by day, times, the next event. |
| `data.test.ts` | Tests for `data.ts`. |
| `CalendarPage.tsx` | The page: the events by day, each with a link to open it in Google Calendar. |

## How it gets the events

`loadEvents()` calls `getCalendarEvents()` from `src/core/calendar.ts`,
which asks the `calendar` server function. That function holds the Google
key, so no key is ever in the site. In demo mode (your computer and the
tests) it gives made-up events instead, so you can work on this without
any keys.

The last events loaded are saved on the device, so the page still shows
them with no connection, with when they're from.

## Ideas for next

- **Mentors add events from the app.** `addCalendarEvent()`,
  `changeCalendarEvent()` and `removeCalendarEvent()` in
  `src/core/calendar.ts` already work. The app only changes events it added.
- **Sign-ups,** from #12. These need a table for who's signed up to which
  event (by its Google Calendar `id`), so they need a migration and a
  mentor's approval. Decide first who can sign up, any limits, and who sees
  the list.
- **A Slack reminder** the day before an event, with `src/core/reminders.ts`.
