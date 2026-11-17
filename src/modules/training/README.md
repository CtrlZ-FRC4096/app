# Training

The lessons live in the wiki. This keeps track of who has done them, and
(later) lets mentors sign off hands-on skills.

## What works

- **The lessons.** The page has a section for each course in `COURSES`
  (`data.ts`), with its lessons in the order to do them. Each lesson's title
  links to its page on the wiki, in a new tab.
- **Mark done.** A big **Mark done** button on each lesson. Once it's done,
  the lesson says **Done ✓** with an **Undo** button. Anyone signed in can
  mark their own lessons; nobody can mark anyone else's. If saving fails,
  the page says why.
- **Progress.** At the top, "3 of 5 done" with a progress bar, and each
  course says how many of its lessons are done. They update as soon as you
  press a button.
- **The home page tile:** "2 of 5 lessons done", green once every lesson is
  done.

To add a lesson, add it to its course in `COURSES` at the top of `data.ts`
(the comment there says how). Never change a lesson's id: progress is saved
under it.

## The table

- `training_progress` (`supabase/migrations/..._training_progress.sql`): one
  row for each lesson a person has finished. Marking a lesson not done
  deletes the row. People add and remove only their own rows. Everyone sees
  their own progress, and mentors and admins see everyone's.

Tests: `data.test.ts`, and the rules in
`supabase/tests/training-progress.test.ts`.

## Rules

- Only mentors and admins can sign off a skill.
- Link to the wiki for lesson content. Don't copy lessons into the app.

## Still to build

- Hands-on skills (shop safety, drill press, crimping) that a mentor signs
  off in person
- Students request a sign-off; mentors see the requests and sign off, with
  tests for who may sign off
- Mentors see everyone's progress

Copy the pattern from the [Example module](../example/README.md): a table
and rules in `data.ts`, tests in `data.test.ts`, and the page calling
`data.ts`. Each table also needs a migration in `supabase/migrations/` that
makes it in the team database, with its permission rules and tests; see
[Adding a module](../../../docs/adding-a-module.md). Keep each pull request to
one step.

**Works with:** Robot status (can show how many sign-offs are waiting).
