-- The CNC module (issues #54, #55 and #56): what needs cutting on the
-- router, the stock it's cut from, each sheet we have, and where every part
-- came out of each sheet.
--
--   cnc_stock        Kinds of stock, like "1/4 in aluminum plate", with the
--                    router settings for each. Mentors manage these.
--   cnc_jobs         Parts waiting to be cut, being cut, and cut. Anyone on
--                    the team adds them (from the BOM) and moves them along.
--   cnc_shapes       Each part's size and outline, read from Onshape once
--                    and kept, so the team's yearly Onshape API calls aren't
--                    spent asking again.
--   cnc_sheets       The real sheets on the rack, each with an ID like
--                    AL250-007 written on it.
--   cnc_sheet_cuts   Where parts were cut (or are planned to be) on a sheet.
--
-- Everyone on the team can read everything, add jobs, sheets and cuts, and
-- change them. Deleting stays with mentors, except that people can delete
-- cuts they recorded themselves and planned cuts, to fix mistakes.
-- All sizes are in inches.

-- Kinds of stock.
create table public.cnc_stock (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('plate', 'tube', 'bar', 'other')),
  -- What everyone calls it: "1/4 in aluminum plate", "2 x 1 in aluminum tube".
  name text not null unique check (char_length(trim(name)) between 1 and 100),
  -- The start of each sheet's ID: AL250 in AL250-007.
  code text not null unique check (code ~ '^[A-Z0-9]{2,8}$'),
  material text not null check (char_length(trim(material)) between 1 and 100),
  -- A plate's thickness, or a tube's wall.
  thickness_in numeric check (thickness_in > 0 and thickness_in < 12),
  -- The size of a full sheet when it's bought, for new sheets and the "too big" check.
  sheet_width_in numeric check (sheet_width_in > 0 and sheet_width_in <= 240),
  sheet_length_in numeric check (sheet_length_in > 0 and sheet_length_in <= 240),
  -- Router settings, for time estimates and design checks.
  bit_in numeric check (bit_in > 0 and bit_in < 2),
  feed_ipm numeric check (feed_ipm > 0 and feed_ipm < 2000),
  depth_per_pass_in numeric check (depth_per_pass_in > 0 and depth_per_pass_in < 12),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

-- Parts to cut. A job is one part from the BOM and how many to cut.
create table public.cnc_jobs (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.bom_parts (id) on delete cascade,
  -- Empty until someone picks the stock.
  stock_id uuid references public.cnc_stock (id) on delete set null,
  quantity integer not null check (quantity between 1 and 999),
  status text not null default 'to_cut' check (status in ('to_cut', 'cutting', 'cut')),
  note text check (char_length(trim(note)) between 1 and 300),
  -- When the status last changed, and who changed it. Filled in by the trigger below.
  status_at timestamptz not null default now(),
  status_by uuid default auth.uid() references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

create index on public.cnc_jobs (part_id);
create index on public.cnc_jobs (stock_id);

-- A part's shape from Onshape, one per part. Outlines are lists of loops,
-- each a flat list of numbers [x0, y0, x1, y1, ...]; the first is the outside.
create table public.cnc_shapes (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null unique references public.bom_parts (id) on delete cascade,
  -- Which Onshape part it was read from, and its version then, to tell when it changes.
  onshape_id text not null check (char_length(onshape_id) between 1 and 1000),
  microversion text check (char_length(microversion) between 1 and 100),
  -- Which of the part's own axes is its thickness, and where its bottom face is on it.
  axis text not null check (axis in ('x', 'y', 'z')),
  low_in numeric not null,
  thickness_in numeric not null check (thickness_in >= 0),
  width_in numeric not null check (width_in >= 0),
  length_in numeric not null check (length_in >= 0),
  outline jsonb not null default '[]' check (jsonb_typeof(outline) = 'array' and pg_column_size(outline) <= 262144),
  -- For time estimates and design checks.
  cut_length_in numeric not null check (cut_length_in >= 0),
  smallest_hole_in numeric,
  tightest_inside_radius_in numeric,
  sharp_inside_corners integer not null default 0 check (sharp_inside_corners >= 0),
  narrowest_gap_in numeric,
  -- Pockets or steps that don't go all the way through.
  pockets boolean not null default false,
  -- When it was last read, and by whom. Filled in by the trigger below.
  read_at timestamptz not null default now(),
  read_by uuid default auth.uid() references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

-- The real sheets of stock, each labelled with its ID.
create table public.cnc_sheets (
  id uuid primary key default gen_random_uuid(),
  label text not null unique check (label ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  -- A stock with sheets can't be deleted: scrap or delete the sheets first.
  stock_id uuid not null references public.cnc_stock (id) on delete restrict,
  width_in numeric not null check (width_in > 0 and width_in <= 240),
  length_in numeric not null check (length_in > 0 and length_in <= 240),
  location text check (char_length(trim(location)) between 1 and 100),
  status text not null default 'new' check (status in ('new', 'partly_used', 'scrap')),
  -- An Onshape assembly with the parts laid out on this sheet, to read cuts from.
  onshape_url text check (onshape_url like 'https://cad.onshape.com/%' and char_length(onshape_url) <= 500),
  -- The sheet this one was cut from, for a leftover piece.
  parent_id uuid references public.cnc_sheets (id) on delete set null,
  note text check (char_length(trim(note)) between 1 and 300),
  layout_read_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

create index on public.cnc_sheets (stock_id);

-- Where parts were cut, or are planned to be, on a sheet. A sheet's length
-- runs along x and its width along y, from the corner at the Onshape
-- layout's origin. x and y are the corner of the part's box; length_in and
-- width_in are how far the box runs along x and y. The outline, if there is
-- one, is drawn from the box's corner.
create table public.cnc_sheet_cuts (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.cnc_sheets (id) on delete cascade,
  job_id uuid references public.cnc_jobs (id) on delete set null,
  part_id uuid references public.bom_parts (id) on delete set null,
  -- The part's name when it was cut, so the cut still says what it was if the part goes.
  name text not null check (char_length(trim(name)) between 1 and 100),
  x_in numeric not null check (x_in between -240 and 480),
  y_in numeric not null check (y_in between -240 and 480),
  width_in numeric not null check (width_in > 0 and width_in <= 240),
  length_in numeric not null check (length_in > 0 and length_in <= 240),
  rotation_deg numeric not null default 0 check (rotation_deg between -360 and 360),
  outline jsonb check (jsonb_typeof(outline) = 'array' and pg_column_size(outline) <= 262144),
  source text not null check (source in ('onshape', 'manual')),
  status text not null default 'cut' check (status in ('planned', 'cut')),
  -- When it was cut, and by whom. Filled in by the trigger below.
  cut_at timestamptz,
  cut_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

create index on public.cnc_sheet_cuts (sheet_id);
create index on public.cnc_sheet_cuts (job_id);

alter table public.cnc_stock enable row level security;
alter table public.cnc_jobs enable row level security;
alter table public.cnc_shapes enable row level security;
alter table public.cnc_sheets enable row level security;
alter table public.cnc_sheet_cuts enable row level security;

-- Signed-out visitors get nothing. Signed-in people can only ever write the
-- columns below: who made something, and when, is filled in for them.
revoke all on table public.cnc_stock, public.cnc_jobs, public.cnc_shapes, public.cnc_sheets, public.cnc_sheet_cuts from anon, authenticated;
grant select, delete on table public.cnc_stock, public.cnc_jobs, public.cnc_shapes, public.cnc_sheets, public.cnc_sheet_cuts to authenticated;

grant insert (kind, name, code, material, thickness_in, sheet_width_in, sheet_length_in, bit_in, feed_ipm, depth_per_pass_in),
  update (kind, name, code, material, thickness_in, sheet_width_in, sheet_length_in, bit_in, feed_ipm, depth_per_pass_in)
  on table public.cnc_stock to authenticated;

grant insert (part_id, stock_id, quantity, status, note), update (stock_id, quantity, status, note)
  on table public.cnc_jobs to authenticated;

grant insert (part_id, onshape_id, microversion, axis, low_in, thickness_in, width_in, length_in, outline, cut_length_in,
    smallest_hole_in, tightest_inside_radius_in, sharp_inside_corners, narrowest_gap_in, pockets),
  update (onshape_id, microversion, axis, low_in, thickness_in, width_in, length_in, outline, cut_length_in,
    smallest_hole_in, tightest_inside_radius_in, sharp_inside_corners, narrowest_gap_in, pockets)
  on table public.cnc_shapes to authenticated;

grant insert (label, stock_id, width_in, length_in, location, status, onshape_url, parent_id, note),
  update (label, width_in, length_in, location, status, onshape_url, note, layout_read_at)
  on table public.cnc_sheets to authenticated;

grant insert (sheet_id, job_id, part_id, name, x_in, y_in, width_in, length_in, rotation_deg, outline, source, status),
  update (status)
  on table public.cnc_sheet_cuts to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.cnc_stock, public.cnc_jobs, public.cnc_shapes, public.cnc_sheets, public.cnc_sheet_cuts;

-- The rules. Wrapping the helpers in (select ...) lets the database work out
-- the answer once per query instead of once per row.

-- Stock: everyone reads, mentors manage.
create policy "Members can read stock"
  on public.cnc_stock for select to authenticated
  using ((select private.is_member()));

create policy "Mentors can add stock"
  on public.cnc_stock for insert to authenticated
  with check ((select private.is_mentor()));

create policy "Mentors can change stock"
  on public.cnc_stock for update to authenticated
  using ((select private.is_mentor()))
  with check ((select private.is_mentor()));

create policy "Mentors can delete stock"
  on public.cnc_stock for delete to authenticated
  using ((select private.is_mentor()));

-- Jobs, shapes and sheets: everyone reads, adds and changes; mentors delete.
create policy "Members can read jobs"
  on public.cnc_jobs for select to authenticated
  using ((select private.is_member()));

create policy "Members can add jobs"
  on public.cnc_jobs for insert to authenticated
  with check ((select private.is_member()));

create policy "Members can change jobs"
  on public.cnc_jobs for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

create policy "Mentors can delete jobs"
  on public.cnc_jobs for delete to authenticated
  using ((select private.is_mentor()));

create policy "Members can read shapes"
  on public.cnc_shapes for select to authenticated
  using ((select private.is_member()));

create policy "Members can add shapes"
  on public.cnc_shapes for insert to authenticated
  with check ((select private.is_member()));

create policy "Members can change shapes"
  on public.cnc_shapes for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

create policy "Mentors can delete shapes"
  on public.cnc_shapes for delete to authenticated
  using ((select private.is_mentor()));

create policy "Members can read sheets"
  on public.cnc_sheets for select to authenticated
  using ((select private.is_member()));

create policy "Members can add sheets"
  on public.cnc_sheets for insert to authenticated
  with check ((select private.is_member()));

create policy "Members can change sheets"
  on public.cnc_sheets for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

create policy "Mentors can delete sheets"
  on public.cnc_sheets for delete to authenticated
  using ((select private.is_mentor()));

-- Cuts: everyone reads, adds, and marks planned cuts as cut. Anyone can
-- delete a planned cut or one they recorded; mentors can delete any.
create policy "Members can read cuts"
  on public.cnc_sheet_cuts for select to authenticated
  using ((select private.is_member()));

create policy "Members can add cuts"
  on public.cnc_sheet_cuts for insert to authenticated
  with check ((select private.is_member()));

create policy "Members can change cuts"
  on public.cnc_sheet_cuts for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

create policy "Members can delete planned cuts and their own"
  on public.cnc_sheet_cuts for delete to authenticated
  using ((select private.is_member()) and (status = 'planned' or created_by = (select auth.uid()) or (select private.is_mentor())));

-- When a job's status changes: note when and who. When it's marked cut, the
-- cuts planned for it on sheets become cuts too, so the sheets show what's
-- really gone. (Runs as the person changing it, with their permissions.)
create function private.cnc_job_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_at := now();
    new.status_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger cnc_job_status
  before update on public.cnc_jobs
  for each row execute function private.cnc_job_status();

create function private.cnc_job_cut()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'cut' and old.status <> 'cut' then
    update public.cnc_sheet_cuts set status = 'cut' where job_id = new.id and status = 'planned';
  end if;
  return null;
end;
$$;

create trigger cnc_job_cut
  after update on public.cnc_jobs
  for each row execute function private.cnc_job_cut();

-- When a cut is recorded: note when and who, and a new sheet becomes partly used.
create function private.cnc_cut_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'cut' and (tg_op = 'INSERT' or old.status <> 'cut') then
    new.cut_at := now();
    new.cut_by := auth.uid();
  elsif new.status = 'planned' then
    new.cut_at := null;
    new.cut_by := null;
  end if;
  return new;
end;
$$;

create trigger cnc_cut_status
  before insert or update on public.cnc_sheet_cuts
  for each row execute function private.cnc_cut_status();

create function private.cnc_sheet_used()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'cut' then
    update public.cnc_sheets set status = 'partly_used' where id = new.sheet_id and status = 'new';
  end if;
  return null;
end;
$$;

create trigger cnc_sheet_used
  after insert or update on public.cnc_sheet_cuts
  for each row execute function private.cnc_sheet_used();

-- Reading a shape again from Onshape: note when and who.
create function private.cnc_shape_read()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.read_at := now();
  new.read_by := auth.uid();
  return new;
end;
$$;

create trigger cnc_shape_read
  before update on public.cnc_shapes
  for each row execute function private.cnc_shape_read();
