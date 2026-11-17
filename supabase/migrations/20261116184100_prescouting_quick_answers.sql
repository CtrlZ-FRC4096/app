-- Prescouting: quick answers for each team (#184), so teams are easy to
-- compare at a glance. All optional: empty text or null means we don't
-- know yet. Rows already saved start with none filled in.
--
--   drivetrain     One of DRIVETRAINS in src/modules/scouting/season.ts.
--   best_climb     The highest level they can climb, one of ENDGAME in
--                  season.ts ('None' means they can't climb).
--   auto_fuel      About how many fuel they score in auto, 0 to 99.
--   cycle_seconds  About how many seconds a scoring cycle takes, 1 to 150.
--   rating         Our overall rating, 1 (weak) to 5 (great).
--
-- The choice lists change each season, so the database only limits their
-- length; the app (checkFacts() in src/modules/scouting/prescouting/data.ts)
-- checks they're on the list. The number limits are the same in both.

alter table public.prescouting_notes
  add column drivetrain text not null default '' check (char_length(drivetrain) <= 60),
  add column best_climb text not null default '' check (char_length(best_climb) <= 60),
  add column auto_fuel integer check (auto_fuel between 0 and 99),
  add column cycle_seconds integer check (cycle_seconds between 1 and 150),
  add column rating integer check (rating between 1 and 5);

-- Anyone who can change the other answers can change these.
grant update (drivetrain, best_climb, auto_fuel, cycle_seconds, rating) on table public.prescouting_notes to authenticated;
