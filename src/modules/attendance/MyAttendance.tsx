import { Panel, Pill } from '../../core/ui'
import { useMyAttendance } from './data'
import { BASE_POINTS } from './points'
import { dayLabel, teamClock } from './time'

/**
 * Your own points, hours and days, for the dates being counted. Everyone
 * sees this, students included, and nobody can change anything here: a
 * mentor fixes mistakes.
 */
export function MyAttendance(props: { range: { from?: string; to?: string }; rangeName: string }) {
  const { person, row } = useMyAttendance(props.range)

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
                      {d.stillIn && <Pill tone="warn">No check-out: ask a mentor</Pill>}
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
