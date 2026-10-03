import { BUILTIN_TEMPLATES, defaultAppData } from '../src/core/defaults'
import type { AppData, CabinetInstance, Job } from '../src/core/types'

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export function data(patch: (d: AppData) => void = () => {}): AppData {
  const d = defaultAppData()
  patch(d)
  return d
}

export function cabinet(templateId: string, patch: (p: CabinetInstance['params']) => void = () => {}, id = 'cab-1', number = 'B1'): CabinetInstance {
  const t = BUILTIN_TEMPLATES.find((x) => x.id === templateId)!
  const params = clone(t.params)
  patch(params)
  return { id, number, name: t.name, templateId, qty: 1, params, overrides: {} }
}

export function job(cabinets: CabinetInstance[], number = 'T001'): Job {
  return {
    id: 'job-test',
    number,
    name: 'Test job',
    customer: 'Test',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cabinets,
  }
}
