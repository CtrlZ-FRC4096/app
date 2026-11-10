import { useEffect, useState, type FormEvent } from 'react'
import { isMentor, useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { Callout, PageHead, Panel, Pill } from '../../core/ui'
import BatteryDetails from './BatteryDetails'
import {
  IN_THE_ROBOT, MATCH_LIMIT, NAME_LIMIT, NOTES_LIMIT, addBattery, ago, changeBattery, findBatteries, groupByStatus, isTired, moveToNext, nextStatus,
  nextUp, removeBattery, suggestMatch, useBatteries, useLog, type Battery, type LogEntry,
} from './data'
import Labels from './Labels'

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
  const log = useLog()
  const now = useNow()
  const { role } = useSession()
  const mentor = isMentor(role)
  const [adding, setAdding] = useState(false)
  const [labels, setLabels] = useState(false)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = batteries.find((b) => b.id === editingId)
  const retired = batteries.filter((b) => b.retired)
  const next = nextUp(batteries, log)
  const found = findBatteries(batteries, query)

  return (
    <>
      <PageHead title="Batteries">
        Where each battery is: charged, in the robot, or charging. Tap a battery's button when it moves on, and its number for its readings and history.
      </PageHead>
      <Callout title={next ? `Next up: ${next.name}` : 'Next up: none'}>
        <span>
          {next
            ? `Charged the longest, ${ago(next.status_changed_at, now)}. Tired batteries are left out.`
            : 'No charged battery that isn\'t tired. Check what\'s on the chargers.'}
        </span>
      </Callout>
      <div className="toolbar" style={{ margin: '12px 0' }}>
        <label className="field" htmlFor="battery-find">
          Find a battery
          <input id="battery-find" className="input" type="search" style={{ width: '12ch', minHeight: 46, fontSize: 16 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="2026-3" />
        </label>
        {!labels && <button type="button" className="btn btn-lg" onClick={() => setLabels(true)}>Labels</button>}
        {/* Only mentors and admins add, rename, retire and delete batteries. The database's rules enforce this too. */}
        {mentor && !adding && <button type="button" className="btn btn-lg" onClick={() => setAdding(true)}>Add a battery</button>}
      </div>
      {labels && <Labels batteries={batteries.filter((b) => !b.retired)} onDone={() => setLabels(false)} />}
      {mentor && adding && <AddBatteryForm onDone={() => setAdding(false)} />}
      {mentor && editing && <EditBatteryForm key={editing.id} battery={editing} onDone={() => setEditingId(null)} />}
      {query && found.filter((b) => !b.retired).length === 0 && (
        <p className="muted">No battery with "{query}" in its number.</p>
      )}
      {groupByStatus(found).filter((group) => !query || group.batteries.length > 0).map((group) => (
        <Panel key={group.status} title={`${group.status} (${group.batteries.length})`} aside={group.hint && <span className="note">{group.hint}</span>}>
          {group.batteries.length === 0 ? (
            <p className="panel-body muted">None.</p>
          ) : (
            <div className="row-list">
              {group.batteries.map((battery) => (
                <BatteryRow key={battery.id} battery={battery} log={log} now={now} onEdit={mentor ? () => setEditingId(battery.id) : undefined} />
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

function BatteryRow(props: { battery: Battery; log: LogEntry[]; now: Date; onEdit?: () => void }) {
  const { battery } = props
  const next = nextStatus(battery.status)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  // Going In the robot asks which match first: null while it isn't asking.
  const [match, setMatch] = useState<string | null>(null)

  async function move(forMatch = '') {
    setSaving(true)
    const result = await moveToNext(battery, forMatch)
    setSaving(false)
    setMatch(null)
    toast(result.ok ? `${battery.name}: ${next}${forMatch.trim() ? ` for ${forMatch.trim()}` : ''}.` : result.error)
  }

  async function askMatch() {
    setMatch('')
    // Fill in our next match from the event schedule. The box can be changed, or left empty.
    const suggested = await suggestMatch()
    setMatch((typed) => (typed === '' ? suggested : typed))
  }

  return (
    // flexWrap: on a phone the big button goes under the battery's number and fills the width.
    <div style={{ flexWrap: 'wrap' }}>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere', flex: '1 1 10rem' }}>
        <button type="button" className="link-btn" style={{ fontSize: 20, fontWeight: 700, minHeight: 44 }} aria-expanded={open} onClick={() => setOpen(!open)}>
          {battery.name} {open ? '▴' : '▾'}
        </button>
        {isTired(battery.id, props.log) && <> <Pill tone="warn">Tired</Pill></>}
        <br />
        <span className="note">{battery.status} {ago(battery.status_changed_at, props.now)}</span>
        {battery.notes && <><br /><span className="note">{battery.notes}</span></>}
      </span>
      {match === null ? (
        <span className="toolbar" style={{ flex: '1 1 14rem' }}>
          <button type="button" className="btn btn-lg btn-primary" style={BIG_BUTTON} disabled={saving} onClick={() => void (next === IN_THE_ROBOT ? askMatch() : move())}>
            Move to {next}
          </button>
          {props.onEdit && (
            <button type="button" className="btn btn-lg" style={{ minHeight: 56 }} aria-label={`Edit ${battery.name}`} onClick={props.onEdit}>Edit</button>
          )}
        </span>
      ) : (
        <form
          style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}
          onSubmit={(e) => { e.preventDefault(); void move(match) }}
        >
          <label className="field" htmlFor={`match-${battery.id}`}>
            Which match is it for?
            <input id={`match-${battery.id}`} className="input" style={{ width: '12ch', minHeight: 46, fontSize: 16 }} maxLength={MATCH_LIMIT} value={match} onChange={(e) => setMatch(e.target.value)} placeholder="Qual 12" />
          </label>
          <button type="submit" className="btn btn-lg btn-primary" style={BIG_BUTTON} disabled={saving}>Put {battery.name} in the robot</button>
          <button type="button" className="btn btn-lg" style={{ minHeight: 56 }} onClick={() => setMatch(null)}>Cancel</button>
        </form>
      )}
      {open && <BatteryDetails battery={battery} log={props.log} now={props.now} />}
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
