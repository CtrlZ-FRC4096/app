import { useState, type FormEvent } from 'react'
import { isMentor } from '../../core/roles'
import { useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { Panel, Pick, Pill } from '../../core/ui'
import { KIND_LABEL, STOCK_KINDS, addStock, changeStock, removeStock, sheetsTable, stockForm, stockTable, thicknessText, type NewStock, type Stock, type StockKind } from './data'
import { inches, parseInches, sizeText, suggestCode } from './geometry'

/**
 * The kinds of stock parts are cut from, with each one's router settings
 * for time estimates and design checks. Everyone can see them; mentors add
 * and change them.
 */
export function StockList() {
  const user = useSession()
  const stocks = stockTable.useRows()
  const sheets = sheetsTable.useRows()
  const [editing, setEditing] = useState<Stock | 'new' | null>(null)
  const mentor = isMentor(user.role)

  return (
    <>
      <div className="toolbar">
        {mentor && editing === null && <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>Add stock</button>}
        <span className="note">
          {mentor ? 'Choose a stock to change its router settings.' : 'Only mentors add stock and change router settings. Ask one if something is wrong.'}
        </span>
      </div>
      {editing && <StockForm key={editing === 'new' ? 'new' : editing.id} stock={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      <Panel title="Stock">
        {stocks.length === 0 ? (
          <p className="panel-body muted">No stock yet. {mentor ? 'Add the plates, tubes and bars the team cuts from.' : 'A mentor adds it.'}</p>
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
                    <tr key={s.id} aria-selected={editing !== 'new' && editing?.id === s.id}>
                      <td>
                        {mentor ? <button type="button" className="name-btn" onClick={() => setEditing(s)}>{s.name}</button> : s.name}
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

/** Add a kind of stock, or change one. Mentors only; the database enforces this too. */
function StockForm(props: { stock: Stock | null; onDone: () => void }) {
  const { stock } = props
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
          {stock && <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => void remove()}>Delete stock</button>}
        </div>
      </form>
    </Panel>
  )
}
