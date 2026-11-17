import { Fragment, useState, type FormEvent } from 'react'
import { href } from '../../../core/router'
import { useSession } from '../../../core/session'
import { toast } from '../../../core/toast'
import { PageHead, Panel, Pick } from '../../../core/ui'
import type { Result } from '../../../core/table'
import { MAX_TEAM, tbaTeamUrl, useTeamPhotos } from '../data'
import { DRIVETRAINS, ENDGAME } from '../season'
import { PRESCOUT_VIEWS, TABLE_ANSWER_LENGTH, setPrescoutView, starCount, usePrescoutView } from './data'
import {
  MAX_AUTO_FUEL, MAX_CYCLE_SECONDS, NO_ANSWERS, NO_FACTS, PRESCOUT_QUESTIONS, PRESCOUT_SORTS, STAR_GROUPS, TIERS, firstLine, hasMatch13, isEventKey, prescoutFacts, prescoutHref, prescoutOverview,
  reloadPrescoutTeams, savePrescout, searchPrescout, setPrescoutEvent, setTier, usePrescoutEvent, usePrescoutNotes, usePrescoutTeams, useStars,
  type OverviewTeam, type PrescoutAnswers, type PrescoutFacts, type PrescoutNotes, type PrescoutSort, type PrescoutTeam, type Tier,
} from './data'
import Stars from './Stars'
import './prescouting.css'
import TeamSeason from './TeamSeason'

// Big enough to tap, and 16px text so phones don't zoom in on the box.
const BOX = { minHeight: 46, fontSize: 16 }

/** The address of a team's prescouting page. */
const teamHref = prescoutHref

// Scouting's Prescouting tab (#184). #/scouting/prescouting is the overview
// of every team at the event (#116, #118); #/scouting/prescouting/<event>/<team>
// is one team's page with our notes (#117). ScoutingPage.tsx reads the
// address and passes the event and team in. The event is in a team page's
// address, so a link to it always opens the same team at the same event.
// Every scout can use it (#184).
export default function PrescoutPage(props: { event?: string; team?: string }) {
  const { event, team } = props
  if (event === undefined) return <Overview />
  const number = Number(team)
  if (!isEventKey(event) || !Number.isInteger(number) || number < 1 || number > MAX_TEAM) {
    return (
      <Panel>
        <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
          <p style={{ margin: 0 }}>That address isn't a team's prescouting page. Go back to the list and choose the team.</p>
          <div className="toolbar"><a className="btn" href={prescoutHref()}>All teams</a></div>
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
  const me = useSession().id
  const [sort, setSort] = useState<PrescoutSort>('Team number')
  const view = usePrescoutView()
  const teams = result?.ok ? prescoutOverview(result.value, notes, stars, me, sort) : []
  const starred = teams.some((t) => t.group !== 'Everyone else')
  // What's typed in the search box. The list narrows as it's typed.
  const [search, setSearch] = useState('')
  const found = searchPrescout(teams, search)

  return (
    <>
      <PageHead title="Prescouting">Every team coming to an event, to look up before it starts. Star the ones we care about to keep them at the top.</PageHead>
      <EventBox event={event} />
      <Panel title={`Teams at ${event}`} aside={result?.ok ? <span className="note">{result.value.length} teams</span> : undefined}>
        {!result ? (
          <p className="panel-body muted" aria-live="polite">Loading teams…</p>
        ) : !result.ok ? (
          <Problem error={result.error} retry={() => void reloadPrescoutTeams(event)} />
        ) : (
          <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
            <div className="toolbar" style={{ gap: '10px 20px' }}>
              <div className="field">
                Sort by
                <Pick label="Sort by" options={[...PRESCOUT_SORTS]} value={sort} onChange={setSort} />
              </div>
              <div className="field">
                Show as
                <Pick label="Show as" options={[...PRESCOUT_VIEWS]} value={view} onChange={setPrescoutView} />
              </div>
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
            {view === 'Table' ? (
              found.length > 0 && <TeamTable event={event} teams={found} headings={starred} />
            ) : (
              STAR_GROUPS.map((group) => (
                <TeamGroup key={group} title={starred ? group : ''} event={event} teams={found.filter((t) => t.group === group)} />
              ))
            )}
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
    <section style={{ display: 'grid', gap: 12 }} aria-label={props.title || 'Teams'}>
      {props.title && <h3 style={{ margin: '4px 0 0', fontSize: 15 }}>{props.title} <span className="note">({props.teams.length})</span></h3>}
      {props.teams.map((t) => <TeamCard key={t.team} event={props.event} team={t} />)}
    </section>
  )
}

// One line per row, so three or more teams fit where one card did.
const CELL = { padding: '0 10px', whiteSpace: 'nowrap' } as const

/**
 * The overview as a table: a row for each team, a column for each question
 * in PRESCOUT_QUESTIONS (so a new question gets a column by itself). It's
 * wider than a phone, so it scrolls sideways inside its own box, with the
 * team column kept in place (.grid-table, like Attendance). The star groups
 * are heading rows, so the columns stay lined up. `teams` come sorted and
 * grouped from prescoutOverview(); `headings` is false when nobody is starred.
 */
export function TeamTable(props: { event: string; teams: OverviewTeam[]; headings: boolean }) {
  return (
    // minWidth 0 lets the box be narrower than the table, so the table scrolls and not the page.
    <div className="table-wrap" style={{ minWidth: 0, border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
      <table className="grid-table">
        <thead>
          <tr>
            <th scope="col" style={{ padding: '8px 10px' }}>Team</th>
            {PRESCOUT_QUESTIONS.map((q) => <th key={q.key} scope="col" style={{ padding: '8px 10px' }}>{q.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {STAR_GROUPS.map((group) => {
            const teams = props.teams.filter((t) => t.group === group)
            if (teams.length === 0) return null
            return (
              <Fragment key={group}>
                {props.headings && (
                  <tr>
                    {/* The words stay at the left edge while the table scrolls sideways. */}
                    <th colSpan={PRESCOUT_QUESTIONS.length + 1} scope="rowgroup" style={{ padding: '6px 10px', background: 'var(--surface-2)' }}>
                      <span style={{ position: 'sticky', left: 10, display: 'inline-block' }}>{group} ({teams.length})</span>
                    </th>
                  </tr>
                )}
                {teams.map((t) => <TeamRow key={t.team} event={props.event} team={t} />)}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TeamRow(props: { event: string; team: OverviewTeam }) {
  const t = props.team
  const stars = starCount(t.stars)
  return (
    <tr>
      <td style={CELL}>
        {/* As tall as the row, so the whole cell is the tap target. */}
        <a
          href={teamHref(props.event, t.team)}
          title={t.name}
          aria-label={`Team ${t.team}, ${t.name}${t.notes?.tier ? `, tier ${t.notes.tier}` : ''}${stars ? `, ${stars === 1 ? '1 star' : `${stars} stars`}` : ''}`}
          style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, minWidth: 44, color: 'inherit' }}
        >
          <strong className="tnum">{t.team}</strong>
          {t.notes?.tier && <TierBadge tier={t.notes.tier} />}
          {stars > 0 && <span className="note tnum">★{stars}</span>}
        </a>
      </td>
      {PRESCOUT_QUESTIONS.map((q) => {
        const answer = firstLine(t.notes?.[q.key] ?? '', TABLE_ANSWER_LENGTH)
        return <td key={q.key} style={CELL} className={answer ? undefined : 'muted'}>{answer || '—'}</td>
      })}
    </tr>
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
const OVERVIEW_ANSWERS: (keyof PrescoutAnswers)[] = ['overall', 'key_task', 'strengths', 'weaknesses', 'other_notes']

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
          {t.notes?.tier && <> <TierBadge tier={t.notes.tier} long /></>}
          <br />
          <span className="note tnum">{`EPA ${formatEpa(t.epa)} · xP ${formatEpa(t.xp)}`}</span>
        </a>
      </div>
      <Stars event={props.event} team={t.team} />
      {notes ? (
        <dl style={{ margin: 0, display: 'grid', gap: 4, fontSize: 14 }}>
          <FactsLine notes={notes} />
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

/** The quick answers on one wrapping line, like "Rating 4 of 5 · Swerve · Best climb Level 2". Nothing if none are filled in. */
function FactsLine(props: { notes: PrescoutNotes }) {
  const facts = prescoutFacts(props.notes)
  if (facts.length === 0) return null
  return (
    <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <dt style={{ display: 'inline', fontWeight: 600 }}>Quick answers: </dt>
      <dd style={{ display: 'inline', margin: 0 }}>{facts.map((f) => `${f.label} ${f.value}`).join(' · ')}</dd>
    </div>
  )
}

/** A team's tier as a small badge (#191): "B", or "Tier B" when `long`. Colours in prescouting.css. */
function TierBadge(props: { tier: Tier; long?: boolean }) {
  return <span className="prescout-tier-badge" data-tier={props.tier} title={`Tier ${props.tier}`}>{props.long ? `Tier ${props.tier}` : props.tier}</span>
}

/**
 * The tier list (#191): six big buttons, S to F. Tap one to choose it, and
 * tap it again to clear it. Shared with everyone, and changes from other
 * phones show up by themselves.
 */
function TierPanel(props: { event: string; team: number; tier: Tier | null }) {
  const [saving, setSaving] = useState(false)

  async function choose(tier: Tier | '') {
    if (tier === '' || saving) return
    setSaving(true)
    const result = await setTier(props.event, props.team, tier === props.tier ? null : tier)
    setSaving(false)
    if (!result.ok) toast(result.error)
  }

  return (
    <Panel title="Tier" aside={props.tier ? <TierBadge tier={props.tier} /> : <span className="note">Not rated</span>}>
      <div className="panel-body prescout-tier" style={{ display: 'grid', gap: 8 }}>
        <Pick<Tier | ''> label="Tier" options={[...TIERS]} value={props.tier ?? ''} onChange={(tier) => void choose(tier)} />
        <p className="note" style={{ margin: 0 }}>S is best. Tap the chosen tier again to clear it.</p>
      </div>
    </Panel>
  )
}

/** A Match 13 number to one decimal place, or "—" if Match 13 didn't give it. */
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
        <a className="btn" href={prescoutHref()}>← All teams</a>
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
      {/* Starring and the tier are here (#191). */}
      <TierPanel event={event} team={team} tier={notes?.tier ?? null} />
      <Panel title="Stars">
        <div className="panel-body">
          <Stars event={event} team={team} />
        </div>
      </Panel>
      <RobotPhotos event={event} team={team} />
      {details && <Match13Panel team={details} />}
      <NotesForm event={event} team={team} saved={notes ?? NO_ANSWERS} savedFacts={notes ?? NO_FACTS} />
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


/**
 * Match 13's numbers for the team (#186), to compare with what scouts read
 * and watched. "—" for a number Match 13 didn't give, and a line saying so
 * if it hasn't rated them at all yet.
 */
export function Match13Panel(props: { team: PrescoutTeam }) {
  const t = props.team
  const numbers: [string, number | null][] = [['Auto', t.auto], ['Teleop', t.teleop], ['Endgame', t.endgame], ['EPA', t.epa], ['OPR', t.opr], ['DPR', t.dpr]]
  return (
    <Panel title="Match 13">
      {hasMatch13(t) ? (
        <>
          <div className="stats" aria-label="Match 13 numbers">
            <div>
              <strong>{formatEpa(t.xp)}</strong>
              <span>{t.xpRank ? `xP · Rank ${t.xpRank.rank} of ${t.xpRank.of}` : 'xP'}</span>
            </div>
            {numbers.map(([label, value]) => (
              <div key={label}><strong>{formatEpa(value)}</strong><span>{label}</span></div>
            ))}
          </div>
          <p className="panel-body note" style={{ margin: 0, paddingTop: 0 }}>
            xP is the points they add to their alliance's score. Before the event, it's Match 13's rating of how strong they are going in; it changes once matches start.
          </p>
        </>
      ) : (
        <p className="panel-body muted" style={{ margin: 0 }}>No Match 13 numbers yet. They usually show up closer to the event.</p>
      )}
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

const NOT_SURE = 'Not sure'
const NOT_RATED = 'Not rated'

/** The quick answers (#184), then the questions, each an open-ended text box, and Save. */
function NotesForm(props: { event: string; team: number; saved: PrescoutAnswers; savedFacts: PrescoutFacts }) {
  // Starts from what's saved. Someone else's later changes show after a reload.
  const [answers, setAnswers] = useState<PrescoutAnswers>(() => ({ ...NO_ANSWERS, ...pickAnswers(props.saved) }))
  const [drivetrain, setDrivetrain] = useState(props.savedFacts.drivetrain || NOT_SURE)
  const [climb, setClimb] = useState(props.savedFacts.best_climb || NOT_SURE)
  const [rating, setRating] = useState(props.savedFacts.rating === null ? NOT_RATED : String(props.savedFacts.rating))
  const [autoFuel, setAutoFuel] = useState(props.savedFacts.auto_fuel === null ? '' : String(props.savedFacts.auto_fuel))
  const [cycle, setCycle] = useState(props.savedFacts.cycle_seconds === null ? '' : String(props.savedFacts.cycle_seconds))
  const [saving, setSaving] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const facts: PrescoutFacts = {
      drivetrain: drivetrain === NOT_SURE ? '' : drivetrain,
      best_climb: climb === NOT_SURE ? '' : climb,
      rating: rating === NOT_RATED ? null : Number(rating),
      auto_fuel: numberOrNull(autoFuel),
      cycle_seconds: numberOrNull(cycle),
    }
    const result = await savePrescout(props.event, props.team, answers, facts)
    setSaving(false)
    toast(result.ok ? `Saved notes for team ${props.team}.` : result.error)
  }

  return (
    <Panel title="Our notes">
      <form className="panel-body" onSubmit={(e) => void save(e)} style={{ display: 'grid', gap: 14 }}>
        <div className="field">
          Overall rating
          <Pick label="Overall rating" options={[NOT_RATED, '1', '2', '3', '4', '5']} value={rating} onChange={setRating} />
          <span className="note">1 is weak, 5 is great.</span>
        </div>
        <div className="field">
          Drivetrain
          <Pick label="Drivetrain" options={[NOT_SURE, ...DRIVETRAINS]} value={drivetrain} onChange={setDrivetrain} />
        </div>
        <div className="field">
          Best climb
          <Pick label="Best climb" options={[NOT_SURE, ...ENDGAME]} value={climb} onChange={setClimb} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <NumberBox id="prescout-auto_fuel" label="Fuel in auto (about)" value={autoFuel} onChange={setAutoFuel} placeholder={`0 to ${MAX_AUTO_FUEL}`} />
          <NumberBox id="prescout-cycle_seconds" label="Seconds per cycle (about)" value={cycle} onChange={setCycle} placeholder={`1 to ${MAX_CYCLE_SECONDS}`} />
        </div>
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

/** A box that only takes a whole number. The number keypad opens on phones. */
function NumberBox(props: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="field" htmlFor={props.id} style={{ minWidth: 0 }}>
      {props.label}
      <input id={props.id} className="input" style={{ ...BOX, width: '12ch', maxWidth: '100%' }} inputMode="numeric" value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={props.placeholder} />
    </label>
  )
}

/** What was typed in a number box: empty means we don't know (null). Anything else is checked by savePrescout(). */
function numberOrNull(typed: string): number | null {
  return typed.trim() === '' ? null : Number(typed.trim())
}

function pickAnswers(row: PrescoutAnswers): PrescoutAnswers {
  return Object.fromEntries(PRESCOUT_QUESTIONS.map((q) => [q.key, row[q.key]])) as PrescoutAnswers
}
