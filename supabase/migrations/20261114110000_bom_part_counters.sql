-- BOM: never give out the same part number twice (#21).
--
-- The app gives a new part the next number in its series, like
-- 4096-26-INT-007 after 4096-26-INT-006. It used to work that out from the
-- parts there are now, so deleting the highest-numbered part let the next
-- new part take its number again, and an old printed drawing could point at
-- the wrong part.
--
--   bom_part_counters   the highest number each series has ever used. A
--                       series is team, year and system code: 4096-26-INT.
--                       One row per series, not per system, because part
--                       numbers are unique across the whole BOM: a system
--                       deleted and added again, or two robots that both
--                       have an INT system, share the series.
--
-- Nobody writes these rows from the app. The trigger below raises the
-- number whenever a part with a team number is added or renumbered, and
-- never lowers it, so nobody can turn it back. Members can read them, so the
-- app can work out the next number.
--
-- The helper private.is_member() comes from the members migration.

create table public.bom_part_counters (
  id uuid primary key default gen_random_uuid(),
  -- Team, year and system code, like 4096-26-INT.
  series text not null unique check (series ~ '^4096-[0-9]{2}-[A-Z]{2,4}$'),
  -- The highest number used in the series: 6 for 4096-26-INT-006.
  last_number integer not null check (last_number between 0 and 999999),
  created_at timestamptz not null default now()
);

alter table public.bom_part_counters enable row level security;

-- Signed-out visitors get nothing. Signed-in people can only read: there's
-- no insert, update or delete grant, so only the trigger changes the rows.
revoke all on table public.bom_part_counters from anon, authenticated;
grant select on table public.bom_part_counters to authenticated;

-- Changes show up in the app straight away.
alter publication supabase_realtime add table public.bom_part_counters;

create policy "Members can read part number counters"
  on public.bom_part_counters for select to authenticated
  using ((select private.is_member()));

-- Remember a part's number if it's a team number like 4096-26-INT-014.
-- Other numbers (a vendor's, or one typed into Onshape by hand) are left
-- alone. Security definer, so it can write the counters for whoever added
-- the part; the rules on bom_parts already decided they may.
create function private.remember_part_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  found text[] := regexp_match(new.part_number, '^(4096-[0-9]{2}-[A-Z]{2,4})-([0-9]{1,6})$');
begin
  if found is not null then
    insert into public.bom_part_counters (series, last_number)
    values (found[1], found[2]::integer)
    on conflict (series) do update
      set last_number = greatest(public.bom_part_counters.last_number, excluded.last_number);
  end if;
  return null;
end;
$$;

revoke all on function private.remember_part_number() from public;

create trigger remember_part_number
  after insert or update of part_number on public.bom_parts
  for each row execute function private.remember_part_number();

-- Start from the parts there are now. (Parts already deleted before this
-- migration can't be remembered: nothing kept their numbers.)
insert into public.bom_part_counters (series, last_number)
select found[1], max(found[2]::integer)
from public.bom_parts
cross join lateral regexp_match(part_number, '^(4096-[0-9]{2}-[A-Z]{2,4})-([0-9]{1,6})$') as match (found)
where found is not null
group by found[1];
