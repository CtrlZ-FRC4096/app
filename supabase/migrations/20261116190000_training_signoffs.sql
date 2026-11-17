-- The Training module's hands-on skills: who has asked a mentor for a
-- sign-off, and who has been signed off. One row per person per skill.
--
-- skill_id is the skill's id from src/modules/training/data.ts, like
-- 'drill-press'. The list of skills lives there, not in the database.
--
-- A student asks for a sign-off, which adds a 'requested' row for
-- themselves, and can take it back while it's waiting. Signing people off is
-- for mentors and admins, and comes in the next migration
-- (..._training_signoffs_mentors.sql).

create table public.training_signoffs (
  id uuid primary key default gen_random_uuid(),
  skill_id text not null check (char_length(skill_id) between 1 and 100),
  status text not null default 'requested' check (status in ('requested', 'signed_off')),
  -- The mentor who signed it off, and when. Empty while it's requested.
  -- If the mentor's account is removed, the sign-off stays without a name.
  signed_off_by uuid references public.members (id) on delete set null,
  signed_off_at timestamptz,
  created_at timestamptz not null default now(),
  -- Whose sign-off it is. Their sign-offs go if their account is removed.
  created_by uuid not null default auth.uid() references public.members (id) on delete cascade,
  -- Each person asks for, or is signed off on, a skill once.
  unique (created_by, skill_id),
  -- Signed off means there's a date; requested means there's no mentor or date.
  check ((status = 'signed_off') = (signed_off_at is not null)),
  check (status = 'signed_off' or signed_off_by is null)
);

alter table public.training_signoffs enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules
-- allow, and can only ever fill in the skill when they ask: the status
-- starts as 'requested', and created_by is filled in with who they are.
revoke all on table public.training_signoffs from anon, authenticated;
grant select, delete on table public.training_signoffs to authenticated;
grant insert (skill_id) on table public.training_signoffs to authenticated;

-- Changes from other tabs and devices show up in the app straight away.
alter publication supabase_realtime add table public.training_signoffs;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can see their own sign-offs, and mentors everyone's"
  on public.training_signoffs for select to authenticated
  using (
    ((select private.is_member()) and created_by = (select auth.uid()))
    or (select private.is_mentor())
  );

-- Asking is only ever for yourself, and only ever a request: nobody can
-- sign themselves off.
create policy "Members can ask for a sign-off for themselves"
  on public.training_signoffs for insert to authenticated
  with check (
    (select private.is_member())
    and created_by = (select auth.uid())
    and status = 'requested'
    and signed_off_by is null
    and signed_off_at is null
  );

create policy "Members can cancel their own request while it's waiting"
  on public.training_signoffs for delete to authenticated
  using ((select private.is_member()) and created_by = (select auth.uid()) and status = 'requested');

-- No update rule here: nobody can change a row yet. Mentors signing people
-- off comes in ..._training_signoffs_mentors.sql.
