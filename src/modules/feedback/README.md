# Feedback

Ideas and problems anyone on the team can send: about the team, the robot or
this app. Everyone signed in sees the whole list, so people can check whether
something has already been sent. Mentors and admins delete posts to keep the
list tidy.

| File | What it does |
|:--|:--|
| `index.ts` | Tells the app about the module, and gives the home page its tile status and "Needs attention" line. |
| `data.ts` | The `feedback_posts` table, the rules, and the functions that change it. |
| `data.test.ts` | Tests for `data.ts`. |
| `FeedbackPage.tsx` | The page: the form, the filter buttons, the list, and Delete for mentors. |

## What a post holds

| Column | What it is |
|:--|:--|
| `kind` | `Idea` or `Problem`. The database only allows those two words. |
| `text` | What the person wrote, 1 to 500 characters. |
| `created_by` | Who sent it, filled in by the database. `useMemberNames()` turns it into a name. |

## Who can do what

The rules are in `supabase/migrations/20261029120000_feedback_posts.sql`, and
`supabase/tests/feedback-posts.test.ts` checks every one of them.

- **Anyone on the team** reads the list and sends a post, signed with their own id.
- **Mentors and admins** delete any post.
- **Nobody** can change a post after sending it: there is no update rule.

Hiding the Delete button from students only keeps the page tidy. The database
is what stops them.

## Ideas for next

- Let someone delete their own post by mistake, soon after sending it.
- Tell a mentor in Slack when a problem comes in, with `src/core/slack.ts`.
- A "Done" or "Thanks, we did this" mark, so good ideas don't just scroll away.
