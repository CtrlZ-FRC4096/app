import { useState, type FormEvent } from 'react'
import { navigate, useRoute } from '../../core/router'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pick } from '../../core/ui'
import { DRIVER_SKILLS, STOPS, saveEntry, useEntries, type Stop } from './data'
import FormSection from './FormSection'
import Picklist from './Picklist'
import PitForm from './PitForm'
import Schedule from './Schedule'
import SavedOnDevice from './SavedOnDevice'
import TeamPage, { TeamLink } from './TeamPage'
import { COUNTERS, ENDGAME, ROLES } from './season'

/** Width and height of the − and + buttons, in pixels. Big enough to tap without looking. */
const TAP_SIZE = 60

/** Every counter from season.ts, starting at 0. */
function zeroCounts(): Record<string, number> {
  return Object.fromEntries(COUNTERS.map((c) => [c.key, 0]))
}

/**
 * A row of buttons where any number can be chosen, like <Pick> but for
 * more than one. It uses Pick's look, so the form looks like one thing.
 */
function PickMany(props: { label: string; options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  function toggle(option: string) {
    const chosen = props.value.includes(option)
    props.onChange(chosen ? props.value.filter((o) => o !== option) : [...props.value, option])
  }
  return (
    <div className="pick" role="group" aria-label={props.label}>
      {props.options.map((option) => (
        <button key={option} type="button" aria-pressed={props.value.includes(option)} onClick={() => toggle(option)}>
          {option}
        </button>
      ))}
    </div>
  )
}

const VIEWS = ['Match', 'Pit', 'Schedule', 'Picklist']
/** Each view's address after #/scouting/. */
const PATHS: Record<string, string> = { Match: '', Pit: 'pit', Schedule: 'schedule', Picklist: 'picklist' }

// A Match / Pit / Schedule / Picklist switch at the top. The choice is in the
// address, so #/scouting/pit opens the pit form straight away: a menu or a
// bookmark can link to any of them. Both forms stay on the page, and the one
// not chosen is hidden, so switching doesn't lose what's typed. The schedule
// and the picklist are only on the page while chosen, so they only load
// while someone's looking at them.
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
      <div style={{ marginBottom: 12 }}>
        <Pick label="Which page" options={VIEWS} value={view} onChange={(v) => navigate('scouting', PATHS[v])} />
      </div>
      <div hidden={view !== 'Match'}><MatchForm /></div>
      <div hidden={view !== 'Pit'}><PitForm /></div>
      {view === 'Schedule' && <Schedule />}
      {view === 'Picklist' && <Picklist />}
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
  const [brokeDown, setBrokeDown] = useState(false)
  const [stop, setStop] = useState<Stop>('None')
  // 0 until the scout chooses, so no button is pressed and Save asks for one.
  const [driverSkill, setDriverSkill] = useState(0)
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
      broke_down: brokeDown,
      stop,
      driver_skill: driverSkill,
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
    setBrokeDown(false)
    setStop('None')
    setDriverSkill(0)
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <label className="field" htmlFor="scout-match">
                Match number
                <input id="scout-match" className="input" style={{ width: '9ch', minHeight: 46, fontSize: 16 }} inputMode="numeric" value={match} onChange={(e) => setMatch(e.target.value)} placeholder="12" />
              </label>
              <label className="field" htmlFor="scout-team">
                Team number
                <input id="scout-team" className="input" style={{ width: '9ch', minHeight: 46, fontSize: 16 }} inputMode="numeric" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="4096" />
              </label>
            </div>
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
              <input type="checkbox" style={{ width: 24, height: 24 }} checked={brokeDown} onChange={(e) => setBrokeDown(e.target.checked)} />
              Broke down (stopped working or lost a mechanism)
            </label>
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
