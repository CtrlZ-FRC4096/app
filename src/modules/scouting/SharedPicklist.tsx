import { useState } from 'react'
import { isLeader, useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pick, Pill } from '../../core/ui'
import {
  PICK_STATUSES, addMissingTeams, allWeightsZero, moveTeam, setPickStatus, startPicklist, useRankedPicklist, usePicklist, useTeamPicklist,
  type PickStatus, type PicklistRow,
} from './data'
import { TeamLink } from './TeamPage'

/** Width and height of the up and down buttons, in pixels. Big enough to tap. */
const TAP_SIZE = 44

// Read out by screen readers but not shown, for "Moved team 9991 to place 2."
const SCREEN_READER_ONLY = { position: 'absolute', width: 1, height: 1, padding: 0, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' } as const

// The final picklist for alliance selection, at #/scouting/shared-picklist.
// It's the scouting_picklist table, so every phone shows the same order and
// changes show up by themselves. Everyone signed in sees it; student leaders,
// mentors and admins see the buttons to change it (the database's rules are
// what stop anyone else). The changes go through moveTeam(), setPickStatus(),
// startPicklist() and addMissingTeams() in data.ts.
export default function SharedPicklist() {
  const { role } = useSession()
  const canChange = isLeader(role)
  const list = usePicklist()
  const [hidePicked, setHidePicked] = useState(false)
  // True while a move is saving, so a second tap can't move from the old order.
  const [moving, setMoving] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  async function move(row: PicklistRow, direction: -1 | 1) {
    setMoving(true)
    const result = await moveTeam(row.id, direction)
    setMoving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    const place = Math.max(1, Math.min(list.length, list.indexOf(row) + 1 + direction))
    setAnnouncement(`Moved team ${row.team_number} to place ${place}.`)
  }

  async function mark(row: PicklistRow, status: PickStatus) {
    const result = await setPickStatus(row.id, status)
    if (!result.ok) toast(result.error)
    else setAnnouncement(`Team ${row.team_number} marked ${status}.`)
  }

  const picked = list.filter((row) => row.status === 'Picked').length
  const shown = hidePicked ? list.filter((row) => row.status !== 'Picked') : list

  return (
    <div className="stack">
      <PageHead title="Final picklist">
        The order the strategy team wants to pick teams in, the same on every phone. It updates by itself.
        {canChange ? " Move teams with the up and down buttons, and mark teams that are picked or that we shouldn't pick." : ' Only student leaders, mentors and admins can change it.'}
      </PageHead>
      {canChange && <StartOrAdd list={list} />}
      {list.length > 0 && (
        <div className="toolbar">
          <label className="check" style={{ minHeight: 44 }}>
            <input type="checkbox" checked={hidePicked} onChange={(e) => setHidePicked(e.target.checked)} /> Hide picked ({picked})
          </label>
        </div>
      )}
      <Panel title="Picklist" aside={<span className="note">{list.length} {list.length === 1 ? 'team' : 'teams'}</span>}>
        <p style={SCREEN_READER_ONLY} role="status">{announcement}</p>
        {list.length === 0 ? (
          <p className="panel-body muted">
            {canChange ? 'No teams yet. Start it from the ranked list above.' : "The strategy team hasn't made the picklist yet."}
          </p>
        ) : shown.length === 0 ? (
          <p className="panel-body muted">Every team on the list is picked.</p>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {shown.map((row) => {
              const place = list.indexOf(row) + 1
              return (
                <li key={row.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
                  {/* Picked and Do not pick teams keep their place, greyed out. */}
                  <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px', opacity: row.status === 'Open' ? 1 : 0.55 }}>
                    <strong className="tnum" style={{ fontSize: 18, minWidth: '2ch' }}>{`${place}.`}</strong>
                    <strong style={{ fontSize: 18 }}><TeamLink team={row.team_number} /></strong>
                    {row.status !== 'Open' && <Pill tone={row.status === 'Picked' ? 'plain' : 'crit'}>{row.status}</Pill>}
                  </span>
                  {canChange && (
                    <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                      <button type="button" className="btn" style={{ minWidth: TAP_SIZE, minHeight: TAP_SIZE, fontSize: 20 }}
                        aria-label={`Move team ${row.team_number} up`} disabled={moving || place === 1} onClick={() => void move(row, -1)}>
                        <span aria-hidden="true">↑</span>
                      </button>
                      <button type="button" className="btn" style={{ minWidth: TAP_SIZE, minHeight: TAP_SIZE, fontSize: 20 }}
                        aria-label={`Move team ${row.team_number} down`} disabled={moving || place === list.length} onClick={() => void move(row, 1)}>
                        <span aria-hidden="true">↓</span>
                      </button>
                      <Pick label={`Team ${row.team_number}'s status`} options={[...PICK_STATUSES]} value={row.status} onChange={(status) => void mark(row, status)} />
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </Panel>
    </div>
  )
}

// For people who can change the shared list: start an empty list from the
// ranked list on the Picklist page (with this phone's weights), or add the
// teams it doesn't have yet. Its own component so only their phones load
// the ranked list.
function StartOrAdd(props: { list: PicklistRow[] }) {
  const { ranked, weights } = useRankedPicklist()
  const teamPicklist = useTeamPicklist()
  const [busy, setBusy] = useState(false)
  const onList = new Set(props.list.map((row) => row.team_number))
  const missing = ranked.filter((line) => !onList.has(line.team)).map((line) => line.team)

  async function start(teams: number[]) {
    setBusy(true)
    const result = await startPicklist(teams)
    setBusy(false)
    toast(result.ok ? `Started the picklist with ${result.value.length} teams.` : result.error)
  }

  async function addMissing() {
    setBusy(true)
    const result = await addMissingTeams(missing)
    setBusy(false)
    toast(result.ok ? `Added ${result.value.length} ${result.value.length === 1 ? 'team' : 'teams'} to the bottom.` : result.error)
  }

  if (props.list.length === 0) {
    const noWeights = allWeightsZero(weights)
    return (
      <Panel title="Start the picklist">
        <div className="panel-body">
          <p className="muted" style={{ margin: 0 }}>
            {noWeights
              ? 'Every weight on the Picklist page is 0 on this phone. Set at least one above 0 first, so the list starts in a useful order.'
              : `Starts with the ${ranked.length} teams on the Picklist page, in the order your weights on this phone give. Then move them by hand.`}
          </p>
          <div className="toolbar">
            <button type="button" className="btn btn-primary" style={{ minHeight: TAP_SIZE }} disabled={busy || noWeights || ranked.length === 0} onClick={() => void start(ranked.map((line) => line.team))}>
              {busy ? 'Starting…' : 'Start from the ranked list'}
            </button>
            {/* #151: everyone's own picklists, averaged. */}
            <button type="button" className="btn" style={{ minHeight: TAP_SIZE }} disabled={busy || teamPicklist.length === 0} onClick={() => void start(teamPicklist.map((line) => line.team))}>
              {busy ? 'Starting…' : 'Start from the team picklist'}
            </button>
          </div>
          {teamPicklist.length === 0 && <p className="note" style={{ margin: 0 }}>Nobody has made their own picklist yet, so there's no team picklist to start from.</p>}
        </div>
      </Panel>
    )
  }
  if (missing.length === 0) return null
  return (
    <div className="toolbar">
      <span className="note">{missing.length} {missing.length === 1 ? 'team is' : 'teams are'} on the ranked list but not here.</span>
      <button type="button" className="btn" style={{ minHeight: TAP_SIZE }} disabled={busy} onClick={() => void addMissing()}>
        {busy ? 'Adding…' : 'Add teams not on the list'}
      </button>
    </div>
  )
}
