# Roster

Who's active this season, and their subteams. It's in the Team menu, for
mentors and admins only.

## What it does

- **Who's listed:** everyone on the Members page with the **Student** or
  **Student leader** role whose access is on, A to Z. Students show up
  once they've signed in. Switching someone's access off on the Members
  page takes them off the roster; changing their role to mentor does too.
- **Active this season:** a mentor ticks it for each student. Attendance's
  **required Mondays** are for active students only (see
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
- The home page tile says "3 active students of 5".

## Who can do what

| | Mentors and admins | Everyone else |
|:--|:--|:--|
| Open the Roster page | Yes | No (`roles` in `index.ts`) |
| See everyone's entry, and the subteams | Yes | No |
| See their own entry (active, and which subteams) | Yes | Yes, so Attendance knows whether Mondays are required for them |
| Change anything | Yes | No |

The rules are in `supabase/migrations/..._roster.sql`, tested in
`supabase/tests/roster.test.ts`. In the app, `mentorsOnly()` in `data.ts`
tells anyone else who can.

## Files

| File | What it does |
|:--|:--|
| `data.ts` | The three tables, the example roster, and adding and changing it. `activeRosterIds()` is for other modules |
| `data.test.ts` | Tests for `data.ts`, and the page in demo mode |
| `RosterPage.tsx` | The page |
| `index.ts` | Tells the app about the module |

Tables: `roster_subteams`, `roster_students` (one row per student a mentor
has set; no row means not active) and `roster_subteam_members` (who's on
which subteam, and their main one).

## Other modules

Read the roster through `data.ts`, never the page. Issue #157 (tasks
grouped by subteam) and #167 (strategy-only scouting pages) could use the
subteams here.
