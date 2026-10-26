# Scouting

**Not built yet.** Match scouting for events. It has to work with no Wi-Fi: entries save on the device and sync when there is a connection.

## What it needs to do

- A form for one robot in one match, with big buttons for phones
- Entries save on the device first and sync later
- A QR code for a waiting entry, so another device can copy it with no network
- The match schedule from The Blue Alliance
- The form's fields come from a season settings file, so a new game means new settings, not new code
- Export entries as CSV

## Rules

- Test every change at phone size (browser developer tools > device toolbar).
- Don't put a Blue Alliance key in the browser code. Ask a mentor how to get the schedule.
- Scouting data is visible to signed-in team members only.

## Where to start

1. Create `season.ts` with this season's counters and endgame choices.
2. Create `data.ts` with an `Entry` type, `saveEntry()` and tests.
3. Build the form for one robot, drawing its fields from `season.ts`.

Copy the pattern from the [Example module](../example/README.md): a table
and rules in `data.ts`, tests in `data.test.ts`, and the page calling
`data.ts`. Each table also needs a migration in `supabase/migrations/` that
makes it in the team database, with its permission rules and tests; see
[Adding a module](../../../docs/adding-a-module.md). Keep each pull request to
one step.

**Works with:** Robot status (can show entries waiting to sync).
