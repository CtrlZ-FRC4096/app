import { useState } from 'react'
import { toast } from '../../core/toast'
import { FILE_FORMAT_NAMES, MACHINE_FILE_FORMATS, MACHINE_NAMES, type FileFormat, type Machine, type Part, type Step } from './data'
import { downloadPartFile, downloadProblem, downloadQueue, partDownloads, queueFiles, type SavedFile } from './files'

// The Download buttons for a part's files, and for a whole machine's queue
// (#24). The files come from Onshape through files.ts, only when a button
// is pressed.

/** Hand a file to the browser to save, under its own name. */
function saveToDevice(file: SavedFile) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(file.blob)
  link.download = file.name
  link.click()
  // Give the browser a moment to start saving before letting go of the file.
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
}

const machineList = (machines: Machine[]) => machines.map((m) => MACHINE_NAMES[m]).join(' and ')

/**
 * Under a custom part's stages: a Download button for each file its
 * machines need, like "Download STEP" for the lathe. `steps` are the stages
 * shown, so at one machine's station only that machine's file shows.
 */
export function PartDownloads(props: { part: Part; steps: Step[] }) {
  const { part } = props
  const [busy, setBusy] = useState<FileFormat | null>(null)
  const files = partDownloads(part, props.steps)
  if (files.length === 0) return null
  const problem = downloadProblem(part)

  async function download(format: FileFormat) {
    setBusy(format)
    const answer = await downloadPartFile(part, format)
    setBusy(null)
    if (answer.ok) saveToDevice(answer.value)
    else toast(answer.error)
  }

  return (
    <span className="toolbar" style={{ marginTop: 6, gap: 6 }}>
      <span className="note">Files:</span>
      {problem ? (
        <span className="note">{problem}</span>
      ) : (
        files.map((f) =>
          f.ready ? (
            <button
              key={f.format}
              type="button"
              className="btn btn-sm"
              disabled={busy !== null}
              title={`${f.name}, for the ${machineList(f.machines).toLowerCase()}`}
              onClick={() => void download(f.format)}
            >
              {busy === f.format ? 'Downloading…' : `Download ${FILE_FORMAT_NAMES[f.format]}`}
            </button>
          ) : (
            <span key={f.format} className="note">
              {FILE_FORMAT_NAMES[f.format]} for the {machineList(f.machines).toLowerCase()}: not in the app yet, export it from Onshape (Open CAD).
            </span>
          ),
        )
      )}
    </span>
  )
}

/**
 * At one machine's station: download every part's file in its queue, one
 * after another. The browser may ask once whether the site can download
 * several files.
 */
export function QueueDownloads(props: { queue: { part: Part; steps: Step[] }[]; machine: Machine }) {
  const files = queueFiles(props.queue, props.machine)
  const [progress, setProgress] = useState<string | null>(null)
  const ready = files.filter((f) => !f.problem)
  if (files.length === 0) return null
  const kinds = [...new Set(ready.map((f) => FILE_FORMAT_NAMES[f.file!.format]))].join(' and ')
  const left = files.length - ready.length
  // The machine's usual kind of file, like the router's DXF.
  const usual = MACHINE_FILE_FORMATS[props.machine][0]

  async function downloadAll() {
    setProgress('Starting…')
    const answer = await downloadQueue(files, saveToDevice, (done, total) => setProgress(`Downloading ${done} of ${total}…`))
    setProgress(null)
    toast(answer.ok ? answer.value : answer.error)
  }

  return (
    <div className="toolbar" style={{ gap: 6 }}>
      {ready.length > 0 && (
        <button type="button" className="btn btn-sm" disabled={progress !== null} onClick={() => void downloadAll()}>
          {progress ?? `Download ${ready.length === 1 ? 'the' : `all ${ready.length}`} ${kinds} ${ready.length === 1 ? 'file' : 'files'}`}
        </button>
      )}
      <span className="note">
        {usual && ready.some((f) => f.file!.format !== usual) && `${FILE_FORMAT_NAMES[usual]} isn't in the app yet, so the ${MACHINE_NAMES[props.machine].toLowerCase()} gets ${kinds} for now. `}
        {ready.length > 1 && 'One after another, named by part number. If your browser asks about several downloads, choose Allow. '}
        {left > 0 && `${left === 1 ? '1 part' : `${left} parts`} can't be downloaded here: see under each part.`}
      </span>
    </div>
  )
}
