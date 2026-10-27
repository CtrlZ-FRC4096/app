# Attendance

Who said they'd come, when they checked in and out, and attendance points.
**Mentors and admins only**: attendance is personal information about
students, and the database's rules stop anyone else reading or changing it.

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
- **Points** per day, plus 3 to start each points period:

  | Poll answer | Didn't come | Under 1.5 h | 1.5 h or more |
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
   with a CSV download for each.
3. **Periods**: the dates points are counted over, like "2027 build season,
   Jan 9 to Apr 17" (leave the last day empty while it's still going).
   Everyone starts a period with 3 points and only its meetings count.
   Mentors save periods once and all see the same ones; the sheets open on
   the period that includes today. "Count points over" switches to another
   period, all time, or any dates, until the app is reloaded.
4. **Fixes**: choose a name to add a missed check-out, change an RSVP,
   ignore a wrong check-in, or hide someone (mentors, parents) from the
   tables. Manual RSVPs are never overwritten by importing again.

## Pulling from Slack automatically

Once set up, the **Pull attendance from Slack** workflow reads the
attendance channel once a day, late in the evening after meetings, and adds
anything new: poll answers and
Jibble check-ins and check-outs. Nobody has to export Slack. The tab shows
when the last pull ran, and mentors see a warning on the home page if pulls
stop. It follows the same rules as importing an export: it updates poll
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

The bot token can only read the channels the app is invited to, and the
member list. It lives only in the `database` environment, which only `main`
can use, so pull requests can't read it. Never put it in the code.

## Files

| File | What it does |
|:--|:--|
| `slack-export.ts` | Reads users, polls and Jibble messages, and matches Jibble names to Slack accounts |
| `sync.ts` | Builds what the daily pull sends to the database |
| `../../../scripts/attendance-sync.ts` | The daily pull itself: reads Slack, writes to the database |
| `points.ts` | Sessions, hours and points (the rules above) |
| `periods.ts` | Points periods: which one includes today, and what dates to count |
| `time.ts` | Central-time days and times |
| `data.ts` | The tables, importing, fixes, periods and CSV |
| `AttendancePage.tsx`, `AttendanceGrid.tsx`, `PersonPanel.tsx`, `PeriodsPanel.tsx`, `ImportPanel.tsx` | The tab |

Tables: `attendance_people`, `attendance_checks`, `attendance_rsvps`
(`supabase/migrations/..._attendance.sql`), and `attendance_syncs` with the
function the pull calls (`..._attendance_slack_pull.sql`), and
`attendance_periods` (`..._attendance_periods.sql`). Permission tests:
`supabase/tests/attendance.test.ts` and `attendance-pull.test.ts`.

Changes to this folder and `scripts/` need a mentor's approval, because the
daily pull runs this code with the database password and the Slack token.

## Next

See issue #13: checking in from the app instead of Jibble, and letting
students see their own points.
