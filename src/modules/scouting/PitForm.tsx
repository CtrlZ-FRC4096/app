import { useState, type FormEvent } from 'react'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pick } from '../../core/ui'
import { blankOrNumber, numberOnly, savePitEntry, usePitEntries } from './data'
import FormSection from './FormSection'
import SavedOnDevice from './SavedOnDevice'
import { TeamLink } from './TeamPage'
import PickMany from './PickMany'
import { AUTO_SIDES, DRIVETRAINS, VISION } from './season'

// Big enough to tap, and 16px text so phones don't zoom in on the box.
const BOX = { minHeight: 46, fontSize: 16 }

/** A box that only takes a number, like 115.5. The number keypad opens on phones. */
function NumberBox(props: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string; wholeNumber?: boolean }) {
  return (
    <label className="field" htmlFor={props.id}>
      {props.label}
      <input
        id={props.id}
        className="input"
        style={{ ...BOX, width: '9ch' }}
        inputMode={props.wholeNumber ? 'numeric' : 'decimal'}
        value={props.value}
        onChange={(e) => props.onChange(props.wholeNumber ? e.target.value.replace(/\D/g, '') : numberOnly(e.target.value))}
        placeholder={props.placeholder}
      />
    </label>
  )
}

/** A text box several lines tall. */
function TextBox(props: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="field" htmlFor={props.id}>
      {props.label}
      <textarea id={props.id} className="input" style={BOX} rows={3} value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={props.placeholder} />
    </label>
  )
}

// The pit form, for talking to a team in their pit before matches. The
// choices come from season.ts. Saving goes through savePitEntry() in
// data.ts, which keeps the entry on this device and sends it to the team
// database whenever there's a connection, the same way as match entries.
export default function PitForm() {
  const entries = usePitEntries()
  const [match, setMatch] = useState('')
  const [team, setTeam] = useState('')
  // '' until the scout chooses, so no button is pressed.
  const [drivetrain, setDrivetrain] = useState('')
  const [drivetrainOther, setDrivetrainOther] = useState('')
  const [vision, setVision] = useState<string[]>([])
  const [visionNotes, setVisionNotes] = useState('')
  const [weight, setWeight] = useState('')
  const [length, setLength] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [motors, setMotors] = useState('')
  const [autoSide, setAutoSide] = useState('')
  const [autoPath, setAutoPath] = useState('')
  const [partnersDo, setPartnersDo] = useState('')
  const [theyDo, setTheyDo] = useState('')

  function save(event: FormEvent) {
    event.preventDefault()
    const result = savePitEntry({
      team: Number(team),
      match: blankOrNumber(match),
      drivetrain,
      drivetrain_other: drivetrainOther,
      vision,
      vision_notes: visionNotes,
      weight: blankOrNumber(weight),
      length: blankOrNumber(length),
      width: blankOrNumber(width),
      height: blankOrNumber(height),
      motors,
      auto_side: autoSide,
      auto_path: autoPath,
      partners_do: partnersDo,
      they_do: theyDo,
    })
    if (!result.ok) {
      toast(result.error)
      return
    }
    // Ready for the next team.
    for (const clear of [setMatch, setTeam, setDrivetrain, setDrivetrainOther, setVisionNotes, setWeight, setLength, setWidth, setHeight, setMotors, setAutoSide, setAutoPath, setPartnersDo, setTheyDo]) clear('')
    setVision([])
    toast(`Saved pit entry for team ${result.value.team}.`)
  }

  return (
    <>
      <PageHead title="Pit form">
        Ask a team about their robot in their pit, before matches. Entries save on this device, so it works with no Wi-Fi, and send to the team by themselves once there's a connection.
      </PageHead>
      <form onSubmit={save}>
        <Panel>
          <FormSection title="Team" first>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <NumberBox id="pit-match" label="Match number" value={match} onChange={setMatch} placeholder="12" wholeNumber />
              <NumberBox id="pit-team" label="Team number" value={team} onChange={setTeam} placeholder="4096" wholeNumber />
            </div>
          </FormSection>
          <FormSection title="Robot">
            <div className="field">
              Drivetrain
              <Pick label="Drivetrain" options={DRIVETRAINS} value={drivetrain} onChange={setDrivetrain} />
            </div>
            {drivetrain === 'Other' && (
              <label className="field" htmlFor="pit-drivetrain-other">
                Which drivetrain?
                <input id="pit-drivetrain-other" className="input" style={BOX} value={drivetrainOther} onChange={(e) => setDrivetrainOther(e.target.value)} placeholder="Like: West coast with butterfly modules" />
              </label>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <NumberBox id="pit-weight" label="Weight (pounds)" value={weight} onChange={setWeight} placeholder="115" />
              <NumberBox id="pit-length" label="Length (inches)" value={length} onChange={setLength} placeholder="28" />
              <NumberBox id="pit-width" label="Width (inches)" value={width} onChange={setWidth} placeholder="28" />
              <NumberBox id="pit-height" label="Height (inches)" value={height} onChange={setHeight} placeholder="36" />
            </div>
            <TextBox id="pit-motors" label="Motors" value={motors} onChange={setMotors} placeholder="Like: 4 Kraken X60 on the drive, 2 NEO on the shooter" />
            <div className="field">
              What can their robot see? (choose all that fit)
              <PickMany label="What can their robot see" options={VISION} value={vision} onChange={setVision} />
            </div>
            <label className="field" htmlFor="pit-vision-notes">
              More about what it sees
              <input id="pit-vision-notes" className="input" style={BOX} value={visionNotes} onChange={(e) => setVisionNotes(e.target.value)} placeholder="Like: two cameras on the shooter" />
            </label>
          </FormSection>
          <FormSection title="Preferred auto">
            <div className="field">
              Starting side
              <Pick label="Starting side" options={AUTO_SIDES} value={autoSide} onChange={setAutoSide} />
            </div>
            <TextBox id="pit-auto-path" label="Path" value={autoPath} onChange={setAutoPath} placeholder="Where it drives and what it scores" />
          </FormSection>
          <FormSection title="Strategy">
            <TextBox id="pit-partners" label="What do they want their partners to do?" value={partnersDo} onChange={setPartnersDo} />
            <TextBox id="pit-they-do" label="What will they do?" value={theyDo} onChange={setTheyDo} />
            <div className="toolbar">
              <button type="submit" className="btn btn-lg btn-primary">Save Entry</button>
            </div>
          </FormSection>
        </Panel>
      </form>
      <SavedOnDevice
        rows={entries.map((e) => ({ id: e.id, label: <><TeamLink team={e.team} />{e.drivetrain ? ` · ${e.drivetrain === 'Other' && e.drivetrain_other ? e.drivetrain_other : e.drivetrain}` : ''}</>, created_at: e.created_at, synced: e.synced }))}
        emptyText="No pit entries yet. Fill in the form and press Save Entry."
      />
    </>
  )
}
