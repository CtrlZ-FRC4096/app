-- The Pit checklist (the status module, #146): the list of things to do to
-- get the robot ready, and who did each one before each match.
--
-- Two tables:
--   pit_checklist_items    the checklist itself: one row per item
--   pit_checklist_checks   one row per item checked for a match. Unchecking
--                          deletes the row. Each match starts fresh, and
--                          the rows left are a record of what was done
--                          before each match.
--
-- Who can do what:
--   members        read the items and every check
--   mentors/admins add, rename, assign, reorder and delete items, and check
--                  or uncheck any item
--   students       check or uncheck only the items assigned to them
--
-- The helpers private.is_member() and private.is_mentor() come from the
-- members migration. private.is_mentor() is true for mentors and admins.

create table public.pit_checklist_items (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(text) between 1 and 200),
  -- General, Mechanical, Electrical, Programming or Drive team. The list is
  -- PIT_SUBGROUPS in src/modules/status/data.ts, so it isn't fixed here.
  subgroup text not null default 'General' check (char_length(subgroup) between 1 and 40),
  -- Who the item is assigned to: members' ids. An array (rather than a
  -- separate table) so the rule for checks below can ask "is this person in
  -- assignee_ids?" in one step. An array can't have a foreign key, so a
  -- removed member's id can stay here; the app shows them as "Former member"
  -- and a mentor reassigns the item.
  assignee_ids uuid[] not null default '{}',
  -- The item's place in the list. A fraction, so moving an item only
  -- changes that one item: it goes halfway between its new neighbours.
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

create table public.pit_checklist_checks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.pit_checklist_items (id) on delete cascade,
  -- The Blue Alliance's match key, like 2026ilch_qm12, or 'practice' for the
  -- round used when there's no schedule (PRACTICE_KEY in data.ts).
  match_key text not null check (char_length(match_key) between 1 and 60),
  -- When it was checked, and who checked it.
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references public.members (id) on delete cascade,
  -- An item is checked once for each match.
  unique (item_id, match_key)
);

create index pit_checklist_checks_match on public.pit_checklist_checks (match_key);

alter table public.pit_checklist_items enable row level security;
alter table public.pit_checklist_checks enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
-- Checks have no update: a check is there or it isn't.
revoke all on table public.pit_checklist_items from anon, authenticated;
revoke all on table public.pit_checklist_checks from anon, authenticated;
grant select, insert, update, delete on table public.pit_checklist_items to authenticated;
grant select, insert, delete on table public.pit_checklist_checks to authenticated;

-- A mentor sees a student's check on their own phone straight away.
alter publication supabase_realtime add table public.pit_checklist_items;
alter publication supabase_realtime add table public.pit_checklist_checks;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can read the pit checklist"
  on public.pit_checklist_items for select to authenticated
  using ((select private.is_member()));

create policy "Mentors can add pit checklist items as themselves"
  on public.pit_checklist_items for insert to authenticated
  with check ((select private.is_mentor()) and created_by = (select auth.uid()));

create policy "Mentors can rename, assign and reorder pit checklist items"
  on public.pit_checklist_items for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors can delete pit checklist items"
  on public.pit_checklist_items for delete to authenticated
  using ((select private.is_mentor()));

create policy "Members can read every check"
  on public.pit_checklist_checks for select to authenticated
  using ((select private.is_member()));

-- A check is signed by whoever checked it. Students can only check items
-- assigned to them; mentors and admins can check anything.
create policy "Members can check their own items, and mentors any item"
  on public.pit_checklist_checks for insert to authenticated
  with check (
    (select private.is_member())
    and created_by = (select auth.uid())
    and (
      (select private.is_mentor())
      or exists (
        select 1 from public.pit_checklist_items item
        where item.id = item_id and (select auth.uid()) = any (item.assignee_ids)
      )
    )
  );

-- Unchecking follows the same rule: the item must be assigned to you, so a
-- student can't undo someone else's work.
create policy "Members can uncheck their own items, and mentors any item"
  on public.pit_checklist_checks for delete to authenticated
  using (
    (select private.is_member())
    and (
      (select private.is_mentor())
      or exists (
        select 1 from public.pit_checklist_items item
        where item.id = item_id and (select auth.uid()) = any (item.assignee_ids)
      )
    )
  );
