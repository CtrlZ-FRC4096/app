-- The Training module's table: which lessons each person has finished.
-- One row means "this person finished this lesson". Marking a lesson not
-- done deletes the row.
--
-- lesson_id is the lesson's id from src/modules/training/data.ts, like
-- 'code-first-button'. The lessons themselves live on the wiki.

create table public.training_progress (
  id uuid primary key default gen_random_uuid(),
  lesson_id text not null check (char_length(lesson_id) between 1 and 100),
  created_at timestamptz not null default now(),
  -- Who finished it. Their progress goes if their account is removed.
  created_by uuid not null default auth.uid() references public.members (id) on delete cascade,
  -- Each person finishes a lesson once.
  unique (created_by, lesson_id)
);

alter table public.training_progress enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.training_progress from anon, authenticated;
grant select, insert, delete on table public.training_progress to authenticated;

-- Changes from other tabs and devices show up in the app straight away.
alter publication supabase_realtime add table public.training_progress;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can see their own progress, and mentors everyone's"
  on public.training_progress for select to authenticated
  using (
    ((select private.is_member()) and created_by = (select auth.uid()))
    or (select private.is_mentor())
  );

create policy "Members can mark lessons done for themselves"
  on public.training_progress for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Members can mark their own lessons not done"
  on public.training_progress for delete to authenticated
  using ((select private.is_member()) and created_by = (select auth.uid()));

-- No update rule: a lesson is either done (a row) or not (no row).
