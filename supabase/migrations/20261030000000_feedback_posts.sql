-- The Feedback module's table: ideas and problems anyone on the team can send.
--
-- Everyone signed in can send a post and read the list. Mentors and admins
-- can delete one. Nobody can change a post after sending it, so what someone
-- wrote stays what they wrote.
--
-- The helpers private.is_member() and private.is_mentor() come from the
-- members migration. private.is_mentor() is true for mentors and admins.

create table public.feedback_posts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('Idea', 'Problem')),
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

alter table public.feedback_posts enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
revoke all on table public.feedback_posts from anon, authenticated;
grant select, insert, delete on table public.feedback_posts to authenticated;

-- Posts from other people show up in the app straight away.
alter publication supabase_realtime add table public.feedback_posts;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

create policy "Members can read feedback"
  on public.feedback_posts for select to authenticated
  using ((select private.is_member()));

create policy "Members can send feedback as themselves"
  on public.feedback_posts for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Mentors and admins can delete feedback"
  on public.feedback_posts for delete to authenticated
  using ((select private.is_mentor()));

-- No update rule, so nobody can edit a post after sending it.
