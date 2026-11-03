import { useState, type CSSProperties, type FormEvent, type MouseEvent } from 'react'
import { useMemberNames } from '../../core/members'
import { useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { shortDate } from '../../core/format'
import { PageHead, Panel, Pick, Pill, Stepper } from '../../core/ui'
import {
  EMPTY_ITEM,
  STATUSES,
  TYPES,
  VENDORS,
  VIEWS,
  addItem,
  changeItem,
  choices,
  groupItems,
  itemToForm,
  removeItem,
  statusOf,
  summaryText,
  useItems,
  type NewItem,
  type PurchaseItem,
  type View,
} from './data'

// Fields and their boxes may shrink to the screen's width. Without this, a
// dropdown grows to fit its longest choice and the page scrolls sideways
// on a phone.
const FIELD: CSSProperties = { minWidth: 0 }
const BOX: CSSProperties = { minWidth: 0, width: '100%' }

const EMPTY_TEXT: Record<View, string> = {
  Current: 'Nothing in progress. Ask for something above, or look at All.',
  All: 'Nothing on the list yet. Ask for the first thing above.',
  'By status': 'Nothing on the list yet. Ask for the first thing above.',
  'By vendor': 'Nothing on the list yet. Ask for the first thing above.',
}

// The page reads items with a hook (useItems) and changes them with
// functions from data.ts. It never saves anything itself.
export default function PurchasingPage() {
  const items = useItems()
  const [view, setView] = useState<View>('Current')
  const [adding, setAdding] = useState(false)
  // The item opened for changing, if any.
  const [openId, setOpenId] = useState<string | null>(null)
  const groups = groupItems(items, view)

  return (
    <>
      <PageHead title="Purchasing">
        What the team needs to buy, from asking for it to it being in the shop. This list is separate from the BOM: add anything we need to order. Tap an item to change it.
      </PageHead>

      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <Pick label="Show" options={[...VIEWS]} value={view} onChange={setView} />
        {!adding && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>Ask for something</button>}
      </div>

      {adding && (
        <Panel title="Ask for something">
          <ItemForm item={null} onDone={() => setAdding(false)} />
        </Panel>
      )}

      {groups.length === 0 ? (
        <Panel><p className="panel-body muted">{EMPTY_TEXT[view]}</p></Panel>
      ) : (
        groups.map((group) => (
          <Panel
            key={group.title}
            title={group.status ? <h2><Pill tone={group.status.tone}>{group.title}</Pill></h2> : group.title}
            aside={<span className="note">{group.status ? group.status.hint + ' · ' : ''}{group.items.length}</span>}
          >
            <div className="row-list">
              {group.items.map((item) =>
                item.id === openId ? (
                  <div key={item.id} style={{ display: 'block', padding: 0 }}>
                    <ItemForm item={item} onDone={() => setOpenId(null)} />
                  </div>
                ) : (
                  <ItemRow key={item.id} item={item} showStatus={!group.status} onOpen={() => setOpenId(item.id)} />
                ),
              )}
            </div>
          </Panel>
        ))
      )}

      {items.length > 0 && <p className="note">{summaryText(items)}</p>}
    </>
  )
}

/**
 * One item in a list. Tapping it opens it for changing, except on its
 * Open link button, which sits apart so it's easy to hit on a phone.
 */
function ItemRow(props: { item: PurchaseItem; showStatus: boolean; onOpen: () => void }) {
  const { item } = props
  const nameOf = useMemberNames()
  const status = statusOf(item.status)
  const details = [item.vendor, item.type, item.part_number].filter(Boolean)

  function open(event: MouseEvent) {
    if ((event.target as HTMLElement).closest('a, button')) return
    props.onOpen()
  }

  return (
    <div style={{ flexWrap: 'wrap', cursor: 'pointer' }} onClick={open}>
      <span style={{ flex: '1 1 16rem', minWidth: 0, overflowWrap: 'anywhere' }}>
        <button type="button" className="name-btn" onClick={props.onOpen}><strong>{item.name}</strong></button>
        {' '}× {item.quantity}
        {props.showStatus && <>{' '}<Pill tone={status.tone}>{status.label}</Pill></>}
        <br />
        <span className="muted">{details.join(' · ')}</span>
        {item.notes && <><br /><span className="muted">{item.notes}</span></>}
        <br />
        <span className="note">Requested by {nameOf(item.requested_by)} · {shortDate(item.created_at)}</span>
      </span>
      {item.link && (
        <a className="btn btn-sm" href={item.link} target="_blank" rel="noopener noreferrer">Open link</a>
      )}
    </div>
  )
}

/** Ask for something, or change an item when `item` is given. */
function ItemForm(props: { item: PurchaseItem | null; onDone: () => void }) {
  const { item } = props
  const nameOf = useMemberNames()
  const me = useSession()
  const [form, setForm] = useState<NewItem>(item ? itemToForm(item) : EMPTY_ITEM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const set = (changes: Partial<NewItem>) => setForm((current) => ({ ...current, ...changes }))
  const id = (field: string) => `purchase-${item?.id ?? 'new'}-${field}`
  // Asking for something, you pick its priority. Changing one, any status.
  const statuses = item ? STATUSES : STATUSES.filter((s) => s.ask)

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = item ? await changeItem(item, form) : await addItem(form)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(item ? 'Saved.' : 'Added to the list.')
    props.onDone()
  }

  async function remove() {
    if (!item) return
    // Anyone can delete anything, so it takes two presses.
    if (!deleting) {
      setDeleting(true)
      return
    }
    const result = await removeItem(item)
    toast(result.ok ? `Deleted ${item.name}.` : result.error)
    if (result.ok) props.onDone()
  }

  const text = (field: 'name' | 'link' | 'part_number', label: string, placeholder = '') => (
    <label className="field" style={FIELD} htmlFor={id(field)}>
      {label}
      <input id={id(field)} className="input" style={BOX} value={form[field]} placeholder={placeholder} onChange={(e) => set({ [field]: e.target.value })} />
    </label>
  )

  const select = (field: 'vendor' | 'type', label: string, list: string[]) => (
    <label className="field" style={FIELD} htmlFor={id(field)}>
      {label}
      <select id={id(field)} className="input" style={BOX} value={form[field]} onChange={(e) => set({ [field]: e.target.value })}>
        <option value="" disabled>Pick one</option>
        {choices(list, form[field]).map((choice) => <option key={choice} value={choice}>{choice}</option>)}
      </select>
    </label>
  )

  return (
    <form className="panel-body" style={{ maxWidth: '70ch', minWidth: 0 }} onSubmit={save}>
      {/* Always whoever filled in the form: it can't be picked or changed. */}
      <p className="note" style={{ margin: 0 }}>
        {item ? `Requested by ${nameOf(item.requested_by)} · ${shortDate(item.created_at)}` : `Requested by ${me.name}`}
      </p>
      {text('name', 'What to buy', 'Like "Ethernet cables, 5 ft (10 pack)"')}
      <label className="field" style={FIELD} htmlFor={id('status')}>
        {item ? 'Status' : 'Priority'}
        <select id={id('status')} className="input" style={BOX} value={form.status} onChange={(e) => set({ status: e.target.value as NewItem['status'] })}>
          {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <span className="note">{statusOf(form.status).hint}.</span>
      </label>
      {select('vendor', 'Vendor', VENDORS)}
      {select('type', 'Type', TYPES)}
      <div className="field">
        <span>Number needed</span>
        <Stepper id={id('quantity')} label="Number needed" min={1} value={form.quantity} onChange={(quantity) => set({ quantity })} />
      </div>
      {text('link', 'Link to the product', 'https://…')}
      {text('part_number', 'Part or item number (if there is one)')}
      <label className="field" style={FIELD} htmlFor={id('notes')}>
        Notes
        <textarea id={id('notes')} className="input" style={BOX} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      <div className="toolbar">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : item ? 'Save' : 'Add to the list'}</button>
        <button type="button" className="btn" onClick={props.onDone}>Cancel</button>
        {item && (
          <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => void remove()}>
            {deleting ? 'Press again to delete' : 'Delete'}
          </button>
        )}
      </div>
    </form>
  )
}
