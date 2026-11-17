import { useState, type ChangeEvent } from 'react'
import { plural } from '../../core/format'
import { Callout, PageHead, Panel } from '../../core/ui'
import { durationText, findEntries, openLog, type LogSummary } from './data'

// Open a robot log (.wpilog) and see what's in it. The file is read in this
// browser by data.ts and wpilog.ts; nothing is uploaded or saved.
export default function RobotLogsPage() {
  const [summary, setSummary] = useState<LogSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [query, setQuery] = useState('')

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Let the same file be chosen again after it changes on disk.
    event.target.value = ''
    if (!file) return
    setReading(true)
    setError(null)
    const result = openLog(file.name, new Uint8Array(await file.arrayBuffer()))
    setReading(false)
    if (result.ok) {
      setSummary(result.value)
      setQuery('')
    } else {
      setError(result.error)
    }
  }

  const entries = summary ? findEntries(summary.entries, query) : []

  return (
    <>
      <PageHead title="Robot logs">
        Open a log from the robot to see what's in it. The file is read in this browser and nothing is uploaded.
      </PageHead>
      <Panel title="Open a log">
        <div className="panel-body">
          <div className="toolbar">
            <label className="btn btn-lg btn-primary">
              {reading ? 'Reading…' : 'Open a log'}
              <input type="file" accept=".wpilog" hidden disabled={reading} onChange={(e) => void choose(e)} />
            </label>
          </div>
          <p className="note" style={{ margin: 0 }}>
            A WPILib or AdvantageKit log (.wpilog), copied off the roboRIO or its USB stick. Reading logs is for a laptop: they can be large.
          </p>
        </div>
      </Panel>
      {error && (
        <Callout title="Couldn't read that file">
          <span>{error}</span>
        </Callout>
      )}
      {summary && (
        <>
          {summary.cutOff && (
            <Callout title="This log is cut off">
              <span>The file ends partway through, so the last moments may be missing. Everything before that is shown. Copy it off the robot again once it's stopped writing.</span>
            </Callout>
          )}
          <Panel title={summary.match ? `${summary.match.label} · ${summary.match.event}` : 'Not from a match'} aside={<span className="note">{summary.fileName}</span>}>
            <div className="panel-body">
              <p style={{ margin: 0 }}>
                <strong>{durationText(summary.duration)}</strong> long, with {plural(summary.entries.length, 'entry', 'entries')} and{' '}
                {plural(summary.values, 'value', 'values')}.
              </p>
              {summary.recordedAt && <p className="note" style={{ margin: 0 }}>Recorded {new Date(summary.recordedAt).toLocaleString()}.</p>}
              {!summary.match && (
                <p className="note" style={{ margin: 0 }}>The file name doesn't say which match. The robot only names it after the match once the field (FMS) is connected.</p>
              )}
            </div>
          </Panel>
          <Panel title="Entries" aside={<span className="note">{entries.length} of {summary.entries.length}</span>}>
            <div className="panel-body">
              <label className="field" htmlFor="log-find">
                Find an entry
                <input id="log-find" className="input" type="search" style={{ maxWidth: '24rem', minHeight: 46, fontSize: 16 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="DS:enabled, current, voltage" />
              </label>
            </div>
            {/* table-wrap: on a phone only the table scrolls sideways, never the page. */}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Entry</th>
                    <th>Type</th>
                    <th className="num">Values</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.name}>
                      <td style={{ overflowWrap: 'anywhere' }}>
                        <span className="mono">{entry.name}</span>
                        {entry.metadata && <><br /><span className="note">{entry.metadata}</span></>}
                      </td>
                      <td className="mono">{entry.type}</td>
                      <td className="num">{entry.values.toLocaleString('en-US')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  )
}
