import { useEffect, useRef, useState, type FormEvent } from 'react'
import { plural } from '../../core/format'
import { isMentor, useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pill, Stepper } from '../../core/ui'
import { addItem, changeItem, isLow, removeItem, useItems, useLowItems, type Item } from './data'

// The page reads parts with a hook (useItems) and changes them with
// functions from data.ts. It never saves anything itself.
export default function InventoryPage() {
  const items = useItems()
  const lowItems = useLowItems()
  const { role } = useSession()
  const mentor = isMentor(role)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [lowOnly, setLowOnly] = useState(false)
  const shown = lowOnly ? lowItems : items
  const editing = items.find((item) => item.id === editingId)

  return (
    <>
      <PageHead title="Parts">
        Parts, where they live, and how many are left.
      </PageHead>
      {/* Anyone on the team can add parts. Changing and deleting them is for mentors. */}
      {adding && <AddItemForm onDone={() => setAdding(false)} />}
      {editing && mentor && <EditItemForm key={editing.id} item={editing} onDone={() => setEditingId(null)} />}
      <Panel
        title="All parts"
        aside={<span className="note">{plural(shown.length, 'part', 'parts')}</span>}
      >
        <div className="panel-body">
          <div className="toolbar">
            {!adding && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>Add a part</button>}
            <label className="check"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only</label>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="panel-body muted">No parts yet. Add the first one with the Add a part button.</p>
        ) : shown.length === 0 ? (
          <p className="panel-body muted">No parts are low right now.</p>
        ) : (
          // table-wrap lets the table scroll sideways inside its box on a phone, so the page doesn't.
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Part number</th>
                  <th>Location</th>
                  <th className="num">Qty</th>
                  {mentor && <th aria-label="Change" />}
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name} {isLow(item) && <Pill tone="warn">Low</Pill>}</td>
                    <td><span className="note">{item.vendor}</span><br />{item.vendor_part_number}</td>
                    <td>{item.location}</td>
                    <td className="num">{item.quantity}</td>
                    {mentor && (
                      <td className="num">
                        <button type="button" className="btn btn-sm" aria-label={`Edit ${item.name}`} onClick={() => setEditingId(item.id)}>Edit</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

/** The form for adding a part. */
function AddItemForm(props: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [vendor, setVendor] = useState('')
  const [vendorPartNumber, setVendorPartNumber] = useState('')
  const [location, setLocation] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [lowStockLevel, setLowStockLevel] = useState(0)
  const [saving, setSaving] = useState(false)

  async function add(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await addItem({
      name, vendor, vendor_part_number: vendorPartNumber, location, quantity, low_stock_level: lowStockLevel,
    })
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(`Added ${result.value.name}.`)
    setName('')
    setVendorPartNumber('')
    setQuantity(1)
    setLowStockLevel(0)
    // The vendor and location stay filled in, since parts often come in batches from one vendor to one bin.
  }

  return (
    <Panel title="Add a part">
      <form className="panel-body" onSubmit={add}>
        <label className="field" htmlFor="item-name">
          Name
          <input id="item-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="SPARK MAX" />
        </label>
        <label className="field" htmlFor="item-vendor">
          Vendor
          <input id="item-vendor" className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="REV" />
        </label>
        <label className="field" htmlFor="item-vendor-number">
          Vendor part number
          <input id="item-vendor-number" className="input mono" value={vendorPartNumber} onChange={(e) => setVendorPartNumber(e.target.value)} placeholder="REV-11-2158" />
        </label>
        <label className="field" htmlFor="item-location">
          Location (bin or shelf)
          <input id="item-location" className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bin E2" />
        </label>
        <div className="field">
          Quantity on the shelf
          <Stepper id="item-quantity" label="Quantity" value={quantity} onChange={setQuantity} />
        </div>
        <div className="field">
          Low at or below
          <Stepper id="item-low-stock" label="Low-stock level" value={lowStockLevel} onChange={setLowStockLevel} />
        </div>
        <div className="toolbar">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add part'}</button>
          <button type="button" className="btn" onClick={props.onDone}>Done</button>
        </div>
      </form>
    </Panel>
  )
}

/** Change a part's quantity and location, or delete it. Mentors and admins only. */
function EditItemForm(props: { item: Item; onDone: () => void }) {
  const { item } = props
  const [quantity, setQuantity] = useState(item.quantity)
  const [location, setLocation] = useState(item.location)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Opened from a row further down the list: bring the form into view, clear of the top bar.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await changeItem(item, { quantity, location })
    setSaving(false)
    toast(result.ok ? `Saved ${item.name}.` : result.error)
    if (result.ok) props.onDone()
  }

  async function remove() {
    // Deleting can't be undone, so it takes two presses.
    if (!deleting) {
      setDeleting(true)
      return
    }
    const result = await removeItem(item)
    toast(result.ok ? `Deleted ${item.name}.` : result.error)
    if (result.ok) props.onDone()
  }

  return (
    <div ref={ref} style={{ scrollMarginTop: 160 }}>
      <Panel title={`Change ${item.name}`}>
        <form className="panel-body" onSubmit={save}>
          <p className="note" style={{ margin: 0 }}>{item.vendor} · {item.vendor_part_number}</p>
          <label className="field" htmlFor="edit-item-location">
            Location (bin or shelf)
            <input id="edit-item-location" className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <div className="field">
            Quantity on the shelf
            <Stepper id="edit-item-quantity" label="Quantity" value={quantity} onChange={setQuantity} />
          </div>
          <div className="toolbar">
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn" onClick={props.onDone}>Cancel</button>
            <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => void remove()}>
              {deleting ? 'Press again to delete' : 'Delete'}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  )
}
