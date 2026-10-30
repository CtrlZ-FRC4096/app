-- A first step on the CNC board: "Ready to CAM". A part is flagged when its
-- design is done, someone makes its toolpaths, then it's To cut, Cutting
-- and Cut as before. New jobs start there.

alter table public.cnc_jobs drop constraint cnc_jobs_status_check;
alter table public.cnc_jobs add constraint cnc_jobs_status_check check (status in ('cam', 'to_cut', 'cutting', 'cut'));
alter table public.cnc_jobs alter column status set default 'cam';
