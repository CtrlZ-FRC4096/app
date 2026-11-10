import { useState, type FormEvent } from 'react'
import { href, useRoute } from '../../core/router'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pick } from '../../core/ui'
import type { Result } from '../../core/table'
import { MAX_TEAM, tbaTeamUrl } from '../scouting/data'
import {
  NO_ANSWERS, PRESCOUT_QUESTIONS, PRESCOUT_SORTS, firstLine, isEventKey, prescoutOverview, reloadPrescoutTeams, savePrescout,
  setPrescoutEvent, toggleMark, usePrescoutEvent, usePrescoutNotes, usePrescoutTeams,
  type OverviewTeam, type PrescoutAnswers, type PrescoutSort, type PrescoutTeam,
} from './data'

// Big enough to tap, and 16px text so phones don't zoom in on the box.
const BOX = { minHeight: 46, fontSize: 16 }

/** The address of a team's prescouting page. */
function teamHref(event: string, team: number): string {
  return href('prescouting', event, String(team))
}

// Prescouting. #/prescouting is the overview of every team at the event
// (#116, #118); #/prescouting/<event>/<team> is one team's
// page with our notes (#117). The event is in a team page's address, so a
// link to it always opens the same team at the same event.
export default function PrescoutPage() {
  const [event, team] = useRoute().rest
  if (event === undefined) return <Overview />
  const number = Number(team)
  if (!isEventKey(event) || !Number.isInteger(number) || number < 1 || number > MAX_TEAM) {
    return (
      <Panel>
        <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
          <p style={{ margin: 0 }}>That address isn't a team's prescouting page. Go back to the list and choose the team.</p>
          <div className="toolbar"><a className="btn" href={href('prescouting')}>All teams</a></div>
        </div>
      </Panel>
    )
  }
  return <TeamPage event={event} team={number} />
}

// ---------------------------------------------------------------------------
// The overview: the event box, then a card for each team.

function Overview() {
  const event = usePrescoutEvent()
  const result = usePrescoutTeams(event)
  const notes = usePrescoutNotes(event)
  const [sort, setSort] = useState<PrescoutSort>('Team number')
  const teams = result?.ok ? prescoutOverview(result.value, notes, sort) : []

  return (
    <>
      <PageHead title="Prescouting">Every team coming to an event, to look up before it starts. Mark the ones we care about to keep them at the top.</PageHead>
      <EventBox event={event} />
      <Panel title={`Teams at ${event}`} aside={result?.ok ? <span className="note">{result.value.length} teams</span> : undefined}>
        {!result ? (
          <p className="panel-body muted" aria-live="polite">Loading teams…</p>
        ) : !result.ok ? (
          <Problem error={result.error} retry={() => void reloadPrescoutTeams(event)} />
        ) : (
          <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
            <div className="field">
              Sort by
              <Pick label="Sort by" options={[...PRESCOUT_SORTS]} value={sort} onChange={setSort} />
            </div>
            <TeamGroup title="Marked" event={event} teams={teams.filter((t) => t.marked)} />
            <TeamGroup title={teams.some((t) => t.marked) ? 'Everyone else' : ''} event={event} teams={teams.filter((t) => !t.marked)} />
          </div>
        )}
      </Panel>
    </>
  )
}

/**
 * Marked teams, or everyone else, each in the chosen sort. The headings
 * show why a marked team stays above a team with a better EPA. With no
 * marked teams there's one list and no heading (title '').
 */
function TeamGroup(props: { title: string; event: string; teams: OverviewTeam[] }) {
  if (props.teams.length === 0) return null
  return (
    <section style={{ display: 'grid', gap: 12 }} aria-label={props.title || 'Teams'}>
      {props.title && <h3 style={{ margin: '4px 0 0', fontSize: 15 }}>{props.title} <span className="note">({props.teams.length})</span></h3>}
      {props.teams.map((t) => <TeamCard key={t.team} event={props.event} team={t} />)}
    </section>
  )
}

/** The event key box. The key is remembered on this phone. */
function EventBox(props: { event: string }) {
  const [typed, setTyped] = useState(props.event)
  const [problem, setProblem] = useState('')

  function choose(e: FormEvent) {
    e.preventDefault()
    const result = setPrescoutEvent(typed)
    if (!result.ok) return setProblem(result.error)
    setProblem('')
    setTyped(result.value)
  }

  return (
    <Panel>
      <form className="panel-body" onSubmit={choose} style={{ display: 'grid', gap: 10 }}>
        <label className="field" htmlFor="prescout-event">
          Event key
          <span className="toolbar">
            <input
              id="prescout-event"
              className="input"
              style={{ ...BOX, width: '14ch' }}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="2026ilch"
            />
            <button type="submit" className="btn btn-primary" style={BOX}>Show teams</button>
          </span>
        </label>
        <p className="note" style={{ margin: 0 }}>
          The end of the event's page address on thebluealliance.com. Each Championship division has its own.
        </p>
        {problem && <p role="alert" style={{ margin: 0 }}>{problem}</p>}
      </form>
    </Panel>
  )
}

/** What went wrong loading the teams, with a Try again button. */
function Problem(props: { error: string; retry: () => void }) {
  return (
    <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
      <p role="alert" style={{ margin: 0 }}>{props.error}</p>
      <div className="toolbar">
        <button type="button" className="btn" onClick={props.retry}>Try again</button>
      </div>
    </div>
  )
}

/** The answers the overview shows, in order. The rest are on the team's page. */
const OVERVIEW_ANSWERS: (keyof PrescoutAnswers)[] = ['key_task', 'strengths', 'weaknesses', 'other_notes']

/** One team in the overview: a card, not a table row, so nothing scrolls sideways on a phone. */
export function TeamCard(props: { event: string; team: OverviewTeam }) {
  const t = props.team
  const open = teamHref(props.event, t.team)
  const notes = t.prescouted ? t.notes : null
  return (
    <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 12, display: 'grid', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <a href={open} style={{ minWidth: 0, overflowWrap: 'anywhere', color: 'inherit', textDecoration: 'none', flex: 1 }}>
          <strong className="tnum">{t.team}</strong> {t.name}
          <br />
          <span className="note tnum">{`EPA ${formatEpa(t.epa)}`}</span>
        </a>
        <MarkButton event={props.event} team={t.team} marked={t.marked} />
      </div>
      {notes ? (
        <dl style={{ margin: 0, display: 'grid', gap: 4, fontSize: 14 }}>
          {OVERVIEW_ANSWERS.map((key) => (
            <div key={key} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              <dt style={{ display: 'inline', fontWeight: 600 }}>{PRESCOUT_QUESTIONS.find((q) => q.key === key)?.label}: </dt>
              <dd style={{ display: 'inline', margin: 0 }} className={notes[key] ? undefined : 'muted'}>{firstLine(notes[key]) || '—'}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Not prescouted yet</p>
      )}
      <div className="toolbar">
        <a className="btn" href={open}>{t.prescouted ? 'Open notes' : 'Add notes'}</a>
        <a className="btn" href={t.tbaUrl} target="_blank" rel="noreferrer" aria-label={`Team ${t.team} on The Blue Alliance`}>TBA</a>
      </div>
    </section>
  )
}

function formatEpa(epa: number | null): string {
  return epa === null ? '—' : epa.toFixed(1)
}

/** The star. Marks are shared: everyone sees the same marked teams. */
function MarkButton(props: { event: string; team: number; marked: boolean }) {
  const [busy, setBusy] = useState(false)
  async function toggle() {
    setBusy(true)
    const result = await toggleMark(props.event, props.team)
    setBusy(false)
    if (!result.ok) toast(result.error)
  }
  return (
    <button type="button" className="btn" style={{ flexShrink: 0, minHeight: 44 }} aria-pressed={props.marked} disabled={busy} onClick={() => void toggle()}>
      {props.marked ? '★ Marked' : '☆ Mark'}
    </button>
  )
}

// ---------------------------------------------------------------------------
// One team's page: who they are, then our notes.

export function TeamPage(props: { event: string; team: number }) {
  const { event, team } = props
  const list = usePrescoutTeams(event)
  const notes = usePrescoutNotes(event).find((n) => n.team_number === team) ?? null
  const details: PrescoutTeam | undefined = list?.ok ? list.value.find((t) => t.team === team) : undefined

  return (
    <>
      <div className="toolbar">
        <a className="btn" href={href('prescouting')}>← All teams</a>
      </div>
      <PageHead title={details ? `${team} ${details.name}` : `Team ${team}`} eyebrow={`Prescouting · ${event}`}>
        <TeamLine list={list} details={details} />
      </PageHead>
      <div className="toolbar">
        <MarkButton event={event} team={team} marked={notes?.marked ?? false} />
        <a className="btn" style={{ minHeight: 44 }} href={details?.tbaUrl ?? tbaTeamUrl(team, event)} target="_blank" rel="noreferrer">
          The Blue Alliance
        </a>
      </div>
      <NotesForm event={event} team={team} saved={notes ?? NO_ANSWERS} />
    </>
  )
}

/** The EPA under the team's name, or why it's not there. */
function TeamLine(props: { list: Result<PrescoutTeam[]> | null; details: PrescoutTeam | undefined }) {
  if (!props.list) return <>Loading…</>
  if (!props.list.ok) return <>Couldn't load their name and EPA: {props.list.error}</>
  if (!props.details) return <>The Blue Alliance doesn't list them at this event.</>
  return <>EPA {formatEpa(props.details.epa)}</>
}

/** The questions, each an open-ended text box, and Save. */
function NotesForm(props: { event: string; team: number; saved: PrescoutAnswers }) {
  // Starts from what's saved. Someone else's later changes show after a reload.
  const [answers, setAnswers] = useState<PrescoutAnswers>(() => ({ ...NO_ANSWERS, ...pickAnswers(props.saved) }))
  const [saving, setSaving] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const result = await savePrescout(props.event, props.team, answers)
    setSaving(false)
    toast(result.ok ? `Saved notes for team ${props.team}.` : result.error)
  }

  return (
    <Panel title="Our notes">
      <form className="panel-body" onSubmit={(e) => void save(e)} style={{ display: 'grid', gap: 14 }}>
        {PRESCOUT_QUESTIONS.map((q) => (
          <label key={q.key} className="field" htmlFor={`prescout-${q.key}`}>
            {q.label}
            <textarea
              id={`prescout-${q.key}`}
              className="input"
              style={BOX}
              rows={3}
              value={answers[q.key]}
              onChange={(e) => setAnswers((now) => ({ ...now, [q.key]: e.target.value }))}
              placeholder={q.hint}
            />
          </label>
        ))}
        <div className="toolbar">
          <button type="submit" className="btn btn-primary btn-lg" style={BOX} disabled={saving}>{saving ? 'Saving…' : 'Save notes'}</button>
        </div>
      </form>
    </Panel>
  )
}

function pickAnswers(row: PrescoutAnswers): PrescoutAnswers {
  return Object.fromEntries(PRESCOUT_QUESTIONS.map((q) => [q.key, row[q.key]])) as PrescoutAnswers
}
