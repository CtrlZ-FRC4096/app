import { useState, type FormEvent, type ReactNode } from 'react'
import { navigate, useRoute } from '../../core/router'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pick } from '../../core/ui'
import { DRIVER_SKILLS, STOPS, saveEntry, useEntries, type Stop } from './data'
import EventPicker from './EventPicker'
import FormSection from './FormSection'
import MatchTeamFields from './MatchTeamFields'
import PickMany from './PickMany'
import Picklist from './Picklist'
import PitForm from './PitForm'
import RankingsPage from './RankingsPage'
import Schedule from './Schedule'
import SavedOnDevice from './SavedOnDevice'
import SharedPicklist from './SharedPicklist'
import Simulator from './Simulator'
import TeamPage, { TeamLink } from './TeamPage'
import { AUTO_SIDES, BREAKDOWN_PARTS, COUNTERS, ENDGAME, RANKING_POINTS, ROLES } from './season'

/** Width and height of the − and + buttons, in pixels. Big enough to tap without looking. */
const TAP_SIZE = 60

/** Every counter from season.ts, starting at 0. */
function zeroCounts(): Record<string, number> {
  return Object.fromEntries(COUNTERS.map((c) => [c.key, 0]))
}

/** A big tick box with its words beside it. */
function Tick(props: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
      <input type="checkbox" style={{ width: 24, height: 24, flexShrink: 0 }} checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      {props.children}
    </label>
  )
}

/** A one-line box for a short answer. 16px text so phones don't zoom in on it. */
function ShortAnswer(props: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="field" htmlFor={props.id}>
      {props.label}
      <input id={props.id} className="input" style={{ minHeight: 46, fontSize: 16 }} value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={props.placeholder} />
    </label>
  )
}

const VIEWS = ['Match', 'Pit', 'Schedule', 'Rankings', 'Picklist', 'Final picklist', 'Simulator']
/** Each view's address after #/scouting/. */
const PATHS: Record<string, string> = { Match: '', Pit: 'pit', Schedule: 'schedule', Rankings: 'rankings', Picklist: 'picklist', 'Final picklist': 'shared-picklist', Simulator: 'simulate' }

// A Match / Pit / Schedule / Rankings / Picklist / Final picklist / Simulator switch at
// the top. The choice is in the address, so #/scouting/pit opens the pit form
// straight away: a menu or a bookmark can link to any of them. Both forms
// stay on the page, and the one not chosen is hidden, so switching doesn't
// lose what's typed. The other pages are only on the page while they're
// chosen, so they only load and update while someone's looking at them.
//
// #/scouting/team/9991 is the team page for team 9991 (TeamPage.tsx), with
// both forms hidden. It's only drawn while open: it waits for the team
// database, and the forms must work with no connection.
export default function ScoutingPage() {
  const [rest = '', teamText] = useRoute().rest
  const view = rest === 'team' ? 'Team' : VIEWS.find((v) => PATHS[v] === rest) ?? 'Match'
  const team = Number(teamText)
  return (
    <>
      <EventPicker />
      <div style={{ marginBottom: 12 }}>
        <Pick label="Which page" options={VIEWS} value={view} onChange={(v) => navigate('scouting', PATHS[v])} />
      </div>
      <div hidden={view !== 'Match'}><MatchForm /></div>
      <div hidden={view !== 'Pit'}><PitForm /></div>
      {view === 'Schedule' && <Schedule />}
      {view === 'Rankings' && <RankingsPage />}
      {view === 'Picklist' && <Picklist />}
      {view === 'Final picklist' && <SharedPicklist />}
      {view === 'Simulator' && <Simulator />}
      {view === 'Team' && <TeamPage team={Number.isInteger(team) && team > 0 ? team : null} />}
    </>
  )
}

// The form for one robot in one match. Every field comes from season.ts,
// so a new game means new settings, not a new page. Saving goes through
// saveEntry() in data.ts, which keeps the entry on this device and sends it
// to the team database whenever there's a connection.
function MatchForm() {
  const entries = useEntries()
  const [match, setMatch] = useState('')
  const [team, setTeam] = useState('')
  const [counts, setCounts] = useState(zeroCounts)
  const [endgame, setEndgame] = useState(ENDGAME[0])
  const [roles, setRoles] = useState<string[]>([])
  const [roleNotes, setRoleNotes] = useState('')
  const [brokeDown, setBrokeDown] = useState(false)
  const [brokeParts, setBrokeParts] = useState<string[]>([])
  const [brokeOther, setBrokeOther] = useState('')
  const [brownedOut, setBrownedOut] = useState(false)
  const [stop, setStop] = useState<Stop>('None')
  // 0 until the scout chooses, so no button is pressed and Save asks for one.
  const [driverSkill, setDriverSkill] = useState(0)
  // '' until the scout chooses: they may not have seen where it started.
  const [autoSide, setAutoSide] = useState('')
  const [autoNotes, setAutoNotes] = useState('')
  const [rankingPoints, setRankingPoints] = useState<string[]>([])
  const [notes, setNotes] = useState('')

  function change(key: string, by: number) {
    setCounts((now) => ({ ...now, [key]: Math.max(0, (now[key] ?? 0) + by) }))
  }

  function save(event: FormEvent) {
    event.preventDefault()
    const result = saveEntry({
      match: Number(match),
      team: Number(team),
      counts,
      endgame,
      roles,
      role_notes: roleNotes,
      broke_down: brokeDown,
      broke_parts: brokeParts,
      broke_other: brokeOther,
      browned_out: brownedOut,
      stop,
      driver_skill: driverSkill,
      auto_side: autoSide,
      auto_notes: autoNotes,
      ranking_points: rankingPoints,
      notes,
    })
    if (!result.ok) {
      toast(result.error)
      return
    }
    // Ready for the next robot.
    setMatch('')
    setTeam('')
    setCounts(zeroCounts())
    setEndgame(ENDGAME[0])
    setRoles([])
    setRoleNotes('')
    setBrokeDown(false)
    setBrokeParts([])
    setBrokeOther('')
    setBrownedOut(false)
    setStop('None')
    setDriverSkill(0)
    setAutoSide('')
    setAutoNotes('')
    setRankingPoints([])
    setNotes('')
    toast(`Saved match ${result.value.match}, team ${result.value.team}.`)
  }

  const tap = { width: TAP_SIZE, minHeight: TAP_SIZE, padding: 0, fontSize: 24 }

  return (
    <>
      <PageHead title="Match form">
        Count what one robot does in one match. Entries save on this device, so it works with no Wi-Fi.
      </PageHead>
      <form onSubmit={save}>
        <Panel>
          <FormSection title="Match" first>
            {/* Position, match and team. The team fills in from the schedule: see MatchTeamFields.tsx. */}
            <MatchTeamFields match={match} team={team} onMatch={setMatch} onTeam={setTeam} />
          </FormSection>
          <FormSection title="Auto">
            <div className="field">
              Where it started (tap again to clear if you didn't see)
              <Pick label="Where it started" options={AUTO_SIDES} value={autoSide} onChange={(side) => setAutoSide(side === autoSide ? '' : side)} />
            </div>
            <ShortAnswer id="scout-auto" label="What did its auto do?" value={autoNotes} onChange={setAutoNotes} placeholder="Like: scored preload, picked up 2 from the middle" />
          </FormSection>
          <FormSection title="Scoring">
            {COUNTERS.map((c) => (
              <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span>{c.label}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button type="button" className="btn btn-lg" style={tap} aria-label={`${c.label}: one fewer`} onClick={() => change(c.key, -1)}>−</button>
                  <span className="mono" style={{ minWidth: '2.5ch', textAlign: 'center', fontSize: 22 }} aria-live="polite" aria-label={c.label}>{counts[c.key]}</span>
                  <button type="button" className="btn btn-lg btn-primary" style={tap} aria-label={`${c.label}: one more`} onClick={() => change(c.key, 1)}>+</button>
                </span>
              </div>
            ))}
          </FormSection>
          <FormSection title="How it went">
            <div className="field">
              Role (choose all that fit)
              <PickMany label="Role" options={ROLES} value={roles} onChange={setRoles} />
            </div>
            <ShortAnswer id="scout-role-notes" label="How well does it do its role?" value={roleNotes} onChange={setRoleNotes} placeholder="Like: fast cycles, missed a few shots" />
            <Tick checked={brokeDown} onChange={setBrokeDown}>Broke down (stopped working or lost a mechanism)</Tick>
            {brokeDown && (
              <>
                <div className="field">
                  What broke? (choose all that fit)
                  <PickMany label="What broke" options={BREAKDOWN_PARTS} value={brokeParts} onChange={setBrokeParts} />
                </div>
                <ShortAnswer id="scout-broke-other" label="Anything else that broke" value={brokeOther} onChange={setBrokeOther} placeholder="Like: bumper fell off" />
              </>
            )}
            <Tick checked={brownedOut} onChange={setBrownedOut}>Died or browned out (lost power, stuttering, lights flickering)</Tick>
            <div className="field">
              E-stop or A-stop
              <Pick label="E-stop or A-stop" options={[...STOPS]} value={stop} onChange={setStop} />
            </div>
            <div className="field">
              Driver skill
              <Pick label="Driver skill" options={DRIVER_SKILLS} value={driverSkill} onChange={setDriverSkill} />
              <span className="note">1: struggles to drive, 5: smooth and quick</span>
            </div>
          </FormSection>
          <FormSection title="Endgame">
            <Pick label="Endgame" options={ENDGAME} value={endgame} onChange={setEndgame} />
            <div className="field">
              Ranking points their alliance earned (choose all that fit)
              <PickMany label="Ranking points" options={RANKING_POINTS} value={rankingPoints} onChange={setRankingPoints} />
            </div>
            <label className="field" htmlFor="scout-notes">
              Notes
              <textarea id="scout-notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the form doesn't show: tipped, fast cycles, slow intake" />
            </label>
            <div className="toolbar">
              <button type="submit" className="btn btn-lg btn-primary">Save Entry</button>
            </div>
          </FormSection>
        </Panel>
      </form>
      <SavedOnDevice
        rows={entries.map((e) => ({ id: e.id, label: <>Match {e.match} · <TeamLink team={e.team} /></>, created_at: e.created_at, synced: e.synced }))}
        emptyText="No entries yet. Fill in the form and press Save Entry."
      />
    </>
  )
}
