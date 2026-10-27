import { useEffect, useRef, useState, type FormEvent } from 'react'
import { isMentor } from '../../core/roles'
import { useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pick, Pill, Stepper } from '../../core/ui'
import {
  PART_FILTERS, addPart, addRobot, addSystem, changePart, changeSystem, filterParts, kindLabel, nextPartNumber, partCountText,
  removePart, removeSystem, renameRobot, useParts, useRobots, useSystems,
  type BomSystem, type Part, type PartFilter, type PartKind, type Robot,
} from './data'

// The form open at the top of the page, if any. A null robot, system or
// part means adding a new one; otherwise it's the one being changed.
type Editing =
  | { form: 'robot'; robot: Robot | null }
  | { form: 'system'; system: BomSystem | null }
  | { form: 'part'; part: Part | null }

const INTRO = 'The parts in each system of the robot: what we make in the shop, and what we buy (COTS).'

// The page reads rows with hooks from data.ts and saves through its
// functions (addPart, changeSystem, ...). It never saves anything itself.
// Anyone on the team can add and change robots, systems and parts, and
// delete parts. Only mentors see Delete system: it deletes every part in it.
export default function BomPage() {
  const user = useSession()
  const robots = useRobots()
  const [robotId, setRobotId] = useState<string>()
  const robot = robots.find((r) => r.id === robotId) ?? robots[0]
  const systems = useSystems(robot?.id)
  const [systemId, setSystemId] = useState<string>()
  const system = systems.find((s) => s.id === systemId) ?? systems[0]
  const parts = useParts(system?.id)
  const [filter, setFilter] = useState<PartFilter>('All')
  const shown = filterParts(parts, filter)
  const [editing, setEditing] = useState<Editing | null>(null)
  const close = () => setEditing(null)

  if (!robot) {
    return (
      <>
        <PageHead eyebrow="BOM" title="Bill of materials">{INTRO}</PageHead>
        <RobotForm robot={null} intro="Start the BOM by naming the robot. Then add its systems, like Intake, and the parts in each." onDone={(saved) => saved && setRobotId(saved.id)} />
      </>
    )
  }

  return (
    <>
      <PageHead eyebrow="BOM" title={robot.name}>{INTRO}</PageHead>
      <div className="toolbar">
        {robots.length > 1 && (
          <Pick
            label="Robot"
            options={robots.map((r) => r.name)}
            value={robot.name}
            onChange={(name) => {
              setRobotId(robots.find((r) => r.name === name)?.id)
              setSystemId(undefined)
              close()
            }}
          />
        )}
        <button type="button" className="btn btn-sm" onClick={() => setEditing({ form: 'robot', robot })}>Rename robot</button>
        <button type="button" className="btn btn-sm" onClick={() => setEditing({ form: 'robot', robot: null })}>Add a robot</button>
        <button type="button" className="btn btn-sm" onClick={() => setEditing({ form: 'system', system: null })}>Add a system</button>
      </div>

      {editing?.form === 'robot' && (
        <RobotForm
          key={editing.robot?.id ?? 'new'}
          robot={editing.robot}
          onDone={(saved) => {
            if (saved && !editing.robot) {
              setRobotId(saved.id)
              setSystemId(undefined)
            }
            close()
          }}
        />
      )}
      {(editing?.form === 'system' || (!system && !editing)) && (
        <SystemForm
          key={editing?.form === 'system' ? (editing.system?.id ?? 'new') : 'first'}
          robot={robot}
          system={editing?.form === 'system' ? editing.system : null}
          partCount={editing?.form === 'system' && editing.system ? parts.length : 0}
          canCancel={editing?.form === 'system'}
          canDelete={isMentor(user.role)}
          onDone={(saved) => {
            if (saved) setSystemId(saved.id)
            close()
          }}
        />
      )}
      {editing?.form === 'part' && system && (
        <PartForm key={editing.part?.id ?? `new-${system.id}`} system={system} parts={parts} part={editing.part} onDone={close} />
      )}

      {!system ? (
        <Panel>
          <p className="panel-body muted">No systems in {robot.name} yet. Add one above, or they'll come from Onshape later.</p>
        </Panel>
      ) : (
        <Panel title={system.name} aside={<span className="note">{partCountText(parts)}</span>}>
          <div className="panel-body">
            <Pick
              label="System"
              options={systems.map((s) => s.name)}
              value={system.name}
              onChange={(name) => {
                setSystemId(systems.find((s) => s.name === name)?.id)
                if (editing?.form !== 'robot') close()
              }}
            />
            <div className="toolbar">
              <Pick label="Show" options={[...PART_FILTERS]} value={filter} onChange={setFilter} />
              <button type="button" className="btn btn-sm" onClick={() => setEditing({ form: 'system', system })}>Change system</button>
              {/* The database only accepts https:// links here, so it's safe to open. */}
              {system.onshape_url && <a href={system.onshape_url} target="_blank" rel="noopener noreferrer">Open in Onshape</a>}
              {!(editing?.form === 'part' && !editing.part) && (
                <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setEditing({ form: 'part', part: null })}>Add a part</button>
              )}
            </div>
            {shown.length > 0 && <p className="note">Choose a part's name to change or delete it.</p>}
          </div>
          {shown.length === 0 ? (
            <p className="panel-body muted">
              {parts.length === 0 ? `No parts in ${system.name} yet.` : `No ${kindLabel(filter === 'Made' ? 'made' : 'cots')} parts in ${system.name}. Pick All to see every part.`}
            </p>
          ) : (
            // Three columns, so the table fits on a phone. The revision and
            // the Made / COTS pill sit under the part number, and the
            // material (or vendor) under the name.
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Part number</th>
                    <th>Part</th>
                    <th className="num">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id} aria-selected={editing?.form === 'part' && editing.part?.id === p.id}>
                      <td>
                        <span className="mono" style={{ whiteSpace: 'nowrap' }}>{p.part_number}</span>
                        <br />
                        <Pill tone={p.kind === 'made' ? 'info' : 'plain'}>{kindLabel(p.kind)}</Pill>
                        {p.revision && <span className="note"> Rev {p.revision}</span>}
                      </td>
                      <td>
                        <button type="button" className="name-btn" onClick={() => setEditing({ form: 'part', part: p })}>{p.name}</button>
                        <br />
                        <span className="note">{p.kind === 'made' ? p.material : [p.vendor, p.vendor_part_number].filter(Boolean).join(' · ')}</span>
                      </td>
                      <td className="num">{p.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </>
  )
}

/** Put the cursor in a form's first box when it opens, which also scrolls it into view. */
function useFocusOnOpen() {
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [])
  return ref
}

/** Name a new robot, or rename one. */
function RobotForm(props: { robot: Robot | null; intro?: string; onDone: (saved: Robot | null) => void }) {
  const [name, setName] = useState(props.robot?.name ?? '')
  const [saving, setSaving] = useState(false)
  const form = useFocusOnOpen()

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = props.robot ? await renameRobot(props.robot, name) : await addRobot(name)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(props.robot ? 'Renamed.' : `Added ${result.value.name}.`)
    props.onDone(result.value)
  }

  return (
    <Panel title={props.robot ? `Rename ${props.robot.name}` : 'Add a robot'}>
      <form ref={form} className="panel-body" onSubmit={save}>
        {props.intro && <p className="muted">{props.intro}</p>}
        <label className="field" htmlFor="robot-name">
          Robot name
          <input id="robot-name" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="2027 competition robot" />
        </label>
        <div className="toolbar">
          <button type="submit" className="btn btn-primary" disabled={saving}>{props.robot ? 'Save' : 'Add robot'}</button>
          {!props.intro && <button type="button" className="btn" onClick={() => props.onDone(null)}>Cancel</button>}
        </div>
      </form>
    </Panel>
  )
}

/** Add a system to a robot, or change one. Mentors can also delete it, with its parts. */
function SystemForm(props: {
  robot: Robot
  system: BomSystem | null
  partCount: number
  canCancel: boolean
  canDelete: boolean
  onDone: (saved: BomSystem | null) => void
}) {
  const { system } = props
  const [name, setName] = useState(system?.name ?? '')
  const [code, setCode] = useState(system?.code ?? '')
  const [link, setLink] = useState(system?.onshape_url ?? '')
  const [saving, setSaving] = useState(false)
  const form = useFocusOnOpen()

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const fields = { name, code, onshape_url: link }
    const result = system ? await changeSystem(system, fields) : await addSystem(props.robot.id, fields)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(system ? 'Saved.' : `Added ${result.value.name}.`)
    props.onDone(result.value)
  }

  async function remove() {
    if (!system) return
    const parts = props.partCount === 1 ? '1 part' : `${props.partCount} parts`
    if (!window.confirm(`Delete ${system.name} and its ${parts}? This can't be undone.`)) return
    const result = await removeSystem(system)
    toast(result.ok ? `Deleted ${system.name}.` : result.error)
    if (result.ok) props.onDone(null)
  }

  return (
    <Panel title={system ? `Change ${system.name}` : `Add a system to ${props.robot.name}`}>
      <form ref={form} className="panel-body" onSubmit={save}>
        <label className="field" htmlFor="system-name">
          Name
          <input id="system-name" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Intake" />
        </label>
        <label className="field" htmlFor="system-code">
          Code: 2 to 4 letters, used in part numbers{system && ' (parts already numbered keep their numbers)'}
          <input id="system-code" className="input mono" value={code} maxLength={4} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="INT" />
        </label>
        <label className="field" htmlFor="system-link">
          Onshape link (optional)
          <input id="system-link" className="input" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://cad.onshape.com/documents/..." />
        </label>
        <div className="toolbar">
          <button type="submit" className="btn btn-primary" disabled={saving}>{system ? 'Save' : 'Add system'}</button>
          {props.canCancel && <button type="button" className="btn" onClick={() => props.onDone(null)}>Cancel</button>}
          {system && props.canDelete && (
            <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => void remove()}>Delete system</button>
          )}
        </div>
      </form>
    </Panel>
  )
}

const KINDS: Record<string, PartKind> = { Made: 'made', COTS: 'cots' }

/** The form for adding a part to one system, or changing one. `parts` are that system's parts. */
function PartForm(props: { system: BomSystem; parts: Part[]; part: Part | null; onDone: () => void }) {
  const { system, part } = props
  const [kind, setKind] = useState<PartKind>(part?.kind ?? 'made')
  // Null until someone types one: until then, use the next free number.
  const [partNumber, setPartNumber] = useState<string | null>(part?.part_number ?? null)
  const [name, setName] = useState(part?.name ?? '')
  // Null until someone types one: made parts start at revision A, COTS parts have none.
  const [revision, setRevision] = useState<string | null>(part ? (part.revision ?? '') : null)
  const shownRevision = revision ?? (kind === 'made' ? 'A' : '')
  const [material, setMaterial] = useState(part?.material ?? '')
  const [vendor, setVendor] = useState(part?.vendor ?? '')
  const [vendorPartNumber, setVendorPartNumber] = useState(part?.vendor_part_number ?? '')
  const [quantity, setQuantity] = useState(part?.quantity ?? 1)
  const [saving, setSaving] = useState(false)
  const shownPartNumber = partNumber ?? nextPartNumber(system, props.parts)
  const form = useFocusOnOpen()

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const fields = {
      system_id: system.id, part_number: shownPartNumber, name, revision: shownRevision, kind, material, quantity, vendor, vendor_part_number: vendorPartNumber,
    }
    const result = part ? await changePart(part, fields) : await addPart(fields)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    if (part) {
      toast(`Saved ${result.value.part_number}.`)
      props.onDone()
      return
    }
    // Stay open, ready for the next part.
    toast(`Added ${result.value.part_number}.`)
    setPartNumber(null)
    setName('')
    setRevision(null)
    setMaterial('')
    setVendor('')
    setVendorPartNumber('')
    setQuantity(1)
  }

  async function remove() {
    if (!part || !window.confirm(`Delete ${part.part_number} ${part.name}?`)) return
    const result = await removePart(part)
    toast(result.ok ? `Deleted ${part.part_number}.` : result.error)
    if (result.ok) props.onDone()
  }

  return (
    <Panel title={part ? `Change ${part.part_number}` : `Add a part to ${system.name}`}>
      <form ref={form} className="panel-body" onSubmit={save}>
        <Pick label="Made or COTS" options={Object.keys(KINDS)} value={kindLabel(kind)} onChange={(label) => setKind(KINDS[label])} />
        <label className="field" htmlFor="part-number">
          Part number
          <input id="part-number" className="input mono" value={shownPartNumber} onChange={(e) => setPartNumber(e.target.value)} />
        </label>
        <label className="field" htmlFor="part-name">
          Name
          <input id="part-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'made' ? 'Side plate' : 'Brushless motor'} />
        </label>
        <label className="field" htmlFor="part-revision">
          Revision (optional)
          <input id="part-revision" className="input" value={shownRevision} onChange={(e) => setRevision(e.target.value)} />
        </label>
        {kind === 'made' ? (
          <label className="field" htmlFor="part-material">
            Material
            <input id="part-material" className="input" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="6061 aluminum, 1/4 in plate" />
          </label>
        ) : (
          <>
            <label className="field" htmlFor="part-vendor">
              Vendor
              <input id="part-vendor" className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="WCP" />
            </label>
            <label className="field" htmlFor="part-vendor-number">
              Vendor part number (optional)
              <input id="part-vendor-number" className="input" value={vendorPartNumber} onChange={(e) => setVendorPartNumber(e.target.value)} />
            </label>
          </>
        )}
        <div className="field">
          Quantity
          <Stepper id="part-quantity" label="Quantity" min={1} value={quantity} onChange={setQuantity} />
        </div>
        <div className="toolbar">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : part ? 'Save' : 'Add part'}</button>
          <button type="button" className="btn" onClick={props.onDone}>{part ? 'Cancel' : 'Done'}</button>
          {part && <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => void remove()}>Delete part</button>}
        </div>
      </form>
    </Panel>
  )
}
