// Tests for data.ts. Run them with `npm test`.
// Who is allowed to do what is the database's job: that's tested in
// supabase/tests/cnc.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import { setDemoRole } from '../../core/demo'
import { partsTable, systemsTable } from '../bom/data'
import {
  addJob, addManualCut, addSheet, addStock, boardGroups, canRemoveCut, changeJob, changeSheet, cncSummary, cutLately, cutsTable, jobsTable,
  addStockFromOnshape, camStockFor, camStockOf, editJob, markReadyToCam, onshapeMadeParts, plateStock, partForOnshape, planLayout, planRoom, planStockImport, readLayout, shapeReadCalls, readShapes, readSheet, readStock, removeCut, removeJob, removeStock, saveRoomPlan,
  setJobStatus, shapesTable, sheetForm, sheetsTable, sheetsWithRoom, splitRemnant, stockForm, stockTable,
  type Cut, type Job, type ManualCut, type OnshapePlacement, type Shape, type Sheet,
} from './data'
import type { Part } from '../bom/data'

beforeEach(() => {
  setDemoRole('student')
  for (const table of [partsTable, systemsTable, stockTable, jobsTable, shapesTable, sheetsTable, cutsTable]) table.reset()
})

const part = (number: string) => partsTable.rows().find((p) => p.part_number === number)!
const stockByCode = (code: string) => stockTable.rows().find((s) => s.code === code)!
const sheetByLabel = (label: string) => sheetsTable.rows().find((s) => s.label === label)!
const jobFor = (number: string, status: Job['status']) => jobsTable.rows().find((j) => j.part_id === part(number).id && j.status === status)!
const cutsOn = (sheet: Sheet) => cutsTable.rows().filter((c) => c.sheet_id === sheet.id)
const SIDE_PLATE = '4096-26-INT-001'

describe('the example data', () => {
  it('has every job pointing at a made part and a stock', () => {
    for (const job of jobsTable.rows()) {
      expect(partsTable.rows().find((p) => p.id === job.part_id)?.kind).toBe('made')
      expect(stockTable.rows().some((s) => s.id === job.stock_id)).toBe(true)
    }
  })

  it("has sheet IDs that start with their stock's code, and cuts that are on their sheets", () => {
    for (const sheet of sheetsTable.rows()) expect(sheet.label.startsWith(`${stockTable.rows().find((s) => s.id === sheet.stock_id)!.code}-`)).toBe(true)
    for (const cut of cutsTable.rows()) {
      const sheet = sheetsTable.rows().find((s) => s.id === cut.sheet_id)!
      expect(cut.x_in + cut.length_in).toBeLessThanOrEqual(sheet.length_in)
      expect(cut.y_in + cut.width_in).toBeLessThanOrEqual(sheet.width_in)
    }
  })
})

describe('stock', () => {
  const input = { ...stockForm(), name: '3/16 in aluminum plate', code: 'al188', material: '6061 aluminum', thickness: '3/16', sheetLength: '24', sheetWidth: '48', bit: '1/8', feed: '45', depthPerPass: '0.04' }

  it('reads sizes as typed, puts the long side as the length, and capitalizes the code', () => {
    const read = readStock(input, [])
    expect(read).toEqual({
      ok: true,
      value: { kind: 'plate', name: '3/16 in aluminum plate', code: 'AL188', material: '6061 aluminum', thickness_in: 0.1875, sheet_width_in: 24, sheet_length_in: 48, bit_in: 0.125, feed_ipm: 45, depth_per_pass_in: 0.04 },
    })
  })

  it('refuses repeated names and codes, bad sizes, and half a sheet size', () => {
    expect(readStock({ ...input, name: '1/4 IN ALUMINUM PLATE' }, stockTable.rows())).toMatchObject({ ok: false })
    expect(readStock({ ...input, code: 'AL250' }, stockTable.rows())).toMatchObject({ ok: false })
    expect(readStock({ ...input, code: 'A' }, [])).toMatchObject({ ok: false })
    expect(readStock({ ...input, thickness: 'thick' }, [])).toMatchObject({ ok: false })
    expect(readStock({ ...input, feed: '-5' }, [])).toMatchObject({ ok: false })
    expect(readStock({ ...input, sheetWidth: '' }, [])).toMatchObject({ ok: false })
  })

  it('can be added and, with no sheets, deleted by a mentor', async () => {
    const added = await addStock(input)
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(await removeStock(added.value)).toMatchObject({ ok: false })
    setDemoRole('mentor')
    expect(await removeStock(added.value)).toEqual({ ok: true, value: null })
    expect(await removeStock(stockByCode('AL250'))).toMatchObject({ ok: false, error: expect.stringContaining('sheets') })
  })
})

describe('the CNC board', () => {
  const groups = () => boardGroups(jobsTable.rows(), partsTable.rows(), systemsTable.rows(), stockTable.rows(), shapesTable.rows())

  it("groups what's waiting by stock, being cut first, and leaves out what's cut", () => {
    const shown = groups().map((g) => [g.stock?.code, g.jobs.map((j) => `${j.part?.name} ×${j.job.quantity} ${j.job.status}`)])
    expect(shown).toEqual([
      ['AL250', ['Intake side plate ×1 to_cut']],
      ['PC125', ['Bellypan ×1 cutting']],
      ['AT2X1', ['Frame rail ×4 to_cut']],
    ])
  })

  it('puts jobs with no stock picked last', async () => {
    await addJob(part('4096-26-INT-002'), 3, null)
    const last = groups().at(-1)!
    expect(last.stock).toBeUndefined()
    expect(last.jobs[0].part?.name).toBe('Roller shaft')
  })

  it('shows its system, and its shape from Onshape if there is one', () => {
    const [aluminum] = groups()
    expect(aluminum.jobs[0].system?.name).toBe('Intake')
    expect(aluminum.jobs[0].shape?.length_in).toBe(18)
  })

  it("lists what's been cut lately, newest first", () => {
    const lately = cutLately(jobsTable.rows(), partsTable.rows(), systemsTable.rows(), stockTable.rows(), shapesTable.rows(), new Date('2026-10-30T12:00:00Z'))
    expect(lately.map((j) => j.part?.name)).toEqual(['Intake side plate'])
    expect(cutLately(jobsTable.rows(), [], [], [], [], new Date('2026-12-30T12:00:00Z'))).toEqual([])
  })

  it('adds made parts ready to CAM, adding to a job already waiting for CAM on the same stock', async () => {
    const first = await addJob(part(SIDE_PLATE), 2, stockByCode('AL250').id)
    expect(first).toMatchObject({ ok: true, value: { added: true, job: { status: 'cam', quantity: 2 } } })
    const more = await addJob(part(SIDE_PLATE), 3, stockByCode('AL250').id)
    expect(more).toMatchObject({ ok: true, value: { added: false } })
    expect(jobFor(SIDE_PLATE, 'cam').quantity).toBe(5)
    // The spare already CAM'd and waiting to cut isn't changed.
    expect(jobFor(SIDE_PLATE, 'to_cut').quantity).toBe(1)
    const other = await addJob(part(SIDE_PLATE), 1, stockByCode('AL125').id, 'Test piece')
    expect(other).toMatchObject({ ok: true, value: { added: true, job: { status: 'cam', note: 'Test piece' } } })
  })

  it("refuses bought parts and quantities that aren't 1 to 999", async () => {
    expect(await addJob(part('4096-26-INT-004'), 1, null)).toMatchObject({ ok: false })
    expect(await addJob(part(SIDE_PLATE), 0, null)).toMatchObject({ ok: false })
    expect(await addJob(part(SIDE_PLATE), 1.5, null)).toMatchObject({ ok: false })
    const job = jobFor(SIDE_PLATE, 'to_cut')
    expect(await changeJob(job, { quantity: 1000, stock_id: job.stock_id, note: '' })).toMatchObject({ ok: false })
    expect(await changeJob(job, { quantity: 5, stock_id: null, note: '  ' })).toMatchObject({ ok: true, value: { quantity: 5, stock_id: null, note: null } })
  })

  it('moves jobs along, noting who and when', async () => {
    const job = jobFor('4096-26-DRV-002', 'to_cut')
    const moved = await setJobStatus(job, 'cutting')
    expect(moved).toMatchObject({ ok: true, value: { status: 'cutting', status_by: '00000000-0000-4000-8000-00000000a1e7' } })
  })

  it('records the cuts planned for a job when it is marked cut, and the sheet becomes partly used', async () => {
    const sheet = sheetByLabel('PC125-001')
    expect(sheet.status).toBe('new')
    await setJobStatus(jobFor('4096-26-DRV-001', 'cutting'), 'cut')
    expect(cutsOn(sheet).map((c) => c.status)).toEqual(['cut'])
    expect(cutsOn(sheet)[0].cut_by).toBe('00000000-0000-4000-8000-00000000a1e7')
    expect(sheetByLabel('PC125-001').status).toBe('partly_used')
  })

  it('only lets a mentor take a job off the board', async () => {
    const job = jobFor('4096-26-DRV-002', 'to_cut')
    expect(await removeJob(job)).toMatchObject({ ok: false })
    setDemoRole('mentor')
    expect(await removeJob(job)).toEqual({ ok: true, value: null })
  })

  it('sums up the board for the home page', () => {
    expect(cncSummary(jobsTable.rows())).toEqual({ tone: 'info', text: '5 to cut · 1 cutting' })
    expect(cncSummary([...jobsTable.rows(), { ...jobsTable.rows()[0], status: 'cam', quantity: 2 }])).toEqual({ tone: 'info', text: '2 ready to CAM · 5 to cut · 1 cutting' })
    expect(cncSummary([])).toEqual({ tone: 'plain', text: 'Nothing waiting to cut' })
  })
})

describe('shapes from Onshape', () => {
  it('reads every part in a Part Studio with one call, saving new shapes and updating old ones', async () => {
    const result = await readShapes([part(SIDE_PLATE), part('4096-26-INT-002'), part('4096-26-INT-003')])
    expect(result).toEqual({ ok: true, value: 'Read 3 parts from Onshape. That used 1 Onshape API call.' })
    expect(shapesTable.rows().map((s) => s.part_id)).toEqual([part(SIDE_PLATE).id, part('4096-26-INT-002').id, part('4096-26-INT-003').id])
  })

  it('says which parts are gone from Onshape', async () => {
    const result = await readShapes([part(SIDE_PLATE), part('4096-26-INT-004')])
    expect(result).toEqual({ ok: true, value: 'Read 1 part from Onshape. 1 part isn’t in Onshape any more. That used 1 Onshape API call.' })
  })

  it('says when parts were typed in, so there is nothing to read', async () => {
    expect(await readShapes([part('4096-26-DRV-001')])).toMatchObject({ ok: false, error: expect.stringContaining('typed in') })
  })
})

describe('sheets', () => {
  it('fill in the next ID and the full sheet size for a stock', () => {
    expect(sheetForm(stockByCode('AL250'), sheetsTable.rows())).toMatchObject({ label: 'AL250-003', length: '48', width: '24' })
  })

  it('read what was typed, long side as the length', () => {
    const input = { ...sheetForm(stockByCode('AL250'), sheetsTable.rows()), label: 'al250-010', length: '12', width: '30', location: ' Rack C ' }
    expect(readSheet(input, sheetsTable.rows())).toEqual({
      ok: true,
      value: { label: 'AL250-010', stock_id: stockByCode('AL250').id, length_in: 30, width_in: 12, location: 'Rack C', onshape_url: null, note: null },
    })
  })

  it('refuse a repeated ID, a bad size, or a link that is not to Onshape', () => {
    const input = sheetForm(stockByCode('AL250'), sheetsTable.rows())
    expect(readSheet({ ...input, label: 'AL250-001' }, sheetsTable.rows())).toMatchObject({ ok: false })
    expect(readSheet({ ...input, label: 'AL 250' }, [])).toMatchObject({ ok: false })
    expect(readSheet({ ...input, length: '0' }, [])).toMatchObject({ ok: false })
    expect(readSheet({ ...input, onshape_url: 'https://example.com/layout' }, [])).toMatchObject({ ok: false })
  })

  it('can be added new, and changed', async () => {
    const added = await addSheet(sheetForm(stockByCode('PC250'), sheetsTable.rows()))
    expect(added).toMatchObject({ ok: true, value: { label: 'PC250-001', status: 'new', width_in: 24, length_in: 48 } })
    if (!added.ok) return
    const form = { ...sheetForm(stockByCode('PC250'), []), label: 'PC250-001', location: 'Rack D' }
    expect(await changeSheet(added.value, form)).toMatchObject({ ok: true, value: { location: 'Rack D' } })
  })

  it('split off a leftover piece with its own ID, scrapping the rest', async () => {
    const sheet = sheetByLabel('AL250-001')
    const piece = await splitRemnant(sheet, { ...sheetForm(stockByCode('AL250'), sheetsTable.rows()), length: '29', width: '24', location: 'Remnant shelf' }, true)
    expect(piece).toMatchObject({ ok: true, value: { label: 'AL250-003', parent_id: sheet.id, length_in: 29, status: 'new' } })
    expect(sheetByLabel('AL250-001').status).toBe('scrap')
  })
})

describe('cuts', () => {
  const manual = (more: Partial<ManualCut>): ManualCut => ({ jobId: '', partId: '', name: '', x: '1', y: '1', length: '10', width: '5', turned: false, status: 'cut', ...more })

  it('can be recorded by hand, with the outline if the size matches its shape', async () => {
    const sheet = sheetByLabel('AL250-002')
    const job = jobFor(SIDE_PLATE, 'to_cut')
    const cut = await addManualCut(sheet, manual({ jobId: job.id, x: '0.5', y: '0.5', length: '6', width: '18', turned: true }))
    expect(cut).toMatchObject({ ok: true, value: { name: 'Intake side plate', job_id: job.id, rotation_deg: 90, length_in: 6, width_in: 18, status: 'cut' } })
    if (cut.ok) expect(cut.value.outline?.length).toBe(8)
    expect(sheetByLabel('AL250-002').status).toBe('partly_used')
  })

  it("can be something that isn't in the BOM, without an outline", async () => {
    const cut = await addManualCut(sheetByLabel('AL250-002'), manual({ name: 'Test coupon', status: 'planned' }))
    expect(cut).toMatchObject({ ok: true, value: { name: 'Test coupon', part_id: null, outline: null, status: 'planned', cut_at: null } })
    expect(sheetByLabel('AL250-002').status).toBe('new')
  })

  it('must be on the sheet, with a name, a place and a size', async () => {
    const sheet = sheetByLabel('AL250-002')
    expect(await addManualCut(sheet, manual({ name: 'Plate', x: '40' }))).toMatchObject({ ok: false, error: expect.stringContaining('off the sheet') })
    expect(await addManualCut(sheet, manual({ name: '' }))).toMatchObject({ ok: false })
    expect(await addManualCut(sheet, manual({ name: 'Plate', y: 'here' }))).toMatchObject({ ok: false })
    expect(await addManualCut(sheet, manual({ name: 'Plate', width: '0' }))).toMatchObject({ ok: false })
  })

  it('can be deleted when planned, or by whoever recorded them, or by a mentor', async () => {
    const [cut] = cutsTable.rows().filter((c) => c.status === 'cut')
    const student = { id: '00000000-0000-4000-8000-00000000a1e7', role: 'student' as const }
    expect(canRemoveCut(cut, student)).toBe(false)
    expect(canRemoveCut({ ...cut, status: 'planned' }, student)).toBe(true)
    expect(canRemoveCut({ ...cut, created_by: student.id }, student)).toBe(true)
    expect(canRemoveCut(cut, { ...student, role: 'mentor' })).toBe(true)
    expect(await removeCut(cut)).toMatchObject({ ok: false })
  })
})

describe('reading a layout from Onshape', () => {
  const sheet = () => sheetByLabel('AL250-001')
  const at = (x: number, y: number) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, 0, 0, 0, 0, 1]
  const sidePlateId = () => part(SIDE_PLATE).onshape_id!

  it('matches Onshape parts to the BOM, even if a configuration is written differently', () => {
    expect(partForOnshape(sidePlateId(), partsTable.rows())?.name).toBe('Intake side plate')
    expect(partForOnshape(`${sidePlateId()}?Length=2`, partsTable.rows())?.name).toBe('Intake side plate')
    expect(partForOnshape('0000000000000000000000a1/0000000000000000000000c2/NOPE', partsTable.rows())).toBeUndefined()
  })

  it("plans each part where it sits, skipping what's cut already, the sheet itself, and anything off the sheet", () => {
    const placements: OnshapePlacement[] = [
      { onshape_id: 'other/doc/JSD', name: 'Sheet', transform: at(0, 0) },
      { onshape_id: sidePlateId(), name: 'Side plate <1>', transform: at(0.5, 0.5) },
      { onshape_id: sidePlateId(), name: 'Side plate <3>', transform: at(0.5, 13.5) },
      { onshape_id: sidePlateId(), name: 'Side plate <4>', transform: at(40, 13.5) },
    ]
    const plan = planLayout(sheet(), placements, partsTable.rows(), jobsTable.rows(), shapesTable.rows(), cutsTable.rows())
    expect(plan.cuts).toHaveLength(1)
    expect(plan.cuts[0]).toMatchObject({ name: 'Intake side plate', x_in: 0.5, y_in: 13.5, length_in: 18, width_in: 6, job_id: jobFor(SIDE_PLATE, 'to_cut').id, status: 'planned', source: 'onshape' })
    expect(plan.skipped.map((s) => s.name)).toEqual(['Sheet', 'Side plate <1>', 'Side plate <4>'])
  })

  it('gives a job only as many parts as it still needs', () => {
    const placements = [13.5, 0.5].map((x, i) => ({ onshape_id: sidePlateId(), name: `Side plate <${i}>`, transform: at(20, x) }))
    const plan = planLayout(sheet(), placements, partsTable.rows(), jobsTable.rows(), shapesTable.rows(), cutsTable.rows())
    // The spare job wants 1; the second plate has no job left to take it.
    expect(plan.cuts.map((c) => c.job_id)).toEqual([jobFor(SIDE_PLATE, 'to_cut').id, null])
  })

  it('skips a part already planned by hand in the same spot', async () => {
    const plan = planRoom(sheet(), stockByCode('AL250'), jobsTable.rows(), partsTable.rows(), shapesTable.rows(), cutsTable.rows())
    await saveRoomPlan(sheet(), plan.spots)
    const placements = [{ onshape_id: sidePlateId(), name: 'Side plate <3>', transform: at(0.5, 13.5) }]
    const again = planLayout(sheet(), placements, partsTable.rows(), jobsTable.rows(), shapesTable.rows(), cutsTable.rows())
    expect(again).toEqual({ cuts: [], skipped: [{ name: 'Side plate <3>', why: 'is already planned there' }] })
  })

  it('saves the plan, replacing what was planned from Onshape before', async () => {
    const first = await readLayout(sheet())
    expect(first).toMatchObject({ ok: true, value: { planned: 1 } })
    const again = await readLayout(sheet())
    expect(again).toMatchObject({ ok: true, value: { planned: 1 } })
    expect(cutsOn(sheet()).map((c) => c.status)).toEqual(['cut', 'cut', 'planned'])
    expect(sheet().layout_read_at).not.toBe('2026-10-27T22:00:00Z')
  })

  it('needs the layout link first', async () => {
    expect(await readLayout(sheetByLabel('AL250-002'))).toMatchObject({ ok: false, error: expect.stringContaining('layout link') })
  })
})

describe('finding room', () => {
  it('finds a spot for each waiting part on the stock, around what is there', () => {
    const sheet = sheetByLabel('AL250-001')
    const plan = planRoom(sheet, stockByCode('AL250'), jobsTable.rows(), partsTable.rows(), shapesTable.rows(), cutsTable.rows())
    expect(plan.spots).toHaveLength(1)
    expect(plan.spots[0].spot.box).toEqual({ x: 0.5, y: 13.5, length: 18, width: 6 })
    expect(plan.noRoom).toEqual([])
  })

  it("says which parts don't fit, and which have no size yet", async () => {
    await addJob(part(SIDE_PLATE), 9, stockByCode('AL250').id)
    await addJob(part('4096-26-INT-002'), 1, stockByCode('AL250').id)
    const plan = planRoom(sheetByLabel('AL250-001'), stockByCode('AL250'), jobsTable.rows(), partsTable.rows(), shapesTable.rows(), cutsTable.rows())
    expect(plan.spots.length + plan.noRoom[0].count).toBe(10)
    expect(plan.noShape.map((n) => n.part?.name)).toEqual(['Roller shaft'])
  })

  it('saves the spots as planned cuts, so the room is spoken for', async () => {
    const sheet = sheetByLabel('AL250-002')
    const plan = planRoom(sheet, stockByCode('AL250'), jobsTable.rows(), partsTable.rows(), shapesTable.rows(), cutsTable.rows())
    const saved = await saveRoomPlan(sheet, plan.spots)
    expect(saved).toMatchObject({ ok: true })
    expect(cutsOn(sheet).map((c: Cut) => [c.status, c.source, c.outline?.length])).toEqual([['planned', 'manual', 8]])
    const after = planRoom(sheet, stockByCode('AL250'), jobsTable.rows(), partsTable.rows(), shapesTable.rows(), cutsTable.rows())
    expect(after.spots).toEqual([])
  })

  it('lists the sheets with room for a part, leaving out scrap', () => {
    const shape = shapesTable.rows()[0]
    expect(sheetsWithRoom(shape, stockByCode('AL250'), sheetsTable.rows(), cutsTable.rows()).map((s) => s.label)).toEqual(['AL250-001', 'AL250-002'])
    expect(sheetsWithRoom(shape, stockByCode('AL125'), sheetsTable.rows(), cutsTable.rows()).map((s) => s.label)).toEqual(['AL125-002'])
    expect(sheetsWithRoom(undefined, stockByCode('AL250'), sheetsTable.rows(), cutsTable.rows())).toEqual([])
  })
})

describe('importing stock from Onshape', () => {
  // Made-up parts from Onshape, each with a material and a shape.
  let n = 0
  const madePart = (name: string, material: string | null): Part => {
    n += 1
    return { ...part(SIDE_PLATE), id: `part-${n}`, name, part_number: `4096-26-TST-00${n}`, material, onshape_id: `doc/elem/J${n}D` }
  }
  const shapeOf = (p: Part, thickness: number, width = 6, length = 10): Shape => ({
    ...shapesTable.rows()[0], id: `shape-${p.id}`, part_id: p.id, thickness_in: thickness, width_in: width, length_in: length,
  })

  it('proposes the plates the parts need, one per material and thickness, with a code of its own', () => {
    const gusset = madePart('Gusset', 'Aluminum - 6061')
    const bracket = madePart('Bracket', 'Aluminum - 6061')
    const plate = madePart('Side plate', 'Aluminum - 6061')
    const cover = madePart('Cover', 'Polycarbonate')
    const shapes = [shapeOf(gusset, 0.188), shapeOf(bracket, 0.188), shapeOf(plate, 0.25), shapeOf(cover, 0.0625)]
    const stocks = stockTable.rows().filter((s) => s.code !== 'AL250')
    const plan = planStockImport([gusset, bracket, plate, cover], shapes, [...stocks, { ...stocks[0], code: 'AL188', name: 'Something else', kind: 'bar' }])
    expect(plan.add.map((a) => [a.stock.name, a.stock.code, a.stock.material, a.stock.thickness_in, a.parts.map((p) => p.name)])).toEqual([
      ['3/16 in aluminum plate', 'AL188B', 'Aluminum - 6061', 0.1875, ['Gusset', 'Bracket']],
      ['1/4 in aluminum plate', 'AL250', 'Aluminum - 6061', 0.25, ['Side plate']],
      ['1/16 in polycarbonate plate', 'PC063', 'Polycarbonate', 0.0625, ['Cover']],
    ])
    expect(plan.add[0].stock).toMatchObject({ kind: 'plate', sheet_width_in: null, bit_in: null })
  })

  it('knows the plates already in the stock list, however the material is written', () => {
    const plate = madePart('Side plate', 'Aluminum - 6061')
    const plan = planStockImport([plate], [shapeOf(plate, 0.25)], stockTable.rows())
    expect(plan.add).toEqual([])
    expect(plan.have.map((h) => [h.stock.code, h.parts.map((p) => p.name)])).toEqual([['AL250', ['Side plate']]])
  })

  it("leaves out parts that aren't plates, have no material, or haven't been read", () => {
    const shaft = madePart('Shaft', 'Aluminum - 6061')
    const mystery = madePart('Mystery plate', null)
    const unread = madePart('Unread plate', 'Polycarbonate')
    const plan = planStockImport([shaft, mystery, unread], [shapeOf(shaft, 0.5, 0.5, 12), shapeOf(mystery, 0.25)], stockTable.rows())
    expect(plan.notPlates.map((p) => p.name)).toEqual(['Shaft'])
    expect(plan.noMaterial.map((p) => p.name)).toEqual(['Mystery plate'])
    expect(plan.unread.map((p) => p.name)).toEqual(['Unread plate'])
  })

  it('only looks at made parts from Onshape, and counts the API calls to read them', () => {
    const fromOnshape = onshapeMadeParts(partsTable.rows())
    expect(fromOnshape.map((p) => p.part_number)).toEqual(['4096-26-INT-001', '4096-26-INT-002', '4096-26-INT-003'])
    // One Part Studio: one call, however many parts.
    expect(shapeReadCalls(fromOnshape)).toBe(1)
    expect(shapeReadCalls([...fromOnshape, { ...fromOnshape[0], onshape_id: `${fromOnshape[0].onshape_id}?size=2` }])).toBe(2)
  })

  it('adds the plates picked, which anyone can do', async () => {
    const cover = madePart('Cover', 'Polycarbonate')
    const plan = planStockImport([cover], [shapeOf(cover, 0.0625)], stockTable.rows())
    expect(await addStockFromOnshape(plan.add)).toMatchObject({ ok: true })
    expect(stockTable.rows().find((s) => s.code === 'PC063')).toMatchObject({ name: '1/16 in polycarbonate plate', created_by: '00000000-0000-4000-8000-00000000a1e7' })
    expect(await addStockFromOnshape([])).toMatchObject({ ok: false })
  })

  it('works with the example data: the side plate is already here, and the shaft and spacer are not plates', async () => {
    const plan = planStockImport(partsTable.rows(), shapesTable.rows(), stockTable.rows())
    expect(plan.unread.map((p) => p.name)).toEqual(['Roller shaft', 'Pivot spacer'])
    await readShapes(plan.unread)
    const after = planStockImport(partsTable.rows(), shapesTable.rows(), stockTable.rows())
    expect(after).toMatchObject({ add: [], unread: [], noMaterial: [] })
    expect(after.have.map((h) => h.stock.code)).toEqual(['AL250'])
    expect(after.notPlates.map((p) => p.name)).toEqual(['Roller shaft', 'Pivot spacer'])
  })
})

describe('flagging parts ready to CAM', () => {
  it('picks aluminum or polycarbonate and a thickness from the material, or the shape from Onshape', () => {
    const stocks = stockTable.rows()
    const shape = shapesTable.rows()[0]
    expect(camStockFor(part(SIDE_PLATE), shape, stocks)).toEqual({ plate: 'aluminum', thickness: 0.25 })
    expect(camStockFor(part(SIDE_PLATE), undefined, stocks)).toEqual({ plate: 'aluminum', thickness: 0.25 })
    expect(camStockFor(part('4096-26-DRV-001'), undefined, stocks)).toEqual({ plate: 'polycarbonate', thickness: 0.125 })
    expect(camStockFor({ ...part(SIDE_PLATE), material: 'Aluminum' }, undefined, stocks)).toEqual({ plate: 'aluminum', thickness: 0 })
  })

  it('picks other stock for tubes and bars, and anything not aluminum or polycarbonate', () => {
    const stocks = stockTable.rows()
    expect(camStockFor(part('4096-26-DRV-002'), undefined, stocks)).toEqual({ stockId: stockByCode('AT2X1').id })
    expect(camStockFor(part('4096-26-INT-003'), undefined, stocks)).toEqual({ stockId: null })
  })

  it('uses the plate already in the stock list', async () => {
    const result = await markReadyToCam(part(SIDE_PLATE), 2, { plate: 'aluminum', thickness: 0.25 })
    expect(result).toMatchObject({ ok: true, value: { added: true, stock: { code: 'AL250' }, job: { status: 'cam', stock_id: stockByCode('AL250').id } } })
  })

  it("adds a plate that isn't in the stock list yet, with a typed-in thickness", async () => {
    expect(plateStock('aluminum', 0.375, stockTable.rows())).toBeUndefined()
    const result = await markReadyToCam(part(SIDE_PLATE), 1, { plate: 'aluminum', thickness: 0.375 })
    expect(result).toMatchObject({ ok: true, value: { stock: { name: '3/8 in aluminum plate', code: 'AL375', material: 'Aluminum', thickness_in: 0.375 } } })
    // Flagging another part on it uses the same stock.
    await markReadyToCam(part('4096-26-INT-002'), 1, { plate: 'aluminum', thickness: 0.375 })
    expect(stockTable.rows().filter((s) => s.name === '3/8 in aluminum plate')).toHaveLength(1)
  })

  it('needs a thickness, and takes other stock or none', async () => {
    expect(await markReadyToCam(part(SIDE_PLATE), 1, { plate: 'polycarbonate', thickness: 0 })).toMatchObject({ ok: false, error: expect.stringContaining('thickness') })
    expect(await markReadyToCam(part('4096-26-DRV-002'), 4, { stockId: stockByCode('AT2X1').id })).toMatchObject({ ok: true, value: { stock: { code: 'AT2X1' } } })
    expect(await markReadyToCam(part('4096-26-INT-003'), 4, { stockId: null })).toMatchObject({ ok: true, value: { stock: null, job: { stock_id: null } } })
    expect(await markReadyToCam(part('4096-26-INT-004'), 1, { stockId: null })).toMatchObject({ ok: false, error: expect.stringContaining('bought') })
  })
})

describe('changing a part on the board', () => {
  it('starts from its plate, or its stock if it is not an aluminum or polycarbonate plate', () => {
    expect(camStockOf(stockByCode('AL250'))).toEqual({ plate: 'aluminum', thickness: 0.25 })
    expect(camStockOf(stockByCode('PC125'))).toEqual({ plate: 'polycarbonate', thickness: 0.125 })
    expect(camStockOf(stockByCode('AT2X1'))).toEqual({ stockId: stockByCode('AT2X1').id })
    expect(camStockOf(undefined)).toEqual({ stockId: null })
  })

  it('moves a part back a step, and changes how many and the plate, adding the plate if needed', async () => {
    const job = jobFor(SIDE_PLATE, 'to_cut')
    const result = await editJob(job, { quantity: 4, cutFrom: { plate: 'aluminum', thickness: 0.1875 }, note: 'Thinner', status: 'cam' })
    expect(result).toMatchObject({ ok: true, value: { status: 'cam', quantity: 4, note: 'Thinner', stock_id: stockByCode('AL188').id } })
    expect(stockByCode('AL188').name).toBe('3/16 in aluminum plate')
  })

  it('moves a cut part back, and keeps the step when it is the same', async () => {
    const done = jobFor(SIDE_PLATE, 'cut')
    expect(await editJob(done, { quantity: 2, cutFrom: camStockOf(stockByCode('AL250')), note: '', status: 'cutting' })).toMatchObject({ ok: true, value: { status: 'cutting' } })
    const rails = jobFor('4096-26-DRV-002', 'to_cut')
    expect(await editJob(rails, { quantity: 6, cutFrom: { stockId: rails.stock_id }, note: '', status: 'to_cut' })).toMatchObject({ ok: true, value: { status: 'to_cut', quantity: 6 } })
  })

  it("refuses a bad quantity or a missing thickness, and changes nothing", async () => {
    const job = jobFor(SIDE_PLATE, 'to_cut')
    expect(await editJob(job, { quantity: 0, cutFrom: { plate: 'aluminum', thickness: 0.5 }, note: '', status: 'cam' })).toMatchObject({ ok: false })
    expect(await editJob(job, { quantity: 1, cutFrom: { plate: 'aluminum', thickness: 0 }, note: '', status: 'cam' })).toMatchObject({ ok: false })
    expect(jobFor(SIDE_PLATE, 'to_cut')).toEqual(job)
    expect(stockTable.rows().some((s) => s.code === 'AL500')).toBe(false)
  })
})
