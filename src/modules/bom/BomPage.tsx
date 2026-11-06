import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import { plural, shortDate } from '../../core/format'
import { isMentor } from '../../core/roles'
import { useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pick, Pill, Stepper } from '../../core/ui'
import {
  PART_FILTERS, addPart, addRobot, addSystem, applyOnshapeImport, changePart, changeSystem, filterParts, getOnshapeBom, kindLabel,
  nextPartNumber, partCountText, removePart, removeSystem, renameRobot, shelfText, useParts, useRobots, useSystems,
  type BomSystem, type Part, type PartFilter, type PartKind, type Robot,
} from './data'
import {
  MACHINES, MACHINE_NAMES, STAGES, STAGE_HINTS, STAGE_NAMES, STATUS_NAMES, addStep, advance, changeDone, isProcess, moveBack, removeStep,
  stationName, stationQueue, stepName, stepsFor, useSteps, type Machine, type Stage, type Station, type Step,
} from './data'
import { planImport, type OnshapeImportPlan } from './onshape'
import { href } from '../../core/router'
import { useItems, type Item } from '../inventory/data'
import { arrivalText, isLate, statusOf, useRequestsByBomPart, type PurchaseItem } from '../purchasing/data'
import { camStockFor, markReadyToCam, shapesTable, useOnBoard, useStock, type CamStock } from '../cnc/data'
// The CNC module's material and thickness picker, so flagging a part looks the same here and on the CNC board.
import { CamStockPicker } from '../cnc/CamStockPicker'

// The form open at the top of the page, if any. A null robot, system or
// part means adding a new one; otherwise it's the one being changed.
type Editing =
  | { form: 'robot'; robot: Robot | null }
  | { form: 'system'; system: BomSystem | null }
  | { form: 'part'; part: Part | null }
  | { form: 'cnc'; part: Part }
  | { form: 'stages'; part: Part }

const INTRO = 'The parts in each system of the robot: what we make in the shop, and what we buy (COTS).'

// The page reads rows with hooks from data.ts and saves through its
// functions (addPart, changeSystem, ...). It never saves anything itself.
// Anyone on the team can add and change robots, systems and parts, and
// delete parts, and add, remove and move along stages. Only mentors see
// Delete system: it deletes every part in it.
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
  const steps = useSteps()
  const [station, setStation] = useState<Station>({ kind: 'all' })
  const queue = stationQueue(parts, steps, station)
  // At one station, only the parts waiting there, with only their stages there.
  const shown = station.kind === 'all' ? filterParts(parts, filter) : queue.map((q) => q.part)
  const stagesShown = (p: Part) => (station.kind === 'all' ? stepsFor(p, steps) : (queue.find((q) => q.part.id === p.id)?.steps ?? []))
  const [editing, setEditing] = useState<Editing | null>(null)
  const close = () => setEditing(null)
  // An import from Onshape waiting to be confirmed, and whether Onshape is being read.
  const [importing, setImporting] = useState<{ system: BomSystem; plan: OnshapeImportPlan } | null>(null)
  const [reading, setReading] = useState(false)
  const onBoard = useOnBoard()
  // Each COTS part's request in Purchasing, if it has one.
  const requests = useRequestsByBomPart()
  // Inventory's parts, to show how many of each COTS part are on the shelf.
  const items = useItems()

  async function readOnshape(s: BomSystem) {
    setReading(true)
    const answer = await getOnshapeBom(s)
    setReading(false)
    if (!answer.ok) {
      toast(answer.error)
      return
    }
    close()
    setImporting({ system: s, plan: planImport(s, answer.value) })
  }

  if (!robot) {
    return (
      <>
        <PageHead title="Bill of materials">{INTRO}</PageHead>
        <RobotForm robot={null} intro="Start the BOM by naming the robot. Then add its systems, like Intake, and the parts in each." onDone={(saved) => saved && setRobotId(saved.id)} />
      </>
    )
  }

  return (
    <>
      <PageHead title={robot.name}>{INTRO}</PageHead>
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
      {editing?.form === 'cnc' && <CncForm key={editing.part.id} part={editing.part} onDone={close} />}
      {editing?.form === 'stages' && <StagesForm key={editing.part.id} part={editing.part} steps={stepsFor(editing.part, steps)} onDone={close} />}
      {importing && importing.system.id === system?.id && (
        <ImportPreview system={importing.system} plan={importing.plan} onDone={() => setImporting(null)} />
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
              {station.kind === 'all' && <Pick label="Show" options={[...PART_FILTERS]} value={filter} onChange={setFilter} />}
              <StationPicker value={station} onChange={setStation} />
              <button type="button" className="btn btn-sm" onClick={() => setEditing({ form: 'system', system })}>Change system</button>
              {system.onshape_url && (
                <button type="button" className="btn btn-sm" disabled={reading} onClick={() => void readOnshape(system)}>
                  {reading ? 'Reading Onshape…' : 'Import from Onshape'}
                </button>
              )}
              {/* The database only accepts https:// links here, so it's safe to open. */}
              {system.onshape_url && <a href={system.onshape_url} target="_blank" rel="noopener noreferrer">Open in Onshape</a>}
              {!(editing?.form === 'part' && !editing.part) && (
                <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setEditing({ form: 'part', part: null })}>Add a part</button>
              )}
            </div>
            <p className="note">
              {system.onshape_url
                ? system.onshape_imported_at
                  ? `Last imported from Onshape ${shortDate(system.onshape_imported_at)}. `
                  : 'Not imported from Onshape yet. '
                : "To import this system's parts from Onshape, add its assembly's link with Change system. "}
              {shown.length > 0 && "Choose a part's name to change or delete it."}
            </p>
          </div>
          {shown.length === 0 ? (
            <p className="panel-body muted">
              {parts.length === 0
                ? `No parts in ${system.name} yet.`
                : station.kind !== 'all'
                  ? `Nothing in ${system.name} is waiting for ${station.kind === 'machine' ? `the ${MACHINE_NAMES[station.machine]}` : STAGE_NAMES[station.stage].toLowerCase()}. Pick Every stage to see every part.`
                  : `No ${kindLabel(filter === 'Made' ? 'made' : 'cots')} parts in ${system.name}. Pick All to see every part.`}
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
                  {shown.map((p) => {
                    // Made parts get a second row with their stages, the table's full width.
                    const hasStages = p.kind === 'made' && !p.removed_in_onshape
                    const under = hasStages ? { borderBottom: 0 } : undefined
                    return (
                      <Fragment key={p.id}>
                        <tr aria-selected={editing?.form === 'part' && editing.part?.id === p.id}>
                          <td style={under}>
                            <span className="mono" style={{ whiteSpace: 'nowrap' }}>{p.part_number}</span>
                            <br />
                            <Pill tone={p.kind === 'made' ? 'info' : 'plain'}>{kindLabel(p.kind)}</Pill>
                            {p.revision && <span className="note"> Rev {p.revision}</span>}
                          </td>
                          <td style={under}>
                            <button type="button" className="name-btn" onClick={() => setEditing({ form: 'part', part: p })}>{p.name}</button>
                            {p.removed_in_onshape && <> <Pill tone="warn">Removed in Onshape</Pill></>}
                            <br />
                            <span className="note">
                              {p.kind === 'made' ? p.material : [p.vendor, p.vendor_part_number].filter(Boolean).join(' · ')}
                              {/* The database only accepts https:// links here, so it's safe to open. */}
                              {p.onshape_url && <>{(p.material || p.vendor || p.vendor_part_number) && ' · '}<a href={p.onshape_url} target="_blank" rel="noopener noreferrer">CAD</a></>}
                            </span>
                            {p.kind === 'made' && !p.removed_in_onshape && (
                              <>
                                <br />
                                <span className="note">
                                  {onBoard.get(p.id) ? `${onBoard.get(p.id)} on the CNC board · ` : ''}
                                  <button type="button" className="link-btn" onClick={() => setEditing({ form: 'cnc', part: p })}>Ready to CAM</button>
                                </span>
                              </>
                            )}
                            {p.kind === 'cots' && !p.removed_in_onshape && <Shelf part={p} items={items} />}
                            {p.kind === 'cots' && !p.removed_in_onshape && <PurchaseStatus part={p} request={requests.get(p.id)} />}
                          </td>
                          <td className="num" style={under}>{p.quantity}</td>
                        </tr>
                        {hasStages && (
                          <tr>
                            <td colSpan={3} style={{ paddingTop: 0 }}>
                              <StageList
                                part={p}
                                steps={stagesShown(p)}
                                canChange={station.kind === 'all'}
                                onChange={() => setEditing({ form: 'stages', part: p })}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </>
  )
}

/** What an import from Onshape will change, to check before anything is saved. */
function ImportPreview(props: { system: BomSystem; plan: OnshapeImportPlan; onDone: () => void }) {
  const { system, plan } = props
  const [saving, setSaving] = useState(false)
  const changed = plan.change.filter((c) => c.what.length > 0)
  const nothing = plan.add.length === 0 && plan.change.length === 0 && plan.removed.length === 0
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), [])

  async function apply() {
    setSaving(true)
    const result = await applyOnshapeImport(system, plan)
    setSaving(false)
    toast(result.ok ? result.value : result.error)
    if (result.ok) props.onDone()
  }

  return (
    <div ref={ref}>
      <Panel title={`Import ${system.name} from Onshape`} aside={<span className="note">From {plan.source}</span>}>
        {nothing ? (
          <p className="panel-body muted">Everything already matches Onshape. There's nothing to import.</p>
        ) : (
          <ul className="goal-list">
            {plan.add.length > 0 && (
              <li>
                Add {plural(plan.add.length, 'part', 'parts')}: {plan.add.map((p) => `${p.name} (${p.quantity})`).join(', ')}
              </li>
            )}
            {changed.map((c) => (
              <li key={c.part.id}>
                Change {c.part.name}: {c.what.join(', ')}
              </li>
            ))}
            {plan.removed.length > 0 && (
              <li>
                Mark {plural(plan.removed.length, 'part', 'parts')} as removed in Onshape (they stay in the list):{' '}
                {plan.removed.map((p) => p.name).join(', ')}
              </li>
            )}
            {plan.unchanged > 0 && <li>{plural(plan.unchanged, 'part already matches', 'parts already match')}</li>}
          </ul>
        )}
        <div className="panel-body toolbar">
          {!nothing && (
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void apply()}>
              {saving ? 'Importing…' : 'Import'}
            </button>
          )}
          <button type="button" className="btn" onClick={props.onDone}>{nothing ? 'Close' : 'Cancel'}</button>
        </div>
      </Panel>
    </div>
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
        {part?.onshape_id && (
          <p className="note">From Onshape: importing again sets its name, number, quantity and material back to what Onshape has. Change them in CAD to keep them.</p>
        )}
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

/** Flag a made part ready to CAM on the CNC board: how many, and what it's cut from (guessed from its material and its shape in Onshape). */
function CncForm(props: { part: Part; onDone: () => void }) {
  const { part } = props
  const stocks = useStock()
  const shape = shapesTable.useRows().find((s) => s.part_id === part.id)
  const [quantity, setQuantity] = useState(part.quantity)
  const [cutFrom, setCutFrom] = useState<CamStock>(() => camStockFor(part, shape, stocks))
  const [saving, setSaving] = useState(false)
  const form = useFocusOnOpen()

  async function flag(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await markReadyToCam(part, quantity, cutFrom)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(result.value.added ? `Flagged ${part.name} ×${quantity} ready to CAM.` : `${part.name} was already waiting for CAM: now ${result.value.job.quantity}.`)
    props.onDone()
  }

  return (
    <Panel title={`${part.name}: ready to CAM`}>
      <form ref={form} className="panel-body" onSubmit={flag}>
        <p className="note">{part.material ? `${part.material}.` : 'No material in the BOM yet.'} The robot needs {part.quantity}. It goes on the CNC board.</p>
        <div className="field">
          How many to cut
          <Stepper id="cnc-quantity" label="How many to cut" min={1} value={quantity} onChange={setQuantity} />
        </div>
        <CamStockPicker id="cnc-cut-from" value={cutFrom} onChange={setCutFrom} />
        <div className="toolbar">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Flagging…' : 'Ready to CAM'}</button>
          <button type="button" className="btn" onClick={props.onDone}>Cancel</button>
        </div>
      </form>
    </Panel>
  )
}

const STATUS_TONES = { todo: 'plain', in_progress: 'info', done: 'ok' } as const

/** The station filter: every stage, or one stage's or one machine's queue. */
function StationPicker(props: { value: Station; onChange: (station: Station) => void }) {
  const encode = (s: Station) => (s.kind === 'stage' ? `stage:${s.stage}` : s.kind === 'machine' ? `machine:${s.machine}` : 'all')
  const stations: Station[] = [
    { kind: 'all' },
    ...STAGES.filter((stage) => !isProcess(stage)).map((stage): Station => ({ kind: 'stage', stage })),
    ...MACHINES.map((machine): Station => ({ kind: 'machine', machine })),
  ]
  return (
    <select
      className="input"
      aria-label="Station"
      value={encode(props.value)}
      onChange={(e) => props.onChange(stations.find((s) => encode(s) === e.target.value) ?? { kind: 'all' })}
    >
      {stations.map((s) => <option key={encode(s)} value={encode(s)}>{stationName(s)}</option>)}
    </select>
  )
}

/** How many of a COTS part Inventory has and where, and whether that's enough for this line. */
function Shelf(props: { part: Part; items: Item[] }) {
  const shelf = shelfText(props.part, props.items)
  if (!shelf) return null
  return (
    <>
      <br />
      <span className="note">{shelf.text}</span>{' '}
      {shelf.short > 0 ? <Pill tone="warn">Short {shelf.short}</Pill> : <Pill tone="ok">Enough</Pill>}
    </>
  )
}

/** A made part's stages: each one's status, how many are through it, and buttons to move it along. */
/**
 * A COTS part's order, from Purchasing: its status, which opens the request
 * there, or a Purchase button that opens a request filled in from the part.
 */
function PurchaseStatus(props: { part: Part; request: PurchaseItem | undefined }) {
  const { request } = props
  const status = request && statusOf(request.status)
  return (
    <span className="toolbar" style={{ marginTop: 6 }}>
      {request && status ? (
        <>
          <Pill tone={status.tone}>{status.label}</Pill>
          {isLate(request) && <Pill tone="warn">Late</Pill>}
          {arrivalText(request) && <span className="note">{arrivalText(request)}</span>}
          <a className="btn btn-sm" href={href('purchasing', 'item', request.id)}>Open in Purchasing</a>
        </>
      ) : (
        <a className="btn btn-sm" href={href('purchasing', 'from-bom', props.part.id)}>Purchase</a>
      )}
    </span>
  )
}

function StageList(props: { part: Part; steps: Step[]; canChange: boolean; onChange: () => void }) {
  const { part } = props

  async function run(action: Promise<{ ok: true } | { ok: false; error: string }>) {
    const result = await action
    if (!result.ok) toast(result.error)
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {/* Two columns, so the buttons line up and fit on a phone: the stage on the left, its buttons on the right. */}
      {props.steps.map((s) => (
        <div key={s.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 8 }}>
          <span>
            <Pill tone={STATUS_TONES[s.status]}>{stepName(s)}</Pill>
            <br />
            <span className="note">{STATUS_NAMES[s.status]} · {Math.min(s.quantity_done, part.quantity)} of {part.quantity}</span>
          </span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn" style={{ minWidth: 40 }} aria-label={`${stepName(s)}: one fewer done`} onClick={() => void run(changeDone(s, -1))}>−</button>
            <button type="button" className="btn" style={{ minWidth: 40 }} aria-label={`${stepName(s)}: one more done`} onClick={() => void run(changeDone(s, 1))}>+</button>
            <button type="button" className="btn" style={{ minWidth: 96 }} onClick={() => void run(s.status === 'done' ? moveBack(s) : advance(s))}>
              {s.status === 'todo' ? 'Start' : s.status === 'in_progress' ? 'Mark done' : 'Undo'}
            </button>
          </span>
        </div>
      ))}
      <span className="note">
        {props.steps.length === 0 && 'No stages yet. '}
        {props.canChange && (
          <button type="button" className="link-btn" onClick={props.onChange}>{props.steps.length ? 'Change stages' : 'Add stages'}</button>
        )}
      </span>
    </div>
  )
}

/** Choose which stages a made part goes through, and the machine for each process stage. */
function StagesForm(props: { part: Part; steps: Step[]; onDone: () => void }) {
  const { part, steps } = props
  const has = (stage: Stage) => steps.find((s) => s.stage === stage)
  const [chosen, setChosen] = useState<Set<Stage>>(() => new Set(steps.map((s) => s.stage)))
  const [machines, setMachines] = useState<Record<string, Machine>>(() =>
    Object.fromEntries(steps.filter((s) => s.machine).map((s) => [s.stage, s.machine!])),
  )
  const [saving, setSaving] = useState(false)

  function toggle(stage: Stage) {
    const next = new Set(chosen)
    if (next.has(stage)) next.delete(stage)
    else next.add(stage)
    setChosen(next)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const noMachine = STAGES.find((stage) => isProcess(stage) && chosen.has(stage) && !machines[stage])
    if (noMachine) return toast(`Pick the machine for ${STAGE_NAMES[noMachine]}.`)
    // A stage whose machine changed is removed and added again, starting over.
    const keep = (s: Step) => chosen.has(s.stage) && (!s.machine || s.machine === machines[s.stage])
    const removing = steps.filter((s) => !keep(s))
    const adding = STAGES.filter((stage) => chosen.has(stage) && !steps.some((s) => keep(s) && s.stage === stage))
    const losing = removing.filter((s) => s.quantity_done > 0 || s.status !== 'todo')
    if (losing.length && !window.confirm(`This clears the progress on ${losing.map(stepName).join(', ')}. Go ahead?`)) return
    setSaving(true)
    for (const s of removing) {
      const result = await removeStep(s)
      if (!result.ok) return finish(result.error)
    }
    for (const stage of adding) {
      const result = await addStep(part, stage, isProcess(stage) ? (machines[stage] ?? null) : null)
      if (!result.ok) return finish(result.error)
    }
    finish(`Saved ${part.name}'s stages.`, true)
  }

  function finish(message: string, done = false) {
    setSaving(false)
    toast(message)
    if (done) props.onDone()
  }

  return (
    <Panel title={`${part.name}: stages`}>
      <form className="panel-body" onSubmit={save}>
        <p className="note">Tick the stages this part goes through. A part only needs the ones it has.</p>
        {STAGES.map((stage) => (
          <div key={stage} className="field">
            <label className="check">
              <input type="checkbox" checked={chosen.has(stage)} onChange={() => toggle(stage)} />
              {STAGE_NAMES[stage]} <span className="note">({STAGE_HINTS[stage]}{has(stage) ? `, ${STATUS_NAMES[has(stage)!.status].toLowerCase()}` : ''})</span>
            </label>
            {isProcess(stage) && chosen.has(stage) && (
              <select
                className="input"
                aria-label={`Machine for ${STAGE_NAMES[stage]}`}
                value={machines[stage] ?? ''}
                onChange={(e) => setMachines({ ...machines, [stage]: e.target.value as Machine })}
              >
                <option value="" disabled>Pick the machine</option>
                {MACHINES.map((m) => <option key={m} value={m}>{MACHINE_NAMES[m]}</option>)}
              </select>
            )}
          </div>
        ))}
        <div className="toolbar">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save stages'}</button>
          <button type="button" className="btn" onClick={props.onDone}>Cancel</button>
        </div>
      </form>
    </Panel>
  )
}
