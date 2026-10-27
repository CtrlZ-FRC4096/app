import type { Report } from './points'
import { cellText, type AttendancePerson, type Sheet } from './data'
import { dayLabel } from './time'

/**
 * One sheet of the report: a row per person, a column per meeting day
 * (newest first, so the latest meeting is in view). The name column stays
 * put while the days scroll sideways.
 */
export function AttendanceGrid(props: {
  report: Report<AttendancePerson>
  rows: Report<AttendancePerson>['rows']
  sheet: Sheet
  selected: string | null
  onSelect: (personId: string) => void
}) {
  const { report, rows, sheet } = props
  const days = [...report.days].reverse()
  const totalLabel = sheet === 'points' ? 'Points' : sheet === 'hours' ? 'Hours' : 'Days here'

  if (rows.length === 0) return <p className="panel-body muted">Nobody to show. Import a Slack export, or change the dates or search.</p>

  return (
    <div className="table-wrap">
      <table className="grid-table">
        <thead>
          <tr>
            <th>Name</th>
            <th className="num">{totalLabel}</th>
            {days.map((day) => <th key={day} className="num day">{dayLabel(day)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.person.id} aria-selected={props.selected === row.person.id}>
              <td>
                <button type="button" className="name-btn" onClick={() => props.onSelect(row.person.id)}>
                  {row.person.name}
                </button>
                {row.person.hidden && <span className="note"> (hidden)</span>}
              </td>
              <td className="num cell">
                <strong>{sheet === 'points' ? row.points : sheet === 'hours' ? row.hours.toFixed(1) : row.daysPresent}</strong>
              </td>
              {days.map((day) => {
                const record = row.days.get(day)
                return (
                  <td key={day} className={'num cell ' + tone(record, sheet)}>
                    {cellText(record, sheet)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function tone(record: Parameters<typeof cellText>[0], sheet: Sheet): string {
  if (!record) return ''
  if (record.stillIn && sheet !== 'rsvps') return 'cell-warn'
  if (sheet === 'points') return record.points < 0 ? 'cell-bad' : record.points >= 2 ? 'cell-good' : ''
  if (sheet === 'rsvps') return record.rsvp === 'yes' && record.hours === null ? 'cell-bad' : ''
  return ''
}
