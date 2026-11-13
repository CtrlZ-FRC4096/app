import { useState } from 'react'
import { useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { PageHead, Panel } from '../../core/ui'
import {
  MAX_PICKLIST_NOTE, addToMyPicklist, allWeightsZero, moveOnMyPicklist, setPicklistNote, startMyPicklist, useMyPicklist, useRankedPicklist,
  type MyPicklistRow,
} from './data'
import { TeamLink } from './TeamPage'

/** Width and height of the buttons, in pixels. Big enough to tap. */
const TAP_SIZE = 44

// Your own picklist (#151), at #/scouting/my-picklist. It's saved to the
// team database (scouting_my_picklist), so it's on all your devices and the
// team picklist can average it. It still shows with no Wi-Fi, but changes
// need a connection. Changes go through data.ts: startMyPicklist(),
// addToMyPicklist(), moveOnMyPicklist() and setPicklistNote().
export default function MyPicklist() {
  useSession()
  const list = useMyPicklist()
  // True while a change is saving, so a second tap can't move from the old order.
  const [busy, setBusy] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  async function move(row: MyPicklistRow, rank: number) {
    setBusy(true)
    const result = await moveOnMyPicklist(row.team_number, rank)
    setBusy(false)
    if (!result.ok) toast(result.error)
    else setAnnouncement(`Moved team ${row.team_number} to place ${Math.min(list.length, Math.max(1, rank))}.`)
  }

  return (
    <div className="stack">
      <PageHead title="My picklist">
        Your own order for picking teams, with a note on any team. Everyone can see it, and the team picklist averages everyone's. It's saved to the team, so changing it needs a connection.
      </PageHead>
      <StartOrAdd list={list} />
      <Panel title="My list" aside={<span className="note">{list.length} {list.length === 1 ? 'team' : 'teams'}</span>}>
        <p className="note" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }} role="status">{announcement}</p>
        {list.length === 0 ? (
          <p className="panel-body muted" style={{ margin: 0 }}>No teams yet. Start it from the ranked list above.</p>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {list.map((row, i) => <Line key={row.id} row={row} place={i + 1} last={list.length} busy={busy} move={move} />)}
          </ol>
        )}
      </Panel>
    </div>
  )
}

function Line(props: { row: MyPicklistRow; place: number; last: number; busy: boolean; move: (row: MyPicklistRow, rank: number) => Promise<void> }) {
  const { row, place } = props
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(row.note ?? '')
  const [moveTo, setMoveTo] = useState('')

  async function saveNote() {
    const result = await setPicklistNote(row.team_number, note)
    if (!result.ok) toast(result.error)
    else setEditing(false)
  }

  return (
    <li style={{ display: 'grid', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
        <strong className="tnum" style={{ fontSize: 18, minWidth: '2ch' }}>{`${place}.`}</strong>
        <strong style={{ fontSize: 18 }}><TeamLink team={row.team_number} /></strong>
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <button type="button" className="btn" style={{ minWidth: TAP_SIZE, minHeight: TAP_SIZE, fontSize: 20 }}
            aria-label={`Move team ${row.team_number} up`} disabled={props.busy || place === 1} onClick={() => void props.move(row, place - 1)}>
            <span aria-hidden="true">↑</span>
          </button>
          <button type="button" className="btn" style={{ minWidth: TAP_SIZE, minHeight: TAP_SIZE, fontSize: 20 }}
            aria-label={`Move team ${row.team_number} down`} disabled={props.busy || place === props.last} onClick={() => void props.move(row, place + 1)}>
            <span aria-hidden="true">↓</span>
          </button>
          {/* Move to any place, for long moves. */}
          <form style={{ display: 'flex', gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (moveTo) void props.move(row, Number(moveTo)).then(() => setMoveTo('')) }}>
            <input className="input" style={{ width: '5ch', minHeight: TAP_SIZE, fontSize: 16 }} inputMode="numeric" aria-label={`Move team ${row.team_number} to place`} placeholder="#"
              value={moveTo} onChange={(e) => setMoveTo(e.target.value.replace(/\D/g, ''))} />
            <button type="submit" className="btn" style={{ minHeight: TAP_SIZE }} disabled={props.busy || !moveTo}>Move to…</button>
          </form>
        </span>
      </div>
      {editing ? (
        <form style={{ display: 'grid', gap: 6 }} onSubmit={(e) => { e.preventDefault(); void saveNote() }}>
          <textarea className="input" style={{ fontSize: 16 }} rows={2} maxLength={MAX_PICKLIST_NOTE} aria-label={`Note on team ${row.team_number}`}
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
    </li>
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
