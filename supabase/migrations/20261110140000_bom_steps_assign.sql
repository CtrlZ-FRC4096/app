-- Stages can be assigned to a person, with a due date (issue #16), so
-- everyone can see who is doing what and what's late. Both are optional: a
-- stage starts with nobody assigned and no due date.
--
-- Anyone on the team can assign a stage and set its due date, like moving a
-- stage along. The rule "Members can move stages along" from
-- ..._bom_steps.sql already covers who can change a stage, so this only
-- adds the two columns to what a change may touch.
--
-- If a person is deleted from the team, their stages go back to unassigned.

alter table public.bom_steps
  add column assigned_to uuid references public.members (id) on delete set null,
  add column due_date date;

create index on public.bom_steps (assigned_to);

grant update (assigned_to, due_date) on table public.bom_steps to authenticated;
