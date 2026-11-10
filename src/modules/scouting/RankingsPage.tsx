import { useEffect, useState } from 'react'
import { href } from '../../core/router'
import { PageHead, Panel } from '../../core/ui'
import { teamNumber, updatedAgo, useRankings, type TbaRanking } from './data'

/** How often "Updated 2 minutes ago" counts up, even with no new rankings. */
const CLOCK_MS = 15 * 1000

/** "5-2-0": wins, losses and ties. */
function recordText(r: TbaRanking): string {
  return r.record ? `${r.record.wins}-${r.record.losses}-${r.record.ties}` : 'No record yet'
}

// The event's rankings from The Blue Alliance. useRankings() in data.ts
// checks for new ones every minute while this page is open, and keeps the
// last ones on this device, so they still show with no Wi-Fi.
export default function RankingsPage() {
  const { saved, status } = useRankings()
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(timer)
  }, [])

  // What to say under the title: when they're from, and why they're old, if they are.
  const when = saved ? `Updated ${updatedAgo(saved.checked_at, new Date(now))}` : status.checking ? 'Getting the rankings…' : 'No rankings on this phone yet'

  return (
    <>
      <PageHead title="Rankings">
        The event's rankings from The Blue Alliance. They update by themselves after each match. RP is ranking points. Tap a team to see everything about them.
      </PageHead>
      <Panel title="Event rankings" aside={<span className="note" aria-live="polite">{when}</span>}>
        {status.problem && <p className="panel-body note" style={{ margin: 0 }}>Not updated. {status.problem}</p>}
        {saved && saved.rankings.length === 0 && (
          <p className="panel-body muted">No rankings yet. They show up after the first qualification match.</p>
        )}
        {saved && saved.rankings.length > 0 && (
          <div className="row-list">
            {/* Each row is a link to that team's page: the whole row, so it's easy to tap. */}
            {saved.rankings.map((r) => (
              <a key={r.team_key} href={href('scouting', 'team', String(teamNumber(r.team_key)))} style={{ minHeight: 44, color: 'inherit', textDecoration: 'none' }}>
                <span className="mono" style={{ minWidth: '3ch', fontSize: 18 }}>{r.rank}</span>
                <span>
                  <span style={{ color: 'var(--orange-text)', textDecoration: 'underline', textUnderlineOffset: 2 }}>Team {teamNumber(r.team_key)}</span>
                  <br />
                  <span className="note">{recordText(r)} · {r.matches_played} played</span>
                </span>
                <span className="mono" style={{ marginLeft: 'auto' }}>{r.extra_stats?.[0] ?? '–'} RP</span>
              </a>
            ))}
          </div>
        )}
      </Panel>
    </>
  )
}
