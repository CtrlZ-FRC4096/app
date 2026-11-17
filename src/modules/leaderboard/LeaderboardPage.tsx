import { useState } from 'react'
import { toast } from '../../core/toast'
import { Callout, PageHead, Panel } from '../../core/ui'
import { REPO, updateLeaderboards, useLeaderboards, type Place } from './data'

const MEDALS = ['🥇', '🥈', '🥉']

// The page reads the leaderboards with a hook (useLeaderboards) and asks for
// new numbers with updateLeaderboards() from data.ts. It never fetches itself.
export default function LeaderboardPage() {
  const view = useLeaderboards()
  const [refreshing, setRefreshing] = useState(false)
  const busy = refreshing || view.loading
  const nothingYet = view.pulls.length === 0 && view.issues.length === 0

  async function refresh() {
    setRefreshing(true)
    const result = await updateLeaderboards()
    setRefreshing(false)
    toast(result.ok ? result.value : result.error)
  }

  return (
    <>
      <PageHead title="Leaderboards">
        Which students have solved the most issues and merged the most pull requests in the team app’s GitHub repo. Mentors
        aren’t on the boards.
      </PageHead>

      <div className="toolbar">
        <span className="note">
          {view.demo
            ? 'Demo mode: made-up people.'
            : view.updatedAt
              ? `Updated ${new Date(view.updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
              : 'Not loaded yet.'}
        </span>
        <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>
          {busy ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {view.error && <p className="note" role="alert">{view.error}</p>}

      {nothingYet && busy ? (
        <Panel>
          <p className="panel-body muted">Loading from GitHub…</p>
        </Panel>
      ) : (
        <>
          <Board title="Most issues solved" places={view.issues} unit={['issue', 'issues']} empty="No issues solved yet." />
          <Board title="Most pull requests" places={view.pulls} unit={['pull request', 'pull requests']} empty="No merged pull requests yet." />
        </>
      )}

      <Callout title="How to get credit for an issue">
        <p>
          In your pull request’s description, write <span className="mono">Closes #12</span> (or{' '}
          <span className="mono">Fixes #12</span>), using the issue’s number, one line per issue. When your pull request is merged,
          GitHub closes the issue and it counts for you. Only merged pull requests count.
        </p>
      </Callout>
    </>
  )
}

function Board(props: { title: string; places: Place[]; unit: [string, string]; empty: string }) {
  const [one, many] = props.unit
  return (
    <Panel title={props.title}>
      {props.places.length === 0 ? (
        <p className="panel-body muted">{props.empty}</p>
      ) : (
        <ol className="row-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {props.places.map((place) => (
            <li key={place.login}>
              <span className="tnum" style={{ minWidth: 28 }} aria-label={`Rank ${place.rank}`}>
                {MEDALS[place.rank - 1] ?? place.rank}
              </span>
              <a href={`https://github.com/${REPO}/pulls?q=is%3Amerged+author%3A${encodeURIComponent(place.login)}`} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                {place.login}
              </a>
              <strong className="tnum" style={{ marginLeft: 'auto' }}>
                {place.count} <span className="note">{place.count === 1 ? one : many}</span>
              </strong>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
