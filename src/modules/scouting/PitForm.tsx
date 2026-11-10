import { useState, type FormEvent } from 'react'
import { shortDate } from '../../core/format'
import { toast } from '../../core/toast'
import { Panel, Pick, Pill } from '../../core/ui'
import { numbersOnly, savePitEntry, syncPitEntries, toNumber, usePitEntries, useSyncPitEntries } from './data'
import { AUTO_SIDES, DRIVETRAINS } from './season'

// Big enough to tap, and 16px text so phones don't zoom in when a box is tapped.
const BOX = { minHeight: 46, fontSize: 16 }
const NUMBER_BOX = { ...BOX, width: '9ch' }

// The pit form: what a scout learns talking to a team in their pit. The
// choices come from season.ts. Saving goes through savePitEntry() in
// data.ts, which keeps the entry on this device until it syncs.
export default function PitForm() {
  useSyncPitEntries()
  const entries = usePitEntries()
  const waiting = entries.filter((e) => !e.synced).length
  const [team, setTeam] = useState('')
  // '' until the scout chooses, so no button is pressed.
  const [drivetrain, setDrivetrain] = useState('')
  const [weight, setWeight] = useState('')
  const [length, setLength] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [motors, setMotors] = useState('')
  const [autoSide, setAutoSide] = useState('')
  const [autoPath, setAutoPath] = useState('')
  const [partnerStrategy, setPartnerStrategy] = useState('')
  const [ownStrategy, setOwnStrategy] = useState('')
  const [sending, setSending] = useState(false)

  function save(event: FormEvent) {
    event.preventDefault()
    const result = savePitEntry({
      team: Number(team),
      drivetrain: drivetrain || null,
      weight_lb: toNumber(weight),
      length_in: toNumber(length),
      width_in: toNumber(width),
      height_in: toNumber(height),
      motors,
      auto_side: autoSide || null,
      auto_path: autoPath,
      partner_strategy: partnerStrategy,
      own_strategy: ownStrategy,
    })
    if (!result.ok) {
      toast(result.error)
      return
    }
    // Ready for the next pit.
    for (const clear of [setTeam, setDrivetrain, setWeight, setLength, setWidth, setHeight, setMotors, setAutoSide, setAutoPath, setPartnerStrategy, setOwnStrategy]) clear('')
    toast(`Saved team ${result.value.team}.`)
    void syncPitEntries()
  }

  async function syncNow() {
    setSending(true)
    const result = await syncPitEntries()
    setSending(false)
    toast(result.ok ? 'Everything on this device is synced.' : `${result.error} The rest stay Waiting.`)
  }

  /** A box that only takes a number, like a weight or size. */
  const numberBox = (id: string, label: string, value: string, set: (value: string) => void, placeholder: string) => (
    <label className="field" htmlFor={id}>
      {label}
      <input id={id} className="input" style={NUMBER_BOX} inputMode="decimal" value={value} onChange={(e) => set(numbersOnly(e.target.value))} placeholder={placeholder} />
    </label>
  )

  return (
    <>
      <form onSubmit={save}>
        <Panel title="Team">
          <div className="panel-body">
            <label className="field" htmlFor="pit-team">
              Team number
              <input id="pit-team" className="input" style={NUMBER_BOX} inputMode="numeric" value={team} onChange={(e) => setTeam(e.target.value.replace(/\D/g, ''))} placeholder="4096" />
            </label>
          </div>
        </Panel>
        <Panel title="Robot">
          <div className="panel-body">
            <div className="field">
              Drivetrain
              <Pick label="Drivetrain" options={DRIVETRAINS} value={drivetrain} onChange={setDrivetrain} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {numberBox('pit-weight', 'Weight (lb)', weight, setWeight, '115')}
              {numberBox('pit-length', 'Length (in)', length, setLength, '28')}
              {numberBox('pit-width', 'Width (in)', width, setWidth, '28')}
              {numberBox('pit-height', 'Height (in)', height, setHeight, '24')}
            </div>
            <label className="field" htmlFor="pit-motors">
              Motors
              <textarea id="pit-motors" className="input" style={BOX} rows={2} value={motors} onChange={(e) => setMotors(e.target.value)} placeholder="8 Kraken X60 on swerve, 2 NEO on the shooter" />
            </label>
          </div>
        </Panel>
        <Panel title="Preferred auto">
          <div className="panel-body">
            <div className="field">
              Starts on
              <Pick label="Starts on" options={AUTO_SIDES} value={autoSide} onChange={setAutoSide} />
            </div>
            <label className="field" htmlFor="pit-auto-path">
              Path
              <textarea id="pit-auto-path" className="input" style={BOX} rows={2} value={autoPath} onChange={(e) => setAutoPath(e.target.value)} placeholder="Scores preload, picks up 2 from the middle" />
            </label>
          </div>
        </Panel>
        <Panel title="Strategy">
          <div className="panel-body">
            <label className="field" htmlFor="pit-partner-strategy">
              What do they want their partners to do?
              <textarea id="pit-partner-strategy" className="input" style={BOX} rows={3} value={partnerStrategy} onChange={(e) => setPartnerStrategy(e.target.value)} />
            </label>
            <label className="field" htmlFor="pit-own-strategy">
              What will they do?
              <textarea id="pit-own-strategy" className="input" style={BOX} rows={3} value={ownStrategy} onChange={(e) => setOwnStrategy(e.target.value)} />
            </label>
            <div className="toolbar">
              <button type="submit" className="btn btn-lg btn-primary">Save pit entry</button>
            </div>
          </div>
        </Panel>
      </form>
      <Panel
        title="Pit entries on this device"
        aside={waiting > 0 && (
          <button type="button" className="btn btn-sm" disabled={sending} onClick={() => void syncNow()}>{sending ? 'Syncing…' : 'Sync now'}</button>
        )}
      >
        {entries.length === 0 ? (
          <p className="panel-body muted">No pit entries yet. Fill in the form and press Save pit entry.</p>
        ) : (
          <div className="row-list">
            {entries.map((e) => (
              <div key={e.id}>
                <span>Team {e.team}{e.drivetrain && ` · ${e.drivetrain}`}<br /><span className="note">{shortDate(e.created_at)}</span></span>
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
