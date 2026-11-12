import { useState, type FormEvent } from 'react'
import { toast } from '../../core/toast'
import { Panel, Pill } from '../../core/ui'
import { plural } from '../../core/format'
import { isMentor, useSession } from '../../core/session'
import {
  peopleTable, requiredDays, sendAbsence, sentLate, setMondayRequired, takeBackAbsence, toCsv, useAbsences, useMondayMeetings, useMyMondays,
  useRequiredReport, type AttendanceAbsence, type AttendancePerson,
} from './data'
import { MAX_ABSENCE_REASON, MAX_NOT_REQUIRED_REASON, MONDAY_LABEL, MONDAY_TONE, type Meeting, type MondayStatus, type RequiredRow } from './required'
import { dayLabel, today } from './time'

type Range = { from?: string; to?: string }

/** What a cell in the mentors' grid says, and its colour. */
const CELL: Record<MondayStatus, [text: string, className: string]> = {
  came: ['✓', 'cell-good'],
  excused: ['Excused', ''],
  missed: ['Missed', 'cell-bad'],
  upcoming: ['', ''],
}

/** While the calendar loads, or if it couldn't. */
function Loading(props: { loading: boolean; error: string | null; reload: () => void }) {
  if (props.error) {
    return (
      <div className="panel-body toolbar">
        <span className="muted">Couldn't load the team calendar: {props.error}</span>
        <button type="button" className="btn btn-sm" onClick={props.reload}>Try again</button>
      </div>
    )
  }
  return props.loading ? <p className="panel-body muted">Loading the Monday meetings from the team calendar…</p> : null
}

/**
 * Mentors and admins: everyone's required Mondays, which Mondays are
 * required, and the absences people sent. Coming means checking in with
 * Jibble that day; an absence sent counts as excused.
 */
export function RequiredMondaysPanel(props: { range: Range; search: string; showHidden: boolean }) {
  const { meetings, loading, error, reload } = useMondayMeetings(props.range)
  const report = useRequiredReport(meetings, props.showHidden)
  const days = requiredDays(meetings)
  const wanted = props.search.trim().toLowerCase()
  const rows = report.filter((row) => row.person.name.toLowerCase().includes(wanted))
  // Newest first, so the latest Monday is in view; only the next one still to come.
  const upcoming = days.filter((d) => d >= today())
  const shown = [...days.filter((d) => d < today()), ...upcoming.slice(0, 1)].reverse()

  function download() {
    const csv = toCsv([
      ['Name', 'Came', 'Excused', 'Missed', ...[...shown].reverse()],
      ...rows.map((row) => [row.person.name, String(row.came), String(row.excused), String(row.missed), ...[...shown].reverse().map((d) => MONDAY_LABEL[row.days.get(d)!])]),
    ])
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    link.download = 'attendance-required-mondays.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <>
      <Panel
        title="Required Mondays"
        aside={rows.length > 0 && shown.length > 0 && <button type="button" className="btn btn-sm" onClick={download}>Download CSV</button>}
      >
        <p className="panel-body note">
          Every Monday meeting on the team calendar is required, unless it's marked not required below. Checking in with Jibble counts as
          coming. An absence someone sends counts as excused. None of this changes points.
        </p>
        <Loading loading={loading} error={error} reload={reload} />
        {!loading && !error && (shown.length === 0 ? (
          <p className="panel-body muted">No required Mondays in these dates. Monday meetings come from the team calendar.</p>
        ) : rows.length === 0 ? (
          <p className="panel-body muted">Nobody to show. Change the dates or search.</p>
        ) : (
          <MondayGrid rows={rows} days={shown} />
        ))}
      </Panel>
      {!loading && !error && <MondaysList meetings={meetings} />}
      <AbsencesList days={days} />
    </>
  )
}

/** A row per person, with their totals, then a column per required Monday, newest first. Most missed at the top. */
function MondayGrid(props: { rows: RequiredRow<AttendancePerson>[]; days: string[] }) {
  return (
    <div className="table-wrap">
      <table className="grid-table">
        <thead>
          <tr>
            <th>Name</th>
            <th className="num">Missed</th>
            <th className="num">Excused</th>
            <th className="num">Came</th>
            {props.days.map((day) => <th key={day} className="num day">{dayLabel(day)}</th>)}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.person.id}>
              <td>
                {row.person.name}
                {row.person.hidden && <span className="note"> (hidden)</span>}
              </td>
              <td className={'num cell' + (row.missed > 0 ? ' cell-bad' : '')}>{row.missed}</td>
              <td className="num cell">{row.excused}</td>
              <td className="num cell">{row.came}</td>
              {props.days.map((day) => {
                const [text, className] = CELL[row.days.get(day)!]
                return <td key={day} className={'num cell ' + className}>{text}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Each Monday meeting on the calendar, with a switch for whether it's required. Mentors and admins. */
function MondaysList(props: { meetings: Meeting[] }) {
  // The Monday being marked not required, while its reason is typed.
  const [marking, setMarking] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const meetings = [...props.meetings].reverse()

  async function save(day: string, required: boolean, why = '') {
    setSaving(true)
    const result = await setMondayRequired(day, required, why)
    setSaving(false)
    if (!result.ok) return toast(result.error)
    toast(required ? `${dayLabel(day)} is required again.` : `${dayLabel(day)} isn't required.`)
    setMarking(null)
    setReason('')
  }

  function submit(event: FormEvent, day: string) {
    event.preventDefault()
    void save(day, false, reason)
  }

  return (
    <Panel title="Monday meetings" aside={<span className="note">From the team calendar</span>}>
      {meetings.length === 0 ? (
        <p className="panel-body muted">No Monday meetings on the team calendar in these dates.</p>
      ) : (
        <div className="row-list">
          {meetings.map((m) => (
            <div key={m.day} style={{ flexWrap: 'wrap' }}>
              <span style={{ minWidth: 0, flex: '1 1 200px', overflowWrap: 'anywhere' }}>
                <strong>{dayLabel(m.day)}</strong> · {m.title}
                {!m.required && m.reason && <span className="note"> · {m.reason}</span>}
              </span>
              <Pill tone={m.required ? 'info' : 'plain'}>{m.required ? 'Required' : 'Not required'}</Pill>
              {marking === m.day ? (
                <form className="toolbar" style={{ flex: '1 1 100%' }} onSubmit={(e) => submit(e, m.day)} aria-label={`Mark ${dayLabel(m.day)} not required`}>
                  <label className="field" htmlFor="not-required-reason" style={{ flex: '1 1 200px' }}>
                    Why (optional)
                    <input id="not-required-reason" className="input" maxLength={MAX_NOT_REQUIRED_REASON} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Holiday, no meeting" />
                  </label>
                  <button type="submit" className="btn btn-sm btn-primary" disabled={saving}>Not required</button>
                  <button type="button" className="btn btn-sm" onClick={() => setMarking(null)}>Cancel</button>
                </form>
              ) : m.required ? (
                <button type="button" className="btn btn-sm" onClick={() => setMarking(m.day)}>Mark not required</button>
              ) : (
                <button type="button" className="btn btn-sm" disabled={saving} onClick={() => void save(m.day, true)}>Make required</button>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

/** The absences sent for these Mondays, newest Monday first, with their reasons. Mentors and admins. */
function AbsencesList(props: { days: string[] }) {
  const absences = useAbsences(props.days)
  const people = peopleTable.useRows()
  const nameOf = (absence: AttendanceAbsence) => people.find((p) => p.id === absence.person_id)?.name ?? 'Someone'

  return (
    <Panel title="Absences" aside={<span className="note">{plural(absences.length, 'absence', 'absences')}</span>}>
      {absences.length === 0 ? (
        <p className="panel-body muted">Nobody has said they'll miss a required Monday in these dates.</p>
      ) : (
        <div className="row-list">
          {absences.map((absence) => (
            <div key={absence.id} style={{ flexWrap: 'wrap' }}>
              <span style={{ minWidth: 0, flex: '1 1 260px', overflowWrap: 'anywhere' }}>
                <strong>{nameOf(absence)}</strong> · {dayLabel(absence.day)}
                {sentLate(absence) && <> <Pill tone="warn">Sent after</Pill></>}
                <br />
                <span className="note">“{absence.reason}”</span>
              </span>
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={async () => {
                  const result = await takeBackAbsence(absence)
                  toast(result.ok ? `Removed. ${dayLabel(absence.day)} counts as missed for ${nameOf(absence)} unless they checked in.` : result.error)
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

/**
 * Students and student leaders: your required Mondays for the dates being
 * counted, and the ones coming up, where you say you can't make it. That
 * counts as excused straight away. Mentors and admins don't see this: the
 * Mondays aren't required for them, and they see everyone's instead.
 */
export function MyMondays(props: { range: Range }) {
  const { role } = useSession()
  const { meetings, loading, error, reload } = useMondayMeetings(props.range)
  const { person, row, absences } = useMyMondays(meetings)
  const [asking, setAsking] = useState<string | null>(null)
  if (!person || isMentor(role)) return null

  const required = requiredDays(meetings)
  const day = today()
  const coming = required.filter((d) => d >= day)
  const past = required.filter((d) => d < day).reverse()
  const absenceOn = (d: string) => absences.find((a) => a.day === d)
  // Missed, or excused after the fact: still shown, so you can see what you sent.
  const missed = past.filter((d) => {
    const absence = absenceOn(d)
    return row?.days.get(d) === 'missed' || (row?.days.get(d) === 'excused' && absence !== undefined && sentLate(absence))
  })

  return (
    <Panel
      title="Required Mondays"
      aside={row && <span className="note">Came {row.came} · Excused {row.excused} · Missed {row.missed}</span>}
    >
      <p className="panel-body note">
        Monday meetings on the team calendar are required. If you can't make one, say so here, ideally before it starts: it counts as
        excused.
      </p>
      <Loading loading={loading} error={error} reload={reload} />
      {!loading && !error && (
        <>
          {coming.length === 0 && missed.length === 0 ? (
            <p className="panel-body muted">No required Mondays in the next 4 weeks.</p>
          ) : (
            <div className="row-list">
              {/* Coming up first, soonest first; then any you missed, most recent first. */}
              {[...coming, ...missed].map((d) => {
                const absence = absenceOn(d)
                const status: MondayStatus = absence ? 'excused' : d >= day ? 'upcoming' : 'missed'
                return (
                  <div key={d} style={{ flexWrap: 'wrap' }}>
                    <span style={{ minWidth: 0, flex: '1 1 200px', overflowWrap: 'anywhere' }}>
                      <strong>{dayLabel(d)}</strong>
                      {absence && <span className="note"> · “{absence.reason}”</span>}
                    </span>
                    <Pill tone={MONDAY_TONE[status]}>{status === 'upcoming' ? 'Required' : status === 'excused' ? "You can't make it" : 'Missed'}</Pill>
                    {absence ? (
                      d >= day && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={async () => {
                            const result = await takeBackAbsence(absence)
                            toast(result.ok ? 'Taken back. See you there.' : result.error)
                          }}
                        >
                          Take back
                        </button>
                      )
                    ) : asking !== d && (
                      <button type="button" className="btn btn-sm" onClick={() => setAsking(d)}>{d >= day ? "I can't make it" : 'Say why I missed it'}</button>
                    )}
                    {asking === d && <AbsenceForm key={d} person={person} day={d} required={required} onDone={() => setAsking(null)} />}
                  </div>
                )
              })}
            </div>
          )}
          {missed.length > 0 && (
            <p className="panel-body note">
              Were you there, but Jibble missed you? Request the missing hours above instead: a check-in counts as coming.
            </p>
          )}
        </>
      )}
    </Panel>
  )
}

/** Why you can't make a required Monday. */
function AbsenceForm(props: { person: AttendancePerson; day: string; required: string[]; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)

  async function send(event: FormEvent) {
    event.preventDefault()
    setSending(true)
    const result = await sendAbsence(props.person, { day: props.day, reason }, props.required)
    setSending(false)
    if (!result.ok) return toast(result.error)
    toast(`Sent. ${dayLabel(props.day)} counts as excused.`)
    props.onDone()
  }

  return (
    <form className="toolbar" style={{ flex: '1 1 100%' }} onSubmit={send} aria-label={`Can't make ${dayLabel(props.day)}`}>
      <label className="field" htmlFor={`absence-${props.day}`} style={{ flex: '1 1 220px' }}>
        {props.day >= today() ? "Why can't you make it?" : 'Why did you miss it?'}
        <input
          id={`absence-${props.day}`}
          className="input"
          maxLength={MAX_ABSENCE_REASON}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Doctor appointment, family trip…"
        />
      </label>
      <button type="submit" className="btn btn-sm btn-primary" disabled={sending}>{sending ? 'Sending…' : 'Send'}</button>
      <button type="button" className="btn btn-sm" onClick={props.onDone}>Cancel</button>
    </form>
  )
}
