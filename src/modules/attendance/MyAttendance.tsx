import { useState, type FormEvent } from 'react'
import { toast } from '../../core/toast'
import { Panel, Pill } from '../../core/ui'
import { cancelRequest, requestHours, useMyAttendance, useMyRequests, type AttendancePerson } from './data'
import { BASE_POINTS } from './points'
import { MAX_REQUEST_NOTE, requestTimes, STATUS_LABEL, STATUS_TONE } from './requests'
import { dayLabel, teamClock, today } from './time'

/**
 * Your own points, hours and days, for the dates being counted. Everyone
 * sees this, students included. Nobody changes anything here directly:
 * if Jibble missed some hours, ask for them, and a mentor approves.
 */
export function MyAttendance(props: { range: { from?: string; to?: string }; rangeName: string }) {
  const { person, row } = useMyAttendance(props.range)
  const requests = useMyRequests()
  // The day being asked about, when the form is open.
  const [asking, setAsking] = useState<string | null>(null)

  if (!person) {
    return (
      <Panel title="Your attendance">
        <p className="panel-body muted">
          There's no attendance for you yet. It's matched by your Slack account once you've checked in with Jibble or answered the
          attendance poll. If you have and this still shows, ask a mentor.
        </p>
      </Panel>
    )
  }

  const days = row ? [...row.days.values()].filter((d) => d.sessions.length || d.rsvp).reverse() : []
  return (
    <Panel title="Your attendance" aside={<span className="note">{props.rangeName}</span>}>
      <div className="stats" aria-label="Your totals">
        <div><strong>{row?.points ?? BASE_POINTS}</strong><span>points</span></div>
        <div><strong>{(row?.hours ?? 0).toFixed(1)}</strong><span>hours</span></div>
        <div><strong>{row?.daysPresent ?? 0}</strong><span>{row?.daysPresent === 1 ? 'meeting' : 'meetings'} here</span></div>
      </div>

      <div className="panel-body">
        {asking === null ? (
          <div className="toolbar">
            <button type="button" className="btn btn-sm" onClick={() => setAsking(today())}>Request missing hours</button>
            <span className="note">Forgot to check out, or Jibble missed you? Ask, and a mentor approves it.</span>
          </div>
        ) : (
          <RequestForm key={asking} person={person} day={asking} onDone={() => setAsking(null)} />
        )}
      </div>

      {days.length === 0 ? (
        <p className="panel-body muted">No meetings for you in these dates yet. Everyone starts with {BASE_POINTS} points.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Day</th><th className="num">Points</th><th className="num">Hours</th><th>Said</th><th>Checked in and out</th></tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <td style={{ whiteSpace: 'nowrap' }}>{dayLabel(d.day)}</td>
                  <td className={'num ' + (d.points < 0 ? 'cell-bad' : d.points >= 2 ? 'cell-good' : '')}>{d.points}</td>
                  <td className="num">{d.hours === null ? '' : d.hours.toFixed(2)}</td>
                  <td>{d.rsvp === 'yes' ? "I'll come" : d.rsvp === 'no' ? "Can't come" : <span className="muted">No answer</span>}</td>
                  <td>
                    <span className="checks">
                      {d.sessions.map((s) => (
                        <span key={s.in}>{teamClock(s.in)}–{s.out ? teamClock(s.out) : '?'}</span>
                      ))}
                      {d.stillIn && (
                        <>
                          <Pill tone="warn">No check-out</Pill>
                          <button type="button" className="link-btn" onClick={() => setAsking(d.day)}>Request it</button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {requests.length > 0 && (
        <>
          <h3 className="panel-body" style={{ paddingBottom: 0 }}>Your requests</h3>
          <div className="row-list">
            {requests.map((request) => (
              <div key={request.id}>
                <Pill tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</Pill>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <strong>{dayLabel(request.day)}</strong> · {requestTimes(request)}
                  <br />
                  <span className="note">{request.note}</span>
                </span>
                {request.status === 'pending' && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ marginLeft: 'auto' }}
                    onClick={async () => {
                      const result = await cancelRequest(request)
                      toast(result.ok ? 'Taken back.' : result.error)
                    }}
                  >
                    Take back
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}

/** Asking for missing hours on one day. Leave a time empty when Jibble already has it. */
function RequestForm(props: { person: AttendancePerson; day: string; onDone: () => void }) {
  const [day, setDay] = useState(props.day)
  const [inClock, setInClock] = useState('')
  const [outClock, setOutClock] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  async function send(event: FormEvent) {
    event.preventDefault()
    setSending(true)
    const result = await requestHours(props.person, { day, inClock, outClock, note })
    setSending(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast('Sent. A mentor will approve or decline it.')
    props.onDone()
  }

  return (
    <form className="panel-body" style={{ padding: 0 }} onSubmit={send} aria-label="Request missing hours">
      <div className="toolbar">
        <label className="field" htmlFor="req-day">
          Day
          <input id="req-day" className="input" type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="field" htmlFor="req-in">
          Checked in at
          <input id="req-in" className="input" type="time" value={inClock} onChange={(e) => setInClock(e.target.value)} />
        </label>
        <label className="field" htmlFor="req-out">
          Checked out at
          <input id="req-out" className="input" type="time" value={outClock} onChange={(e) => setOutClock(e.target.value)} />
        </label>
      </div>
      <span className="note">Leave a time empty if Jibble already has it: for a forgotten check-out, just fill in when you left.</span>
      <label className="field" htmlFor="req-note">
        What happened
        <input
          id="req-note"
          className="input"
          maxLength={MAX_REQUEST_NOTE}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Forgot to check out, Jibble was down…"
        />
      </label>
      <div className="toolbar">
        <button type="submit" className="btn btn-primary" disabled={sending}>{sending ? 'Sending…' : 'Send request'}</button>
        <button type="button" className="btn" onClick={props.onDone}>Cancel</button>
      </div>
    </form>
  )
}
