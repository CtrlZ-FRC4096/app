# Batteries

Which batteries are charged, in the robot, or charging, so the pit crew
always grabs a good one. Made to be used on a phone in the pit.

## What works

- **By status.** The page lists every battery that isn't retired, grouped
  by status, with Charged first. In each group, the battery that's been in
  that status longest comes first.
- **Moving on.** A big **Move to …** button on each battery moves it to its
  next status: Needs charging → Charging → Resting → Charged → In the robot
  → Needs charging. Anyone on the team can press it. Each battery says how
  long ago its status changed; the database records the time, so a phone
  with the wrong clock can't get it wrong.
- **Which match.** Moving a battery In the robot asks which match it's for,
  filled in with our next match from the event schedule (`getSchedule()` in
  the Scouting module). It can be changed or left empty.
- **Next up.** At the top: the charged battery to use next, the one charged
  longest, leaving out tired ones.
- **Details.** Tap a battery's number for its latest reading, a form to
  record a new one (voltage and internal resistance, from a Battery Beak or
  CBA), the matches it was used in, and its recent history.
- **Tired batteries.** A battery whose latest internal resistance reading is
  above `TIRED_RESISTANCE_OHMS` (top of `data.ts`) is marked Tired.
- **Labels.** The **Labels** button shows a big number for each battery, to
  print and stick on. **Find a battery** finds one by its number.
- **Mentors** see **Add a battery**, and **Edit** on each battery to rename
  it, change its notes, retire it (or bring it back), or delete it. Retired
  batteries are listed at the bottom, for mentors only.
- **The home page tile:** "3 charged · 2 charging".

The statuses are `STATUSES` at the top of `data.ts`, in the order a battery
goes through them. To change them, change that list. A battery saved with a
status that's no longer there still shows, under its old status, and moves
on to Needs charging.

## The tables

- `batteries` (`supabase/migrations/..._batteries.sql`): one row per
  battery. Anyone on the team changes a battery's status. Only mentors and
  admins add, rename, retire, change the notes on, or delete a battery. A
  trigger keeps students to the status. No two batteries have the same
  number.
- `batteries_log` (`..._batteries_log.sql`): the history. Every status
  change and reading, with who and when. Anyone adds to it and reads it;
  nobody edits or deletes it. Deleting a battery deletes its history, so
  retire batteries instead.

Moving a battery changes its status, then adds the history line, as two
steps, like Inventory's `changeStock()`. If the second step fails, the page
says so.

Tests: `data.test.ts`, and the rules in `supabase/tests/batteries.test.ts`
and `batteries-log.test.ts`.

## Still to decide

- **The tired-battery limit.** `TIRED_RESISTANCE_OHMS` is 0.020 Ω, a common
  starting point. Ask the electrical lead what limit to use, and whether
  voltage should flag anything too.
- **No Wi-Fi in the pit.** The tables need a connection; a phone hotspot is
  the simplest answer. If that isn't good enough, a later step could save
  changes on the phone first, like Scouting entries.
- **QR codes on the labels.** Making a QR code needs an npm package, which
  is a mentor's decision. Inventory's bin labels need the same, so decide
  once for both.
- **Robot status:** should its pit checklist show which battery is in the
  robot?
- **Our team number** is `OUR_TEAM` in `data.ts`, used to find our next
  match.
