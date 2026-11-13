import { useState } from 'react'
import { useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { PageHead, Panel } from '../../core/ui'
import {
  MAX_PICKLIST_NOTE, addToMyPicklist, allWeightsZero, moveOnMyPicklist, removeFromMyPicklist, setPicklistNote, startMyPicklist, useMyPicklist, useRankedPicklist,
  type MyPicklistRow,
} from './data'
import { ConfirmAction, MenuAction, MoveTo, RowMenu } from './RowMenu'
import { TeamLink } from './TeamPage'
import { useDragOrder } from './useDragOrder'

/** Width and height of the buttons, in pixels. Big enough to tap. */
const TAP_SIZE = 44

// Your own picklist (#151), at #/scouting/my-picklist. It's saved to the
// team database (scouting_my_picklist), so it's on all your devices and the
// team picklist can average it. It still shows with no Wi-Fi, but changes
// need a connection. Changes go through data.ts: startMyPicklist(),
// addToMyPicklist(), moveOnMyPicklist(), setPicklistNote() and
// removeFromMyPicklist(). Dragging is useDragOrder.ts, and the ⋯ menu with
// Move to… and Remove is RowMenu.tsx.
export default function MyPicklist() {
  useSession()
  const list = useMyPicklist()
  const [announcement, setAnnouncement] = useState('')
  // The team being taken off the list, while that saves.
  const [removing, setRemoving] = useState<string | null>(null)
  const { items: ordered, busy, list: attachList, rowProps, handleProps, moveTo } = useDragOrder({
    items: list,
    idOf: (row) => row.id,
    save: (id, to) => moveOnMyPicklist(list.find((row) => row.id === id)?.team_number ?? 0, to + 1),
    onDone: (id, result, place) => {
      if (!result.ok) toast(result.error ?? 'Something went wrong. Try again.')
      else setAnnouncement(`Moved team ${list.find((row) => row.id === id)?.team_number} to place ${place}.`)
    },
    removing,
  })

  async function remove(row: MyPicklistRow) {
    setRemoving(row.id)
    const result = await removeFromMyPicklist(row.team_number)
    setRemoving(null)
    toast(result.ok ? `Took team ${row.team_number} off your list.` : result.error)
  }

  return (
    <div className="stack">
      <PageHead title="My picklist">
        Your own order for picking teams, with a note on any team. Drag a team by the handle on the right, or use its ⋯ menu to move it to a place, add a note or take it off your list. Everyone can see your list, and the team picklist averages everyone's. It's saved to the team, so changing it needs a connection.
      </PageHead>
      <StartOrAdd list={list} />
      <Panel title="My list" aside={<span className="note">{list.length} {list.length === 1 ? 'team' : 'teams'}</span>}>
        <p className="note" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }} role="status">{announcement}</p>
        {list.length === 0 ? (
          <p className="panel-body muted" style={{ margin: 0 }}>No teams yet. Start it from the ranked list above.</p>
        ) : (
          <ol ref={attachList} className="drag-list">
            {ordered.map((row, i) => (
              <li key={row.id} {...rowProps(row.id)}>
                <Line row={row} place={i + 1} last={list.length} busy={busy} moveTo={(place) => moveTo(row.id, place - 1)} remove={() => void remove(row)} />
                <button {...handleProps(row.id, `Move team ${row.team_number}. Drag, or use the arrow keys.`)}><span aria-hidden="true">⠿</span></button>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  )
}

// One team: its place, the team and its note, then the ⋯ menu.
function Line(props: { row: MyPicklistRow; place: number; last: number; busy: boolean; moveTo: (place: number) => void; remove: () => void }) {
  const { row, place } = props
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(row.note ?? '')
  const name = `Team ${row.team_number}`

  async function saveNote() {
    const result = await setPicklistNote(row.team_number, note)
    if (!result.ok) toast(result.error)
    else setEditing(false)
  }

  return (
    <>
      <div className="drag-row-body">
        <div className="drag-row-top">
          <strong className="tnum" style={{ fontSize: 18, minWidth: '2ch' }}>{`${place}.`}</strong>
          <strong style={{ fontSize: 18 }}><TeamLink team={row.team_number} /></strong>
        </div>
        {editing ? (
          <form style={{ display: 'grid', gap: 6 }} onSubmit={(e) => { e.preventDefault(); void saveNote() }}>
            <textarea className="input" style={{ fontSize: 16 }} rows={2} maxLength={MAX_PICKLIST_NOTE} aria-label={`Note on team ${row.team_number}`} autoFocus
              value={note} onChange={(e) => setNote(e.target.value)} placeholder="Like: great defender, slow climb" />
            <div className="toolbar">
              <button type="submit" className="btn btn-primary" style={{ minHeight: TAP_SIZE }}>Save note</button>
              <button type="button" className="btn" style={{ minHeight: TAP_SIZE }} onClick={() => { setNote(row.note ?? ''); setEditing(false) }}>Cancel</button>
              <span className="note">{`${note.trim().length} of ${MAX_PICKLIST_NOTE}`}</span>
            </div>
          </form>
        ) : (
          <button type="button" className="link-btn" style={{ justifySelf: 'start', minHeight: TAP_SIZE, textAlign: 'left', overflowWrap: 'anywhere' }} onClick={() => setEditing(true)}>
            {row.note ?? 'Add a note'}
          </button>
        )}
      </div>
      <RowMenu label={`More options for team ${row.team_number}`}>
        {(close) => (
          <>
            <MoveTo name={name} place={place} count={props.last} disabled={props.busy} onMove={(to) => { close(); props.moveTo(to) }} />
            <MenuAction disabled={props.busy || place === 1} onClick={() => { close(); props.moveTo(1) }}>Move to top</MenuAction>
            <MenuAction disabled={props.busy || place === props.last} onClick={() => { close(); props.moveTo(props.last) }}>Move to bottom</MenuAction>
            <MenuAction onClick={() => { close(); setEditing(true) }}>{row.note ? 'Change note' : 'Add a note'}</MenuAction>
            <ConfirmAction label="Remove from my list" confirm="Remove" disabled={props.busy}
              question={row.note ? `Take team ${row.team_number} off your list? Its note goes too.` : `Take team ${row.team_number} off your list?`}
              onConfirm={() => { close(); props.remove() }} />
          </>
        )}
      </RowMenu>
    </>
  )
}

// Start an empty list from the Picklist page's order (this phone's weights),
// or add the teams it doesn't have yet.
function StartOrAdd(props: { list: MyPicklistRow[] }) {
  const { ranked, weights } = useRankedPicklist()
  const [busy, setBusy] = useState(false)
  const onList = new Set(props.list.map((row) => row.team_number))
  const missing = ranked.filter((line) => !onList.has(line.team)).map((line) => line.team)

  async function run(action: () => Promise<{ ok: boolean; error?: string; value?: unknown[] }>, done: (n: number) => string) {
    setBusy(true)
    const result = await action()
    setBusy(false)
    toast(result.ok ? done(result.value?.length ?? 0) : result.error ?? 'Something went wrong. Try again.')
  }

  if (props.list.length === 0) {
    const noWeights = allWeightsZero(weights)
    return (
      <div className="toolbar">
        <button type="button" className="btn btn-lg btn-primary" disabled={busy || noWeights || ranked.length === 0}
          onClick={() => void run(() => startMyPicklist(ranked.map((line) => line.team)), (n) => `Started your picklist with ${n} teams.`)}>
          {busy ? 'Starting…' : 'Start my list'}
        </button>
        <span className="note">
          {noWeights ? 'Every weight on the Picklist page is 0 on this phone. Set one above 0 first.' : `Starts with the ${ranked.length} teams on the Picklist page, in the order your weights give.`}
        </span>
      </div>
    )
  }
  if (missing.length === 0) return null
  return (
    <div className="toolbar">
      <span className="note">{missing.length} {missing.length === 1 ? 'team is' : 'teams are'} at the event but not on your list.</span>
      <button type="button" className="btn" style={{ minHeight: TAP_SIZE }} disabled={busy}
        onClick={() => void run(() => addToMyPicklist(missing), (n) => `Added ${n} ${n === 1 ? 'team' : 'teams'} to the bottom.`)}>
        {busy ? 'Adding…' : 'Add teams not on my list'}
      </button>
    </div>
  )
}
