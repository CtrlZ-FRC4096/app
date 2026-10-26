# Why the app is built this way

## One app, built from modules

The team wanted one place for inventory, the BOM, scouting, robot status and
training, that students can keep adding to. Each of those is a module: a
folder in `src/modules/` that plugs into the same layout, roles and
navigation. A new module is a new folder plus one line in
`src/modules/index.ts`.

Everything lives in one repo, so a change that touches two modules (the BOM
reads Inventory's stock levels) is one pull request, and there is one set of
checks and one shared look.

## What it has to survive

- **Graduation.** The team's earlier web systems stopped being looked after
  when the students who built them left. Nothing here should need one
  particular person to keep it running.
- **Students building with Claude.** Mistakes will happen. They need to be
  caught before they're merged (CI, reviews, tests) and contained to one
  module (each module loads separately, with its own error handling).
- **Minors and money.** Everyone will sign in with Slack. Roles decide who
  sees costs and scouting data.

## How it runs

- **The site** is static files on GitHub Pages, published from `main`
  automatically. There is no server.
- **The data** goes in Supabase: a Postgres database with permission rules
  on every table, and Sign in with Slack limited to the Ctrl-Z workspace.
  Its free plan covers a team our size. Until the site is connected to it,
  and always on your computer and in tests, the app runs in demo mode on
  example data saved in the browser. A module's code is the same either way
  (`src/core/table.ts`), so students can build without database access.
- **The workspace check happens in the database.** A trigger on new
  accounts (in the members migration) turns away anyone Slack says came
  from another workspace, before an account is made. The browser can't get
  around it.
- **Anything with a secret key** (the Onshape BOM sync, The Blue Alliance)
  runs in a Supabase server function, never in the browser.

## Things the database setup handles, and what's left

- **Leaving Slack doesn't sign anyone out by itself.** Slack is only checked
  at sign-in, and on Supabase's free plan a login doesn't expire on its own.
  For now an admin switches off a leaver's access in the Members module,
  which takes effect straight away. Still to do: a nightly job that asks
  Slack who is still in the workspace and switches off anyone who has left.
- **The free plan pauses** a project after a week of low activity. The
  "Keep the database awake" workflow asks it a small question twice a week.
- **The free plan has no backups.** Still to do: a nightly backup, or
  Supabase Pro ($25 a month) once the team depends on the data.
- **Store as little as possible about students:** their Slack name, ID and
  picture. Supabase also keeps the email Slack sends, but the app never
  reads it.
- **Every table is checked.** `supabase/tests/tables.test.ts` fails a pull
  request if any table has row level security off, lets signed-out visitors
  in, or doesn't match the example data its module uses.
