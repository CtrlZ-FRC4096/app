import { useState, type FormEvent } from 'react'
import { shortDate } from '../../core/format'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pick, Pill } from '../../core/ui'
import { DRIVER_SKILLS, STOPS, saveEntry, useEntries, type Stop } from './data'
import PitForm from './PitForm'
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

const FORMS = ['Match', 'Pit'] as const
type Form = (typeof FORMS)[number]

// The Scouting page: a switch between the match form and the pit form.
export default function ScoutingPage() {
  const [form, setForm] = useState<Form>('Match')
  return (
    <>
      <PageHead title={form === 'Match' ? 'Match form' : 'Pit form'}>
        {form === 'Match'
          ? 'Count what one robot does in one match. Entries save on this device, so it works with no Wi-Fi.'
          : "Talk to a team in their pit about their robot. Entries save on this device, and sync when there's a connection."}
      </PageHead>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <Pick label="Match or pit scouting" options={[...FORMS]} value={form} onChange={setForm} />
      </div>
      {form === 'Match' ? <MatchForm /> : <PitForm />}
    </>
  )
}

// The form for one robot in one match. Every field comes from season.ts,
// so a new game means new settings, not a new page. Saving goes through
// saveEntry() in data.ts, which keeps the entry on this device.
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
      <form onSubmit={save}>
        <Panel title="Match">
          <div className="panel-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <label className="field" htmlFor="scout-match">
              Match number
              <input id="scout-match" className="input" style={{ width: '9ch', minHeight: 46, fontSize: 16 }} inputMode="numeric" value={match} onChange={(e) => setMatch(e.target.value)} placeholder="12" />
            </label>
            <label className="field" htmlFor="scout-team">
              Team number
              <input id="scout-team" className="input" style={{ width: '9ch', minHeight: 46, fontSize: 16 }} inputMode="numeric" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="4096" />
            </label>
          </div>
        </Panel>
        <Panel title="Scoring">
          <div className="row-list">
            {COUNTERS.map((c) => (
              <div key={c.key}>
                <span>{c.label}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button type="button" className="btn btn-lg" style={tap} aria-label={`${c.label}: one fewer`} onClick={() => change(c.key, -1)}>−</button>
                  <span className="mono" style={{ minWidth: '2.5ch', textAlign: 'center', fontSize: 22 }} aria-live="polite" aria-label={c.label}>{counts[c.key]}</span>
                  <button type="button" className="btn btn-lg btn-primary" style={tap} aria-label={`${c.label}: one more`} onClick={() => change(c.key, 1)}>+</button>
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="How it went">
          <div className="panel-body">
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
          </div>
        </Panel>
        <Panel title="Endgame">
          <div className="panel-body">
            <Pick label="Endgame" options={ENDGAME} value={endgame} onChange={setEndgame} />
            <label className="field" htmlFor="scout-notes">
              Notes
              <textarea id="scout-notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the form doesn't show: tipped, fast cycles, slow intake" />
            </label>
            <div className="toolbar">
              <button type="submit" className="btn btn-lg btn-primary">Save entry</button>
            </div>
          </div>
        </Panel>
      </form>
      <Panel title="Saved on this device" aside={<span className="note">{entries.length} saved</span>}>
        {entries.length === 0 ? (
          <p className="panel-body muted">No entries yet. Fill in the form and press Save entry.</p>
        ) : (
          <div className="row-list">
            {entries.map((e) => (
              <div key={e.id}>
                <span>Match {e.match} · Team {e.team}<br /><span className="note">{shortDate(e.created_at)}</span></span>
                <span style={{ marginLeft: 'auto' }}>
                  {e.synced ? <Pill tone="ok">Synced</Pill> : <Pill tone="warn">Waiting</Pill>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  )
}
