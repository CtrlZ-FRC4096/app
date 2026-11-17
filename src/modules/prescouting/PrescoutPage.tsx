import { useState, type FormEvent } from 'react'
import { href, useRoute } from '../../core/router'
import { useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pick } from '../../core/ui'
import type { Result } from '../../core/table'
import { MAX_TEAM, tbaTeamUrl, useTeamPhotos } from '../scouting/data'
import {
  NO_ANSWERS, PRESCOUT_QUESTIONS, PRESCOUT_SORTS, STAR_GROUPS, STRATEGY_ONLY, isEventKey, prescoutHref, prescoutOverview, reloadPrescoutTeams, savePrescout, searchPrescout,
  setPrescoutEvent, useIsStrategy, usePrescoutEvent, usePrescoutNotes, usePrescoutTeams, useStars,
  type OverviewTeam, type PrescoutAnswers, type PrescoutSort, type PrescoutTeam,
} from './data'
import Stars from './Stars'
import TeamSeason from './TeamSeason'
import './prescouting.css'

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
  // Strategy team, student leaders, mentors and admins only (#167). The database refuses anyone else too.
  if (!useIsStrategy()) {
    return (
      <Panel>
        <p className="panel-body" style={{ margin: 0 }}>{`${STRATEGY_ONLY} Ask a mentor if you need it.`}</p>
      </Panel>
    )
  }
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
// The overview: the event box, then a grid of small tiles, one per team (#183).

function Overview() {
  const event = usePrescoutEvent()
  const result = usePrescoutTeams(event)
  const notes = usePrescoutNotes(event)
  const stars = useStars(event)
  const me = useSession().id
  const [sort, setSort] = useState<PrescoutSort>('Team number')
  const teams = result?.ok ? prescoutOverview(result.value, notes, stars, me, sort) : []
  const starred = teams.some((t) => t.group !== 'Everyone else')
  // What's typed in the search box. The list narrows as it's typed.
  const [search, setSearch] = useState('')
  const found = searchPrescout(teams, search)

  return (
    <>
      <PageHead title="Prescouting">Every team coming to an event, to look up before it starts. Tap a team to read and write their notes, or star them to keep them at the top. ✓ means they're prescouted.</PageHead>
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
            <label className="field" htmlFor="prescout-search">
              Find a team
              <input
                id="prescout-search"
                className="input"
                type="search"
                style={{ ...BOX, width: '100%' }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Number or name"
              />
            </label>
            {/* Said aloud by screen readers when the list empties, since nothing else on the page changes. */}
            <div aria-live="polite">
              {teams.length > 0 && found.length === 0 && (
                <p className="muted" style={{ margin: 0, overflowWrap: 'anywhere' }}>No teams match "{search.trim()}". Check the number or name, or clear the box to see every team.</p>
              )}
            </div>
            {STAR_GROUPS.map((group) => (
              <TeamGroup key={group} title={starred ? group : ''} event={event} teams={found.filter((t) => t.group === group)} />
            ))}
          </div>
        )}
      </Panel>
    </>
  )
}

/**
 * Team stars, your stars, or everyone else, each in the chosen sort. The
 * headings show why a starred team stays above a team with a better EPA.
 * With no starred teams there's one list and no heading (title '').
 */
function TeamGroup(props: { title: string; event: string; teams: OverviewTeam[] }) {
  if (props.teams.length === 0) return null
  return (
    <section style={{ display: 'grid', gap: 8, minWidth: 0 }} aria-label={props.title || 'Teams'}>
      {props.title && <h3 style={{ margin: '4px 0 0', fontSize: 15 }}>{props.title} <span className="note">({props.teams.length})</span></h3>}
      <div className="prescout-grid">
        {props.teams.map((t) => <TeamTile key={t.team} event={props.event} team={t} />)}
      </div>
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

/**
 * One team in the overview (#183): a small tile in the grid, linking to their
 * prescouting page. Only their number, name (cut short with "…"), EPA, a ✓ if
 * they're prescouted (and an emptier, dashed look if not), and ★ for a team
 * star or ☆ for your own. Their notes and the Star button are on their page.
 * The classes are in prescouting.css.
 */
export function TeamTile(props: { event: string; team: OverviewTeam }) {
  const t = props.team
  const star = t.stars.forTeam.length > 0 ? 'team star' : t.stars.mine ? 'your star' : ''
  const label = [`Team ${t.team} ${t.name}`, `EPA ${formatEpa(t.epa)}`, t.prescouted ? 'prescouted' : 'not prescouted yet', star].filter(Boolean).join(', ')
  return (
    <a className={t.prescouted ? 'prescout-tile' : 'prescout-tile prescout-tile-todo'} href={teamHref(props.event, t.team)} aria-label={label} title={t.name}>
      <span className="prescout-tile-top">
        <strong className="prescout-tile-number tnum">{t.team}</strong>
        <span className="prescout-tile-badges" aria-hidden="true">
          {star && <span className="prescout-tile-star">{t.stars.forTeam.length > 0 ? '★' : '☆'}</span>}
          {t.prescouted && <span className="prescout-tile-done">✓</span>}
        </span>
      </span>
      <span className="prescout-tile-name">{t.name}</span>
      <span className="prescout-tile-numbers" aria-hidden="true">
        <span>{`EPA ${formatEpa(t.epa)}`}</span>
      </span>
    </a>
  )
}

function formatEpa(epa: number | null): string {
  return epa === null ? '—' : epa.toFixed(1)
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
        <a className="btn" style={{ minHeight: 44 }} href={details?.tbaUrl ?? tbaTeamUrl(team, event)} target="_blank" rel="noreferrer">
          The Blue Alliance
        </a>
        {/* #119: what we saw in matches, one tap away. */}
        <a className="btn" style={{ minHeight: 44 }} href={href('scouting', 'team', String(team))}>
          Scouting team page →
        </a>
      </div>
      {/* Starring is here, not on the overview's tiles, which are too small for a button (#183). */}
      <Panel title="Stars">
        <div className="panel-body">
          <Stars event={event} team={team} />
        </div>
      </Panel>
      <RobotPhotos event={event} team={team} />
      <NotesForm event={event} team={team} saved={notes ?? NO_ANSWERS} />
      <TeamSeason event={event} team={team} />
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
