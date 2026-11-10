import { Pill } from '../../core/ui'
import { rankOf, updatedAgo, useRankings } from './data'

// The team's place in the event rankings (#39), at the top of the team page:
// "Rank 3 of 42 · 5-1-0". It uses useRankings() from data.ts, the same as
// the Rankings page, so it shows the rankings saved on this phone (with when
// they're from) and they update by themselves while the page is open.
export default function TeamRank(props: { team: number }) {
  const { saved, status } = useRankings()
  if (!saved) return status.checking ? <p className="note" style={{ margin: 0 }}>Getting the event rankings…</p> : null
  const ranking = rankOf(saved.rankings, props.team)
  const record = ranking?.record ? ` · ${ranking.record.wins}-${ranking.record.losses}-${ranking.record.ties}` : ''
  return (
    <div className="toolbar">
      {ranking ? <Pill tone="info">{`Rank ${ranking.rank} of ${saved.rankings.length}${record}`}</Pill> : <span className="note">Not in the event rankings yet</span>}
      <span className="note">{`Rankings updated ${updatedAgo(saved.checked_at)}`}</span>
    </div>
  )
}
