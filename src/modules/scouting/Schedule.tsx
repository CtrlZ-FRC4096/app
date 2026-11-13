import { useEffect, useState } from 'react'
import { PageHead, Panel, Pill } from '../../core/ui'
import {
  OUR_TEAM, keepScheduleFresh, likelyWinner, matchesWithPredictions, nexusEventUrl, updatedAgo, useCurrentEvent, useSavedSchedule, useScheduleStatus, type ScheduleRow,
} from './data'

/** "10:24 AM", in the phone's own time zone, which is the event's when you're there. */
function startTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/** One alliance's teams, with ours in bold. */
function Teams(props: { side: 'red' | 'blue'; teams: number[] }) {
  return (
    <span style={{
      display: 'inline-flex', flexWrap: 'wrap', gap: '2px 8px', padding: '3px 8px', borderRadius: 'var(--radius)',
      color: `var(--${props.side}-alliance)`, background: `var(--${props.side}-alliance-bg)`,
    }}>
      <span>{props.side === 'red' ? 'Red' : 'Blue'}</span>
      {props.teams.map((team) => (
        <span key={team} className="mono" style={{ fontWeight: team === OUR_TEAM ? 700 : 400 }}>{team}</span>
      ))}
    </span>
  )
}

function Match(props: { row: ScheduleRow }) {
  const { row } = props
  return (
    <div style={{
      display: 'grid', gap: 6, padding: '10px 16px', borderBottom: '1px solid var(--line)',
      background: row.ours ? 'var(--blue-soft)' : undefined,
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'baseline' }}>
        <strong>{row.label}</strong>
        {row.time != null && <span className="note">{startTime(row.time)}</span>}
        {row.ours && <span style={{ marginLeft: 'auto' }}><Pill tone="info">Ours</Pill></span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Teams side="red" teams={row.red} />
        <Teams side="blue" teams={row.blue} />
      </div>
      <p className="note" style={{ margin: 0 }}>
        {row.score
          ? <>Final score: <span className="mono">{row.score.red}–{row.score.blue}</span> ({row.score.red === row.score.blue ? 'tie' : row.score.red > row.score.blue ? 'Red won' : 'Blue won'})</>
          : row.prediction
            ? <>Likely: <strong>{likelyWinner(row.prediction)}</strong> · predicted <span className="mono">{Math.round(row.prediction.redScore)}–{Math.round(row.prediction.blueScore)}</span></>
            : 'No prediction yet'}
      </p>
    </div>
  )
}

/**
 * The event's matches from The Blue Alliance, with Match 13's prediction
 * for each. While it's open it updates by itself (keepScheduleFresh() in
 * data.ts), and with no connection it shows what was saved on this phone.
 */
export default function Schedule() {
  const event = useCurrentEvent().key
  const saved = useSavedSchedule()
  const status = useScheduleStatus()
  const [justOurs, setJustOurs] = useState(false)
  // Ticks so "Updated 2 minutes ago" stays right without a reload.
  const [now, setNow] = useState(() => new Date())

  // Starts again for the new event when a mentor picks another.
  useEffect(() => keepScheduleFresh(event), [event])
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const rows = saved ? matchesWithPredictions(saved.matches, saved.predictions) : []
  const shown = justOurs ? rows.filter((row) => row.ours) : rows

  let message: string
  if (!saved) message = status.problem ? `${status.problem} The schedule will show once this phone has a connection.` : 'Getting the schedule…'
  else if (status.problem) message = `${status.problem} Showing the schedule saved on this phone ${updatedAgo(saved.savedAt, now)}.`
  else message = `Updated ${updatedAgo(saved.savedAt, now)}.`

  return (
    <>
      <PageHead title="Match schedule">
        Every match at the event, with who Match 13 thinks will win. It updates by itself every 2 minutes.
      </PageHead>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <label className="check" style={{ minHeight: 44 }}>
          <input type="checkbox" checked={justOurs} onChange={(e) => setJustOurs(e.target.checked)} /> Just ours ({OUR_TEAM})
        </label>
        <span className="note" role="status">{message}</span>
        <a className="btn" style={{ minHeight: 44, marginLeft: 'auto' }} href={nexusEventUrl(event)} target="_blank" rel="noreferrer">Open in Nexus ↗</a>
      </div>
      <Panel title="Matches" aside={<span className="note">{shown.length} {shown.length === 1 ? 'match' : 'matches'}</span>}>
        {saved && rows.length === 0 ? (
          <p className="panel-body muted">The Blue Alliance doesn't have the schedule yet. This page checks again every 2 minutes.</p>
        ) : saved && shown.length === 0 ? (
          <p className="panel-body muted">No matches for {OUR_TEAM} on the schedule yet.</p>
        ) : (
          <div>
            {shown.map((row) => <Match key={row.key} row={row} />)}
          </div>
        )}
      </Panel>
    </>
  )
}
