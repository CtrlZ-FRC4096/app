import { useState } from 'react'
import { Callout, PageHead, Panel, Pick } from '../../core/ui'
import { plural } from '../../core/format'
import { isMentor, useSession } from '../../core/session'
import { AttendanceGrid } from './AttendanceGrid'
import { ImportPanel } from './ImportPanel'
import { MyAttendance } from './MyAttendance'
import { PeriodsPanel } from './PeriodsPanel'
import { PersonPanel } from './PersonPanel'
import { BASE_POINTS, FULL_SESSION_HOURS, POINTS } from './points'
import { rangeText } from './periods'
import { periodsTable, SHEET_SORT, sheetRows, sortRows, toCsv, useCountRange, useLastPull, useReport, type Sheet, type SortBy } from './data'
import { ago, dayLabel } from './time'

const SETUP = 'https://github.com/CtrlZ-FRC4096/app/blob/main/src/modules/attendance/README.md#pulling-from-slack-automatically'

const TABS = ['Points', 'Hours', 'Check-ins', 'RSVPs', 'Periods', 'Import'] as const
type Tab = (typeof TABS)[number]
const SHEET: Record<Exclude<Tab, 'Periods' | 'Import'>, Sheet> = { Points: 'points', Hours: 'hours', 'Check-ins': 'checks', RSVPs: 'rsvps' }

const fileName = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Everyone sees their own attendance at the top. Mentors and admins also see
// everyone's below; the database only gives anyone else their own rows.
export default function AttendancePage() {
  const { role } = useSession()
  const range = useCountRange()
  const rangeName = range.period?.name ?? (range.from || range.to ? rangeText(range.from, range.to) : 'All time')

  return (
    <>
      <PageHead eyebrow={isMentor(role) ? 'Everyone sees their own · mentors see everyone' : 'Your attendance'} title="Attendance">
        {isMentor(role)
          ? "Who said they'd come, when they checked in and out, and the points from both. Pulled from the attendance channel's Slack poll and Jibble; fix mistakes by choosing a name."
          : "Your points and hours, from the attendance poll in Slack and your Jibble check-ins. Only you and the mentors can see them. If something's wrong, ask a mentor to fix it."}
      </PageHead>
      <RangePicker range={range} />
      <MyAttendance range={range} rangeName={rangeName} />
      {isMentor(role) && <TeamAttendance range={range} />}
      <PointsRules />
    </>
  )
}

/** The dates points are counted over: a saved period, all time, or dates someone picks. */
function RangePicker({ range }: { range: ReturnType<typeof useCountRange> }) {
  const periods = periodsTable.useRows()
  return (
    <>
      <div className="toolbar">
        <label className="field" htmlFor="att-period">
          Count points over
          <select
            id="att-period"
            className="input"
            value={range.choice}
            onChange={(e) => {
              const choice = e.target.value
              range.set(choice === 'all' ? { kind: 'all' } : choice === 'custom' ? { kind: 'custom', from: range.from ?? '', to: range.to ?? '' } : { kind: 'period', id: choice })
            }}
          >
            {periods.map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}
            <option value="all">All time</option>
            <option value="custom">Dates I pick</option>
          </select>
        </label>
        {/* Changing a date switches to "Dates I pick", starting from the dates shown. */}
        <label className="field" htmlFor="att-from">
          From
          <input id="att-from" className="input" type="date" value={range.from ?? ''} max={range.to} onChange={(e) => range.set({ kind: 'custom', from: e.target.value, to: range.to ?? '' })} />
        </label>
        <label className="field" htmlFor="att-to">
          To
          <input id="att-to" className="input" type="date" value={range.to ?? ''} min={range.from} onChange={(e) => range.set({ kind: 'custom', from: range.from ?? '', to: e.target.value })} />
        </label>
      </div>
      <p className="note" aria-live="polite">
        {range.from || range.to ? (
          <>
            Counting <strong>{range.period?.name ?? 'the dates you picked'}</strong> ({rangeText(range.from, range.to)}): everyone starts with{' '}
            {BASE_POINTS} points, and only meetings in these dates count.
          </>
        ) : (
          <>Counting <strong>all time</strong>: everyone starts with {BASE_POINTS} points, and every meeting counts.</>
        )}
      </p>
    </>
  )
}

/** Mentors and admins: everyone's sheets, fixing mistakes, points periods and importing. */
function TeamAttendance({ range }: { range: ReturnType<typeof useCountRange> }) {
  const [tab, setTab] = useState<Tab>('Points')
  const [sortBy, setSortBy] = useState<SortBy>(SHEET_SORT.points)
  const [search, setSearch] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const periods = periodsTable.useRows()
  const report = useReport(range, showHidden)
  const lastPull = useLastPull()
  const wanted = search.trim().toLowerCase()
  const rows = sortRows(
    report.rows.filter((row) => row.person.name.toLowerCase().includes(wanted)),
    sortBy,
  )
  const person = report.rows.find((row) => row.person.id === selected)
  const last = report.days[report.days.length - 1]
  const cameLast = last ? report.rows.filter((row) => row.days.get(last)?.sessions.length).length : 0

  // Each sheet sorts by its own total: choosing Hours puts the most hours first.
  function choose(next: Tab) {
    setTab(next)
    if (next !== 'Periods' && next !== 'Import') setSortBy(SHEET_SORT[SHEET[next]])
  }

  function download(sheet: Sheet) {
    const csv = toCsv(sheetRows({ ...report, rows }, sheet))
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const dates = range.period?.name ?? (report.days.length ? `${report.days[0]}-to-${last}` : 'empty')
    link.download = `attendance-${sheet}-${fileName(dates) || 'dates'}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <>
      <h2>Everyone</h2>
      <p className="note">
        {plural(report.rows.length, 'person', 'people')} · {plural(report.days.length, 'meeting', 'meetings')}
        {last && ` · ${cameLast} at the last one (${dayLabel(last)})`}
        {' · '}
        {lastPull ? (
          <>Pulled from Slack automatically, last {ago(lastPull.created_at)}</>
        ) : (
          <>Not pulling from Slack automatically yet: import an export, or <a href={SETUP} target="_blank" rel="noopener">set up the daily pull</a></>
        )}
        {periods.length === 0 && '. Save a build season under Periods so every mentor counts the same dates.'}
      </p>

      <Pick label="View" options={[...TABS]} value={tab} onChange={choose} />

      {tab === 'Import' ? (
        <ImportPanel />
      ) : tab === 'Periods' ? (
        <PeriodsPanel
          onShow={(period) => {
            range.set({ kind: 'period', id: period.id })
            choose('Points')
          }}
        />
      ) : (
        <>
          <div className="toolbar">
            <label className="field" htmlFor="att-search">Find someone<input id="att-search" className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name" /></label>
            <label className="check"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden people</label>
          </div>

          {person && <PersonPanel row={person} days={report.days} onClose={() => setSelected(null)} />}

          <Panel
            title={tab}
            aside={<button type="button" className="btn btn-sm" onClick={() => download(SHEET[tab])}>Download CSV</button>}
          >
            <AttendanceGrid report={report} rows={rows} sheet={SHEET[tab]} sortBy={sortBy} onSort={setSortBy} selected={selected} onSelect={setSelected} />
          </Panel>
        </>
      )}
    </>
  )
}

function PointsRules() {
  return (
    <Callout title="How points work">
      <span>
        Everyone starts the dates being counted with {BASE_POINTS}. Each meeting day, a full session means staying at least{' '}
        {FULL_SESSION_HOURS} hours, by Jibble check-in and check-out:
      </span>
      <div className="table-wrap">
        <table className="points-rules">
          <thead><tr><th>Poll answer</th><th className="num">Didn't come</th><th className="num">Left early</th><th className="num">Full session</th></tr></thead>
          <tbody>
            {(['yes', 'no', 'none'] as const).map((answer) => (
              <tr key={answer}>
                <td>{answer === 'yes' ? "Said they'd come" : answer === 'no' ? "Said they wouldn't" : "Didn't answer"}</td>
                <td className="num">{POINTS[answer].none}</td>
                <td className="num">{POINTS[answer].short}</td>
                <td className="num">{POINTS[answer].full}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="note">Someone who checked in but never out gets no hours for that day until a mentor adds the check-out.</span>
    </Callout>
  )
}
