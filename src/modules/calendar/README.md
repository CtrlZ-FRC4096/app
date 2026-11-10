# Calendar

What's coming up on the team's Google Calendar: build sessions, outreach
and competitions, for the next 8 weeks. The home page tile shows the next
event, like "Next: Build session, Tue 6 PM". This is #12 and #95.

The events live in Google Calendar, not in the app's database. The page
loads them when it opens, at most every 10 minutes, or when someone clicks
**Refresh**.

**Adding events.** Anyone on the team can click **Add event**, or add one
in Google Calendar. The person who added an event in the app, or a mentor,
sees **Change** and **Remove** on it. The app never changes events made in
Google Calendar: change those in Google Calendar.

**Sign-ups** come two ways. Pick one under "Sign-ups" when you add an event:

- **In the app.** People tap **Sign up** on the event (and **Cancel
  sign-up** to take it back), and everyone sees who's going: "Going (2):
  Jordan Kim, Pat Chen". There are no limits on how many can sign up. These
  are kept in the `calendar_signups` table.
- **With a link,** to a Google Form or Slack post. The event gets a **Sign
  up** button that opens the link. For an event made in Google Calendar,
  add a line to its description that starts with `Sign up:` and then the
  link, like `Sign up: https://forms.gle/abc123`. It has to be an
  `https://` link. The page shows the button instead of that line.

The home page tile says "Sign-up open" when the next event has either.

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module, and gives the home page tile the next event. |
| `data.ts` | Loads the events and works out what to show: by day, times, the next event, sign-up links. Adds, changes and removes events, and keeps the sign-ups. |
| `data.test.ts` | Tests for `data.ts`, and for the page in demo mode. |
| `CalendarPage.tsx` | The page: the events by day with their buttons, who's going, and the form for adding or changing an event. |

## How it gets the events

`loadEvents()` calls `getCalendarEvents()` from `src/core/calendar.ts`,
which asks the `calendar` server function. That function holds the Google
key, so no key is ever in the site. In demo mode (your computer and the
tests) it gives made-up events instead, so you can work on this without
any keys. The made-up outreach night takes sign-ups in the app, and the
made-up competition has a sign-up link.

The last events loaded are saved on the device, so the page still shows
them with no connection, with when they're from.

## Who can do what, and where that's checked

| What | Who | Checked by |
|:--|:--|:--|
| See events | Everyone on the team | The `calendar` server function |
| Add an event | Everyone on the team | The `calendar` server function |
| Change or remove an event | Who added it in the app, or a mentor | The `calendar` server function (`mayChange()`), which marks each event the app adds with who added it |
| See who's signed up | Everyone on the team | The `calendar_signups` table's rules |
| Sign up, or take it back | Yourself only (mentors can take anyone's back) | The `calendar_signups` table's rules |

The database can't see Google Calendar, so it can't check that an event
takes sign-ups or hasn't ended. `signUp()` in `data.ts` checks those, so
the page says what's wrong.

## Ideas for next

- **Limits,** like 6 van seats or a sign-up deadline. These need new
  columns or a settings table, and a mentor's approval.
- **Sign-ups in the app for events made in Google Calendar,** for example
  with a `Sign up: in the app` line.
- **A Slack reminder** the day before an event, to the people signed up,
  with `src/core/reminders.ts`.
