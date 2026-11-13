import { useState } from 'react'
import { isLeader, useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pick, Pill } from '../../core/ui'
import {
  PICK_STATUSES, addMissingTeams, allWeightsZero, moveTeamTo, removeTeam, setPickStatus, startPicklist, useRankedPicklist, usePicklist, useTeamPicklist,
  type PickStatus, type PicklistRow,
} from './data'
import { ConfirmAction, MenuAction, MoveTo, RowMenu } from './RowMenu'
import { TeamLink } from './TeamPage'
import { useDragOrder } from './useDragOrder'

/** Smallest width and height of a button, in pixels. Big enough to tap. */
const TAP_SIZE = 44

// Read out by screen readers but not shown, for "Moved team 9991 to place 2."
const SCREEN_READER_ONLY = { position: 'absolute', width: 1, height: 1, padding: 0, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' } as const

// The final picklist for alliance selection, at #/scouting/shared-picklist.
// It's the scouting_picklist table, so every phone shows the same order and
// changes show up by themselves. Everyone signed in sees it; student leaders,
// mentors and admins see the buttons to change it (the database's rules are
// what stop anyone else). Dragging is useDragOrder.ts and the ⋯ menu with
// Move to… and Remove is RowMenu.tsx. The changes go through moveTeamTo(),
// setPickStatus(), removeTeam(), startPicklist() and addMissingTeams() in data.ts.
export default function SharedPicklist() {
  const { role } = useSession()
  const canChange = isLeader(role)
  const list = usePicklist()
  const [hidePicked, setHidePicked] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  // The team being taken off the list, while that saves.
  const [removing, setRemoving] = useState<string | null>(null)
  const { items: ordered, busy, list: attachList, rowProps, handleProps, moveTo } = useDragOrder({
    items: list,
    idOf: (row) => row.id,
    save: (id, to) => moveTeamTo(id, to + 1),
    onDone: (id, result, place) => {
      if (!result.ok) toast(result.error ?? 'Something went wrong. Try again.')
      else setAnnouncement(`Moved team ${list.find((row) => row.id === id)?.team_number} to place ${place}.`)
    },
    removing,
  })

  async function mark(row: PicklistRow, status: PickStatus) {
    const result = await setPickStatus(row.id, status)
    if (!result.ok) toast(result.error)
    else setAnnouncement(`Team ${row.team_number} marked ${status}.`)
  }

  async function remove(row: PicklistRow) {
    setRemoving(row.id)
    const result = await removeTeam(row.id)
    setRemoving(null)
    toast(result.ok ? `Took team ${row.team_number} off the picklist.` : result.error)
  }

  const picked = list.filter((row) => row.status === 'Picked').length
  // ordered is the list in the order on screen, even while a move saves.
  const shown = hidePicked ? ordered.filter((row) => row.status !== 'Picked') : ordered

  return (
    <div className="stack">
      <PageHead title="Final picklist">
        The order the strategy team wants to pick teams in, the same on every phone. It updates by itself.
        {canChange ? " Drag a team by the handle on the right, or use its ⋯ menu to move it to a place or take it off the list. Mark teams that are picked or that we shouldn't pick." : ' Only student leaders, mentors and admins can change it.'}
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
          <ol ref={attachList} className="drag-list">
            {shown.map((row) => {
              const place = ordered.indexOf(row) + 1
              return (
                <li key={row.id} {...rowProps(row.id)}>
                  <div className="drag-row-body" style={canChange ? undefined : { paddingRight: 16 }}>
                    <div className="drag-row-top">
                      {/* Picked and Do not pick teams keep their place, greyed out. */}
                      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px', opacity: row.status === 'Open' ? 1 : 0.55 }}>
                        <strong className="tnum" style={{ fontSize: 18, minWidth: '2ch' }}>{`${place}.`}</strong>
                        <strong style={{ fontSize: 18 }}><TeamLink team={row.team_number} /></strong>
                        {row.status !== 'Open' && <Pill tone={row.status === 'Picked' ? 'plain' : 'crit'}>{row.status}</Pill>}
                      </span>
                      {canChange && (
                        <span className="drag-row-end">
                          <Pick label={`Team ${row.team_number}'s status`} options={[...PICK_STATUSES]} value={row.status} onChange={(status) => void mark(row, status)} />
                        </span>
                      )}
                    </div>
                  </div>
                  {canChange && (
                    <RowMenu label={`More options for team ${row.team_number}`}>
                      {(close) => (
                        <>
                          <MoveTo name={`Team ${row.team_number}`} place={place} count={list.length} disabled={busy}
                            onMove={(to) => { close(); moveTo(row.id, to - 1) }} />
                          <MenuAction disabled={busy || place === 1} onClick={() => { close(); moveTo(row.id, 0) }}>Move to top</MenuAction>
                          <MenuAction disabled={busy || place === list.length} onClick={() => { close(); moveTo(row.id, list.length - 1) }}>Move to bottom</MenuAction>
                          <ConfirmAction label="Remove from the picklist" confirm="Remove" disabled={busy}
                            question={`Take team ${row.team_number} off the final picklist for everyone? To keep it in its place instead, mark it Do not pick.`}
                            onConfirm={() => { close(); void remove(row) }} />
                        </>
                      )}
                    </RowMenu>
                  )}
                  {canChange && <button {...handleProps(row.id, `Move team ${row.team_number}. Drag, or use the arrow keys.`)}><span aria-hidden="true">⠿</span></button>}
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
