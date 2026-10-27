import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '../../core/toast'
import { Callout, Panel } from '../../core/ui'
import { plural } from '../../core/format'
import { applyImport, planImport, useAttendance } from './data'
import { parseExport, type ParsedExport } from './slack-export'

/**
 * Import the attendance channel from a Slack export. Files are read in this
 * browser; only Slack IDs, names, check-in times and poll votes are saved.
 */
export function ImportPanel() {
  const { people, checks, rsvps } = useAttendance()
  const folderInput = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [channel, setChannel] = useState('')
  const [parsed, setParsed] = useState<ParsedExport | null>(null)
  const [busy, setBusy] = useState(false)

  // Lets the "Choose the export folder" button pick a whole folder.
  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '')
  }, [])

  const pathOf = (file: File) => file.webkitRelativePath || file.name
  const channels = useMemo(() => channelsIn(files.map(pathOf)), [files])

  function choose(list: FileList | null) {
    const chosen = [...(list ?? [])].filter((f) => f.name.endsWith('.json'))
    const found = channelsIn(chosen.map(pathOf))
    setFiles(chosen)
    setParsed(null)
    setChannel(found.find((c) => /attend/i.test(c)) ?? found[0] ?? '')
  }

  // Read only users.json and the chosen channel's day files, not the whole export.
  useEffect(() => {
    if (!files.length) return
    let current = true
    const wanted = files.filter((f) => f.name === 'users.json' || folderOf(pathOf(f)) === channel)
    void Promise.all(wanted.map(async (f) => ({ path: pathOf(f), text: await f.text() }))).then((read) => {
      if (current) setParsed(parseExport(read))
    })
    return () => {
      current = false
    }
  }, [files, channel])

  const plan = useMemo(
    () => (parsed ? planImport(parsed.users, parsed.daysByChannel.get(channel) ?? [], { people, checks, rsvps }) : null),
    [parsed, channel, people, checks, rsvps],
  )
  const changes = plan ? plan.newPeople.length + plan.newChecks.length + plan.newRsvps.length + plan.changedRsvps.length : 0

  async function run() {
    if (!plan) return
    setBusy(true)
    const result = await applyImport(plan)
    setBusy(false)
    toast(result.ok ? result.value : result.error)
    if (result.ok) {
      setFiles([])
      setParsed(null)
    }
  }

  return (
    <Panel title="Import from Slack">
      <div className="panel-body">
        <ol className="steps">
          <li>
            In Slack, a workspace admin exports the workspace's messages (<strong>Tools &amp; settings → Workspace settings → Import/Export
            Data → Export</strong>) and downloads the zip.
          </li>
          <li>Unzip it, then choose the unzipped folder below. Or choose <code>users.json</code> and the attendance channel's day files.</li>
          <li>Check the summary, then press Import. Importing the same days again only adds what's new.</li>
        </ol>
        <div className="toolbar">
          <label className="btn">
            Choose the export folder
            <input ref={folderInput} type="file" multiple hidden onChange={(e) => choose(e.target.files)} />
          </label>
          <label className="btn">
            Choose files
            <input type="file" multiple accept=".json,application/json" hidden onChange={(e) => choose(e.target.files)} />
          </label>
        </div>
        <p className="note">
          Files are read in this browser. Only Slack IDs, names, check-in times and poll votes are saved, never emails or other channels.
        </p>

        {channels.length > 1 && (
          <label className="field" htmlFor="import-channel" style={{ maxWidth: 320 }}>
            Which channel has the attendance poll and Jibble?
            <select id="import-channel" className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {channels.map((c) => <option key={c} value={c}>#{c}</option>)}
            </select>
          </label>
        )}

        {parsed && plan && (
          <>
            {!parsed.users.length && (
              <Callout title="users.json is missing">
                <span>Without it, names can't be matched to Slack accounts, and poll answers show Slack IDs instead of names. Choose it too.</span>
              </Callout>
            )}
            <ul className="goal-list">
              <li>{plural(plan.days, 'meeting day', 'meeting days')} found</li>
              <li>{plural(plan.newPeople.length, 'new person', 'new people')}</li>
              <li>
                {plural(plan.newChecks.length, 'new check-in or check-out', 'new check-ins and check-outs')}
                {plan.alreadyThere > 0 && ` (${plan.alreadyThere} already imported)`}
              </li>
              <li>
                {plural(plan.newRsvps.length, 'new poll answer', 'new poll answers')}, {plural(plan.changedRsvps.length, 'changed answer', 'changed answers')}
                {plan.keptManual > 0 && ` (${plan.keptManual} set by hand, left alone)`}
              </li>
            </ul>
            {parsed.unreadable.length > 0 && <p className="note">Couldn't read: {parsed.unreadable.join(', ')}</p>}
            {plan.similar.length > 0 && (
              <Callout title="Matched by a similar name: check these">
                <span>{plan.similar.map((s) => `${s.jibble} → ${s.slack}`).join(' · ')}</span>
              </Callout>
            )}
            {plan.unmatched.length > 0 && (
              <Callout title="No Slack account found for these Jibble names">
                <span>They'll be added by name: {plan.unmatched.join(', ')}</span>
              </Callout>
            )}
            <div className="toolbar">
              <button type="button" className="btn btn-primary" disabled={busy || changes === 0} onClick={() => void run()}>
                {busy ? 'Importing…' : changes === 0 ? 'Nothing new to import' : 'Import'}
              </button>
            </div>
          </>
        )}
      </div>
    </Panel>
  )
}

const folderOf = (path: string) => {
  const parts = path.split('/')
  return parts.length > 1 ? parts[parts.length - 2] : '(chosen files)'
}

/** Channel folders that hold day files like 2026-01-09.json. */
function channelsIn(paths: string[]): string[] {
  const found = new Set<string>()
  for (const path of paths) if (/\d{4}-\d{2}-\d{2}\.json$/.test(path)) found.add(folderOf(path))
  return [...found].sort()
}
