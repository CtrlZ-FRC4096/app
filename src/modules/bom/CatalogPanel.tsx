// The catalog of bought parts on the BOM page (#20): the catalog's name under
// a COTS line, the form to add or change an entry, and the list of entries.
// Like the rest of the page, it reads rows with hooks and saves through the
// functions in catalog.ts. It never saves anything itself.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { plural } from '../../core/format'
import { toast } from '../../core/toast'
import { Panel } from '../../core/ui'
import {
  addCatalogEntry, changeCatalogEntry, entryFromPart, removeCatalogEntry, useCatalog,
  type CatalogEntry, type NewCatalogEntry,
} from './catalog'
import type { Part } from './data'

/** Under a COTS line that's in the catalog: the catalog's name for it. Its link to buy is the line's Product page button. */
export function CatalogName(props: { entry: CatalogEntry | undefined }) {
  if (!props.entry) return null
  return (
    <>
      <br />
      <span className="note">Catalog: {props.entry.name}</span>
    </>
  )
}

/**
 * Add an entry to the catalog, filled in from a BOM line (`part`), or change
 * one (`entry`), which can also be deleted. Student leaders, mentors and admins only.
 */
export function CatalogForm(props: { part: Part | null; entry: CatalogEntry | null; onDone: () => void }) {
  const { part, entry } = props
  const [fields, setFields] = useState<NewCatalogEntry>(() =>
    entry ?? (part ? entryFromPart(part) : { vendor: '', vendor_part_number: '', name: '', product_url: '' }),
  )
  const [saving, setSaving] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  // Put the cursor in the first box. Braces, so the effect returns nothing (#173).
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
  }, [])
  const set = (field: keyof NewCatalogEntry) => (e: { target: { value: string } }) => setFields({ ...fields, [field]: e.target.value })

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = entry ? await changeCatalogEntry(entry, fields) : await addCatalogEntry(fields)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(entry ? `Saved ${result.value.name}.` : `Added ${result.value.name} to the catalog.`)
    props.onDone()
  }

  async function remove() {
    if (!entry || !window.confirm(`Delete ${entry.name} from the catalog? BOM lines stay, without its name and link.`)) return
    const result = await removeCatalogEntry(entry)
    toast(result.ok ? `Deleted ${entry.name} from the catalog.` : result.error)
    if (result.ok) props.onDone()
  }

  return (
    <Panel title={entry ? `Change ${entry.name}` : 'Add to the catalog'}>
      <form ref={form} className="panel-body" onSubmit={save}>
        <p className="note">
          The catalog keeps each bought part's name and a link to buy it, for every season. A COTS line from the same vendor with the same vendor part number shows them.
        </p>
        <label className="field" htmlFor="catalog-vendor">
          Vendor
          <input id="catalog-vendor" className="input" value={fields.vendor} maxLength={100} onChange={set('vendor')} placeholder="REV Robotics" />
        </label>
        <label className="field" htmlFor="catalog-number">
          Vendor part number
          <input id="catalog-number" className="input mono" value={fields.vendor_part_number} maxLength={100} onChange={set('vendor_part_number')} placeholder="REV-21-1650" />
        </label>
        <label className="field" htmlFor="catalog-name">
          Name, the way the vendor's page has it
          <input id="catalog-name" className="input" value={fields.name} maxLength={100} onChange={set('name')} />
        </label>
        <label className="field" htmlFor="catalog-link">
          Link to buy it
          <input id="catalog-link" className="input" type="url" value={fields.product_url} onChange={set('product_url')} placeholder="https://..." />
        </label>
        <div className="toolbar">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : entry ? 'Save' : 'Add to catalog'}</button>
          <button type="button" className="btn" onClick={props.onDone}>Cancel</button>
          {entry && <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => void remove()}>Delete entry</button>}
        </div>
      </form>
    </Panel>
  )
}

/**
 * Every entry in the catalog, by vendor, each with its link to buy it. Hidden
 * until someone opens it, because it grows every season. Student leaders and
 * mentors (`canEdit`) can tap a name to change it, or add one by hand.
 */
export function CatalogList(props: { canEdit: boolean; onAdd: () => void; onEdit: (entry: CatalogEntry) => void }) {
  const entries = useCatalog()
  const [open, setOpen] = useState(false)
  return (
    <Panel
      title="Catalog of bought parts"
      aside={<button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : `Show ${plural(entries.length, 'part', 'parts')}`}</button>}
    >
      {open && (
        <>
          <div className="panel-body toolbar">
            <span className="note">Names and links to buy, kept from season to season.</span>
            {props.canEdit && <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={props.onAdd}>Add an entry</button>}
          </div>
          {entries.length === 0 ? (
            <p className="panel-body muted">Nothing in the catalog yet. Use Add to catalog on a COTS part.</p>
          ) : (
            // Two columns, so it fits on a phone: the vendor and number sit under the name.
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Part</th>
                    <th className="num">Buy</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td style={{ overflowWrap: 'anywhere' }}>
                        {props.canEdit
                          ? <button type="button" className="name-btn" onClick={() => props.onEdit(entry)}>{entry.name}</button>
                          : entry.name}
                        <br />
                        <span className="note">{entry.vendor} · {entry.vendor_part_number}</span>
                      </td>
                      <td className="num">
                        {/* The database only accepts https:// links here, so it's safe to open. */}
                        <a className="btn btn-sm" href={entry.product_url} target="_blank" rel="noopener noreferrer">Buy ↗</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}
