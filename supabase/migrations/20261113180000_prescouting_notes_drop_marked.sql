-- Prescouting: drop the old shared Mark (#118). Stars replaced it, and the
-- stars migration (..._scouting_prescout_stars.sql) already turned every
-- marked team into a team star, so nothing is lost.

alter table public.prescouting_notes drop column marked;
