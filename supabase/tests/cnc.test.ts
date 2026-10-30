// Permission rules for the CNC module's tables: everyone reads, adds stock,
// jobs, sheets, shapes and cuts, and moves jobs along; mentors delete
// things. Plus what the database fills in by itself: who changed a
// job's status, cuts planned for a job becoming real when it's marked cut,
// and a new sheet becoming partly used at its first cut.
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const db = setUpTestDatabase()
let student: string
let other: string
let mentor: string
let partId: string
let stockId: string
let sheetId: string

const addStock = (person: string, code = 'AL250', name = '1/4 in aluminum plate') =>
  db.as<{ id: string }>(
    person,
    "insert into public.cnc_stock (kind, name, code, material, thickness_in, bit_in, feed_ipm, depth_per_pass_in) values ('plate', $1, $2, '6061 aluminum', 0.25, 0.25, 60, 0.06) returning id",
    [name, code],
  )

const addJob = (person: string, quantity = 2) =>
  db.as<{ id: string; status: string; status_by: string; created_by: string }>(
    person,
    'insert into public.cnc_jobs (part_id, stock_id, quantity) values ($1, $2, $3) returning *',
    [partId, stockId, quantity],
  )

const addSheet = (person: string, label = 'AL250-002') =>
  db.as<{ id: string; created_by: string }>(
    person,
    "insert into public.cnc_sheets (label, stock_id, width_in, length_in, location) values ($1, $2, 24, 48, 'Rack A') returning *",
    [label, stockId],
  )

const addCut = (person: string, status: 'planned' | 'cut' = 'cut', jobId: string | null = null) =>
  db.as<{ id: string; cut_at: string | null; cut_by: string | null; created_by: string }>(
    person,
    "insert into public.cnc_sheet_cuts (sheet_id, job_id, part_id, name, x_in, y_in, width_in, length_in, source, status) values ($1, $2, $3, 'Side plate', 1, 1, 6, 18, 'manual', $4) returning *",
    [sheetId, jobId, partId, status],
  )

const sheetStatus = async () => (await db.sql<{ status: string }>('select status from public.cnc_sheets where id = $1', [sheetId]))[0].status

beforeEach(async () => {
  student = await db.member('Riley Park')
  other = await db.member('Jordan Kim')
  mentor = await db.member('Pat Mentor', 'mentor')
  const [{ id: robotId }] = await db.as<{ id: string }>(mentor, "insert into public.bom_robots (name) values ('Test robot') returning id")
  const [{ id: systemId }] = await db.as<{ id: string }>(mentor, "insert into public.bom_systems (robot_id, name, code) values ($1, 'Intake', 'INT') returning id", [robotId])
  ;[{ id: partId }] = await db.as<{ id: string }>(
    mentor,
    "insert into public.bom_parts (system_id, part_number, name, kind, material, quantity) values ($1, '4096-26-INT-001', 'Side plate', 'made', '6061 aluminum, 1/4 in plate', 2) returning id",
    [systemId],
  )
  ;[{ id: stockId }] = await addStock(mentor)
  ;[{ id: sheetId }] = await addSheet(mentor, 'AL250-001')
})

describe('CNC stock', () => {
  it('can be read, added and changed by anyone on the team, signed with their own id', async () => {
    expect(await db.as(student, 'select id from public.cnc_stock')).toEqual([{ id: stockId }])
    const [polycarbonate] = await addStock(student, 'PC250', '1/4 in polycarbonate plate')
    expect((await db.sql('select created_by from public.cnc_stock where id = $1', [polycarbonate.id]))[0]).toEqual({ created_by: student })
    expect(await db.as(student, 'update public.cnc_stock set feed_ipm = 100 where id = $1 returning id', [polycarbonate.id])).toEqual([polycarbonate])
  })

  it("doesn't let anyone add stock as someone else, or change who added it", async () => {
    await expect(
      db.as(student, "insert into public.cnc_stock (kind, name, code, material, created_by) values ('plate', 'Plate', 'PL1', 'Steel', $1)", [mentor]),
    ).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(student, 'update public.cnc_stock set created_by = $1', [student])).rejects.toThrow(PERMISSION_DENIED)
  })

  it('can only be deleted by a mentor', async () => {
    const [polycarbonate] = await addStock(student, 'PC250', '1/4 in polycarbonate plate')
    expect(await db.as(student, 'delete from public.cnc_stock where id = $1 returning id', [polycarbonate.id])).toEqual([])
    expect(await db.as(mentor, 'delete from public.cnc_stock where id = $1 returning id', [polycarbonate.id])).toEqual([polycarbonate])
  })

  it("can't be added or changed by someone whose access is off", async () => {
    await db.switchOff(student)
    await expect(addStock(student, 'PC250', '1/4 in polycarbonate plate')).rejects.toThrow(PERMISSION_DENIED)
    expect(await db.as(student, 'update public.cnc_stock set feed_ipm = 999 returning id')).toEqual([])
  })

  it("can't be deleted while it has sheets, and needs a code made of capital letters and numbers", async () => {
    await expect(db.as(mentor, 'delete from public.cnc_stock where id = $1', [stockId])).rejects.toThrow('foreign key')
    await expect(addStock(mentor, 'al-250', 'Another')).rejects.toThrow('check constraint')
  })
})

describe('CNC jobs', () => {
  it('can be added by anyone on the team, signed with their own id, starting at Ready to CAM', async () => {
    const [job] = await addJob(student)
    expect(job).toMatchObject({ status: 'cam', status_by: student, created_by: student })
  })

  it("doesn't let anyone add a job as someone else", async () => {
    await expect(
      db.as(student, 'insert into public.cnc_jobs (part_id, quantity, created_by) values ($1, 1, $2)', [partId, mentor]),
    ).rejects.toThrow(PERMISSION_DENIED)
    await expect(
      db.as(student, 'insert into public.cnc_jobs (part_id, quantity, status_by) values ($1, 1, $2)', [partId, mentor]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('records who moved a job along, and when', async () => {
    const [job] = await addJob(student)
    await db.as(other, "update public.cnc_jobs set status = 'to_cut' where id = $1", [job.id])
    const [moved] = await db.sql<{ status: string; status_by: string }>('select status, status_by from public.cnc_jobs where id = $1', [job.id])
    expect(moved).toEqual({ status: 'to_cut', status_by: other })
    // Changing the quantity isn't a status change.
    await db.as(student, 'update public.cnc_jobs set quantity = 3 where id = $1', [job.id])
    expect((await db.sql('select status_by from public.cnc_jobs where id = $1', [job.id]))[0]).toEqual({ status_by: other })
  })

  it("doesn't let anyone change who moved it, or which part it is", async () => {
    const [job] = await addJob(student)
    await expect(db.as(student, 'update public.cnc_jobs set status_by = $1 where id = $2', [mentor, job.id])).rejects.toThrow(PERMISSION_DENIED)
    await expect(db.as(mentor, 'update public.cnc_jobs set part_id = part_id')).rejects.toThrow(PERMISSION_DENIED)
  })

  it('can only be deleted by a mentor', async () => {
    const [job] = await addJob(student)
    expect(await db.as(student, 'delete from public.cnc_jobs returning id')).toEqual([])
    expect(await db.as(mentor, 'delete from public.cnc_jobs returning id')).toEqual([{ id: job.id }])
  })

  it('go when their part is deleted from the BOM', async () => {
    await addJob(student)
    await db.as(mentor, 'delete from public.bom_parts where id = $1', [partId])
    expect(await db.sql('select id from public.cnc_jobs')).toEqual([])
  })

  it('need a quantity from 1 to 999 and a known status', async () => {
    await expect(addJob(student, 0)).rejects.toThrow('check constraint')
    await expect(db.as(student, "insert into public.cnc_jobs (part_id, quantity, status) values ($1, 1, 'done')", [partId])).rejects.toThrow('check constraint')
  })
})

describe('CNC shapes from Onshape', () => {
  const addShape = (person: string) =>
    db.as<{ id: string; read_by: string }>(
      person,
      `insert into public.cnc_shapes (part_id, onshape_id, axis, low_in, thickness_in, width_in, length_in, outline, cut_length_in)
       values ($1, 'doc/elem/JHD', 'z', 0, 0.25, 6, 18, '[[0,0,18,0,18,6,0,6]]', 48) returning *`,
      [partId],
    )

  it('can be saved and read again by anyone, recording who read it', async () => {
    const [shape] = await addShape(student)
    expect(shape.read_by).toBe(student)
    await db.as(other, 'update public.cnc_shapes set width_in = 6.5 where id = $1', [shape.id])
    expect((await db.sql('select width_in::float as w, read_by from public.cnc_shapes'))[0]).toEqual({ w: 6.5, read_by: other })
  })

  it('are one per part, and only mentors delete them', async () => {
    const [shape] = await addShape(student)
    await expect(addShape(other)).rejects.toThrow('duplicate key')
    expect(await db.as(student, 'delete from public.cnc_shapes returning id')).toEqual([])
    expect(await db.as(mentor, 'delete from public.cnc_shapes returning id')).toEqual([{ id: shape.id }])
  })
})

describe('CNC sheets', () => {
  it('can be added and changed by anyone, and deleted only by mentors', async () => {
    const [sheet] = await addSheet(student)
    expect(sheet.created_by).toBe(student)
    expect(await db.as(student, "update public.cnc_sheets set location = 'Rack B', status = 'scrap' where id = $1 returning id", [sheet.id])).toEqual([{ id: sheet.id }])
    expect(await db.as(student, 'delete from public.cnc_sheets where id = $1 returning id', [sheet.id])).toEqual([])
    expect(await db.as(mentor, 'delete from public.cnc_sheets where id = $1 returning id', [sheet.id])).toEqual([{ id: sheet.id }])
  })

  it('need a unique ID made of capital letters, numbers and dashes', async () => {
    await expect(addSheet(student, 'AL250-001')).rejects.toThrow('duplicate key')
    await expect(addSheet(student, 'al250 #2')).rejects.toThrow('check constraint')
  })

  it("can't be moved to another stock", async () => {
    await expect(db.as(mentor, 'update public.cnc_sheets set stock_id = stock_id')).rejects.toThrow(PERMISSION_DENIED)
  })
})

describe('cuts on a sheet', () => {
  it('record who cut it and when, and make a new sheet partly used', async () => {
    expect(await sheetStatus()).toBe('new')
    const [cut] = await addCut(student)
    expect(cut.cut_by).toBe(student)
    expect(cut.cut_at).not.toBeNull()
    expect(await sheetStatus()).toBe('partly_used')
  })

  it("don't touch a sheet while they're only planned", async () => {
    const [cut] = await addCut(student, 'planned')
    expect(cut.cut_at).toBeNull()
    expect(await sheetStatus()).toBe('new')
    await db.as(other, "update public.cnc_sheet_cuts set status = 'cut' where id = $1", [cut.id])
    expect((await db.sql('select cut_by from public.cnc_sheet_cuts'))[0]).toEqual({ cut_by: other })
    expect(await sheetStatus()).toBe('partly_used')
  })

  it("can't be recorded as cut by someone else", async () => {
    await expect(
      db.as(student, "insert into public.cnc_sheet_cuts (sheet_id, name, x_in, y_in, width_in, length_in, source, cut_by) values ($1, 'Plate', 0, 0, 1, 1, 'manual', $2)", [sheetId, mentor]),
    ).rejects.toThrow(PERMISSION_DENIED)
    const [cut] = await addCut(student)
    await expect(db.as(student, 'update public.cnc_sheet_cuts set x_in = 5 where id = $1', [cut.id])).rejects.toThrow(PERMISSION_DENIED)
  })

  it('become real when their job is marked cut', async () => {
    const [job] = await addJob(student)
    const [planned] = await addCut(student, 'planned', job.id)
    await db.as(other, "update public.cnc_jobs set status = 'cutting' where id = $1", [job.id])
    expect((await db.sql('select status from public.cnc_sheet_cuts where id = $1', [planned.id]))[0]).toEqual({ status: 'planned' })
    await db.as(other, "update public.cnc_jobs set status = 'cut' where id = $1", [job.id])
    expect((await db.sql('select status, cut_by from public.cnc_sheet_cuts where id = $1', [planned.id]))[0]).toEqual({ status: 'cut', cut_by: other })
    expect(await sheetStatus()).toBe('partly_used')
  })

  it('can be deleted by whoever recorded them, or by a mentor; planned ones by anyone', async () => {
    const [mine] = await addCut(student)
    const [theirs] = await addCut(other)
    const [planned] = await addCut(other, 'planned')
    expect(await db.as(student, 'delete from public.cnc_sheet_cuts where id = $1 returning id', [theirs.id])).toEqual([])
    expect(await db.as(student, 'delete from public.cnc_sheet_cuts where id = $1 returning id', [mine.id])).toEqual([{ id: mine.id }])
    expect(await db.as(student, 'delete from public.cnc_sheet_cuts where id = $1 returning id', [planned.id])).toEqual([{ id: planned.id }])
    expect(await db.as(mentor, 'delete from public.cnc_sheet_cuts where id = $1 returning id', [theirs.id])).toEqual([{ id: theirs.id }])
  })

  it('keep their name when the part is deleted, and go with their sheet', async () => {
    await addCut(student)
    await db.as(mentor, 'delete from public.bom_parts where id = $1', [partId])
    expect(await db.sql('select name, part_id from public.cnc_sheet_cuts')).toEqual([{ name: 'Side plate', part_id: null }])
    await db.as(mentor, 'delete from public.cnc_sheets where id = $1', [sheetId])
    expect(await db.sql('select id from public.cnc_sheet_cuts')).toEqual([])
  })
})

describe('the CNC tables', () => {
  it("can't be read or changed by someone who isn't signed in, or whose access is off", async () => {
    await addJob(student)
    for (const table of ['cnc_stock', 'cnc_jobs', 'cnc_shapes', 'cnc_sheets', 'cnc_sheet_cuts']) {
      await expect(db.as(null, `select * from public.${table}`)).rejects.toThrow(PERMISSION_DENIED)
    }
    await db.switchOff(student)
    for (const table of ['cnc_stock', 'cnc_jobs', 'cnc_sheets']) {
      expect(await db.as(student, `select * from public.${table}`)).toEqual([])
    }
    await expect(addJob(student)).rejects.toThrow(PERMISSION_DENIED)
    await expect(addSheet(student, 'AL250-009')).rejects.toThrow(PERMISSION_DENIED)
  })
})
