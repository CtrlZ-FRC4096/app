-- Mentors and admins sign off hands-on skills (Training). This adds to
-- ..._training_signoffs.sql, where students ask for a sign-off:
--
--   - Sign off a request: change its status to 'signed_off'.
--   - Sign people off without a request, such as after a shop safety
--     session: add a 'signed_off' row for each of them.
--   - "Not yet" on a request, or take back a sign-off made by mistake:
--     delete the row, so the person can ask again later.
--
-- The database fills in who signed off and when (signed_off_by and
-- signed_off_at), so neither can be faked: nobody can write those columns.

-- Mentors add rows for other people, already signed off. Students get the
-- same columns, but their rule (in ..._training_signoffs.sql) still only
-- lets them add a request for themselves.
grant insert (created_by, status) on table public.training_signoffs to authenticated;
grant update (status) on table public.training_signoffs to authenticated;

create policy "Mentors sign people off"
  on public.training_signoffs for insert to authenticated
  with check ((select private.is_mentor()));

create policy "Mentors sign off requests"
  on public.training_signoffs for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors turn down requests and take back sign-offs"
  on public.training_signoffs for delete to authenticated
  using ((select private.is_mentor()));

-- Before a row is added or changed: when it becomes signed off, record who
-- did it and when, and keep that afterwards. A request has neither. (Runs as
-- the person changing it, with their permissions.)
--
-- Changes made straight in the database, with nobody signed in (like
-- Supabase's SQL editor), are left as they are, so a mentor can add old
-- sign-offs with their real dates.
create function private.record_training_signoff()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.status = 'signed_off' then
    if tg_op = 'UPDATE' and old.status = 'signed_off' then
      new.signed_off_by := old.signed_off_by;
      new.signed_off_at := old.signed_off_at;
    else
      new.signed_off_by := auth.uid();
      new.signed_off_at := now();
    end if;
  else
    new.signed_off_by := null;
    new.signed_off_at := null;
  end if;
  return new;
end;
$$;

create trigger record_training_signoff
  before insert or update on public.training_signoffs
  for each row execute function private.record_training_signoff();
