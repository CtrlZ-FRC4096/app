/**
 * Downloading a part's file for its machine (#24): a STEP for the lathe,
 * mill or CNC router's CAM, an STL for the 3D printer, fetched from Onshape
 * when someone presses Download; and a DXF for the router or laser, made in
 * the browser from the part's flat outline (dxf.ts).
 *
 * Which file each machine needs, and what it's called, are in data.ts
 * (MACHINE_FILE_FORMATS, partFileName). This file works out which of those
 * the app can download so far, and asks the `onshape` server function for
 * them (supabase/functions/onshape/files.ts), which holds the Onshape keys.
 * In demo mode it gives a tiny made-up file instead.
 *
 * Anyone on the team can download: it changes nothing, and the people at
 * the machines are the ones who need the files. Each download uses some of
 * the team's yearly Onshape API calls (one for an STL, about five for a
 * STEP), so it only happens when someone presses the button. A DXF uses
 * none once the CNC module has the part's outline (one call per Part Studio
 * to read it the first time). An STL is kept until the page is reloaded,
 * so View 3D and Download STL share one call.
 */
import { callFunction } from '../../core/functions'
import { fail, ok, type Result } from '../../core/table'
import { flatOutline, readShapes, shapesTable } from '../cnc/data'
import { MACHINE_FILE_FORMATS, MACHINE_NAMES, partFileName, type FileFormat, type Machine, type Part, type PartFile, type Step } from './data'
import { outlineToDxf } from './dxf'

/** The kinds of file the app can download so far. 3MF isn't, but every 3D printer takes the STL. */
export const DOWNLOADABLE: FileFormat[] = ['step', 'stl', 'dxf']

/** A file a part's machines need, and whether the app can download it yet. */
export interface PartDownload extends PartFile {
  ready: boolean
}

/**
 * The files a part's machines need, each kind once: every kind each machine
 * can use that the app can download, in the machine's order. So the CNC
 * router gets a DXF, and a STEP for pockets; the 3D printer gets an STL. A
 * machine that only takes kinds the app can't download is listed as not
 * ready. With `machine`, only that machine's files, for its queue.
 */
export function partDownloads(part: Part, steps: Step[], machine?: Machine): PartDownload[] {
  const files: PartDownload[] = []
  for (const step of steps) {
    if (!step.machine || (machine && step.machine !== machine)) continue
    const formats = MACHINE_FILE_FORMATS[step.machine]
    const usable = formats.filter((f) => DOWNLOADABLE.includes(f))
    for (const format of usable.length ? usable : formats.slice(0, 1)) {
      const file = files.find((f) => f.format === format)
      if (!file) files.push({ format, name: partFileName(part, format), machines: [step.machine], ready: DOWNLOADABLE.includes(format) })
      else if (!file.machines.includes(step.machine)) file.machines.push(step.machine)
    }
  }
  return files
}

/** Why a part's files can't be downloaded, or null if they can. */
export function downloadProblem(part: Part): string | null {
  if (part.kind !== 'made') return 'COTS parts are bought ready, so they have no files for the machines.'
  if (part.removed_in_onshape) return `${part.name} has been removed in Onshape, so there's no file to download.`
  if (!part.onshape_id || !part.onshape_url) return `Import ${part.name}'s system from Onshape first, so the app knows which Onshape part it is.`
  return null
}

/** A file ready to save, with its name, and anything to tell the person about it. */
export interface SavedFile {
  name: string
  blob: Blob
  note?: string
}

// STLs already fetched, until the page is reloaded, so viewing a part in 3D
// and downloading its STL use one Onshape call between them. The key
// changes when the part does (a new revision, or a different Onshape part).
const stls = new Map<string, Blob>()
const stlKey = (part: Part) => `${part.id}|${part.onshape_id}|${part.revision ?? ''}`

/** Forget the STLs fetched so far. For tests. */
export function forgetFetchedFiles() {
  stls.clear()
}

/**
 * Get a part's file, named by its part number and revision, like
 * 4096-26-INT-002_revA.step. A STEP or STL comes from Onshape and uses some
 * of the team's Onshape API calls, so only call it when someone presses
 * Download. A DXF is made from the part's outline.
 */
export async function downloadPartFile(part: Part, format: FileFormat): Promise<Result<SavedFile>> {
  const problem = downloadProblem(part)
  if (problem) return fail(problem)
  if (!DOWNLOADABLE.includes(format)) return fail(`The app can't download ${format.toUpperCase()} files yet. Open the part in Onshape and export it from there.`)
  if (format === 'dxf') return partDxf(part)
  const kept = format === 'stl' ? stls.get(stlKey(part)) : undefined
  if (kept) return ok({ name: partFileName(part, format), blob: kept })
  const answer = await callFunction<Blob>('onshape', { kind: 'file', part: part.id, format }, () => exampleFile(format))
  if (!answer.ok) return answer
  if (!(answer.value instanceof Blob) || answer.value.size === 0) return fail("Onshape didn't send a file. Try again in a minute.")
  if (format === 'stl') stls.set(stlKey(part), answer.value)
  return ok({ name: partFileName(part, format), blob: answer.value })
}

/**
 * A part's DXF, made from the flat outline the CNC module keeps (cnc_shapes).
 * If it hasn't been read yet, it's read from Onshape first: one call for the
 * part's Part Studio, and then the CNC module has it too.
 */
async function partDxf(part: Part): Promise<Result<SavedFile>> {
  const notes: string[] = []
  if (!shapesTable.rows().some((s) => s.part_id === part.id)) {
    const read = await readShapes([part])
    if (!read.ok) return read
    notes.push(`Read its outline from Onshape first (1 API call). The CNC board has it now too.`)
  }
  const shape = shapesTable.rows().find((s) => s.part_id === part.id)
  if (!shape?.outline.length) return fail(`Onshape didn't give an outline for ${part.name}, so there's no DXF. Download the STEP instead.`)
  if (shape.pockets) notes.push("It has pockets that don't go all the way through: the DXF only has the outline and holes, so use the STEP for those.")
  notes.push('In inches.')
  const blob = new Blob([outlineToDxf(flatOutline(shape))], { type: 'application/dxf' })
  return ok({ name: partFileName(part, 'dxf'), blob, note: notes.join(' ') })
}

/** One file in a machine's queue, or why it can't be downloaded. */
export interface QueueFile {
  part: Part
  file: PartDownload | null
  problem: string | null
}

/**
 * The files for every part in a machine's queue (stationQueue() in
 * data.ts), in the queue's order. Parts the app can't download for say why.
 */
export function queueFiles(queue: { part: Part; steps: Step[] }[], machine: Machine): QueueFile[] {
  return queue.flatMap(({ part, steps }): QueueFile[] => {
    const file = partDownloads(part, steps, machine)[0]
    if (!file) return []
    const problem = !file.ready
      ? `The app can't download ${file.format.toUpperCase()} files for the ${MACHINE_NAMES[machine].toLowerCase()} yet.`
      : downloadProblem(part)
    return [{ part, file, problem }]
  })
}

/**
 * Download every file in a queue, one after another, handing each to
 * `save` as it arrives. Keeps going past a file that fails, and says at the
 * end which didn't come. `onProgress` hears "2 of 5" before each one.
 */
export async function downloadQueue(
  files: QueueFile[],
  save: (file: SavedFile) => void,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<Result<string>> {
  const ready = files.filter((f) => f.file && !f.problem)
  if (ready.length === 0) return fail('None of these parts have a file the app can download yet.')
  const failed: string[] = []
  for (const [i, { part, file }] of ready.entries()) {
    onProgress(i + 1, ready.length)
    const answer = await downloadPartFile(part, file!.format)
    if (answer.ok) save(answer.value)
    else failed.push(`${part.part_number}: ${answer.error}`)
  }
  const got = ready.length - failed.length
  if (failed.length === 0) return ok(`Downloaded ${got === 1 ? '1 file' : `all ${got} files`}.`)
  return fail(`Downloaded ${got} of ${ready.length} files. ${failed.join(' ')}`)
}

/**
 * Demo mode's made-up files: a 20 mm cube as an STL, and a STEP that's
 * only a header. Small, so the button can be tried without keys.
 */
export function exampleFile(format: FileFormat): Blob {
  if (format === 'stl') return new Blob([exampleCube()], { type: 'application/octet-stream' })
  const step = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('Example file from the Ctrl-Z app demo mode. Not a real part.'),'2;1');",
    "FILE_NAME('example.step','2026-11-14T00:00:00',(''),(''),'','','');",
    "FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));",
    'ENDSEC;',
    'DATA;',
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n')
  return new Blob([step], { type: 'application/octet-stream' })
}

/** A binary STL of a 20 mm cube: an 80-byte header, the number of triangles, then 50 bytes for each. */
function exampleCube(): ArrayBuffer {
  const s = 20
  // Each face as two triangles, corners going counter-clockwise seen from outside.
  const faces: [number[], number[][]][] = [
    [[0, 0, -1], [[0, 0, 0], [0, s, 0], [s, s, 0], [s, 0, 0]]],
    [[0, 0, 1], [[0, 0, s], [s, 0, s], [s, s, s], [0, s, s]]],
    [[0, -1, 0], [[0, 0, 0], [s, 0, 0], [s, 0, s], [0, 0, s]]],
    [[0, 1, 0], [[0, s, 0], [0, s, s], [s, s, s], [s, s, 0]]],
    [[-1, 0, 0], [[0, 0, 0], [0, 0, s], [0, s, s], [0, s, 0]]],
    [[1, 0, 0], [[s, 0, 0], [s, s, 0], [s, s, s], [s, 0, s]]],
  ]
  const buffer = new ArrayBuffer(84 + 50 * 12)
  const view = new DataView(buffer)
  const header = 'Example 20 mm cube from the Ctrl-Z app demo mode'
  for (let i = 0; i < header.length; i += 1) view.setUint8(i, header.charCodeAt(i))
  view.setUint32(80, 12, true)
  let at = 84
  for (const [normal, [a, b, c, d]] of faces) {
    for (const triangle of [[a, b, c], [a, c, d]]) {
      for (const n of [normal, ...triangle].flat()) {
        view.setFloat32(at, n, true)
        at += 4
      }
      at += 2 // Two empty bytes after each triangle.
    }
  }
  return buffer
}
