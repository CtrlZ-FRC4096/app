# Training

**Not built yet.** The lessons live in the wiki. This keeps track of who has done them, and lets mentors sign off hands-on skills.

## What it needs to do

- A list of lessons, each linking to its wiki page
- Students mark lessons done and see their progress
- Hands-on skills (shop safety, drill press, crimping) that a mentor signs off in person
- Students request a sign-off; mentors see the requests and sign off
- Mentors see everyone's progress

## Rules

- Only mentors and admins can sign off a skill.
- Link to the wiki for lesson content. Don't copy lessons into the app.

## Where to start

1. Create `data.ts` with a list of lessons. Use real wiki pages, for example https://wiki.team4096.org/docs/Code/Tutorials/first-button/
2. Show the lessons with a Mark done button and a progress bar.
3. Add skills and sign-off requests, with tests for who may sign off.

Copy the pattern from the [Example module](../example/README.md): a table
and rules in `data.ts`, tests in `data.test.ts`, and the page calling
`data.ts`. Each table also needs a migration in `supabase/migrations/` that
makes it in the team database, with its permission rules and tests; see
[Adding a module](../../../docs/adding-a-module.md). Keep each pull request to
one step.

**Works with:** Robot status (can show how many sign-offs are waiting).
