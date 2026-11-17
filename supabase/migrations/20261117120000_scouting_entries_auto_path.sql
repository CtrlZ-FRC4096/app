-- The robot's auto path, drawn on the field on the Scouting module's match
-- form (#205).
--
-- It's saved as jsonb, in the blue view (as if the robot were on blue, with
-- its own driver station wall at x = 0), each spot from 0 to 1:
--
--   { "strokes": [[[x, y], [x, y], ...], ...],   -- the lines it drove
--     "marks": [{ "type": "shot", "x": 0.2, "y": 0.5 }, ...],
--     "didnt_move": false }
--
-- The form needs a path (or "Didn't move") for every new entry, but entries
-- saved before this have none: rows already here and entries still waiting
-- on phones from an older version of the app. So the column can be empty.
--
-- The check matches checkAutoPath() and the limits in
-- src/modules/scouting/data.ts, so an entry the phone saves is never refused
-- here and stuck Waiting. The table's existing policies are for whole rows,
-- so they already cover this column.

-- True if a jsonb value is a number from 0 to 1: a spot across or down the field.
create function private.is_field_spot(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(value) is distinct from 'number' then
    return false;
  end if;
  return value::numeric between 0 and 1;
end;
$$;

-- True if a jsonb value is an auto path the form could have saved: at most
-- 10 lines of at least 2 spots each, 300 spots in all, and 20 marks with a
-- type of up to 30 characters. Either it drove (some lines) or it didn't
-- move (no lines), never both.
create function private.is_auto_path(path jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  stroke jsonb;
  spot jsonb;
  mark jsonb;
  spots int := 0;
begin
  if jsonb_typeof(path) is distinct from 'object'
    or jsonb_typeof(path -> 'strokes') is distinct from 'array'
    or jsonb_typeof(path -> 'marks') is distinct from 'array'
    or jsonb_typeof(path -> 'didnt_move') is distinct from 'boolean' then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(path) as key where key not in ('strokes', 'marks', 'didnt_move')) then
    return false;
  end if;
  if jsonb_array_length(path -> 'strokes') > 10 or jsonb_array_length(path -> 'marks') > 20 then
    return false;
  end if;
  if (path -> 'didnt_move')::boolean = (jsonb_array_length(path -> 'strokes') > 0) then
    return false;
  end if;

  for stroke in select value from jsonb_array_elements(path -> 'strokes') loop
    if jsonb_typeof(stroke) <> 'array' then
      return false;
    end if;
    if jsonb_array_length(stroke) < 2 then
      return false;
    end if;
    spots := spots + jsonb_array_length(stroke);
    for spot in select value from jsonb_array_elements(stroke) loop
      if jsonb_typeof(spot) <> 'array' then
        return false;
      end if;
      if jsonb_array_length(spot) <> 2 or not private.is_field_spot(spot -> 0) or not private.is_field_spot(spot -> 1) then
        return false;
      end if;
    end loop;
  end loop;
  if spots > 300 then
    return false;
  end if;

  for mark in select value from jsonb_array_elements(path -> 'marks') loop
    if jsonb_typeof(mark) <> 'object' or jsonb_typeof(mark -> 'type') is distinct from 'string' then
      return false;
    end if;
    if char_length(mark ->> 'type') not between 1 and 30 or not private.is_field_spot(mark -> 'x') or not private.is_field_spot(mark -> 'y') then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- Anyone who can send an entry runs the check, so signed-in members need to
-- be able to call these. They only look at the value they're given.
revoke all on function private.is_field_spot(jsonb), private.is_auto_path(jsonb) from public;
grant execute on function private.is_field_spot(jsonb), private.is_auto_path(jsonb) to authenticated;

alter table public.scouting_entries
  add column auto_path jsonb check (auto_path is null or private.is_auto_path(auto_path));
