import { useState } from 'react'
import { href, navigate } from '../../core/router'
import { PageHead, Panel } from '../../core/ui'
import { savedWhen, sortStats, statColumns, statText, statValue, useRatings } from './data'

// Every team's Match 13 numbers in one table (#152), at #/scouting/stats.
// Tap a column heading to sort by it (best first; tap again for the other
// way), and tap a team to open its team page. On a phone only the table
// scrolls sideways, never the page. It reads the saved copy from
// useRatings(), so it still shows with no Wi-Fi.
export default function StatsTable() {
  const r = useRatings()
  const columns = statColumns(r.ratings)
  const [sortKey, setSortKey] = useState('xpEnd')
  const [bestFirst, setBestFirst] = useState(true)
  const column = columns.find((c) => c.key === sortKey) ?? columns[0]
  const rows = sortStats(r.ratings, column, bestFirst)

  function sortBy(key: string) {
    if (key === column.key) setBestFirst((now) => !now)
    else {
      setSortKey(key)
      setBestFirst(true)
    }
  }

  const when = r.loadedAt ? savedWhen(r.loadedAt) : null
  return (
    <>
      <PageHead title="Stats">
        Every team's Match 13 numbers at the event. Tap a heading to sort by it, and a team to see everything we scouted about them. Variation, the RP chances and the game parts are our reading of Match 13's names: check them on match13.com.
      </PageHead>
      <Panel
        title="Teams"
        aside={<span className="note">{when ? `Updated ${when}${r.error ? " (couldn't reach Match 13)" : ''}` : r.error ? "Couldn't reach Match 13" : 'Getting the numbers…'}</span>}
      >
        {r.ratings.length === 0 ? (
          <p className="panel-body muted" style={{ margin: 0 }}>{when ? 'Match 13 has no ratings for this event yet.' : 'Nothing saved on this phone yet. Open this page with a connection.'}</p>
        ) : (
          <div className="table-wrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th scope="col">Team</th>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className="num" aria-sort={c.key === column.key ? (bestFirst !== !!c.lowerIsBetter ? 'descending' : 'ascending') : undefined}>
                      <button type="button" className="link-btn" style={{ minHeight: 44, textTransform: 'inherit', color: 'inherit', textDecoration: c.key === column.key ? 'underline' : 'none' }} onClick={() => sortBy(c.key)}>
                        {c.label}{c.key === column.key ? (bestFirst ? ' ↓' : ' ↑') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((rating) => (
                  <tr key={rating.teamNumber} className="clickable" onClick={() => navigate('scouting', 'team', String(rating.teamNumber))}>
                    <td><a href={href('scouting', 'team', String(rating.teamNumber))} onClick={(e) => e.stopPropagation()}>{rating.teamNumber}</a></td>
                    {columns.map((c) => {
                      const value = statValue(rating, c.key)
                      return <td key={c.key} className="num tnum">{value === null ? '–' : statText(value, c)}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="panel-body toolbar" style={{ borderTop: '1px solid var(--line)' }}>
          <span className="note">↓ is best first. Lower is better for DPR and variation.</span>
          <button type="button" className="btn" style={{ minHeight: 44, marginLeft: 'auto' }} disabled={r.loading} onClick={r.refresh}>
            {r.loading ? 'Checking…' : 'Refresh'}
          </button>
        </div>
      </Panel>
    </>
  )
}
