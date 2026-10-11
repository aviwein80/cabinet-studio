/**
 * Job-1: shop rate and labour times for job quotes. The shop rate starts not set; the times are
 * PLACEHOLDER round numbers with a Configure badge until the shop edits or confirms them. Nothing here
 * changes what is cut.
 */
import { useStore } from '@/app/store'
import { ConfigureBadge, ValueBadges } from '@/components/Configure'
import { useConfigureTarget } from '@/components/configureFocus'
import { Field, NumField } from '@/components/fields'
import { PriceInput } from '@/components/PriceField'
import { LABOUR_LABEL, LABOUR_TIME_KEYS, labourMinutes, labourUnconfirmed } from '@/core/quote'

export function PricingSection() {
  const data = useStore((s) => s.data)!
  const updateSettings = useStore((s) => s.updateSettings)
  useConfigureTarget(['labour'])
  const p = data.settings.pricing
  const currency = data.settings.currency ?? '$'
  const minutes = labourMinutes(p)
  const open = labourUnconfirmed(p)
  const item = (key: string) => open.find((u) => u.key === key)
  const confirm = (key: string) => () => updateSettings((s) => void (s.pricing = { ...(s.pricing ?? {}), confirmed: [...new Set([...(s.pricing?.confirmed ?? []), key])] }))
  return (
    <section className="mx-auto mt-8 flex max-w-4xl flex-col gap-4" data-testid="pricing-section">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Pricing (job quotes)</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Labour in a job quote is the time per cabinet, drawer, door and sheet cut, at the shop rate. The times are placeholders until you set or confirm them; the shop rate is not set until you enter it, and labour stays “price not set” until then. Board prices are on each material (Library → Materials → Edit), edgeband and hardware prices in their library tables. Markup and sales tax are set per job on its Quote tab.
        </p>
      </div>
      <div className="grid gap-4 rounded-xl border bg-background p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={`${LABOUR_LABEL.shopRate}, ${currency}`} cfg="labour:shopRate" badge={item('labour:shopRate') && <ConfigureBadge item={item('labour:shopRate')!} />}>
          <PriceInput label={LABOUR_LABEL.shopRate} value={p?.shopRate} onChange={(v) => updateSettings((s) => void (s.pricing = { ...(s.pricing ?? {}), shopRate: v }))} />
        </Field>
        {LABOUR_TIME_KEYS.map((k) => (
          <NumField
            key={k}
            label={LABOUR_LABEL[k]}
            suffix="min"
            min={0}
            max={6000}
            value={minutes[k]}
            cfg={`labour:${k}`}
            badge={<ValueBadges item={item(`labour:${k}`)} onConfirm={confirm(`labour:${k}`)} />}
            onChange={(v) => updateSettings((s) => void (s.pricing = { ...(s.pricing ?? {}), minutes: { ...(s.pricing?.minutes ?? {}), [k]: v } }))}
          />
        ))}
      </div>
    </section>
  )
}
