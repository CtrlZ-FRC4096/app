-- The stages a made part goes through before it's on the robot (issue #15):
-- Design → Pre-process → Process 1 → Process 2 → Post-process. A part only
-- has the stages it needs, so each stage is a row here.
--
--   Pre-process    cutting stock to size, or CAM
--   Process 1, 2   the machines, such as the CNC router, then the lathe
--   Post-process   deburring, tapping, finishing
--
-- Anyone on the team can add and remove a part's stages, move a stage along
-- and count parts through it, like the rest of the BOM. Deleting a part
-- deletes its stages.

create table public.bom_steps (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.bom_parts (id) on delete cascade,
  stage text not null check (stage in ('design', 'pre', 'process1', 'process2', 'post')),
  -- Which machine, for the process stages only.
  machine text check (machine in ('cnc_router', 'lathe', 'mill', '3d_printer', 'laser', 'hand_tools')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  -- How many of the part's quantity are through this stage. The app keeps it
  -- at most the part's quantity; a part's quantity can go down later, so the
  -- database doesn't refuse more.
  quantity_done integer not null default 0 check (quantity_done >= 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.members (id) on delete set null,
  unique (part_id, stage),
  check ((stage in ('process1', 'process2')) = (machine is not null))
);

create index on public.bom_steps (part_id);

alter table public.bom_steps enable row level security;

-- Signed-out visitors get nothing. Signed-in people get what the rules allow.
-- Changing a stage can only change its status and how many are done: which
-- part, stage and machine it is stay as they were added. (To change them,
-- remove the stage and add it again.)
revoke all on table public.bom_steps from anon, authenticated;
grant select, insert, delete on table public.bom_steps to authenticated;
grant update (status, quantity_done) on table public.bom_steps to authenticated;

-- Changes from other people show up in the app straight away.
alter publication supabase_realtime add table public.bom_steps;

create policy "Members can read stages"
  on public.bom_steps for select to authenticated
  using ((select private.is_member()));

create policy "Members can add stages as themselves"
  on public.bom_steps for insert to authenticated
  with check ((select private.is_member()) and created_by = (select auth.uid()));

create policy "Members can move stages along"
  on public.bom_steps for update to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

create policy "Members can remove stages"
  on public.bom_steps for delete to authenticated
  using ((select private.is_member()));
