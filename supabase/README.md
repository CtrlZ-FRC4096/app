# Database (not set up yet)

When the team is ready for real data and Slack sign-in, this folder will
hold the Supabase database setup:

- **Tables** for each module.
- **Permission rules** on every table, which decide what students, mentors
  and admins can read and change. These are the real security: hiding a
  button in a page is not.
- **Tests for the permission rules**, run against a real Postgres database
  on every pull request.
- **Server functions** for anything that needs a secret key, such as the
  Onshape BOM sync. Keys never go in the browser code.

Changes here need a mentor's approval (see `.github/CODEOWNERS`).

Until then, each module keeps example data in the browser through
`src/core/store.ts`. When the database arrives, each module's `data.ts`
changes to read and write the database, and the pages stay the same.
