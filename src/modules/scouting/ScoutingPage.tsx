import { useState } from 'react'
import { PageHead, Panel, Pick } from '../../core/ui'
import { COUNTERS, ENDGAME } from './season'

/** Width and height of the − and + buttons, in pixels. Big enough to tap without looking. */
const TAP_SIZE = 60

/** Every counter from season.ts, starting at 0. */
function zeroCounts(): Record<string, number> {
  return Object.fromEntries(COUNTERS.map((c) => [c.key, 0]))
}

// The form for one robot in one match. Every field comes from season.ts,
// so a new game means new settings, not a new page. It doesn't save yet.
export default function ScoutingPage() {
  const [counts, setCounts] = useState(zeroCounts)
  const [endgame, setEndgame] = useState(ENDGAME[0])
  const [defense, setDefense] = useState(false)
  const [notes, setNotes] = useState('')

  function change(key: string, by: number) {
    setCounts((now) => ({ ...now, [key]: Math.max(0, (now[key] ?? 0) + by) }))
  }

  const tap = { width: TAP_SIZE, minHeight: TAP_SIZE, padding: 0, fontSize: 24 }

  return (
    <>
      <PageHead eyebrow="Scouting" title="Match form">
        Count what one robot does in one match. Entries don't save yet.
      </PageHead>
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
        </div>
      </Panel>
    </>
  )
}
