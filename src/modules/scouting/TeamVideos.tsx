import { Panel } from '../../core/ui'
import { useTeamQualVideos, type QualVideoRow } from './data'

/** "Qual 12 · Red · Won 84–71", or "Qual 12 · Red · Not played yet". */
function matchText(row: QualVideoRow): string {
  const side = row.alliance === 'red' ? 'Red' : 'Blue'
  const result = row.result === null ? 'Not played yet' : `${row.result} ${row.ourScore}–${row.theirScore}`
  return `Qual ${row.number} · ${side} · ${result}`
}

/**
 * One line per qualification match, with a button for each video. Only
 * links: the video opens in YouTube (a new tab), so the page stays light on
 * venue Wi-Fi. A plain component so tests can draw it with example rows.
 */
export function VideoList(props: { rows: QualVideoRow[] }) {
  return (
    <div className="row-list">
      {props.rows.map((row) => (
        <div key={row.key} style={{ flexWrap: 'wrap' }}>
          <span style={{ overflowWrap: 'anywhere' }}>{matchText(row)}</span>
          <span className="toolbar" style={{ marginLeft: 'auto', gap: 8 }}>
            {row.links.map((link, i) => (
              <a
                key={link}
                className="btn"
                style={{ minHeight: 44 }}
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Watch qual ${row.number}${i > 0 ? `, video ${i + 1}` : ''} on YouTube (opens a new tab)`}
              >
                {i === 0 ? 'Watch ↗' : `Watch (${i + 1}) ↗`}
              </a>
            ))}
            {/* A match not played yet already says so on the left. */}
            {row.links.length === 0 && row.result !== null && <span className="note">No video yet</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

// Links to a team's qualification match videos (#41), on the team page.
// They come from The Blue Alliance through useTeamQualVideos() in data.ts,
// which asks again when "Check again" is pressed: TBA adds videos during
// the event.
export default function TeamVideos(props: { team: number }) {
  const { rows, loading, error, reload } = useTeamQualVideos(props.team)
  const checkAgain = (
    <button type="button" className="btn" style={{ minHeight: 44 }} disabled={loading} onClick={reload}>
      {loading ? 'Checking…' : error ? 'Try again' : 'Check again'}
    </button>
  )
  return (
    <Panel title="Match videos" aside={checkAgain}>
      {error && <p className="panel-body" role="status" style={{ margin: 0 }}>{`Couldn't get the videos. ${error}`}</p>}
      {rows.length > 0 ? (
        <VideoList rows={rows} />
      ) : (
        !error && (
          <p className="panel-body muted" style={{ margin: 0 }}>
            {loading ? 'Looking for videos…' : `No qualification matches for team ${props.team} yet.`}
          </p>
        )
      )}
    </Panel>
  )
}
