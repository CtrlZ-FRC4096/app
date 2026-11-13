-- Prescouting: an overall summary of each team (#153), like "Strong
-- scorer, inconsistent climb, good second pick". It's the first question on
-- a team's prescouting page, and shows on the overview card.
--
-- Rows already saved get an empty summary, like the other answers start.
-- The same 2000-character limit as the other answers (MAX_PRESCOUT_ANSWER
-- in src/modules/prescouting/data.ts).

alter table public.prescouting_notes
  add column overall text not null default '' check (char_length(overall) <= 2000);

-- Anyone who can change the other answers can change this one.
grant update (overall) on table public.prescouting_notes to authenticated;
