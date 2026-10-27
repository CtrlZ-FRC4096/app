import { useState } from 'react'
import { Callout, PageHead, Panel, Pick } from '../../core/ui'
import { plural } from '../../core/format'
import { AttendanceGrid } from './AttendanceGrid'
import { ImportPanel } from './ImportPanel'
import { PeriodsPanel } from './PeriodsPanel'
import { PersonPanel } from './PersonPanel'
import { BASE_POINTS, FULL_SESSION_HOURS, POINTS } from './points'
import { rangeText } from './periods'
import { periodsTable, sheetRows, toCsv, useCountRange, useLastPull, useReport, type Sheet } from './data'
import { ago, dayLabel } from './time'

const SETUP = 'https://github.com/CtrlZ-FRC4096/app/blob/main/src/modules/attendance/README.md#pulling-from-slack-automatically'

const TABS = ['Points', 'Hours', 'Check-ins', 'RSVPs', 'Periods', 'Import'] as const
type Tab = (typeof TABS)[number]
const SHEET: Record<Exclude<Tab, 'Periods' | 'Import'>, Sheet> = { Points: 'points', Hours: 'hours', 'Check-ins': 'checks', RSVPs: 'rsvps' }

const fileName = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Mentors and admins only (set in index.ts, and enforced by the database).
export default function AttendancePage() {
  const [tab, setTab] = useState<Tab>('Points')
  const [search, setSearch] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const periods = periodsTable.useRows()
  const range = useCountRange()
  const report = useReport(range, showHidden)
  const lastPull = useLastPull()
  const wanted = search.trim().toLowerCase()
  const rows = report.rows.filter((row) => row.person.name.toLowerCase().includes(wanted))
  const person = report.rows.find((row) => row.person.id === selected)
  const last = report.days[report.days.length - 1]
  const cameLast = last ? report.rows.filter((row) => row.days.get(last)?.sessions.length).length : 0

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
      <PageHead eyebrow="Mentors and admins only" title="Attendance">
        Who said they'd come, when they checked in and out, and the points from both. Imported from the attendance channel's Slack poll
        and Jibble; fix mistakes by choosing a name.
      </PageHead>

      <p className="note">
        {plural(report.rows.length, 'person', 'people')} · {plural(report.days.length, 'meeting', 'meetings')}
        {last && ` · ${cameLast} at the last one (${dayLabel(last)})`}
        {' · '}
        {lastPull ? (
          <>Pulled from Slack automatically, last {ago(lastPull.created_at)}</>
        ) : (
          <>Not pulling from Slack automatically yet: import an export, or <a href={SETUP} target="_blank" rel="noopener">set up the daily pull</a></>
        )}
      </p>

      <Pick label="View" options={[...TABS]} value={tab} onChange={setTab} />

      {tab === 'Import' ? (
        <ImportPanel />
      ) : tab === 'Periods' ? (
        <PeriodsPanel
          onShow={(period) => {
            range.set({ kind: 'period', id: period.id })
            setTab('Points')
          }}
        />
      ) : (
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
            <label className="field" htmlFor="att-search">Find someone<input id="att-search" className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name" /></label>
            <label className="check"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden people</label>
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
            {periods.length === 0 && ' Save a build season under Periods so every mentor counts the same dates.'}
          </p>

          {person && <PersonPanel row={person} days={report.days} onClose={() => setSelected(null)} />}

          <Panel
            title={tab}
            aside={<button type="button" className="btn btn-sm" onClick={() => download(SHEET[tab])}>Download CSV</button>}
          >
            <AttendanceGrid report={report} rows={rows} sheet={SHEET[tab]} selected={selected} onSelect={setSelected} />
          </Panel>

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
        </>
      )}
    </>
  )
}
