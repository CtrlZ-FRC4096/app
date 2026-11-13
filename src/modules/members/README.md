# Members

Who's on the team, their roles, and who can sign in. Mentors and admins can
open it; only admins can change anything.

- **People add themselves** by signing in with the Ctrl-Z Slack workspace.
  Everyone starts as a student. Anyone signing in through another workspace
  is turned away by the database.
- **Admins change roles** (student, student leader, mentor, admin) and
  **switch off access** for people who have left the team. Switched-off people can't see anything,
  straight away.
- **Mentors choose the scouting strategy team** (#167) with the Strategy
  team tick box. Strategy members, mentors and admins see Scouting's
  overview, team pages, picklists, simulator and stats, and Prescouting.
  Mentors and admins always count. The team is the Scouting module's
  `scouting_strategy_team` table; see its README.
- Nobody can change their own role or access here, and the database never
  lets the team end up without an admin.

The member list itself is shared by the whole app, so it lives in
`src/core/members.ts`, and its table and rules are in
`supabase/migrations/..._members_and_slack_sign_in.sql`. Changes to this
module need a mentor's approval.
