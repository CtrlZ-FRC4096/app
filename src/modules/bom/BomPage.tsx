import { useState, type FormEvent } from 'react'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pick, Pill, Stepper } from '../../core/ui'
import {
  PART_FILTERS, addPart, filterParts, kindLabel, nextPartNumber, partCountText, useParts, useRobots, useSystems,
  type BomSystem, type Part, type PartFilter, type PartKind,
} from './data'

// The page reads rows with hooks from data.ts and adds parts with addPart().
// It never saves anything itself.
export default function BomPage() {
  // There's one robot for now. A robot picker can come when there are more.
  const [robot] = useRobots()
  const systems = useSystems(robot?.id)
  const [systemName, setSystemName] = useState<string>()
  const system = systems.find((s) => s.name === systemName) ?? systems[0]
  const parts = useParts(system?.id)
  const [filter, setFilter] = useState<PartFilter>('All')
  const shown = filterParts(parts, filter)
  const [adding, setAdding] = useState(false)

  return (
    <>
      <PageHead eyebrow="BOM" title={robot?.name ?? 'Bill of materials'}>
        The parts in each system of the robot: what we make in the shop, and what we buy (COTS).
      </PageHead>
      {/* Anyone on the team can add parts. Changing and deleting them is for mentors. */}
      {system && adding && (
        <AddPartForm key={system.id} system={system} parts={parts} onDone={() => setAdding(false)} />
      )}
      {!system ? (
        <Panel>
          <p className="panel-body muted">No systems yet. A mentor can add them, or they'll come from Onshape.</p>
        </Panel>
      ) : (
        <Panel title={system.name} aside={<span className="note">{partCountText(parts)}</span>}>
          <div className="panel-body">
            <Pick label="System" options={systems.map((s) => s.name)} value={system.name} onChange={setSystemName} />
            <div className="toolbar">
              <Pick label="Show" options={[...PART_FILTERS]} value={filter} onChange={setFilter} />
              {!adding && (
                <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>Add a part</button>
              )}
            </div>
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
                    <tr key={p.id}>
                      <td>
                        <span className="mono" style={{ whiteSpace: 'nowrap' }}>{p.part_number}</span>
                        <br />
                        <Pill tone={p.kind === 'made' ? 'info' : 'plain'}>{kindLabel(p.kind)}</Pill>
                        {p.revision && <span className="note"> Rev {p.revision}</span>}
                      </td>
                      <td>
                        {p.name}
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

const KINDS: Record<string, PartKind> = { Made: 'made', COTS: 'cots' }

/** The form for adding a part to one system. `parts` are that system's parts. */
function AddPartForm(props: { system: BomSystem; parts: Part[]; onDone: () => void }) {
  const { system } = props
  const [kind, setKind] = useState<PartKind>('made')
  // Null until someone types one: until then, use the next free number.
  const [partNumber, setPartNumber] = useState<string | null>(null)
  const [name, setName] = useState('')
  // Null until someone types one: made parts start at revision A, COTS parts have none.
  const [revision, setRevision] = useState<string | null>(null)
  const shownRevision = revision ?? (kind === 'made' ? 'A' : '')
  const [material, setMaterial] = useState('')
  const [vendor, setVendor] = useState('')
  const [vendorPartNumber, setVendorPartNumber] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [saving, setSaving] = useState(false)
  const shownPartNumber = partNumber ?? nextPartNumber(system, props.parts)

  async function add(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await addPart({
      system_id: system.id, part_number: shownPartNumber, name, revision: shownRevision, kind, material, quantity, vendor, vendor_part_number: vendorPartNumber,
    })
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(`Added ${result.value.part_number}.`)
    setPartNumber(null)
    setName('')
    setRevision(null)
    setMaterial('')
    setVendor('')
    setVendorPartNumber('')
    setQuantity(1)
  }

  return (
    <Panel title={`Add a part to ${system.name}`}>
      <form className="panel-body" onSubmit={add}>
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
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add part'}</button>
          <button type="button" className="btn" onClick={props.onDone}>Done</button>
        </div>
      </form>
    </Panel>
  )
}
