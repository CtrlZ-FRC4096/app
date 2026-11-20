# Calendar

What's coming up on the team's Google Calendar: build sessions, outreach
and competitions, for the next 8 weeks. The home page tile shows the next
event, like "Next: Build session, Tue 6 PM". This is #12 and #95.

The events live in Google Calendar, not in the app's database. The page
loads them when it opens, at most every 10 minutes, or when someone clicks
**Refresh**.

**Adding events.** Student leaders and mentors (and admins) see **Add
event**, and **Change** and **Remove** on events the app added. Students
see the events and sign up, but ask a student leader or mentor to add or
change one. The app never changes the details of events made in Google
Calendar: change those in Google Calendar. It can turn sign-ups on for
them, though (below).

**Sign-ups** come two ways. Pick one under "Sign-ups" when you add an event:

- **In the app.** People tap **Sign up** on the event (and **Cancel
  sign-up** to take it back), and everyone sees who's going: "Going (2):
  Jordan Kim, Pat Chen". There are no limits on how many can sign up.
  Student leaders and mentors also see **Edit list**, to sign someone else
  up or take anyone off. These are kept in the `calendar_signups` table.

  For **any** event still to come, including ones made in Google Calendar,
  student leaders and mentors see **Take sign-ups** (#159). It turns on
  sign-ups in the app and changes nothing else about the event: only a
  private mark the app keeps on it (`teamAppSignUps`). **Stop sign-ups**
  turns them off again. Whoever had signed up stays on the list, hidden,
  and comes back if sign-ups are taken again. Take sign-ups doesn't show on
  an event with a sign-up link, so it never gets two Sign up buttons.
- **With links,** to Google Forms or Slack posts (#226). An event can have
  several, each with an optional name, like one form for travel and one
  for the hotel. The event gets a button for each: **Sign up: Travel ↗**,
  **Sign up: Hotel ↗**, or just **Sign up ↗** for a link with no name. The
  Add event form takes up to 5: each link is a row with a Name box and a
  Link box, with **Add another link** and **Remove**. Put links there, not
  in Details: the form says so if a `Sign up:` line is typed into Details.
  If an event with a link is changed to **In the app**, the form warns that
  saving removes the link, since an event never gets both kinds of button.

  For an event made in Google Calendar, add a line to its description for
  each link:

  ```
  Sign up (Travel): https://forms.gle/abc123
  Sign up (Hotel): https://forms.gle/def456
  ```

  The name in brackets is optional, so `Sign up: https://forms.gle/abc123`
  works too, as a plain **Sign up** button. The lines can also be a
  bulleted or numbered list. Each link has to be `https://`;
  a line with any other kind of link is left in the description and gets
  no button. The page shows the buttons instead of those lines.
  `signUpLinks()` in `data.ts` finds them.

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

| What | Students | Student leaders, mentors, admins | Checked by |
|:--|:--|:--|:--|
| See events and who's signed up | Yes | Yes | The `calendar` server function, and the `calendar_signups` table's rules |
| Sign themselves up, and cancel it | Yes | Yes | The `calendar_signups` table's rules |
| Add events | No | Yes | The `calendar` server function (`calendarRequest()`) |
| Change and remove events the app added | No | Yes | The `calendar` server function (`calendarRequest()` and `mayChange()`) |
| Take sign-ups and stop sign-ups, on any event | No | Yes | The `calendar` server function (`calendarRequest()`), which changes only the event's sign-ups mark (`signUpsPatch()`) |
| Sign someone else up, or take anyone off | No | Yes | The `calendar_signups` table's rules (`private.is_leader()`) |

The app also marks each event it adds with who added it
(`teamAppAddedBy`), as a record. It doesn't change who can edit it.

The database can't see Google Calendar, so it can't check that an event
takes sign-ups or hasn't ended. `signUp()` in `data.ts` checks those, so
the page says what's wrong.

## Ideas for next

- **Limits,** like 6 van seats or a sign-up deadline. These need new
  columns or a settings table, and a mentor's approval.
- **A Slack reminder** the day before an event, to the people signed up,
  with `src/core/reminders.ts`.
