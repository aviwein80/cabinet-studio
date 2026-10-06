/** Areas and costs of the shown sheet, the selected part and the whole job (M2.8, NEW-20). */
import { ConfigureBadge } from '@/components/Configure'
import { formatArea, formatMoney, type JobCosts, materialUnconfirmed } from '@/core/areas'
import type { Library, UnitSystem } from '@/core/types'

export function AreaCostPanel({ costs, sheetIndex, selectedUid, lib, units, currency }: { costs: JobCosts; sheetIndex: number; selectedUid: string | null; lib: Library; units: UnitSystem; currency: string }) {
  const s = costs.sheets.find((x) => x.index === sheetIndex)
  const p = selectedUid ? costs.parts.find((x) => x.uid === selectedUid) : undefined
  const a = (v: number) => formatArea(v, units)
  const $ = (v: number | null) => formatMoney(v, currency)
  const pct = (v: number) => (s && s.sheetArea > 0 ? `${((v / s.sheetArea) * 100).toFixed(1)} %` : '')
  const missing = materialUnconfirmed(lib, costs.missing)
  const t = costs.total
  if (!s) return null
  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="area-cost">
      <div className="font-semibold">Area and cost</div>
      <table className="w-full">
        <thead className="text-[10px] text-muted-foreground">
          <tr>
            <th className="text-left font-medium">Sheet {s.index}</th>
            <th className="text-right font-medium">Area</th>
            <th className="text-right font-medium">Share</th>
            <th className="text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          <tr>
            <td className="font-sans">Parts ({s.parts})</td>
            <td className="text-right">{a(s.partsArea)}</td>
            <td className="text-right">{pct(s.partsArea)}</td>
            <td className="text-right">{$(s.partsCost)}</td>
          </tr>
          <tr>
            <td className="font-sans">Remnants kept</td>
            <td className="text-right">{a(s.remnantArea)}</td>
            <td className="text-right">{pct(s.remnantArea)}</td>
            <td className="text-right">{$(s.remnantValue)}</td>
          </tr>
          <tr>
            <td className="font-sans">Scrap</td>
            <td className="text-right">{a(s.scrapArea)}</td>
            <td className="text-right">{pct(s.scrapArea)}</td>
            <td className="text-right">{$(s.scrapCost)}</td>
          </tr>
          <tr className="border-t font-semibold">
            <td className="font-sans">Sheet</td>
            <td className="text-right">{a(s.sheetArea)}</td>
            <td />
            <td className="text-right">{$(s.sheetCost)}</td>
          </tr>
        </tbody>
      </table>
      {s.sheetWeight !== null && <div className="text-muted-foreground">Sheet weight {s.sheetWeight.toFixed(1)} kg</div>}
      {p && (
        <div className="rounded border bg-muted/30 px-2 py-1.5">
          <span className="font-medium">Part #{p.no}</span>: {a(p.area)} · material {$(p.cost)} · share of the sheet {$(p.share)}
          {p.weight !== null && ` · ${p.weight.toFixed(2)} kg`}
        </div>
      )}
      <div className="text-muted-foreground">
        Job: {costs.sheets.length} sheet{costs.sheets.length === 1 ? '' : 's'}, {a(t.sheetArea)} · parts {a(t.partsArea)} · remnants {a(t.remnantArea)} · scrap {a(t.scrapArea)}
        {t.sheetCost > 0 && ` · sheets ${$(t.sheetCost)}, less remnants ${$(t.sheetCost - t.remnantValue)}`}
      </div>
      {missing.length > 0 && (
        <div className="flex flex-col gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-950">
          <span>No cost for {missing.length === 1 ? 'this material' : 'these materials'} until the price is entered:</span>
          {missing.map((u) => (
            <span key={u.key} className="flex items-center gap-1.5">
              {u.label} ({u.value}) <ConfigureBadge item={u} />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
