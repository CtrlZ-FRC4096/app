import { useState } from 'react'
import { Pick } from '../../core/ui'
import { PLATE_MATERIAL_LABEL, PLATE_THICKNESSES, plateStock, useStock, type CamStock, type PlateMaterial } from './data'
import { inches, parseInches } from './geometry'

const OTHER = 'Other stock'
const CUSTOM = 'Custom'
const MATERIALS = Object.entries(PLATE_MATERIAL_LABEL) as [PlateMaterial, string][]
const fraction = (t: number) => inches(t).replace(' in', '')
const isPreset = (t: number) => PLATE_THICKNESSES.some((p) => Math.abs(p - t) < 1e-6)

/**
 * Pick what a part is cut from when it's flagged ready to CAM: aluminum or
 * polycarbonate plate and its thickness (or a size typed in), or any other
 * stock, like a tube. The BOM's "Ready to CAM" form uses it too.
 */
export function CamStockPicker(props: { id: string; value: CamStock; onChange: (value: CamStock) => void }) {
  const stocks = useStock()
  const { value } = props
  const plate = 'plate' in value ? value : null
  // What's typed for a custom thickness, or null while a usual one is picked.
  const [typed, setTyped] = useState<string | null>(plate && plate.thickness > 0 && !isPreset(plate.thickness) ? fraction(plate.thickness) : null)
  const existing = plate && plate.thickness > 0 ? plateStock(plate.plate, plate.thickness, stocks) : undefined

  function pickMaterial(label: string) {
    const material = MATERIALS.find(([, l]) => l === label)?.[0]
    if (!material) props.onChange({ stockId: stocks.find((s) => s.kind !== 'plate')?.id ?? null })
    else props.onChange({ plate: material, thickness: plate?.thickness ?? 0 })
  }

  function pickThickness(label: string) {
    if (!plate) return
    if (label === CUSTOM) {
      setTyped('')
      props.onChange({ ...plate, thickness: 0 })
      return
    }
    setTyped(null)
    props.onChange({ ...plate, thickness: PLATE_THICKNESSES.find((t) => fraction(t) === label) ?? 0 })
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="field">
        Cut from
        <Pick label="Cut from" options={[...MATERIALS.map(([, l]) => l), OTHER]} value={plate ? PLATE_MATERIAL_LABEL[plate.plate] : OTHER} onChange={pickMaterial} />
      </div>
      {plate ? (
        <>
          <div className="field">
            Thickness
            <Pick
              label="Thickness"
              options={[...PLATE_THICKNESSES.map(fraction), CUSTOM]}
              value={typed !== null ? CUSTOM : isPreset(plate.thickness) ? fraction(plate.thickness) : ''}
              onChange={pickThickness}
            />
          </div>
          {typed !== null && (
            <label className="field" htmlFor={`${props.id}-thickness`}>
              Thickness in inches
              <input
                id={`${props.id}-thickness`}
                className="input"
                inputMode="decimal"
                value={typed}
                placeholder="3/8, 0.375 or 6 mm"
                onChange={(e) => {
                  setTyped(e.target.value)
                  props.onChange({ ...plate, thickness: parseInches(e.target.value) ?? 0 })
                }}
              />
            </label>
          )}
          {plate.thickness > 0 && (
            <span className="note">
              {existing
                ? `From ${existing.name}.`
                : `${inches(plate.thickness)} ${plate.plate} plate isn't in the stock list yet: it's added when you flag this.`}
            </span>
          )}
        </>
      ) : (
        <label className="field" htmlFor={`${props.id}-stock`}>
          Stock
          <select
            id={`${props.id}-stock`}
            className="input"
            value={'stockId' in value ? (value.stockId ?? '') : ''}
            onChange={(e) => props.onChange({ stockId: e.target.value || null })}
          >
            <option value="">Not picked yet</option>
            {stocks.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}
