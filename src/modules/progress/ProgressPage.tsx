import { useState, type FormEvent } from 'react'
import { isLeader, useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { PageHead, Panel } from '../../core/ui'
import { NAME_LIMIT, STAGES, addSubsystem, changeCell, moveSubsystem, removeSubsystem, renameSubsystem, stateOf, useSubsystems, type Stage, type Subsystem } from './data'
import './progress.css'

// The subsystem progress grid. It reads the grid with a hook (useSubsystems)
// and changes it with functions from data.ts; it never saves anything itself.
// Student leaders, mentors and admins can change it. The database's rules
// enforce this too: hiding the buttons only keeps the page tidy.
export default function ProgressPage() {
  const subsystems = useSubsystems()
  const { role } = useSession()
  const canEdit = isLeader(role)

  return (
    <>
      <PageHead title="Build progress">
        Where each subsystem stands: designed, built, wired, programmed and tested.
      </PageHead>
      {canEdit && <AddSubsystemForm />}
      <Panel title="Subsystem progress" className="progress-panel">
        <p className="panel-body" id="progress-instructions">
          {canEdit
            ? 'Tap a cell to move it along: Not started → In progress → Done → Not started. Everyone on the team sees your changes.'
            : 'Student leaders and mentors update this grid. Ask one of them if something has changed.'}
          {' '}On a phone, swipe across the grid to see every stage.
        </p>
        {subsystems.length === 0 ? (
          <p className="panel-body muted">No subsystems yet.{canEdit && ' Add the first one above.'}</p>
        ) : (
          <div className="table-wrap progress-scroll" role="region" aria-label="Subsystem progress grid" tabIndex={0}>
            <table className="progress-grid" aria-label="Robot subsystem progress" aria-describedby="progress-instructions">
              <thead>
                <tr>
                  <th scope="col">Subsystem</th>
                  {STAGES.map((stage) => <th key={stage} scope="col">{stage}</th>)}
                </tr>
              </thead>
              <tbody>
                {subsystems.map((subsystem, i) => (
                  <SubsystemRow key={subsystem.id} subsystem={subsystem} canEdit={canEdit} first={i === 0} last={i === subsystems.length - 1} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

/** Show the result of a change: nothing when it worked, the reason when it didn't. */
function report(result: { ok: boolean; error?: string }) {
  if (!result.ok) toast(result.error ?? 'That didn\'t work. Try again.')
}

function SubsystemRow(props: { subsystem: Subsystem; canEdit: boolean; first: boolean; last: boolean }) {
  const { subsystem, canEdit } = props
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(subsystem.name)
  const [removing, setRemoving] = useState(false)

  async function rename(event: FormEvent) {
    event.preventDefault()
    const result = await renameSubsystem(subsystem, name)
    report(result)
    if (result.ok) setRenaming(false)
  }

  async function remove() {
    // Removing can't be undone, so it takes two presses.
    if (!removing) {
      setRemoving(true)
      return
    }
    const result = await removeSubsystem(subsystem)
    toast(result.ok ? `Removed ${subsystem.name}.` : result.error)
  }

  return (
    <tr>
      <th scope="row">
        {renaming ? (
          <form className="progress-rename" onSubmit={rename}>
            <input className="input" aria-label={`New name for ${subsystem.name}`} maxLength={NAME_LIMIT} value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="btn btn-sm btn-primary">Save</button>
            <button type="button" className="btn btn-sm" onClick={() => { setRenaming(false); setName(subsystem.name) }}>Cancel</button>
          </form>
        ) : (
          subsystem.name
        )}
        {canEdit && !renaming && (
          <span className="progress-actions">
            <button type="button" className="btn btn-sm" aria-label={`Move ${subsystem.name} up`} disabled={props.first} onClick={() => void moveSubsystem(subsystem, -1).then(report)}>↑</button>
            <button type="button" className="btn btn-sm" aria-label={`Move ${subsystem.name} down`} disabled={props.last} onClick={() => void moveSubsystem(subsystem, 1).then(report)}>↓</button>
            <button type="button" className="btn btn-sm" onClick={() => setRenaming(true)}>Rename</button>
            <button type="button" className="btn btn-sm" onClick={() => void remove()} onBlur={() => setRemoving(false)}>
              {removing ? 'Press again to remove' : 'Remove'}
            </button>
          </span>
        )}
      </th>
      {STAGES.map((stage) => (
        <td key={stage}>
          <Cell subsystem={subsystem} stage={stage} canEdit={canEdit} />
        </td>
      ))}
    </tr>
  )
}

function Cell(props: { subsystem: Subsystem; stage: Stage; canEdit: boolean }) {
  const { subsystem, stage } = props
  const state = stateOf(subsystem, stage)
  if (!props.canEdit) {
    // Students see the state, not a button.
    return <span className="progress-cell progress-state" data-state={state}>{state}</span>
  }
  return (
    <button
      type="button"
      className="btn progress-cell"
      data-state={state}
      aria-label={`${subsystem.name}, ${stage}: ${state}. Move it along`}
      onClick={() => void changeCell(subsystem, stage).then(report)}
    >
      {state}
    </button>
  )
}

/** Add a subsystem to the bottom of the grid. Student leaders, mentors and admins only. */
function AddSubsystemForm() {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function add(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await addSubsystem(name)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(`Added ${result.value.name}.`)
    setName('')
  }

  return (
    <Panel title="Add a subsystem">
      <form className="panel-body toolbar" onSubmit={add}>
        <label className="field" htmlFor="progress-new-name">
          Name
          <input id="progress-new-name" className="input" style={{ minHeight: 44, fontSize: 16 }} maxLength={NAME_LIMIT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Elevator" />
        </label>
        <button type="submit" className="btn btn-primary btn-lg" style={{ alignSelf: 'end' }} disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
      </form>
    </Panel>
  )
}
