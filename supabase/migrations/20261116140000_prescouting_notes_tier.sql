-- Prescouting: a tier list (#191). Each team gets a tier, S (best), A, B,
-- C, D or F, so the scouting team can rank the teams before the event and
-- sort the overview by it. One tier per team per event, on their
-- prescouting_notes row, shared by everyone. Whoever changes it last wins.
--
-- Empty (null) until someone chooses one: the app shows that as "Not
-- rated". The same letters as TIERS in src/modules/prescouting/data.ts.

alter table public.prescouting_notes
  add column tier text check (tier in ('S', 'A', 'B', 'C', 'D', 'F'));

-- Anyone who can change the answers can change the tier.
grant update (tier) on table public.prescouting_notes to authenticated;
