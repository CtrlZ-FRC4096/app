# Members

Who's on the team, their roles, who can sign in, and who the purchasers
are. Mentors and admins can open it. Only admins change roles and access;
mentors and admins choose the purchasers.

- **People add themselves** by signing in with the Ctrl-Z Slack workspace.
  Everyone starts as a student. Anyone signing in through another workspace
  is turned away by the database.
- **Admins change roles** (student, student leader, mentor, admin) and
  **switch off access** for people who have left the team. Switched-off people can't see anything,
  straight away.
- **Mentors and admins choose the purchasers** (#144) with the **Purchaser**
  tick on each person's row. Purchasers place and change orders in
  Purchasing, along with mentors and admins. It's an extra permission, not a
  role. Mentors and admins don't get the tick (they can already order), and
  nor do people whose access is off. The purchasers belong to Purchasing, so
  this page reads and changes them through `src/modules/purchasing/data.ts`
  (`useBuyers()`, `setBuyer()`, `canChooseBuyers()`, `canBeBuyer()`), and the
  database rules are in `supabase/migrations/..._purchasing_orders.sql`.
- **Find someone** narrows the list by name. If nobody matches, it says so,
  with a button to clear the search.
- **Mentors choose the scouting strategy team** (#167) with the **Strategy
  team** tick under each student's role. Strategy members, student leaders,
  mentors and admins see Scouting's overview, team pages, picklists,
  simulator and stats, and Prescouting. Student leaders, mentors and admins
  always count, so they don't get the tick. The team is the Scouting module's
  `scouting_strategy_team` table; see its README.
- Nobody can change their own role or access here, and the database never
  lets the team end up without an admin.

The member list itself is shared by the whole app, so it lives in
`src/core/members.ts`, and its table and rules are in
`supabase/migrations/..._members_and_slack_sign_in.sql`. Changes to this
module need a mentor's approval.
