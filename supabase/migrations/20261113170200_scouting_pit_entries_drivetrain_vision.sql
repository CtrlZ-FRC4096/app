-- More questions on the Scouting module's pit form (#163): the drivetrain
-- typed when it's Other, and what the robot can see.
--
-- Pit entries saved on phones before this don't have these, so every new
-- column is empty by default, and those entries still sync.
--
-- The checks match checkPitEntry() in src/modules/scouting/data.ts, so an
-- entry the phone saves is never refused here and stuck Waiting.

alter table public.scouting_pit_entries
  -- Like "West coast with butterfly modules", when the drivetrain is Other.
  add column drivetrain_other text check (char_length(drivetrain_other) between 1 and 100),
  -- Any of VISION in src/modules/scouting/season.ts, like {AprilTags}. They
  -- change by season, so they aren't listed here.
  add column vision text[] not null default '{}' check (cardinality(vision) <= 20),
  add column vision_notes text check (char_length(vision_notes) between 1 and 300);
