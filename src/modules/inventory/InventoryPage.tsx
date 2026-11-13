import { useEffect, useRef, useState, type FormEvent } from 'react'
import { plural, shortDate } from '../../core/format'
import { useMemberNames } from '../../core/members'
import { isMentor, useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { PageHead, Panel, Pill, Stepper } from '../../core/ui'
import {
  MAX_STOCK_NOTE_LENGTH,
  addItem,
  changeItem,
  changeStock,
  isLow,
  removeItem,
  useItems,
  useLowItems,
  useStockHistory,
  type Item,
} from './data'

// The page reads parts with a hook (useItems) and changes them with
// functions from data.ts. It never saves anything itself.
export default function InventoryPage() {
  const items = useItems()
  const lowItems = useLowItems()
  const { role } = useSession()
  const mentor = isMentor(role)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [stockId, setStockId] = useState<string | null>(null)
  const [lowOnly, setLowOnly] = useState(false)
  const shown = lowOnly ? lowItems : items
  const editing = items.find((item) => item.id === editingId)
  const stocking = items.find((item) => item.id === stockId)

  // One panel at a time, so the page doesn't fill with forms.
  function openStock(id: string) {
    setEditingId(null)
    setStockId(id)
  }
  function openEdit(id: string) {
    setStockId(null)
    setEditingId(id)
  }

  return (
    <>
      <PageHead title="Parts">
        Parts, where they live, and how many are left.
      </PageHead>
      {/* Anyone on the team can add parts, and take or add stock. Changing and deleting parts is for mentors. */}
      {adding && <AddItemForm onDone={() => setAdding(false)} />}
      {stocking && <StockForm key={stocking.id} item={stocking} onDone={() => setStockId(null)} />}
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
                  <th aria-label="Change" />
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name} {isLow(item) && <Pill tone="warn">Low</Pill>}</td>
                    <td>
                      <span className="note">{item.vendor}</span>
                      <br />
                      {item.vendor_part_number}
                      {/* The database only accepts https:// links here, so it's safe to open. */}
                      {item.link && (
                        <>
                          <br />
                          <a className="note" href={item.link} target="_blank" rel="noopener noreferrer">Product page ↗</a>
                        </>
                      )}
                    </td>
                    <td>{item.location}</td>
                    <td className="num">{item.quantity}</td>
                    <td className="num">
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <button type="button" className="btn btn-sm" aria-label={`Take or add ${item.name}`} onClick={() => openStock(item.id)}>Take / add</button>
                        {mentor && (
                          <button type="button" className="btn btn-sm" aria-label={`Edit ${item.name}`} onClick={() => openEdit(item.id)}>Edit</button>
                        )}
                      </span>
                    </td>
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
  const [link, setLink] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [lowStockLevel, setLowStockLevel] = useState(0)
  const [saving, setSaving] = useState(false)

  async function add(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = await addItem({
      name, vendor, vendor_part_number: vendorPartNumber, location, link, quantity, low_stock_level: lowStockLevel,
    })
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(`Added ${result.value.name}.`)
    setName('')
    setVendorPartNumber('')
    setLink('')
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
        <label className="field" htmlFor="item-link">
          Product link (optional): the vendor's page for it
          <input id="item-link" className="input" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
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

/** Take parts from the shelf or add them, and see who did before. Anyone on the team. */
function StockForm(props: { item: Item; onDone: () => void }) {
  const { item } = props
  const history = useStockHistory(item)
  const nameOf = useMemberNames()
  const [howMany, setHowMany] = useState(1)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Opened from a row further down the list: bring the form into view, clear of the top bar.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])

  async function change(by: number) {
    setSaving(true)
    const result = await changeStock(item, by, note)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(`${by < 0 ? 'Took' : 'Added'} ${Math.abs(by)} × ${item.name}. ${result.value.quantity} on the shelf.`)
    setHowMany(1)
    setNote('')
  }

  const big = { minHeight: 52, minWidth: 96, fontSize: 18 }

  return (
    <div ref={ref} style={{ scrollMarginTop: 160 }}>
      <Panel title={item.name} aside={<span className="note">{item.quantity} on the shelf · {item.location}</span>}>
        <div className="panel-body">
          <div className="field">
            How many
            <Stepper id="stock-how-many" label="How many" value={howMany} min={1} onChange={setHowMany} />
          </div>
          <label className="field" htmlFor="stock-note">
            Note (optional)
            <input id="stock-note" className="input" maxLength={MAX_STOCK_NOTE_LENGTH} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For the intake rebuild" />
          </label>
          <div className="toolbar">
            <button type="button" className="btn btn-lg btn-primary" style={big} disabled={saving} onClick={() => void change(-howMany)}>Take</button>
            <button type="button" className="btn btn-lg" style={big} disabled={saving} onClick={() => void change(howMany)}>Add</button>
            <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={props.onDone}>Done</button>
          </div>
        </div>
        {history.length === 0 ? (
          <p className="panel-body muted">No one has taken or added any yet.</p>
        ) : (
          <div className="row-list" aria-label={`History for ${item.name}`}>
            {history.map((c) => (
              <div key={c.id}>
                <span>
                  {nameOf(c.created_by)} {c.change < 0 ? 'took' : 'added'} {Math.abs(c.change)}
                  <br />
                  <span className="note">{shortDate(c.created_at)}{c.note && ` · ${c.note}`}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

/** Change a part's quantity, location and product link, or delete it. Mentors and admins only. */
function EditItemForm(props: { item: Item; onDone: () => void }) {
  const { item } = props
  const [quantity, setQuantity] = useState(item.quantity)
  const [location, setLocation] = useState(item.location)
  const [link, setLink] = useState(item.link ?? '')
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
    const result = await changeItem(item, { quantity, location, link })
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
          <label className="field" htmlFor="edit-item-link">
            Product link (optional)
            <input id="edit-item-link" className="input" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
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
