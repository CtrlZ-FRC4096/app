# Attendance

Who said they'd come, when they checked in and out, and attendance points.

- **Everyone sees their own** at the top of the tab: points, hours and
  meetings for the dates being counted, and each of their days. They're
  matched by Slack account, so someone added by name only (a Jibble name
  that matched no Slack account) sees nothing until a mentor fixes it. The
  home page tile shows their points and hours this period.
- **Requests for missing hours.** Anyone can ask for hours Jibble missed,
  from their own attendance: a forgotten check-out, or a whole session they
  didn't check in for, with a note. Mentors and admins see the requests at
  the bottom of the tab and approve or decline them, and the home page
  says so once a request has waited a day. Approving adds the times as check-ins and check-outs made
  by hand, in the database in the same step, so hours and points update
  straight away. People can take back a request until it's decided.
- **Mentors and admins see everyone's**, and are the only ones who can
  change anything. Attendance is personal information about students: the
  database's rules give everyone else only their own rows, read-only.

This replaces the team's attendance notebook (Python, reading a Slack
export into an Excel workbook). It works the same way:

- **RSVPs** come from the Simple Poll in the attendance channel. Votes for
  the first option (:one:) mean yes; any other option means no. The last
  poll posted on a day counts.
- **Check-ins and check-outs** come from Jibble's "jibbled in / jibbled out"
  messages. Names are matched to Slack accounts: exactly, then by first two
  words, then by the closest similar name (like `difflib`).
- **Hours** pair each check-in with the next check-out. A double check-in is
  ignored. Someone who never checks out gets no hours that day until a
  mentor adds the check-out.
- **Points** per day, plus 3 to start each points period. A full session is
  2 hours or more (`FULL_SESSION_HOURS`; the old spreadsheet used 1.5):

  | Poll answer | Didn't come | Under 2 h | 2 h or more |
  |:--|--:|--:|--:|
  | Yes | −1 | 1 | 3 |
  | No | 1 | 1 | 2 |
  | No answer | 0 | 0 | 1 |

Days and times are in Central time, whatever the computer's time zone.

## Using it

1. **Import**: a workspace admin exports Slack, unzips it, and a mentor
   chooses the folder on the Import tab. Only Slack IDs, names, check-in
   times and poll votes are saved. Importing again only adds what's new.
2. **Points, Hours, Check-ins, RSVPs**: the same sheets as the old workbook,
   with a CSV download for each. Every sheet shows each person's points,
   hours and days here side by side, and sorts by its own: Points by
   points, Hours by hours. Click a column's heading to sort by it instead.
3. **Periods**: the dates points are counted over, like "2027 build season,
   Jan 9 to Apr 17" (leave the last day empty while it's still going).
   Everyone starts a period with 3 points and only its meetings count.
   Only mentors and admins save periods, like "Fall 2026" or "2027 build
   season", and everyone sees the same ones. The tab opens on the most
   recent one: the period that includes today, or else the last one that
   started (so between seasons it still shows last season). Anyone can
   switch with "Count points over" to another period, all time, or any
   dates, until the app is reloaded.
4. **Fixes**: choose a name to add a missed check-out, change an RSVP,
   ignore a wrong check-in, or hide someone (mentors, parents) from the
   tables. Manual RSVPs are never overwritten by importing again.

## Pulling from Slack automatically

Once set up, the **Pull attendance from Slack** workflow reads the
attendance channel once a day, late in the evening after meetings, and adds
anything new: poll answers and
Jibble check-ins and check-outs. Nobody has to export Slack. The tab shows
when the last pull ran, and mentors see a warning on the home page once a
day and a half goes by without one. It follows the same rules as importing an export: it updates poll
answers but never ones a mentor set by hand, and never brings back a
check-in a mentor ignored. Each pull re-reads the last 3 days, to catch late
poll votes.

Set up once (needs a Slack workspace admin and a GitHub repo admin):

1. **Give the Slack app a bot.** At [api.slack.com/apps](https://api.slack.com/apps), open the team app (the one
   used for sign-in) → **OAuth & Permissions** → **Bot Token Scopes**, and add:
   - `channels:history` (or `groups:history` if the attendance channel is private)
   - `users:read`

   Then **Install to Workspace** (or **Reinstall**), and copy the **Bot User OAuth Token** (`xoxb-...`).
2. **Invite the app to the channel.** In the attendance channel, type `/invite @Ctrl-Z Team App`.
3. **Find the channel ID.** Click the channel's name; the ID (starting with `C`) is at the bottom of the window.
4. **Give GitHub the token and the channel.** In the repo's settings:
   - **Environments → database → Add environment secret:** `SLACK_BOT_TOKEN`, the `xoxb-...` token.
   - **Secrets and variables → Actions → Variables:** `ATTENDANCE_CHANNEL_ID`, the channel ID.
   - Optional, same place: `ATTENDANCE_SINCE`, the first day to pull, such as `2026-01-01`. Without it, the first pull goes back 180 days.
5. **Run it once:** Actions → **Pull attendance from Slack** → **Run workflow**. After that it runs every night. Run it by hand any time you want the latest straight away.

**Pulling older history.** Each pull only reads from the last one onward
(the first goes back 180 days, or to `ATTENDANCE_SINCE`). To bring in
older messages, use **Run workflow** and type a day in **Pull from this
day**, like `2025-09-01`. It reads the channel from that day to now;
anything already pulled is skipped, and answers a mentor set by hand stay.
The log says which day the oldest message Slack sent back is from. On
Slack's free plan the bot can only read the last 90 days, so for anything
older, import a Slack export on the Import tab.

The bot token can only read the channels the app is invited to, and the
member list. It lives only in the `database` environment, which only `main`
can use, so pull requests can't read it. Never put it in the code.

## Required Mondays

Students have to come to the Monday meetings on the team calendar. This
replaces the absence Google Form and reading the Slack channel by hand.

- **Which Mondays:** every Monday with a meeting on the team Google
  Calendar (an event with a start time; all-day events like competitions
  don't count). They're read through `src/core/calendar.ts` for the dates
  being counted plus the next 4 weeks, so nothing is copied into the
  database. Mentors and admins can mark one **not required** (a holiday
  still on the calendar, say) with an optional reason, and make it required
  again. Those are kept in `attendance_not_required`.
- **Coming** means checking in with Jibble that day (any check-in that
  isn't ignored), however long they stayed.
- **"I can't make it":** under Your attendance, students and student
  leaders see the required Mondays in the next 4 weeks and say they can't
  make one, with a reason. Mentors and admins don't: the Mondays aren't
  required for them, and the database doesn't let them send absences.
  It counts as **excused** straight away: nobody approves it. They can take
  it back until the day. They can also say why they missed one afterwards;
  mentors see that marked **Sent after**. These are kept in
  `attendance_absences`.
- **Missed** is a required Monday with no check-in and no absence. Today
  counts as coming up until the night's pull from Slack.
- **None of this changes hours or points.**
- **Mentors and admins** pick **Required Mondays** under View: a row per
  person with how many they missed, were excused from and came to, and a
  column per required Monday (most missed first, with a CSV download), the
  Monday meetings with the switch for required or not, and every absence
  with its reason. They can remove an absence, which makes that Monday
  missed again unless the person checked in.

The rules are in `required.ts` (tested in `required.test.ts`); the tables,
loading the calendar and sending absences are in `data.ts`; the screens are
`RequiredMondays.tsx`. Demo mode has no team calendar, so `data.ts` makes
up Monday meetings on Jan 5, 12 and 19, 2026 (the example check-ins' weeks;
Jan 19 is marked not required) and the next few Mondays from today.

## Files

| File | What it does |
|:--|:--|
| `slack-export.ts` | Reads users, polls and Jibble messages, and matches Jibble names to Slack accounts |
| `sync.ts` | Builds what the daily pull sends to the database |
| `../../../scripts/attendance-sync.ts` | The daily pull itself: reads Slack, writes to the database |
| `points.ts` | Sessions, hours and points (the rules above) |
| `periods.ts` | Points periods: which one includes today, and what dates to count |
| `time.ts` | Central-time days and times |
| `required.ts` | Required Mondays: which Mondays count, and who came, was excused or missed |
| `data.ts` | The tables, importing, fixes, periods, required Mondays and CSV |
| `AttendancePage.tsx`, `AttendanceGrid.tsx`, `PersonPanel.tsx`, `PeriodsPanel.tsx`, `ImportPanel.tsx`, `RequiredMondays.tsx` | The tab |

Tables: `attendance_people`, `attendance_checks`, `attendance_rsvps`
(`supabase/migrations/..._attendance.sql`), and `attendance_syncs` with the
function the pull calls (`..._attendance_slack_pull.sql`), and
`attendance_periods` (`..._attendance_periods.sql`), and
`attendance_absences` and `attendance_not_required`
(`..._attendance_required_mondays.sql`). Permission tests:
`supabase/tests/attendance.test.ts`, `attendance-pull.test.ts` and
`attendance-required-mondays.test.ts`.

Changes to this folder and `scripts/` need a mentor's approval, because the
daily pull runs this code with the database password and the Slack token.

## Next

See issue #13: checking in from the app instead of Jibble, and letting
students see their own points.
