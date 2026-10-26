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
- **The data**, once it's set up, goes in Supabase: a Postgres database with
  permission rules on every table, and Sign in with Slack limited to the
  Ctrl-Z workspace. Its free plan covers a team our size. Until then, each
  module uses example data saved in the browser.
- **Anything with a secret key** (the Onshape BOM sync, The Blue Alliance)
  runs in a Supabase server function, never in the browser.

## Things the database setup must handle

- **Leaving Slack doesn't sign anyone out by itself.** Slack is only checked
  at sign-in, and on Supabase's free plan a login doesn't expire on its own.
  A nightly job will ask Slack who is still in the workspace and switch off
  anyone who has left.
- **The free plan pauses** a project after a week of low activity, and has
  no automatic backups. A scheduled keep-awake job and a nightly backup to a
  private repo cover both. Supabase Pro ($25 a month) removes both limits if
  the team comes to depend on the app.
- **Store as little as possible about students:** their Slack name and ID.
