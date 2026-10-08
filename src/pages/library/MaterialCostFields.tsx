/** Material cost (M2.8, NEW-20): price per m² or per kg, and the density. Empty = not set. */
import { useState } from 'react'
import { ConfigureBadge } from '@/components/Configure'
import { focusField } from '@/components/configureFocus'
import { Field, SelectField } from '@/components/fields'
import { Input } from '@/components/ui/input'
import { costByOptions, kgPerM2, materialUnconfirmed, ratePerM2 } from '@/core/areas'
import { useStore } from '@/app/store'
import type { Material, MaterialCost } from '@/core/types'
import { enterApplies } from '@/components/enterApplies'

/** m² in one ft². Prices are stored per m²; in inch mode they are typed and shown per ft². */
const M2_PER_FT2 = 0.09290304
const round = (n: number) => Math.round(n * 1e6) / 1e6

/** Optional number. Rendered with `key` = the value shown, so a new value from outside starts it afresh. */
function OptNumInput({ value, onChange, placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string }) {
  const shown = value === undefined ? '' : String(value)
  const [text, setText] = useState(shown)
  return (
    <Input
      className="h-8"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={enterApplies}
      onBlur={() => {
        const t = text.trim().replace(',', '.')
        if (!t) return onChange(undefined)
        const n = Number(t)
        if (Number.isFinite(n) && n >= 0) onChange(n)
        else setText(shown)
      }}
    />
  )
}

const OptNum = (p: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string }) => <OptNumInput key={p.value === undefined ? '' : String(p.value)} {...p} />

export function MaterialCostFields({ material, currency, onChange }: { material: Material; currency: string; onChange: (c: MaterialCost | undefined) => void }) {
  const inches = useStore((st) => st.data?.settings.units === 'in')
  const c: MaterialCost = material.cost ?? { by: 'area' }
  const perFt2 = inches && c.by === 'area'
  const shownPrice = c.price === undefined ? undefined : perFt2 ? round(c.price * M2_PER_FT2) : c.price
  const items = materialUnconfirmed({ materials: [material] })
  const badge = (part: 'price' | 'density') => {
    const u = items.find((x) => x.target.kind === 'material' && x.target.part === part)
    return u ? <ConfigureBadge item={u} onOpen={() => focusField(u.key)} /> : null
  }
  const set = (patch: Partial<MaterialCost>) => {
    const next = { ...c, ...patch }
    onChange(next.price === undefined && next.density === undefined && next.by === 'area' ? undefined : next)
  }
  const rate = ratePerM2(material)
  const kg = kgPerM2(material)
  return (
    <div className="flex flex-col gap-2 rounded-md border p-2.5">
      <div className="text-xs font-semibold">Cost</div>
      <div className="grid grid-cols-3 gap-2">
        <SelectField
          label="Costed by"
          value={c.by}
          options={costByOptions(inches)}
          onChange={(v) => set({ by: v })}
        />
        <Field label={`Price, ${currency} per ${c.by === 'area' ? (perFt2 ? 'ft²' : 'm²') : 'kg'}`} cfg={`material:${material.id}:price`} badge={badge('price')}>
          <OptNum value={shownPrice} placeholder="not set" onChange={(v) => set({ price: v === undefined || !perFt2 ? v : v / M2_PER_FT2 })} />
        </Field>
        <Field label="Density, kg/m³" cfg={`material:${material.id}:density`} badge={c.by === 'weight' ? badge('density') : null}>
          <OptNum value={c.density} placeholder={c.by === 'weight' ? 'needed' : 'optional'} onChange={(v) => set({ density: v })} />
        </Field>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Label only: nothing cut changes. {rate === null ? 'No cost is shown until the price is entered' + (c.by === 'weight' ? ' with the density' : '') + '.' : `Sheet cost ${currency}${(perFt2 ? rate * M2_PER_FT2 : rate).toFixed(2)} per ${perFt2 ? 'ft²' : 'm²'} (${currency}${((rate * material.sheetLength * material.sheetWidth) / 1e6).toFixed(2)} a full sheet).`}
        {kg !== null && ` ${(inches ? kg * M2_PER_FT2 : kg).toFixed(inches ? 2 : 1)} kg per ${inches ? 'ft²' : 'm²'}, ${((kg * material.sheetLength * material.sheetWidth) / 1e6).toFixed(1)} kg a sheet.`}
      </p>
    </div>
  )
}
