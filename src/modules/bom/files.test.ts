// Tests for files.ts: which files a part's machines need that the app can
// download, and downloading them (in demo mode, the made-up files). What
// the server function asks Onshape is tested in
// supabase/tests/onshape-files.test.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import { setDemoRole } from '../../core/demo'
import { partsTable, stationQueue, stepsFor, stepsTable, type Machine, type Part, type Step } from './data'
import { downloadPartFile, downloadProblem, downloadQueue, exampleFile, partDownloads, queueFiles, type SavedFile } from './files'

beforeEach(() => {
  setDemoRole('student')
  partsTable.reset()
  stepsTable.reset()
})

const part = (name: string) => partsTable.rows().find((p) => p.name === name)!
const stepsOf = (name: string) => stepsFor(part(name), stepsTable.rows())
/** A part's stages with one more machine stage added. */
const plus = (name: string, machine: Machine): Step[] => [...stepsOf(name), { ...stepsOf(name)[0], id: `extra-${machine}`, stage: 'process2', machine }]

describe('partDownloads', () => {
  it("gives each machine's first kind of file the app can download, each kind once", () => {
    const cases: [string, Step[], Machine | undefined, { format: string; machines: Machine[]; ready: boolean }[]][] = [
      ['Roller shaft', stepsOf('Roller shaft'), undefined, [{ format: 'step', machines: ['lathe'], ready: true }]],
      ['Pivot spacer', stepsOf('Pivot spacer'), undefined, [{ format: 'stl', machines: ['3d_printer'], ready: true }]],
      // The router's DXF isn't in the app yet, so it gets a STEP, shared with the mill.
      ['Frame rail', stepsOf('Frame rail'), undefined, [{ format: 'step', machines: ['mill', 'cnc_router'], ready: true }]],
      // The laser only takes DXF: listed, but not ready.
      ['Roller shaft', plus('Roller shaft', 'laser'), undefined, [{ format: 'step', machines: ['lathe'], ready: true }, { format: 'dxf', machines: ['laser'], ready: false }]],
      ['Roller shaft', plus('Roller shaft', 'hand_tools'), undefined, [{ format: 'step', machines: ['lathe'], ready: true }]],
      // At one machine's station, only its file.
      ['Frame rail', stepsOf('Frame rail'), 'cnc_router', [{ format: 'step', machines: ['cnc_router'], ready: true }]],
      ['Frame rail', stepsOf('Frame rail'), 'lathe', []],
      ['Brushless motor', stepsOf('Brushless motor'), undefined, []],
    ]
    for (const [name, steps, machine, expected] of cases) {
      expect(partDownloads(part(name), steps, machine), `${name} ${machine ?? ''}`).toEqual(expected.map((e) => expect.objectContaining(e)))
    }
    expect(partDownloads(part('Roller shaft'), stepsOf('Roller shaft'))[0].name).toBe('4096-26-INT-002_revA.step')
  })
})

describe('downloadProblem', () => {
  it('needs a custom part that came from Onshape and is still there', () => {
    const shaft = part('Roller shaft') // imported from the example Onshape assembly
    const cases: [Part, RegExp | null][] = [
      [shaft, null],
      [{ ...shaft, removed_in_onshape: true }, /removed in Onshape/],
      [{ ...shaft, onshape_id: null }, /Import .* from Onshape/],
      [part('Bellypan'), /Import .* from Onshape/], // typed in by hand
      [part('Brushless motor'), /bought/],
    ]
    for (const [p, expected] of cases) {
      if (expected) expect(downloadProblem(p), p.name).toMatch(expected)
      else expect(downloadProblem(p), p.name).toBeNull()
    }
  })
})

describe('downloadPartFile', () => {
  it('gives the file named by part number and revision, or says why not', async () => {
    const step = await downloadPartFile(part('Roller shaft'), 'step')
    expect(step).toMatchObject({ ok: true, value: { name: '4096-26-INT-002_revA.step' } })
    expect(await downloadPartFile(part('Pivot spacer'), 'stl')).toMatchObject({ ok: true, value: { name: '4096-26-INT-003_revA.stl' } })
    expect(await downloadPartFile(part('Intake side plate'), 'dxf')).toMatchObject({ ok: false, error: expect.stringMatching(/export it/) })
    expect(await downloadPartFile(part('Bellypan'), 'step')).toMatchObject({ ok: false, error: expect.stringMatching(/Import/) })
  })
})

describe('queueFiles', () => {
  it("lists each part in a machine's queue with its file, or why it can't be downloaded", () => {
    const parts = partsTable.rows()
    const steps = stepsTable.rows()
    const router = queueFiles(stationQueue(parts, steps, { kind: 'machine', machine: 'cnc_router' }), 'cnc_router')
    expect(router.map((f) => [f.part.name, f.file?.format, f.problem && 'problem'])).toEqual([
      ['Bellypan', 'step', 'problem'], // typed in, not from Onshape
      ['Frame rail', 'step', 'problem'],
      ['Intake side plate', 'step', null], // imported from the example Onshape assembly
    ])
    const laserQueue = [{ part: part('Roller shaft'), steps: plus('Roller shaft', 'laser').filter((s) => s.machine === 'laser') }]
    expect(queueFiles(laserQueue, 'laser')[0].problem).toMatch(/DXF/)
    expect(queueFiles(stationQueue(parts, steps, { kind: 'machine', machine: 'hand_tools' }), 'hand_tools')).toEqual([])
  })
})

describe('downloadQueue', () => {
  it('downloads each file one after another, keeps going past one that fails, and says which', async () => {
    const saved: SavedFile[] = []
    const progress: string[] = []
    const ok = (name: string) => ({ part: part(name), file: partDownloads(part(name), stepsOf(name))[0], problem: null })
    const all = await downloadQueue([ok('Roller shaft'), ok('Pivot spacer')], (f) => saved.push(f), (done, total) => progress.push(`${done} of ${total}`))
    expect(all).toEqual({ ok: true, value: 'Downloaded all 2 files.' })
    expect(saved.map((f) => f.name)).toEqual(['4096-26-INT-002_revA.step', '4096-26-INT-003_revA.stl'])
    expect(progress).toEqual(['1 of 2', '2 of 2'])

    // The bellypan wasn't imported from Onshape, so it fails, but the shaft still comes.
    saved.length = 0
    const some = await downloadQueue([ok('Bellypan'), ok('Roller shaft')], (f) => saved.push(f))
    expect(some).toMatchObject({ ok: false, error: expect.stringMatching(/1 of 2 .*4096-26-DRV-001/) })
    expect(saved.map((f) => f.name)).toEqual(['4096-26-INT-002_revA.step'])

    expect(await downloadQueue([{ ...ok('Roller shaft'), problem: 'Not yet' }], (f) => saved.push(f))).toMatchObject({ ok: false })
  })
})

describe('exampleFile', () => {
  it('is a small STL of 12 triangles, or a STEP header, for demo mode', async () => {
    const stl = new DataView(await exampleFile('stl').arrayBuffer())
    expect([stl.byteLength, stl.getUint32(80, true)]).toEqual([84 + 50 * 12, 12])
    expect(await exampleFile('step').text()).toMatch(/^ISO-10303-21;[\s\S]*END-ISO-10303-21;/)
  })
})
