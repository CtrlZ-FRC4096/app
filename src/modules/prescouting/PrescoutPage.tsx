import { useState, type FormEvent } from 'react'
import { href, useRoute } from '../../core/router'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pick } from '../../core/ui'
import type { Result } from '../../core/table'
import { MAX_TEAM, tbaTeamUrl, useTeamPhotos } from '../scouting/data'
import {
  NO_ANSWERS, PRESCOUT_QUESTIONS, PRESCOUT_SORTS, firstLine, isEventKey, prescoutHref, prescoutOverview, reloadPrescoutTeams, savePrescout,
  setPrescoutEvent, usePrescoutEvent, usePrescoutNotes, usePrescoutTeams,
  MAX_STAR_REASON, removeTeamStar, starTeam, unstarTeam, useStars,
  type OverviewTeam, type PrescoutAnswers, type PrescoutSort, type PrescoutStar, type PrescoutTeam,
} from './data'
import { useMemberNames } from '../../core/members'
import { isMentor } from '../../core/roles'
import { currentUser } from '../../core/session'

// Big enough to tap, and 16px text so phones don't zoom in on the box.
const BOX = { minHeight: 46, fontSize: 16 }

/** The address of a team's prescouting page. */
const teamHref = prescoutHref

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
  const stars = useStars(event)
  const [sort, setSort] = useState<PrescoutSort>('Team number')
  const teams = result?.ok ? prescoutOverview(result.value, notes, sort, stars, currentUser()?.id ?? null) : []
  const starred = teams.some((t) => t.group !== 'rest')

  return (
    <>
      <PageHead title="Prescouting">Every team coming to an event, to look up before it starts. Star the ones you care about, just for you or for the whole team, to keep them at the top.</PageHead>
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
            <TeamGroup title="Starred for the team" event={event} teams={teams.filter((t) => t.group === 'team')} />
            <TeamGroup title="Starred by you" event={event} teams={teams.filter((t) => t.group === 'mine')} />
            <TeamGroup title={starred ? 'Everyone else' : ''} event={event} teams={teams.filter((t) => t.group === 'rest')} />
          </div>
        )}
      </Panel>
    </>
  )
}

/**
 * Teams starred for the team, starred by you, or everyone else, each in the
 * chosen sort. The headings show why a starred team stays above a team with
 * a better EPA. With no starred teams there's one list and no heading
 * (title '').
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
        <StarControls event={props.event} team={t.team} myStars={t.myStars} />
      </div>
      {t.teamStars.length > 0 && <TeamStars stars={t.teamStars} />}
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

/**
 * The Star button (#118). Tapping it asks which kind, with two big buttons:
 * just for me, or for the whole team, which needs a reason. With a star
 * already, it offers to remove it.
 */
function StarControls(props: { event: string; team: number; myStars: PrescoutStar[] }) {
  const [open, setOpen] = useState(false)
  const [forTeam, setForTeam] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const has = (kind: boolean) => props.myStars.some((s) => s.for_team === kind)

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    const result = await action()
    setBusy(false)
    if (!result.ok) return toast(result.error ?? 'Something went wrong. Try again.')
    setOpen(false)
    setForTeam(false)
    setReason('')
  }

  const tap = { minHeight: 44, flexShrink: 0 }
  if (!open) {
    return (
      <button type="button" className="btn" style={tap} aria-expanded={false} onClick={() => setOpen(true)}>
        {props.myStars.length > 0 ? '★ Starred' : '☆ Star'}
      </button>
    )
  }
  return (
    <div style={{ display: 'grid', gap: 8, flexBasis: '100%' }} role="group" aria-label={`Star team ${props.team}`}>
      <div className="toolbar">
        {has(false) ? (
          <button type="button" className="btn btn-lg" disabled={busy} onClick={() => void run(() => unstarTeam(props.event, props.team, false))}>Remove my star</button>
        ) : (
          <button type="button" className="btn btn-lg" disabled={busy} onClick={() => void run(() => starTeam(props.event, props.team, { forTeam: false }))}>Just for me</button>
        )}
        {has(true) ? (
          <button type="button" className="btn btn-lg" disabled={busy} onClick={() => void run(() => unstarTeam(props.event, props.team, true))}>Remove my team star</button>
        ) : (
          <button type="button" className="btn btn-lg" aria-pressed={forTeam} disabled={busy} onClick={() => setForTeam(true)}>For the whole team</button>
        )}
        <button type="button" className="btn" style={tap} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {forTeam && (
        <form style={{ display: 'grid', gap: 8 }} onSubmit={(e) => { e.preventDefault(); void run(() => starTeam(props.event, props.team, { forTeam: true, reason })) }}>
          <label className="field">
            Why should the team look at them?
            <textarea className="input" style={BOX} rows={2} maxLength={MAX_STAR_REASON} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Like: fast, reliable auto. Good second pick." />
          </label>
          <div className="toolbar">
            <button type="submit" className="btn btn-primary" style={tap} disabled={busy || !reason.trim()}>Star for the team</button>
          </div>
        </form>
      )}
    </div>
  )
}

/** Everyone's team stars on a team, with their reasons and who starred them. Mentors can remove any. */
function TeamStars(props: { stars: PrescoutStar[]; canRemove?: boolean }) {
  const nameOf = useMemberNames()
  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 4, fontSize: 14 }}>
      {props.stars.map((s) => (
        <li key={s.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 8px', alignItems: 'center', overflowWrap: 'anywhere' }}>
          <span>★ {s.reason} <span className="note">— {s.created_by ? nameOf(s.created_by) : 'marked before stars'}</span></span>
          {props.canRemove && (
            <button type="button" className="btn btn-sm" style={{ minHeight: 44 }} onClick={() => void removeTeamStar(s).then((result) => !result.ok && toast(result.error))}>Remove</button>
          )}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// One team's page: who they are, then our notes.

export function TeamPage(props: { event: string; team: number }) {
  const { event, team } = props
  const list = usePrescoutTeams(event)
  const notes = usePrescoutNotes(event).find((n) => n.team_number === team) ?? null
  const details: PrescoutTeam | undefined = list?.ok ? list.value.find((t) => t.team === team) : undefined
  const stars = useStars(event).filter((s) => s.team_number === team)
  const me = currentUser()
  const teamStars = stars.filter((s) => s.for_team)

  return (
    <>
      <div className="toolbar">
        <a className="btn" href={href('prescouting')}>← All teams</a>
      </div>
      <PageHead title={details ? `${team} ${details.name}` : `Team ${team}`} eyebrow={`Prescouting · ${event}`}>
        <TeamLine list={list} details={details} />
      </PageHead>
      <div className="toolbar">
        <StarControls event={event} team={team} myStars={stars.filter((s) => s.created_by === me?.id)} />
        <a className="btn" style={{ minHeight: 44 }} href={details?.tbaUrl ?? tbaTeamUrl(team, event)} target="_blank" rel="noreferrer">
          The Blue Alliance
        </a>
        {/* #119: what we saw in matches, one tap away. */}
        <a className="btn" style={{ minHeight: 44 }} href={href('scouting', 'team', String(team))}>
          Scouting team page →
        </a>
      </div>
      {teamStars.length > 0 && (
        <Panel title="Starred for the team">
          <div className="panel-body"><TeamStars stars={teamStars} canRemove={!!me && isMentor(me.role)} /></div>
        </Panel>
      )}
      <RobotPhotos event={event} team={team} />
      <NotesForm event={event} team={team} saved={notes ?? NO_ANSWERS} />
    </>
  )
}

/**
 * Photos of the team's robot from pit scouting (#164), newest first. Tap one
 * to open it full size. Only shown once someone's taken one; the photos
 * come from the Scouting module's useTeamPhotos().
 */
function RobotPhotos(props: { event: string; team: number }) {
  const photos = useTeamPhotos(props.team, props.event)
  if (photos.length === 0) return null
  return (
    <Panel title="Robot photos" aside={<span className="note">From pit scouting</span>}>
      {/* Only this row scrolls sideways, never the page. */}
      <div className="panel-body" style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
        {photos.map((photo, i) =>
          photo.url ? (
            <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
              <img src={photo.url} alt={`Team ${props.team}'s robot, photo ${i + 1}`} style={{ width: i === 0 ? 200 : 120, height: i === 0 ? 150 : 90, objectFit: 'cover', borderRadius: 'var(--radius)', display: 'block' }} />
            </a>
          ) : (
            <span key={photo.id} className="note" style={{ flexShrink: 0 }}>{photo.waiting ? 'On a phone, not sent yet' : 'Needs a connection'}</span>
          ),
        )}
      </div>
    </Panel>
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
