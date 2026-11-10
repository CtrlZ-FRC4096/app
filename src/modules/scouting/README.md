# Scouting

**Partly built.** Match scouting for events. It has to work with no Wi-Fi: entries save on the device and sync when there is a connection.

## What works so far

- The match form, drawn from `season.ts`: counters, role (choose any), broke down, E-stop or A-stop, driver skill, endgame and notes
- Save entry: `saveEntry()` in `data.ts` keeps the entry on this device, marked Waiting. It refuses an entry with no team or match number, or no driver skill chosen.
- A list of the entries saved on this device, newest first, each Waiting or Synced
- Syncing (#31): Waiting entries are sent to the team database by themselves, with nothing to press:
  - right after saving, if there's a connection
  - when the phone comes back online
  - when the app is opened or comes back on screen
  - every minute while any are waiting

  A **Send now** button is there too, but it's never needed. Entries need someone signed in on the phone to send.
- A Match / Pit switch at the top of the page. The choice is in the address: `#/scouting` is the match form and `#/scouting/pit` the pit form. Each form is one panel, with a line between its sections (`FormSection.tsx`). The pit form (`PitForm.tsx`) asks for the team, drivetrain, weight and size, motors, preferred auto and strategy. Its choice lists are `DRIVETRAINS` and `AUTO_SIDES` in `season.ts`. Save pit entry: `savePitEntry()` in `data.ts` keeps it on this device (`pitStore`). It needs a team number; the match number is optional. Pit entries aren't sent to the team database yet: that needs its own table and migration, and is the next step.
- The Competition menu lists Match and Pit under Scouting (`pages` in `index.ts`).
- Match videos (#41), the data part: `useTeamQualVideos(team)` in `data.ts` gives a team's qualification matches in order, each with its alliance, Won / Lost / Tied (or not played yet), the scores, and a YouTube link for each video. A played match with no links has no video on The Blue Alliance yet. It loads when the page opens, and `reload()` is for a "Check again" button. Nothing shows it yet: the panel goes on the team page (#36).

Entries are kept on the device in a store (`entryStore` in `data.ts`), not a table from `createTable()`, because a table needs a connection on the live site. `syncEntries()` sends the Waiting ones to the `scouting_entries` table (`supabase/migrations/..._scouting_entries.sql`, rules tested in `supabase/tests/scouting-entries.test.ts`) and marks them Synced.

Each entry keeps the id its phone gave it, and the table skips an id it already has (`insertOnce()` in `src/core/table.ts`), so an entry sent twice is never saved twice. Everyone on the team can read every entry; only mentors change or delete them.

Don't raise `entryStore`'s version while entries are waiting on phones: entries saved under the old version would be ignored.

## What it needs to do

- A form for one robot in one match, with big buttons for phones
- Entries save on the device first and sync later
- A QR code for a waiting entry, so another device can copy it with no network
- The match schedule from The Blue Alliance
- The form's fields come from a season settings file, so a new game means new settings, not new code
- Export entries as CSV

## Rules

- Test every change at phone size (browser developer tools > device toolbar).
- Don't put a Blue Alliance key in the browser code. Use the functions in `data.ts` below instead.

## The Blue Alliance

`data.ts` already gets these from The Blue Alliance, through the `tba`
server function, which holds the team's key (see "Server functions" in
`supabase/README.md`):

| Function | Gives you |
|:--|:--|
| `getSchedule()` | The event's matches: who's red and blue, and the scores once played |
| `getRankings()` | The event's rankings, best first |
| `getTeamMatches(team)` | One team's matches at the event, with their videos |
| `getTeam(team)` | A team's nickname and home |

Each returns `{ ok: true, value }` or `{ ok: false, error }`. The event is
`EVENT_KEY` in `season.ts`: change it before each event. In demo mode they
return made-up example teams and matches, so you can build pages without a
key.

## Match 13

[Match 13](https://match13.com) rates each team with **xP** ("expected
points"): how many points it adds to its alliance's score. `data.ts` gets
these through the `match13` server function, which holds the team's key:

| Function | Gives you |
|:--|:--|
| `getRatings()` | Every team's rating at the event, best first. Each also has Statbotics' EPA and The Blue Alliance's OPR to compare |
| `getPredictions()` | Each match's predicted scores, and the chance red wins |

They work like The Blue Alliance's above: same `EVENT_KEY`, same
`{ ok, value }` answers, and made-up example data in demo mode. Match 13
has no schedule or team names: get those from The Blue Alliance and match
them up by the match `key` or the team number.
- Scouting data is visible to signed-in team members only.

## Where to start

1. Create `season.ts` with this season's counters and endgame choices.
2. Add an `Entry` type, `saveEntry()` and tests to `data.ts`.
3. Build the form for one robot, drawing its fields from `season.ts`.

Copy the pattern from the [Example module](../example/README.md): a table
and rules in `data.ts`, tests in `data.test.ts`, and the page calling
`data.ts`. Each table also needs a migration in `supabase/migrations/` that
makes it in the team database, with its permission rules and tests; see
[Adding a module](../../../docs/adding-a-module.md). Keep each pull request to
one step.

**Works with:** Robot status (can show entries waiting to sync).
