-- Importing a system's parts from its Onshape assembly or Part Studio
-- (issue #19). The `onshape` server function reads the BOM; the app adds
-- new parts, updates changed ones, and marks parts no longer in CAD as
-- removed instead of deleting them, so their history stays.

-- Which Onshape part a row is: its document, tab, part and configuration.
-- Re-importing matches parts by this, never by name, so renaming a part in
-- CAD keeps everything done to it. Empty for parts typed in by hand.
alter table public.bom_parts
  add column onshape_id text check (char_length(onshape_id) between 1 and 1000),
  add column removed_in_onshape boolean not null default false;

create unique index bom_parts_onshape_id on public.bom_parts (system_id, onshape_id) where onshape_id is not null;

-- Parts from Onshape show what CAD has, which often has no material or
-- vendor yet. Parts typed in by hand still need them.
alter table public.bom_parts drop constraint bom_parts_check;
alter table public.bom_parts add constraint bom_parts_details check (
  onshape_id is not null
  or (kind = 'made' and material is not null)
  or (kind = 'cots' and vendor is not null)
);

-- When the system was last imported, to show on the page.
alter table public.bom_systems add column onshape_imported_at timestamptz;

-- Importing updates these too. (..._bom_members_edit.sql limits which
-- columns can be updated; these are added to that list.)
grant update (onshape_id, removed_in_onshape) on table public.bom_parts to authenticated;
grant update (onshape_imported_at) on table public.bom_systems to authenticated;
