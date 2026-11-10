import { useEffect, useState, type FormEvent } from 'react'
import { isMentor, useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { PageHead, Panel } from '../../core/ui'
import { NAME_LIMIT, NOTES_LIMIT, addBattery, ago, changeBattery, groupByStatus, moveToNext, nextStatus, removeBattery, useBatteries, type Battery } from './data'

// Big enough to tap with gloves on.
const BIG_BUTTON = { minHeight: 56, fontSize: 17, flex: '1 1 12rem' }

/** The time now, updated every minute, so "how long ago" keeps up while the page is open in the pit. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

// The page reads batteries with a hook (useBatteries) and changes them with
// functions from data.ts. It never saves anything itself.
export default function BatteriesPage() {
  const batteries = useBatteries()
  const now = useNow()
  const { role } = useSession()
  const mentor = isMentor(role)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = batteries.find((b) => b.id === editingId)
  const retired = batteries.filter((b) => b.retired)

  return (
    <>
      <PageHead title="Batteries">
        Where each battery is: charged, in the robot, or charging. Tap a battery's button when it moves on.
      </PageHead>
      {/* Only mentors and admins add, rename, retire and delete batteries. The database's rules enforce this too. */}
      {mentor && !adding && (
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <button type="button" className="btn" onClick={() => setAdding(true)}>Add a battery</button>
        </div>
      )}
      {mentor && adding && <AddBatteryForm onDone={() => setAdding(false)} />}
      {mentor && editing && <EditBatteryForm key={editing.id} battery={editing} onDone={() => setEditingId(null)} />}
      {groupByStatus(batteries).map((group) => (
        <Panel key={group.status} title={`${group.status} (${group.batteries.length})`} aside={group.hint && <span className="note">{group.hint}</span>}>
          {group.batteries.length === 0 ? (
            <p className="panel-body muted">None.</p>
          ) : (
            <div className="row-list">
              {group.batteries.map((battery) => (
                <BatteryRow key={battery.id} battery={battery} now={now} onEdit={mentor ? () => setEditingId(battery.id) : undefined} />
              ))}
            </div>
          )}
        </Panel>
      ))}
      {mentor && retired.length > 0 && (
        <Panel title={`Retired (${retired.length})`} aside={<span className="note">Only mentors see these</span>}>
          <div className="row-list">
            {retired.map((battery) => (
              <div key={battery.id}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <strong>{battery.name}</strong>
                  {battery.notes && <><br /><span className="note">{battery.notes}</span></>}
                </span>
                <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} aria-label={`Edit ${battery.name}`} onClick={() => setEditingId(battery.id)}>Edit</button>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  )
}

function BatteryRow(props: { battery: Battery; now: Date; onEdit?: () => void }) {
  const { battery } = props
  const next = nextStatus(battery.status)
  const [saving, setSaving] = useState(false)

  async function move() {
    setSaving(true)
    const result = await moveToNext(battery)
    setSaving(false)
    toast(result.ok ? `${battery.name}: ${next}.` : result.error)
  }

  return (
    // flexWrap: on a phone the big button goes under the battery's number and fills the width.
    <div style={{ flexWrap: 'wrap' }}>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere', flex: '1 1 10rem' }}>
        <strong style={{ fontSize: 20 }}>{battery.name}</strong>
        <br />
        <span className="note">{battery.status} {ago(battery.status_changed_at, props.now)}</span>
        {battery.notes && <><br /><span className="note">{battery.notes}</span></>}
      </span>
      <span className="toolbar" style={{ flex: '1 1 14rem' }}>
        <button type="button" className="btn btn-lg btn-primary" style={BIG_BUTTON} disabled={saving} onClick={() => void move()}>
          Move to {next}
        </button>
        {props.onEdit && (
          <button type="button" className="btn btn-lg" style={{ minHeight: 56 }} aria-label={`Edit ${battery.name}`} onClick={props.onEdit}>Edit</button>
        )}
      </span>
    </div>
  )
}

/** Add a battery. Mentors and admins only. */
function AddBatteryForm(props: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function add(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await addBattery({ name, notes })
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(`Added ${result.value.name}, as Charged.`)
    setName('')
    setNotes('')
  }

  return (
    <Panel title="Add a battery">
      <form className="panel-body" onSubmit={add}>
        <label className="field" htmlFor="battery-name">
          Number on the battery
          <input id="battery-name" className="input" style={{ minHeight: 46, fontSize: 16 }} maxLength={NAME_LIMIT} value={name} onChange={(e) => setName(e.target.value)} placeholder="2026-9" />
        </label>
        <label className="field" htmlFor="battery-notes">
          Notes
          <textarea id="battery-notes" className="input" style={{ fontSize: 16 }} rows={2} maxLength={NOTES_LIMIT} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bought March 2026" />
        </label>
        <div className="toolbar">
          <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>{saving ? 'Adding…' : 'Add battery'}</button>
          <button type="button" className="btn btn-lg" onClick={props.onDone}>Done</button>
        </div>
      </form>
    </Panel>
  )
}

/** Rename a battery, change its notes, retire it, or delete it. Mentors and admins only. */
function EditBatteryForm(props: { battery: Battery; onDone: () => void }) {
  const { battery } = props
  const [name, setName] = useState(battery.name)
  const [notes, setNotes] = useState(battery.notes)
  const [retired, setRetired] = useState(battery.retired)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await changeBattery(battery, { name, notes, retired })
    setSaving(false)
    toast(result.ok ? `Saved ${result.value.name}.` : result.error)
    if (result.ok) props.onDone()
  }

  async function remove() {
    // Deleting can't be undone, so it takes two presses.
    if (!deleting) {
      setDeleting(true)
      return
    }
    const result = await removeBattery(battery)
    toast(result.ok ? `Deleted ${battery.name}.` : result.error)
    if (result.ok) props.onDone()
  }

  return (
    <Panel title={`Change ${battery.name}`}>
      <form className="panel-body" onSubmit={save}>
        <label className="field" htmlFor="battery-edit-name">
          Number on the battery
          <input id="battery-edit-name" className="input" style={{ minHeight: 46, fontSize: 16 }} maxLength={NAME_LIMIT} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field" htmlFor="battery-edit-notes">
          Notes
          <textarea id="battery-edit-notes" className="input" style={{ fontSize: 16 }} rows={2} maxLength={NOTES_LIMIT} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="check" style={{ minHeight: 44 }}>
          <input type="checkbox" checked={retired} onChange={(e) => setRetired(e.target.checked)} />
          Retired: the team no longer uses it
        </label>
        <div className="toolbar">
          <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn btn-lg" onClick={props.onDone}>Cancel</button>
          <button type="button" className="btn btn-lg" style={{ marginLeft: 'auto' }} onClick={() => void remove()}>
            {deleting ? 'Press again to delete' : 'Delete'}
          </button>
        </div>
        {deleting && <p className="note" style={{ margin: 0 }}>Deleting can't be undone. To keep it on record, tick Retired instead.</p>}
      </form>
    </Panel>
  )
}
