import { Panel, Pill } from '../../core/ui'
import { STAT_COLUMNS, ratingComponents, savedWhen, signed, statText, statValue, teamRating, teamRecord, useRatings } from './data'

/** "48.6", or "not given" when Match 13 left it out. */
function points(n: number | null): string {
  return n === null ? 'not given' : n.toFixed(1)
}

/** One line of the panel: what it is on the left, the number on the right. */
function Line(props: { label: string; value: string }) {
  return (
    <div style={{ flexWrap: 'wrap' }}>
      <span>{props.label}</span>
      <strong className="tnum" style={{ marginLeft: 'auto' }}>{props.value}</strong>
    </div>
  )
}

// Match 13's numbers for one team (#37), on the team page. Every team's
// numbers come from one saved copy (useRatings() in data.ts), so this panel
// never asks Match 13 for one team, and it still shows with no Wi-Fi.
export default function TeamRatings(props: { team: number }) {
  const r = useRatings()
  // When the saved numbers are from, or null when nothing's saved yet.
  const when = r.loadedAt ? savedWhen(r.loadedAt) : null
  const saved = when !== null
  const rated = teamRating(r.ratings, props.team)
  const record = teamRecord(r.rankings, props.team)
  const recordText = record ? `${record.wins}-${record.losses}-${record.ties}` : 'not given'

  let body
  if (!saved) {
    body = (
      <p className="panel-body muted" style={{ margin: 0 }}>
        {r.error ? "Couldn't reach Match 13 and nothing is saved on this phone yet. Try again with a connection." : "Getting Match 13's numbers…"}
      </p>
    )
  } else if (!rated) {
    body = (
      <>
        <p className="panel-body muted" style={{ margin: 0 }}>No Match 13 rating yet</p>
        {record && <div className="row-list"><Line label="Record" value={recordText} /></div>}
      </>
    )
  } else {
    const { rating } = rated
    body = (
      <>
        <div className="panel-body" style={{ gap: 6 }}>
          <span><Pill tone="info">{`Rank ${rated.rank} of ${rated.teams}`}</Pill></span>
          <strong className="tnum" style={{ fontSize: 40, lineHeight: 1.1 }}>{`${rating.xpEnd.toFixed(1)} xP`}</strong>
          <span className="note" style={{ overflowWrap: 'anywhere' }}>
            {`${signed(rated.change)} since the event started (${rating.xpStart.toFixed(1)} → ${rating.xpEnd.toFixed(1)})`}
          </span>
        </div>
        <div className="row-list">
          <Line label="Auto" value={points(rating.xAuto)} />
          <Line label="Teleop" value={points(rating.xTele)} />
          <Line label="Endgame" value={points(rating.xEnd)} />
          <Line label="Statbotics EPA" value={points(rating.epa)} />
          <Line label="OPR (The Blue Alliance)" value={points(rating.opr)} />
          <Line label="DPR (points given up, lower is better)" value={points(rating.dpr)} />
          {/* #152: Match 13's other numbers. Their meanings are our reading of Match 13's names: see data.ts. */}
          <Line label="Variation (lower is steadier)" value={points(rating.xVar ?? null)} />
          {STAT_COLUMNS.filter((c) => c.percent).map((c) => (
            <Line key={c.key} label={c.label} value={statText(statValue(rating, c.key), c)} />
          ))}
          {/* #152: Match 13's simulation of the event, when it has one. */}
          {rating.simRank != null && (
            <Line
              label="Likely final rank (Match 13 sim)"
              value={`${rating.simRank.toFixed(1)}${rating.simRankLow != null && rating.simRankHigh != null ? ` (${rating.simRankLow}–${rating.simRankHigh})` : ''}`}
            />
          )}
          {rating.simRp != null && <Line label="Ranking points (Match 13 sim)" value={rating.simRp.toFixed(1)} />}
          {ratingComponents(rating).map((c) => (
            <Line key={c.name} label={`Game part: ${c.name}`} value={statText(c.value)} />
          ))}
          <Line label="Record" value={recordText} />
        </div>
      </>
    )
  }

  return (
    <Panel title="Match 13" aside={<span className="note">Expected points (xP)</span>}>
      {saved && r.error && (
        <p className="panel-body note" role="status" style={{ margin: 0 }}>
          {`Couldn't reach Match 13. Showing numbers from ${when}.`}
        </p>
      )}
      {body}
      <div className="panel-body toolbar" style={{ borderTop: '1px solid var(--line)' }}>
        {saved && <span className="note">{`Updated ${when}`}</span>}
        <button type="button" className="btn" style={{ minHeight: 44, marginLeft: 'auto' }} disabled={r.loading} onClick={r.refresh}>
          {r.loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>
    </Panel>
  )
}
