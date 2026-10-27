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
- **Points** per day, plus 3 to start:

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
3. **Fixes**: choose a name to add a missed check-out, change an RSVP,
   ignore a wrong check-in, or hide someone (mentors, parents) from the
   tables. Manual RSVPs are never overwritten by importing again.

## Files

| File | What it does |
|:--|:--|
| `slack-export.ts` | Reads users, polls and Jibble messages out of the export |
| `points.ts` | Sessions, hours and points (the rules above) |
| `time.ts` | Central-time days and times |
| `data.ts` | The three tables, importing, fixes and CSV |
| `AttendancePage.tsx`, `AttendanceGrid.tsx`, `PersonPanel.tsx`, `ImportPanel.tsx` | The tab |

Tables: `attendance_people`, `attendance_checks`, `attendance_rsvps`
(`supabase/migrations/..._attendance.sql`). Permission tests:
`supabase/tests/attendance.test.ts`.

## Next

See issue #13: importing straight from Slack on a schedule (no export
needed, once server functions exist), checking in from the app instead of
Jibble, and letting students see their own points.
