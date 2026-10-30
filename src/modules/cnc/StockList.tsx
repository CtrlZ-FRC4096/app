import { useState, type FormEvent } from 'react'
import { isMentor } from '../../core/roles'
import { useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { plural } from '../../core/format'
import { Panel, Pick, Pill } from '../../core/ui'
import { partsTable } from '../bom/data'
import {
  KIND_LABEL, STOCK_KINDS, addStock, addStockFromOnshape, changeStock, onshapeMadeParts, planStockImport, readShapes, removeStock, shapeReadCalls,
  shapesTable, sheetsTable, stockForm, stockTable, thicknessText, type NewStock, type Stock, type StockKind,
} from './data'
import { inches, parseInches, sizeText, suggestCode } from './geometry'

/**
 * The kinds of stock parts are cut from, with each one's router settings
 * for time estimates and design checks. Anyone on the team can add and
 * change them, by hand or from the parts in Onshape; mentors delete them.
 */
export function StockList() {
  const stocks = stockTable.useRows()
  const sheets = sheetsTable.useRows()
  const [editing, setEditing] = useState<Stock | 'new' | 'onshape' | null>(null)
  const chosen = typeof editing === 'object' ? editing : null

  return (
    <>
      <div className="toolbar">
        {editing === null && (
          <>
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>Add stock</button>
            <button type="button" className="btn" onClick={() => setEditing('onshape')}>Import from Onshape</button>
          </>
        )}
        <span className="note">Choose a stock to change it or its router settings.</span>
      </div>
      {editing === 'onshape' && <ImportStock onDone={() => setEditing(null)} />}
      {(editing === 'new' || chosen) && <StockForm key={chosen?.id ?? 'new'} stock={chosen} onDone={() => setEditing(null)} />}
      <Panel title="Stock">
        {stocks.length === 0 ? (
          <p className="panel-body muted">No stock yet. Import it from the parts in Onshape, or add the plates, tubes and bars the team cuts from.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Stock</th><th>Sheets</th><th>Router</th></tr>
              </thead>
              <tbody>
                {stocks.map((s) => {
                  const mine = sheets.filter((sheet) => sheet.stock_id === s.id && sheet.status !== 'scrap')
                  return (
                    <tr key={s.id} aria-selected={chosen?.id === s.id}>
                      <td>
                        <button type="button" className="name-btn" onClick={() => setEditing(s)}>{s.name}</button>
                        <br />
                        <span className="note">
                          <Pill tone="plain">{KIND_LABEL[s.kind]}</Pill> <span className="mono">{s.code}</span> · {s.material}
                          {thicknessText(s) && ` · ${thicknessText(s)}`}
                        </span>
                      </td>
                      <td>
                        {s.kind === 'plate' ? mine.length : '–'}
                        {s.sheet_length_in && s.sheet_width_in && (
                          <>
                            <br />
                            <span className="note">Full: {sizeText(s.sheet_length_in, s.sheet_width_in)}</span>
                          </>
                        )}
                      </td>
                      <td className="note">
                        {s.bit_in ? `${inches(s.bit_in)} bit` : 'No bit set'}
                        <br />
                        {s.feed_ipm ? `${s.feed_ipm} in/min` : 'No feed set'}
                        {s.depth_per_pass_in ? `, ${inches(s.depth_per_pass_in)} a pass` : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

const names = (parts: { name: string }[]) => parts.map((p) => p.name).join(', ')

/**
 * Work out the plates the BOM's made parts are cut from, from each part's
 * material and its thickness in Onshape, and add the ones that are missing.
 * Parts whose shape hasn't been read yet are read first, if the person says
 * so, because each costs one of the team's yearly Onshape API calls.
 */
function ImportStock(props: { onDone: () => void }) {
  const parts = partsTable.useRows()
  const shapes = shapesTable.useRows()
  const stocks = stockTable.useRows()
  const plan = planStockImport(parts, shapes, stocks)
  const fromOnshape = onshapeMadeParts(parts)
  // Whether to go ahead without the parts not read yet, and which plates are unticked.
  const [skipUnread, setSkipUnread] = useState(false)
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const picked = plan.add.filter((a) => !unticked.has(a.stock.name))

  async function read() {
    setBusy(true)
    const result = await readShapes(plan.unread)
    setBusy(false)
    toast(result.ok ? result.value : result.error)
    if (!result.ok) setSkipUnread(true)
  }

  async function add() {
    setBusy(true)
    const result = await addStockFromOnshape(picked)
    setBusy(false)
    toast(result.ok ? result.value : result.error)
    if (result.ok) props.onDone()
  }

  function tick(name: string, on: boolean) {
    const next = new Set(unticked)
    if (on) next.delete(name)
    else next.add(name)
    setUnticked(next)
  }

  if (fromOnshape.length === 0) {
    return (
      <Panel title="Import stock from Onshape">
        <p className="panel-body muted">No made parts in the BOM came from Onshape yet. Import a system from Onshape in the BOM first.</p>
        <div className="panel-body toolbar"><button type="button" className="btn" onClick={props.onDone}>Close</button></div>
      </Panel>
    )
  }

  if (plan.unread.length > 0 && !skipUnread) {
    return (
      <Panel title="Import stock from Onshape">
        <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
          <span>
            The stock comes from each made part's material and its thickness in Onshape.{' '}
            {plural(plan.unread.length, 'part hasn’t', 'parts haven’t')} been read from Onshape yet: {names(plan.unread.slice(0, 8))}
            {plan.unread.length > 8 && ` and ${plan.unread.length - 8} more`}.
          </span>
          <span className="note">
            Reading them uses about {plural(shapeReadCalls(plan.unread), 'Onshape API call', 'Onshape API calls')} (one per Part Studio, however many parts are in it).
            It's only done once: their sizes and checks show on the board after.
          </span>
          <span className="toolbar">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void read()}>{busy ? 'Reading Onshape…' : 'Read them'}</button>
            <button type="button" className="btn" onClick={() => setSkipUnread(true)}>Use only the parts read already</button>
            <button type="button" className="btn" onClick={props.onDone}>Cancel</button>
          </span>
        </div>
      </Panel>
    )
  }

  return (
    <Panel title="Import stock from Onshape">
      <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
        {plan.add.length === 0 ? (
          <span>Every plate the parts need is already in the stock list.</span>
        ) : (
          <>
            <span>The parts need these plates, which aren't in the stock list yet. Untick any you don't want.</span>
            {plan.add.map(({ stock, parts: needing }) => (
              <label key={stock.name} className="check" style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" checked={!unticked.has(stock.name)} onChange={(e) => tick(stock.name, e.target.checked)} />
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <strong>{stock.name}</strong> <span className="mono note">{stock.code}</span>
                  <br />
                  <span className="note">{stock.material} · for {names(needing)}</span>
                </span>
              </label>
            ))}
          </>
        )}
        {plan.have.length > 0 && (
          <span className="note">Already here: {plan.have.map((h) => `${h.stock.name} (${names(h.parts)})`).join('; ')}.</span>
        )}
        {plan.noMaterial.length > 0 && (
          <span className="note">No material in Onshape, so left out: {names(plan.noMaterial)}. Set it on the part in Onshape, then import the system in the BOM again.</span>
        )}
        {plan.notPlates.length > 0 && <span className="note">Not flat plates, so left out: {names(plan.notPlates)}. Add tubes and bars by hand.</span>}
        {plan.unread.length > 0 && <span className="note">Not read from Onshape yet, so left out: {names(plan.unread)}.</span>}
        <span className="toolbar">
          {plan.add.length > 0 && (
            <button type="button" className="btn btn-primary" disabled={busy || picked.length === 0} onClick={() => void add()}>
              {busy ? 'Adding…' : `Add ${plural(picked.length, 'kind of stock', 'kinds of stock')}`}
            </button>
          )}
          <button type="button" className="btn" onClick={props.onDone}>{plan.add.length ? 'Cancel' : 'Close'}</button>
        </span>
        {plan.add.length > 0 && <span className="note">Add each one's full sheet size and router settings after, by choosing it.</span>}
      </div>
    </Panel>
  )
}

const KINDS = STOCK_KINDS.map((k) => KIND_LABEL[k])
const kindOf = (label: string) => STOCK_KINDS.find((k) => KIND_LABEL[k] === label) ?? 'plate'

/** What a stock is usually called, from what's been typed: "1/4 in aluminum plate". */
function suggestName(input: NewStock): string {
  const thickness = parseInches(input.thickness)
  const material = input.material.trim().replace(/^\d{4}\s+/, '').toLowerCase()
  if (!material) return ''
  if (input.kind === 'plate') return `${thickness ? `${inches(thickness)} ` : ''}${material} plate`
  return `${material} ${input.kind === 'other' ? '' : input.kind}${thickness && input.kind === 'tube' ? `, ${inches(thickness)} wall` : ''}`.trim()
}

/** Add a kind of stock, or change one. Anyone can; only mentors can delete one, which the database enforces too. */
function StockForm(props: { stock: Stock | null; onDone: () => void }) {
  const { stock } = props
  const user = useSession()
  const [input, setInput] = useState<NewStock>(stockForm(stock ?? undefined))
  // Until someone types a name or code, they follow the material and thickness.
  const [named, setNamed] = useState(Boolean(stock))
  const [coded, setCoded] = useState(Boolean(stock))
  const [saving, setSaving] = useState(false)
  const shown = {
    ...input,
    name: named ? input.name : suggestName(input),
    code: coded ? input.code : input.material.trim() ? suggestCode(input.material, parseInches(input.thickness)) : '',
  }
  const set = (changes: Partial<NewStock>) => setInput({ ...input, ...changes })

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const result = stock ? await changeStock(stock, shown) : await addStock(shown)
    setSaving(false)
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(stock ? 'Saved.' : `Added ${result.value.name}.`)
    props.onDone()
  }

  async function remove() {
    if (!stock || !window.confirm(`Delete ${stock.name}? Parts on the board for it go back to "No stock picked".`)) return
    const result = await removeStock(stock)
    toast(result.ok ? `Deleted ${stock.name}.` : result.error)
    if (result.ok) props.onDone()
  }

  const field = (id: keyof NewStock, label: string, placeholder: string, more: { mono?: boolean; numeric?: boolean } = {}) => (
    <label className="field" htmlFor={`stock-${id}`} style={{ flex: '1 1 140px' }}>
      {label}
      <input
        id={`stock-${id}`}
        className={'input' + (more.mono ? ' mono' : '')}
        inputMode={more.numeric ? 'decimal' : undefined}
        value={shown[id] as string}
        placeholder={placeholder}
        onChange={(e) => {
          if (id === 'name') setNamed(true)
          if (id === 'code') setCoded(true)
          set({ [id]: id === 'code' ? e.target.value.toUpperCase() : e.target.value })
        }}
      />
    </label>
  )

  return (
    <Panel title={stock ? `Change ${stock.name}` : 'Add stock'}>
      <form className="panel-body" onSubmit={save}>
        <Pick label="Kind" options={KINDS} value={KIND_LABEL[input.kind]} onChange={(label) => set({ kind: kindOf(label) as StockKind })} />
        <div className="toolbar">
          {field('material', 'Material', '6061 aluminum')}
          {field('thickness', input.kind === 'tube' ? 'Wall thickness' : 'Thickness', '1/4', { numeric: true })}
        </div>
        <div className="toolbar">
          {field('name', 'Name, the way the team says it', '1/4 in aluminum plate')}
          {field('code', 'Code, to start sheet IDs', 'AL250', { mono: true })}
        </div>
        {input.kind === 'plate' && (
          <div className="toolbar">
            {field('sheetLength', 'Full sheet length', '48', { numeric: true })}
            {field('sheetWidth', 'Full sheet width', '24', { numeric: true })}
          </div>
        )}
        <p className="note">Router settings, for time estimates and design checks. Leave them empty if you don't know yet.</p>
        <div className="toolbar">
          {field('bit', 'Bit diameter', '1/4', { numeric: true })}
          {field('feed', 'Feed (inches a minute)', '60', { numeric: true })}
          {field('depthPerPass', 'Depth per pass', '0.06', { numeric: true })}
        </div>
        <div className="toolbar">
          <button type="submit" className="btn btn-primary" disabled={saving}>{stock ? 'Save' : 'Add stock'}</button>
          <button type="button" className="btn" onClick={props.onDone}>Cancel</button>
          {stock && isMentor(user.role) && <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => void remove()}>Delete stock</button>}
        </div>
      </form>
    </Panel>
  )
}
