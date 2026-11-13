-- Scouting: photos of each robot (#164), taken from the pit form and shown
-- on the team's page.
--
-- Like pit entries, a photo is saved on the scout's phone first, because
-- venue Wi-Fi is unreliable, then sent when there's a connection: the file
-- goes to the private robot-photos bucket, then a row goes in
-- scouting_robot_photos. The row keeps the id the phone gave the photo, and
-- the app sends it with "on conflict do nothing", so sending a photo twice
-- never makes two rows.
--
-- The strategy team (and mentors) see every photo (#167); anyone else sees
-- the ones they took or sent. Signed-in members add their own. Only mentors
-- and admins delete them. Nobody changes one after it's added.
--
-- The phone shrinks each photo to a JPEG before saving it, so the bucket
-- only takes JPEGs (not image/*: that would let in SVG images, which can
-- run code when they're opened).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'robot-photos',
  'robot-photos',
  false,
  5242880, -- 5 MB. A shrunk photo is far smaller.
  array['image/jpeg']
);

create table public.scouting_robot_photos (
  -- Made on the phone, not here.
  id uuid primary key,
  -- The event, like 2026ilch.
  event_key text not null check (char_length(event_key) between 1 and 40),
  team_number integer not null check (team_number between 1 and 99999),
  -- Where the file is in the bucket: the event, the team, then the photo's
  -- own id, like 2026ilch/9991/<id>.jpg.
  path text not null unique check (
    path = event_key || '/' || team_number::text || '/' || id::text || '.jpg'
  ),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  -- Who took it, and when, on the phone. Usually whoever sends it, but a
  -- phone shared between scouts can send someone else's photos.
  taken_by uuid references public.members (id) on delete set null,
  taken_at timestamptz not null,
  -- When it reached the team database, and who sent it.
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null
);

create index on public.scouting_robot_photos (event_key, team_number);

alter table public.scouting_robot_photos enable row level security;

-- Signed-out visitors get nothing. Nobody can change a photo after adding it.
revoke all on table public.scouting_robot_photos from anon, authenticated;
grant select, insert, delete on table public.scouting_robot_photos to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.scouting_robot_photos;

create policy "Strategy sees every robot photo, scouts their own"
  on public.scouting_robot_photos for select to authenticated
  using (
    (select private.is_strategy())
    or ((select private.is_member()) and (created_by = (select auth.uid()) or taken_by = (select auth.uid())))
  );

create policy "Members can send robot photos as themselves"
  on public.scouting_robot_photos for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Mentors can delete robot photos"
  on public.scouting_robot_photos for delete to authenticated
  using ((select private.is_mentor()));

-- The rules for the files themselves. storage.objects holds every bucket's
-- files, so each rule starts by naming this bucket. There's no update rule,
-- so a photo can't be swapped for another file.

-- Only the strategy team opens the files: a scout sees their own photos from
-- their phone until they're sent.
create policy "Strategy can open robot photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'robot-photos' and (select private.is_strategy()));

-- Files go in an event/team folder, named with an id and .jpg, like the
-- rows' paths.
create policy "Members can add robot photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'robot-photos'
    and (select private.is_member())
    and objects.name ~ '^[0-9a-z]{1,40}/[0-9]{1,5}/[0-9a-f-]{36}\.jpg$'
  );

create policy "Mentors can delete robot photo files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'robot-photos' and (select private.is_mentor()));
