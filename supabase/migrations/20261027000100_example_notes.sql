-- The Example module's table: short notes anyone on the team can post.
--
-- Copy this file when your module needs a table. Name the copy with the
-- date and time and what it does, like 20261101180000_inventory_parts.sql,
-- because migrations run in name order. Never edit a migration once it has
-- been merged: the database has already run it. Write a new one instead.
--
-- Every table has:
--   id, created_at, created_by   filled in by the database
--   row level security           on, so the rules below are the only way in
--   rules (policies)             who can read, add, change and delete rows
--
-- The helpers private.is_member(), private.is_mentor() and
-- private.is_admin() come from the members migration.

create table public.example_notes (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(text) between 1 and 200),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

alter table public.example_notes enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.example_notes from anon, authenticated;
grant select, insert, delete on table public.example_notes to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.example_notes;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can read notes"
  on public.example_notes for select to authenticated
  using ((select private.is_member()));

create policy "Members can post notes as themselves"
  on public.example_notes for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Mentors can remove notes"
  on public.example_notes for delete to authenticated
  using ((select private.is_mentor()));

-- No update rule, so nobody can edit a note after posting it.
