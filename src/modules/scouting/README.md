# Scouting

**Partly built.** Match scouting for events. It has to work with no Wi-Fi: entries save on the device and sync when there is a connection.

## What works so far

- The match form, drawn from `season.ts`
- Save entry: `saveEntry()` in `data.ts` keeps the entry on this device, marked Waiting. It refuses an entry with no team or match number.
- A list of the entries saved on this device, newest first

Entries are kept in a store (`entryStore` in `data.ts`), not a table from `createTable()`, because a table needs a connection on the live site. Sending Waiting entries to the team database is the next step.

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
