import { useState, type FormEvent } from 'react'
import { useMemberNames } from '../../core/members'
import { toast } from '../../core/toast'
import { Pill } from '../../core/ui'
import { TIRED_RESISTANCE_OHMS, ago, describeEntry, historyFor, isTired, latestReading, matchesFor, readingText, recordReading, type Battery, type LogEntry } from './data'

/** How many history lines to show. The rest are still in the database. */
const RECENT = 10

/** A number box's text as a number, or null when it's empty. */
const toNumber = (text: string) => (text.trim() === '' ? null : Number(text))

// One battery's details, under its row: its latest reading, a form to record
// a new one, the matches it was used in, and its recent history.
export default function BatteryDetails(props: { battery: Battery; log: LogEntry[]; now: Date }) {
  const { battery, log, now } = props
  const nameOf = useMemberNames()
  const reading = latestReading(battery.id, log)
  const matches = matchesFor(battery.id, log)
  const history = historyFor(battery.id, log).slice(0, RECENT)

  return (
    <div style={{ flexBasis: '100%', display: 'grid', gap: 12, paddingTop: 4 }}>
      <div>
        <strong>Latest reading: </strong>
        {reading ? (
          <>
            {readingText(reading)} <span className="note">({ago(reading.created_at, now)})</span>
            {isTired(battery.id, log) && <> <Pill tone="warn">Tired</Pill> <span className="note">Internal resistance is above {TIRED_RESISTANCE_OHMS} Ω.</span></>}
          </>
        ) : (
          <span className="muted">None yet.</span>
        )}
      </div>
      <ReadingForm battery={battery} />
      <div>
        <strong>Matches: </strong>
        {matches.length === 0 ? <span className="muted">Not used in a match yet.</span> : matches.map((m) => m.match).join(', ')}
      </div>
      <div>
        <strong>History</strong>
        {history.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nothing yet.</p>
        ) : (
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {history.map((entry) => (
              <li key={entry.id}>
                {describeEntry(entry)} <span className="note">· {nameOf(entry.created_by)} · {ago(entry.created_at, now)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Record a tester reading, from a Battery Beak or CBA. Anyone on the team can. */
function ReadingForm(props: { battery: Battery }) {
  const [voltage, setVoltage] = useState('')
  const [resistance, setResistance] = useState('')
  const [saving, setSaving] = useState(false)
  const id = props.battery.id

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await recordReading(props.battery, toNumber(voltage), toNumber(resistance))
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(`Saved the reading for ${props.battery.name}.`)
    setVoltage('')
    setResistance('')
  }

  return (
    <form onSubmit={save} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
      <label className="field" htmlFor={`voltage-${id}`}>
        Voltage (V)
        <input id={`voltage-${id}`} className="input" style={{ width: '9ch', minHeight: 46, fontSize: 16 }} inputMode="decimal" value={voltage} onChange={(e) => setVoltage(e.target.value.replace(/[^\d.]/g, ''))} placeholder="12.9" />
      </label>
      <label className="field" htmlFor={`resistance-${id}`}>
        Internal resistance (Ω)
        <input id={`resistance-${id}`} className="input" style={{ width: '11ch', minHeight: 46, fontSize: 16 }} inputMode="decimal" value={resistance} onChange={(e) => setResistance(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.015" />
      </label>
      <button type="submit" className="btn btn-lg" disabled={saving}>{saving ? 'Saving…' : 'Save reading'}</button>
    </form>
  )
}
