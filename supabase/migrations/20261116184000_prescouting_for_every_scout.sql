-- Prescouting is a tab in Scouting now (#184), and every scout can use it,
-- not only the strategy team (#167). This changes the rules on its three
-- tables back from the strategy team (private.is_strategy(), from
-- ..._scouting_strategy_team.sql) to anyone who can scout: a signed-in
-- member whose access is on (private.is_member()), the same people who can
-- send match entries (..._scouting_entries.sql).
--
-- Everything else stays as it was:
--   - Notes: members read, add (as themselves) and change them; student
--     leaders, mentors and admins delete them ("Leaders can delete
--     prescouting", unchanged).
--   - Stars: a star just for you is still seen only by you. Members see
--     team stars, star as themselves, and remove their own; student
--     leaders, mentors and admins also remove any team star. Nobody
--     changes a star.
--   - Matches scouted from video: members read every row, add their own,
--     and change or remove their own; student leaders, mentors and admins
--     remove anyone's.
-- Signed-out visitors still get nothing.

-- Notes (..._prescouting_notes.sql).
drop policy "Strategy reads prescouting" on public.prescouting_notes;
create policy "Members can read prescouting"
  on public.prescouting_notes for select to authenticated
  using ((select private.is_member()));

drop policy "Strategy adds prescouting as themselves" on public.prescouting_notes;
create policy "Members can add prescouting as themselves"
  on public.prescouting_notes for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

drop policy "Strategy changes prescouting" on public.prescouting_notes;
create policy "Members can change prescouting"
  on public.prescouting_notes for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

-- Stars (..._prescouting_stars.sql).
drop policy "Strategy sees team stars and their own" on public.prescouting_stars;
create policy "Members see team stars and their own"
  on public.prescouting_stars for select to authenticated
  using ((select private.is_member()) and (for_team or created_by = (select auth.uid())));

drop policy "Strategy can star teams as themselves" on public.prescouting_stars;
create policy "Members can star teams as themselves"
  on public.prescouting_stars for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

drop policy "Strategy removes their own stars, and leaders any team star" on public.prescouting_stars;
create policy "Members remove their own stars, and leaders any team star"
  on public.prescouting_stars for delete to authenticated
  using (
    (select private.is_member())
    and (created_by = (select auth.uid()) or (for_team and (select private.is_leader())))
  );

-- Matches scouted from video (..._prescouting_matches.sql).
drop policy "Strategy reads prescouted matches" on public.prescouting_matches;
create policy "Members read prescouted matches"
  on public.prescouting_matches for select to authenticated
  using ((select private.is_member()));

drop policy "Strategy prescouts matches as themselves" on public.prescouting_matches;
create policy "Members prescout matches as themselves"
  on public.prescouting_matches for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

drop policy "Strategy changes their own prescouted matches" on public.prescouting_matches;
create policy "Members change their own prescouted matches"
  on public.prescouting_matches for update to authenticated
  using ((select private.is_member()) and created_by = (select auth.uid()))
  with check ((select private.is_member()) and created_by = (select auth.uid()));

drop policy "Strategy removes their own prescouted matches, and leaders anyone's" on public.prescouting_matches;
create policy "Members remove their own prescouted matches, and leaders anyone's"
  on public.prescouting_matches for delete to authenticated
  using ((select private.is_member()) and (created_by = (select auth.uid()) or (select private.is_leader())));
