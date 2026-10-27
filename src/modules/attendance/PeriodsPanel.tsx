import { useState, type FormEvent } from 'react'
import { toast } from '../../core/toast'
import { Panel, Pill } from '../../core/ui'
import { BASE_POINTS } from './points'
import { periodOn, rangeText } from './periods'
import { periodsTable, removePeriod, savePeriod, type AttendancePeriod } from './data'
import { today } from './time'

const EMPTY = { name: '', first_day: '', last_day: '' }

/** The saved points periods, and a form to add or change one. Every mentor sees the same ones. */
export function PeriodsPanel(props: { onShow: (period: AttendancePeriod) => void }) {
  const periods = periodsTable.useRows()
  const [now] = useState(today)
  const [editing, setEditing] = useState<AttendancePeriod | null>(null)
  const [form, setForm] = useState(EMPTY)
  const current = periodOn(periods, now)

  function edit(period: AttendancePeriod) {
    setEditing(period)
    setForm({ name: period.name, first_day: period.first_day, last_day: period.last_day ?? '' })
  }

  function stopEditing() {
    setEditing(null)
    setForm(EMPTY)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const result = await savePeriod({ ...form, last_day: form.last_day || null }, editing?.id)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(editing ? 'Saved.' : `Added ${result.value.name}.`)
    stopEditing()
  }

  async function remove(period: AttendancePeriod) {
    const result = await removePeriod(period.id)
    toast(result.ok ? `Removed ${period.name}. Its meetings are still there.` : result.error)
    if (result.ok && editing?.id === period.id) stopEditing()
  }

  return (
    <Panel title="Points periods">
      <div className="panel-body">
        <p className="note">
          Points are counted over a period, like a build season: everyone starts it with {BASE_POINTS} points, and only meetings in its
          dates count. Points and Hours open on the period that includes today. Every mentor sees the same periods.
        </p>

        <form className="toolbar" onSubmit={save} aria-label={editing ? `Change ${editing.name}` : 'Add a period'}>
          <label className="field" htmlFor="period-name">
            Name
            <input id="period-name" className="input" value={form.name} maxLength={80} placeholder="2027 build season" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field" htmlFor="period-first">
            First day
            <input id="period-first" className="input" type="date" value={form.first_day} onChange={(e) => setForm({ ...form, first_day: e.target.value })} />
          </label>
          <label className="field" htmlFor="period-last">
            Last day (empty if it's still going)
            <input id="period-last" className="input" type="date" value={form.last_day} min={form.first_day || undefined} onChange={(e) => setForm({ ...form, last_day: e.target.value })} />
          </label>
          <button type="submit" className="btn btn-primary">{editing ? 'Save' : 'Add period'}</button>
          {editing && <button type="button" className="btn" onClick={stopEditing}>Cancel</button>}
        </form>
      </div>

      {periods.length === 0 ? (
        <p className="panel-body muted">No periods yet, so points count every meeting.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Period</th><th>Dates</th><th /></tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.id}>
                  <td>
                    {period.name} {period.id === current?.id && <Pill tone="info">Now</Pill>}
                  </td>
                  <td>{rangeText(period.first_day, period.last_day ?? undefined)}</td>
                  <td>
                    <span className="checks">
                      <button type="button" className="link-btn" onClick={() => props.onShow(period)}>Show its points</button>
                      <button type="button" className="link-btn" onClick={() => edit(period)}>Change</button>
                      <button type="button" className="link-btn" onClick={() => void remove(period)}>Remove</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
