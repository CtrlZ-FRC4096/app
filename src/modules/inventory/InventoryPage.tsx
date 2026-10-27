import { useState, type FormEvent } from 'react'
import { plural } from '../../core/format'
import { toast } from '../../core/toast'
import { PageHead, Panel, Stepper } from '../../core/ui'
import { addItem, useItems } from './data'

// The page reads parts with a hook (useItems) and adds them with addItem().
// It never saves anything itself.
export default function InventoryPage() {
  const items = useItems()
  const [adding, setAdding] = useState(false)

  return (
    <>
      <PageHead eyebrow="Inventory" title="Parts">
        Parts, where they live, and how many are left.
      </PageHead>
      {/* Anyone on the team can add parts. Changing and deleting them is for mentors. */}
      {adding && <AddItemForm onDone={() => setAdding(false)} />}
      <Panel
        title="All parts"
        aside={<span className="note">{plural(items.length, 'part', 'parts')}</span>}
      >
        {!adding && (
          <div className="panel-body">
            <div className="toolbar">
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>Add a part</button>
            </div>
          </div>
        )}
        {items.length === 0 ? (
          <p className="panel-body muted">No parts yet. Add the first one with the Add a part button.</p>
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
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td><span className="note">{item.vendor}</span><br />{item.vendor_part_number}</td>
                    <td>{item.location}</td>
                    <td className="num">{item.quantity}</td>
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
