-- More questions on the Scouting module's match form (#162): how well the
-- robot does its role, what broke, died or browned out, both stops, the
-- auto it was seen doing, and the bonus ranking points its alliance earned.
--
-- Entries saved on phones before this don't have these, so every new column
-- is empty or "no" by default, and those entries still sync.
--
-- The checks match checkEntry() in src/modules/scouting/data.ts, so an entry
-- the phone saves is never refused here and stuck Waiting.

alter table public.scouting_entries
  -- "How well does it do its role?"
  add column role_notes text check (char_length(role_notes) between 1 and 300),
  -- Any of BREAKDOWN_PARTS in src/modules/scouting/season.ts. They change by
  -- season, so they aren't listed here.
  add column broke_parts text[] not null default '{}' check (cardinality(broke_parts) <= 20),
  add column broke_other text check (char_length(broke_other) between 1 and 300),
  -- Lost power or visibly browned out: different from a mechanism breaking.
  add column browned_out boolean not null default false,
  -- One of AUTO_SIDES in season.ts. Empty if the scout didn't see.
  add column auto_side text check (char_length(auto_side) between 1 and 60),
  add column auto_notes text check (char_length(auto_notes) between 1 and 300),
  -- Any of RANKING_POINTS in season.ts.
  add column ranking_points text[] not null default '{}' check (cardinality(ranking_points) <= 20);

-- A robot can be both E-stopped and A-stopped in one match.
alter table public.scouting_entries drop constraint scouting_entries_stop_check;
alter table public.scouting_entries
  add constraint scouting_entries_stop_check check (stop in ('None', 'A-stop', 'E-stop', 'Both'));
