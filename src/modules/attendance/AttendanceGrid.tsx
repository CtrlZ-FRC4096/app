import type { Report } from './points'
import { cellText, type AttendancePerson, type Sheet, type SortBy } from './data'
import { dayLabel } from './time'

/**
 * One sheet of the report: a row per person, with their points, hours and
 * days here side by side, then a column per meeting day (newest first, so
 * the latest meeting is in view). The name column stays put while the days
 * scroll sideways. Clicking a column's heading sorts by it.
 */
export function AttendanceGrid(props: {
  report: Report<AttendancePerson>
  /** Already sorted. */
  rows: Report<AttendancePerson>['rows']
  sheet: Sheet
  sortBy: SortBy
  onSort: (by: SortBy) => void
  selected: string | null
  onSelect: (personId: string) => void
}) {
  const { report, rows, sheet, sortBy } = props
  const days = [...report.days].reverse()

  if (rows.length === 0) return <p className="panel-body muted">Nobody to show. Import a Slack export, or change the dates or search.</p>

  const heading = (by: SortBy, label: string) => {
    const active = sortBy === by
    return (
      <th className={by === 'name' ? undefined : 'num'} aria-sort={active ? (by === 'name' ? 'ascending' : 'descending') : undefined}>
        <button type="button" className="name-btn" onClick={() => props.onSort(by)} title={`Sort by ${label.toLowerCase()}`}>
          {label}
          {active && (by === 'name' ? ' ↑' : ' ↓')}
        </button>
      </th>
    )
  }
  // The total being sorted by stands out.
  const total = (by: SortBy, text: string | number) => <td className="num cell">{sortBy === by ? <strong>{text}</strong> : text}</td>

  return (
    <div className="table-wrap">
      <table className="grid-table">
        <thead>
          <tr>
            {heading('name', 'Name')}
            {heading('points', 'Points')}
            {heading('hours', 'Hours')}
            {heading('days', 'Days here')}
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
              {total('points', row.points)}
              {total('hours', row.hours.toFixed(1))}
              {total('days', row.daysPresent)}
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
