# Batteries

**Step 1 of 4 built.** Which batteries are charged, in the robot, or
charging, so the pit crew always grabs a good one. Made to be used on a
phone in the pit.

## What works so far

- The page lists every battery that isn't retired, grouped by status, with
  Charged first. In each group, the battery that's been in that status
  longest comes first, so in Charged that's the one to use next.
- A big **Move to …** button on each battery moves it to its next status:
  Needs charging → Charging → Resting → Charged → In the robot → Needs
  charging. Anyone on the team can press it.
- Each battery says how long ago its status changed, like "Charged 2 hours
  ago". The database records the time, so a phone with the wrong clock
  can't get it wrong.
- Mentors and admins see **Add a battery**, and **Edit** on each battery to
  rename it, change its notes, retire it (or bring it back), or delete it.
  Retired batteries are listed at the bottom, for mentors only.
- The home page tile: "3 charged · 2 charging".

The statuses are `STATUSES` at the top of `data.ts`, in the order a battery
goes through them. To change them, change that list. A battery saved with a
status that's no longer there still shows, under its old status, and moves
on to Needs charging.

## Rules

- Anyone on the team changes a battery's status. Only mentors and admins
  add, rename, retire, change the notes on, or delete a battery. The
  database enforces this: a trigger in `supabase/migrations/..._batteries.sql`
  keeps students to the status, and its tests are in
  `supabase/tests/batteries.test.ts`.
- No two batteries have the same number.
- Test every change at phone size, with buttons big enough to tap with
  gloves on.

## Still to decide

- **No Wi-Fi in the pit.** The table needs a connection; a phone hotspot is
  the simplest answer. If that isn't good enough, a later step could save
  changes on the phone first, like Scouting entries.
- **The tired-battery limit** for internal resistance (step 2). Ask the
  electrical lead.
- **Robot status:** should its pit checklist show which battery is in the
  robot?

## Next steps

1. ~~The batteries and their status.~~ Done.
2. Readings (voltage and internal resistance) and a history table,
   `batteries_log`, that nobody can edit or delete. Flag tired batteries.
3. Which battery was in which match, using `getSchedule()` from
   `src/modules/scouting/data.ts`, and suggest which charged battery to use
   next.
4. Printed labels. A QR code needs an npm package, which is a mentor's
   decision, shared with Inventory's bin labels.

Keep each pull request to one step.
