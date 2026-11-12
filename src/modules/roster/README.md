# Roster

Who's active this season, and their subteams. It's in the Team menu, for
mentors and admins only.

## What it does

- **Who's listed:** everyone in Attendance (from the Slack channel's poll
  and Jibble) who isn't hidden there, A to Z, **whether or not they have
  an app account**, plus students and student leaders who have signed in
  but aren't in Attendance yet. Each shows **No app account**, **Access
  off** or their role when it isn't Student. To take someone off the list
  (a mentor or parent), hide them in Attendance. Setting someone who isn't
  in Attendance yet adds them there, as the nightly pull from Slack would.
- **Active this season:** a mentor ticks it for each person. Attendance's
  **required Mondays** are for active people only (see
  [Attendance](../attendance/README.md#required-mondays)). Students who
  aren't active don't see the Required Mondays panel.
- **Subteams:** each student can be on any number. Their first one is
  their **main** subteam; a mentor can pick a different main one when
  they're on more than one. Taking someone off their main subteam makes
  their next one main.
- **The subteams themselves** start as Electrical, Mechanical, Software and
  Strategy (the migration adds them). Mentors add, rename and remove them
  at the bottom of the page. Removing one takes everyone off it, after a
  second press.
- **Filters:** find someone by name, show everyone, only active or only
  not active, and pick a subteam (or "No subteam yet").
- The home page tile says "5 active of 6 people".

## Who can do what

| | Mentors and admins | Everyone else |
|:--|:--|:--|
| Open the Roster page | Yes | No (`roles` in `index.ts`) |
| See everyone's entry, and the subteams | Yes | No |
| See their own entry (active, and which subteams) | Yes | Yes (matched by Slack account), so Attendance knows whether Mondays are required for them |
| Change anything | Yes | No |

The rules are in `supabase/migrations/..._roster.sql` and
`..._roster_attendance_people.sql`, tested in
`supabase/tests/roster.test.ts`. In the app, `mentorsOnly()` in `data.ts`
tells anyone else who can.

## Files

| File | What it does |
|:--|:--|
| `data.ts` | The three tables, the example roster, and adding and changing it. `activeRosterIds()` is for other modules |
| `data.test.ts` | Tests for `data.ts`, and the page in demo mode |
| `RosterPage.tsx` | The page |
| `index.ts` | Tells the app about the module |

Tables: `roster_subteams`, `roster_students` (one row per person a mentor
has set; no row means not active) and `roster_subteam_members` (who's on
which subteam, and their main one). Both point at `attendance_people`, so
removing someone from Attendance takes them off the roster.

## Other modules

Read the roster through `data.ts`, never the page. Issue #157 (tasks
grouped by subteam) and #167 (strategy-only scouting pages) could use the
subteams here.
