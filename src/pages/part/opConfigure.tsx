/**
 * "Configure" badges on an operation's own values (M2.6e): values that come from a default
 * cutting value the shop has not confirmed. Typing a value confirms it for this operation;
 * "Mark as confirmed" keeps the one shown.
 */
import { useStore } from '@/app/store'
import { ValueBadges } from '@/components/Configure'
import { focusField } from '@/components/configureFocus'
import { confirmOp, type CutDefaultKey, opUnconfirmed } from '@/core/confirm'
import type { CamOp, CamPart } from '@/cam/types'

export function useOpCfg(op: CamOp, part: CamPart, onChange: (o: CamOp) => void) {
  const machine = useStore((s) => s.data!.machine)
  const items = opUnconfirmed(op, part, machine, null)
  return (key: CutDefaultKey) => {
    const cfg = `op:${op.id}:${key}`
    const item = items.find((u) => u.key === cfg)
    return {
      cfg,
      badge: <ValueBadges item={item} onOpen={() => focusField(cfg)} onConfirm={() => onChange(confirmOp(op, key))} />,
      /** Change the operation and confirm this value on it. */
      set: (o: CamOp) => onChange(confirmOp(o, key)),
    }
  }
}
