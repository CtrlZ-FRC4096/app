import { useState, type FormEvent } from 'react'
import { shortDate } from '../../core/format'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pick, Pill } from '../../core/ui'
import { saveEntry, useEntries } from './data'
import { COUNTERS, ENDGAME } from './season'

/** Width and height of the − and + buttons, in pixels. Big enough to tap without looking. */
const TAP_SIZE = 60

/** Every counter from season.ts, starting at 0. */
function zeroCounts(): Record<string, number> {
  return Object.fromEntries(COUNTERS.map((c) => [c.key, 0]))
}

// The form for one robot in one match. Every field comes from season.ts,
// so a new game means new settings, not a new page. Saving goes through
// saveEntry() in data.ts, which keeps the entry on this device.
export default function ScoutingPage() {
  const entries = useEntries()
  const [match, setMatch] = useState('')
  const [team, setTeam] = useState('')
  const [counts, setCounts] = useState(zeroCounts)
  const [endgame, setEndgame] = useState(ENDGAME[0])
  const [defense, setDefense] = useState(false)
  const [notes, setNotes] = useState('')

  function change(key: string, by: number) {
    setCounts((now) => ({ ...now, [key]: Math.max(0, (now[key] ?? 0) + by) }))
  }

  function save(event: FormEvent) {
    event.preventDefault()
    const result = saveEntry({ match: Number(match), team: Number(team), counts, endgame, defense, notes })
    if (!result.ok) {
      toast(result.error)
      return
    }
    // Ready for the next robot.
    setMatch('')
    setTeam('')
    setCounts(zeroCounts())
    setEndgame(ENDGAME[0])
    setDefense(false)
    setNotes('')
    toast(`Saved match ${result.value.match}, team ${result.value.team}.`)
  }

  const tap = { width: TAP_SIZE, minHeight: TAP_SIZE, padding: 0, fontSize: 24 }

  return (
    <>
      <PageHead title="Match form">
        Count what one robot does in one match. Entries save on this device, so it works with no Wi-Fi.
      </PageHead>
      <form onSubmit={save}>
        <Panel title="Match">
          <div className="panel-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <label className="field" htmlFor="scout-match">
              Match number
              <input id="scout-match" className="input" style={{ width: '9ch', minHeight: 46, fontSize: 16 }} inputMode="numeric" value={match} onChange={(e) => setMatch(e.target.value)} placeholder="12" />
            </label>
            <label className="field" htmlFor="scout-team">
              Team number
              <input id="scout-team" className="input" style={{ width: '9ch', minHeight: 46, fontSize: 16 }} inputMode="numeric" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="4096" />
            </label>
          </div>
        </Panel>
        <Panel title="Scoring">
          <div className="row-list">
            {COUNTERS.map((c) => (
              <div key={c.key}>
                <span>{c.label}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button type="button" className="btn btn-lg" style={tap} aria-label={`${c.label}: one fewer`} onClick={() => change(c.key, -1)}>−</button>
                  <span className="mono" style={{ minWidth: '2.5ch', textAlign: 'center', fontSize: 22 }} aria-live="polite" aria-label={c.label}>{counts[c.key]}</span>
                  <button type="button" className="btn btn-lg btn-primary" style={tap} aria-label={`${c.label}: one more`} onClick={() => change(c.key, 1)}>+</button>
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Endgame">
          <div className="panel-body">
            <Pick label="Endgame" options={ENDGAME} value={endgame} onChange={setEndgame} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
              <input type="checkbox" style={{ width: 24, height: 24 }} checked={defense} onChange={(e) => setDefense(e.target.checked)} />
              Played defense
            </label>
            <label className="field" htmlFor="scout-notes">
              Notes
              <textarea id="scout-notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the counts don't show: broke down, tipped, fast cycles" />
            </label>
            <div className="toolbar">
              <button type="submit" className="btn btn-lg btn-primary">Save entry</button>
            </div>
          </div>
        </Panel>
      </form>
      <Panel title="Saved on this device" aside={<span className="note">{entries.length} saved</span>}>
        {entries.length === 0 ? (
          <p className="panel-body muted">No entries yet. Fill in the form and press Save entry.</p>
        ) : (
          <div className="row-list">
            {entries.map((e) => (
              <div key={e.id}>
                <span>Match {e.match} · Team {e.team}<br /><span className="note">{shortDate(e.created_at)}</span></span>
                <span style={{ marginLeft: 'auto' }}>
                  {e.synced ? <Pill tone="ok">Synced</Pill> : <Pill tone="warn">Waiting</Pill>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  )
}
