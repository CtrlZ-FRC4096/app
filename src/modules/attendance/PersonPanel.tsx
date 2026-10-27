import { useState, type FormEvent } from 'react'
import { toast } from '../../core/toast'
import { Panel, Pill } from '../../core/ui'
import type { Report } from './points'
import {
  addCheck,
  checksOn,
  removeCheck,
  restoreCheck,
  setHidden,
  setRsvp,
  useAttendance,
  type AttendancePerson,
} from './data'
import { dayLabel, teamClock, today } from './time'

type Action = 'in' | 'out' | 'yes' | 'no'

/** One person's days, with everything a mentor might need to fix. */
export function PersonPanel(props: { row: Report<AttendancePerson>['rows'][number]; days: string[]; onClose: () => void }) {
  const { person } = props.row
  const { checks, rsvps } = useAttendance()
  const [day, setDay] = useState(props.days[props.days.length - 1] ?? today())
  const [clock, setClock] = useState('20:30')
  const [action, setAction] = useState<Action>('out')

  async function add(event: FormEvent) {
    event.preventDefault()
    const result = action === 'in' || action === 'out' ? await addCheck(person.id, day, clock, action) : await setRsvp(person.id, day, action)
    toast(result.ok ? 'Saved.' : result.error)
  }

  async function run(work: Promise<{ ok: boolean; error?: string }>, done: string) {
    const result = await work
    toast(result.ok ? done : (result.error ?? 'That didn’t work.'))
  }

  const shown = [...props.days].reverse().filter((d) => {
    const record = props.row.days.get(d)
    return record?.rsvp || checksOn(checks, person.id, d).length > 0
  })

  return (
    <Panel
      title={<h2>{person.name}</h2>}
      aside={<button type="button" className="btn btn-sm" onClick={props.onClose}>Close</button>}
    >
      <div className="panel-body">
        <p className="note">
          {props.row.points} points · {props.row.hours.toFixed(1)} hours · here {props.row.daysPresent} of {props.days.length} meetings
          {person.slack_user_id ? ` · Slack ${person.slack_user_id}` : ' · no Slack account matched'}
        </p>
        <label className="check">
          <input type="checkbox" checked={person.hidden} onChange={(e) => void run(setHidden(person, e.target.checked), e.target.checked ? 'Hidden from the tables.' : 'Shown in the tables.')} />
          Hide from the tables (for mentors, parents and anyone who shouldn't get points)
        </label>

        <form className="toolbar" onSubmit={add} aria-label={`Add to ${person.name}'s attendance`}>
          <select className="input" aria-label="What to add" value={action} onChange={(e) => setAction(e.target.value as Action)}>
            <option value="in">Check-in</option>
            <option value="out">Check-out</option>
            <option value="yes">Said they'd come</option>
            <option value="no">Said they wouldn't</option>
          </select>
          <input className="input" type="date" aria-label="Day" value={day} onChange={(e) => setDay(e.target.value)} />
          {(action === 'in' || action === 'out') && (
            <input className="input" type="time" aria-label="Time" value={clock} onChange={(e) => setClock(e.target.value)} />
          )}
          <button type="submit" className="btn btn-primary">Add</button>
        </form>
      </div>

      {shown.length === 0 ? (
        <p className="panel-body muted">Nothing for {person.name} in these dates.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Day</th><th>Said</th><th>Check-ins and check-outs</th><th className="num">Hours</th><th className="num">Points</th></tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const record = props.row.days.get(d)
                const rsvp = rsvps.find((r) => r.person_id === person.id && r.day === d)
                return (
                  <tr key={d}>
                    <td>{dayLabel(d)}</td>
                    <td>
                      <select
                        className="input"
                        aria-label={`RSVP on ${dayLabel(d)}`}
                        value={record?.rsvp ?? ''}
                        onChange={(e) => void run(setRsvp(person.id, d, (e.target.value || null) as 'yes' | 'no' | null), 'Saved.')}
                      >
                        <option value="">No answer</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                      {rsvp?.source === 'manual' && <span className="note"> set by hand</span>}
                    </td>
                    <td>
                      <span className="checks">
                        {checksOn(checks, person.id, d).map((check) => (
                          <span key={check.id} className={check.ignored ? 'check-ignored' : ''}>
                            {check.direction === 'in' ? 'In' : 'Out'} {teamClock(check.at)}
                            {check.source === 'manual' && <span className="note"> (by hand)</span>}{' '}
                            {check.ignored ? (
                              <button type="button" className="link-btn" onClick={() => void run(restoreCheck(check), 'Counted again.')}>Count it</button>
                            ) : (
                              <button type="button" className="link-btn" onClick={() => void run(removeCheck(check), check.source === 'manual' ? 'Removed.' : 'Ignored.')}>
                                {check.source === 'manual' ? 'Remove' : 'Ignore'}
                              </button>
                            )}
                          </span>
                        ))}
                        {record?.stillIn && <Pill tone="warn">No check-out</Pill>}
                      </span>
                    </td>
                    <td className="num">{record?.hours === null || record?.hours === undefined ? '' : record.hours.toFixed(2)}</td>
                    <td className="num">{record?.points ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
