-- A separate "Died" tick on the Scouting module's match form (#185).
--
-- "Died" means the robot's battery ran out of power: it lost power and
-- stopped. "Browned out" (browned_out, from #162) now means only a short
-- power dip it recovered from, like stuttering or lights flickering. Neither
-- one says anything about "Broke down" (a mechanism breaking).
--
-- Rows saved before this keep their browned_out answer, and died starts as
-- "no" for them: there's no way to tell which of those robots died.
-- Entries saved on phones before this don't have it either, so the default
-- lets them still sync.
--
-- The table's existing policies are for whole rows, so they already cover
-- this column.

alter table public.scouting_entries
  add column died boolean not null default false;
