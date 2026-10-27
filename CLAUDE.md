# Instructions for Claude

This is Team 4096's (Ctrl-Z) team app. Most people working in it are high
school students who are new to web development and are building with your
help. Explain what you change in plain language, and keep changes small
enough for them to understand and for a mentor to review.

## Before you change anything

- Read the README of the module you're working in (`src/modules/<module>/README.md`).
- Follow the pattern in `src/modules/example/`.
- If the task is unclear or would touch more than one module, say so and
  propose a smaller first step instead of guessing.

## Where changes go

- **Work inside one module folder** in `src/modules/`.
- **Don't edit these unless the person says a mentor asked for it:**
  `src/core/`, `src/App.tsx`, `src/main.tsx`, `.github/`, `supabase/`,
  `package.json`, `CLAUDE.md`. If the task seems to need a change there,
  stop and explain why, so they can ask a mentor.
- Two shared changes are allowed, and both need a mentor's approval (say
  so): registering a new module in `src/modules/index.ts`, and adding a
  migration and its tests in `supabase/` for the module's own table.
- **Never edit a migration that's already merged.** The database has run it.
  Add a new migration instead.
- **Don't add npm packages.** If one would really help, say which and why,
  and let a mentor decide.

## How modules work

- `data.ts` holds all data and rules. Data goes in a table from
  `createTable()` (`src/core/table.ts`), with made-up example rows for demo
  mode. Pages read rows with a `use...()` hook from `data.ts` and change them
  through its functions; they never save anything themselves.
- Each table needs a migration in `supabase/migrations/` (copy the
  example's) with row level security on and a policy for each thing people
  may do, plus tests in `supabase/tests/` (copy `example-notes.test.ts`)
  showing who can and can't. The example rows must have exactly the table's
  columns. `npm test` checks all of this.
- Functions that can fail return `{ ok: true, value }` or
  `{ ok: false, error: '...' }`, with an error message written for the user.
  The table's `insert`, `update` and `remove` already do.
- If you change the shape of a table's rows, raise its `version` option, and
  add a migration that changes the database table to match.
- Summaries and attention items for the home page are hooks in `data.ts`
  (like `useNoteSummary`), set as `useSummary` / `useAttention` in `index.ts`.
- Pages use the components in `src/core/ui.tsx` and the classes in
  `src/core/styles.css`. Don't add new colours; use the CSS variables.
- To read another module's data, import from its `data.ts`, never its pages.
- `useSession()` gives the signed-in person's `id`, `name` and `role`.
  `isMentor(role)` covers mentors and admins. Hiding a button is only for
  tidiness: the database's permission rules are what keep data safe, so
  every rule that matters must be in the migration's policies.
- `useMemberNames()` (`src/core/members.ts`) turns a `created_by` id into a
  name.
- Anything needing a secret key goes through a server function in
  `supabase/functions/`, called from `data.ts` with `callFunction()`
  (`src/core/functions.ts`) and made-up example data for demo mode. The
  Blue Alliance's is `tba`: use the functions in `src/modules/scouting/data.ts`.

## Every change

- **Write or update tests** in `data.test.ts` for anything in `data.ts`.
- **Run `npm run check`** (lint, type check, tests, build) and fix
  everything it reports before saying you're done.
- The app must work on a phone: nothing should make the page scroll
  sideways, and buttons need to be big enough to tap.
- Write user-facing text plainly. Name things the way the team does
  ("parts", "bins", "pit checklist"), and make error messages say what to do.

## Never

- Put secrets in the code: passwords, API keys, tokens, Onshape or Blue
  Alliance keys, or Supabase's secret key. This repo is public. Anything
  that needs a key belongs in a server function, which a mentor sets up.
  (Supabase's publishable key is meant to be public, and comes from the
  build settings, not the code.)
- Make a table without row level security, give the `anon` role access to
  anything, or write a policy that lets everyone do everything.
- Use real people's personal information in example data.
- Disable, skip or delete a test to make the checks pass. Fix the cause.
- Commit or push without the person reviewing the changes first.
