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
- Registering a new module in `src/modules/index.ts` is the one allowed
  shared change; mention that it needs a mentor's approval.
- **Don't add npm packages.** If one would really help, say which and why,
  and let a mentor decide.

## How modules work

- `data.ts` holds all data and rules. Pages call its functions and never
  save anything themselves. Example data lives in a store from
  `src/core/store.ts`. When the team database is set up, only `data.ts`
  changes.
- Functions that can fail return `{ ok: true, ... }` or
  `{ ok: false, error: '...' }`, with an error message written for the user.
- If you change the shape of stored data, raise the store's version number
  (the second argument to `createStore`).
- Pages use the components in `src/core/ui.tsx` and the classes in
  `src/core/styles.css`. Don't add new colours; use the CSS variables.
- To read another module's data, import from its `data.ts`, never its pages.
- `useSession()` gives the current role. `isMentor(role)` covers mentors and
  admins. Hiding a button is only for tidiness: once there is a database,
  its permission rules are what keep data safe.

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
  Alliance keys. This repo is public. Anything that needs a key belongs in a
  server function, which a mentor sets up.
- Use real people's personal information in example data.
- Disable, skip or delete a test to make the checks pass. Fix the cause.
- Commit or push without the person reviewing the changes first.
