import { describe, expect, it } from 'vitest'
import { generateCarcass } from '../src/core/construction/carcass'
import { BASE_PARAMS, defaultLibrary, fillHardwareSpecs } from '../src/core/defaults'
import { SALICE } from '../src/core/hardware/specs'
import { toWorld } from '../src/core/geometry'
import { applyKeep, applyUpdate, drivingKeys, geometryChanged } from '../src/core/library/propagate'
import type { DrillOp, Hardware, Library } from '../src/core/types'
import { cabinet, data } from './helpers'

function plateYs(lib: Library, pin?: { hardware?: Record<string, { plateSetback?: number; plateSpacing?: number; holeDiameter?: number; holeDepth?: number }> }) {
  const g = generateCarcass(BASE_PARAMS, lib, pin)
  const side = g.parts.find((p) => p.key === 'side-left')!
  return side.ops.filter((o): o is DrillOp => o.kind === 'drill' && o.diameter === 5).map((h) => toWorld(side.frame, h.x, h.y)[1])
}

describe('Salice plate height', () => {
  it('stores 3 mm, and neither that height nor the name moves holes', () => {
    const lib = defaultLibrary()
    const plate = lib.hardware.find((h) => h.id === 'hw-plate')!
    expect(plate.plateHeight).toBe(3)
    expect(drivingKeys(plate, 'hardware')).not.toContain('plateHeight')
    expect(geometryChanged(plate, { ...plate, plateHeight: 0, name: 'renamed', code: 'RENAMED' }, drivingKeys(plate, 'hardware'))).toBe(false)

    plate.code = 'RENAMED'
    plate.name = 'not a 3 mm plate'
    plate.plateHeight = 0
    const ys = plateYs(lib)
    expect(ys.some((y) => Math.abs(y - SALICE.plateSetback) < 0.1)).toBe(true)
    expect(ys.some((y) => Math.abs(y - 50) < 0.1)).toBe(false)
  })

  it('moves plate screws when the setback changes, unless the cabinet keeps the old value', () => {
    const lib = defaultLibrary()
    const plate = lib.hardware.find((h) => h.id === 'hw-plate')!
    plate.plateSetback = 50
    expect(plateYs(lib).some((y) => Math.abs(y - 50) < 0.1)).toBe(true)
    const kept = plateYs(lib, { hardware: { 'hw-plate': { plateSetback: 37, plateSpacing: 32, holeDiameter: 5, holeDepth: 11 } } })
    expect(kept.some((y) => Math.abs(y - 37) < 0.1)).toBe(true)
    expect(kept.some((y) => Math.abs(y - 50) < 0.1)).toBe(false)
  })

  it('fills a missing plate height instead of reading it as 0', () => {
    const bare = defaultLibrary().hardware.map((h) => (h.id === 'hw-plate' ? { id: h.id, code: h.code, name: h.name, category: h.category } : h))
    const filled = fillHardwareSpecs(bare as Hardware[])
    const plate = filled.find((h) => h.id === 'hw-plate')!
    expect(plate.plateHeight).toBe(3)
    expect(plate.plateSetback).toBe(37)
    expect(fillHardwareSpecs([{ id: 'hw-plate', code: 'X', name: 'X', category: 'mounting-plate', plateHeight: 0 }])[0]!.plateHeight).toBe(0)
  })
})

describe('library edit propagation', () => {
  it('keep clones the old material onto existing cabinets and leaves the library id updated', () => {
    const shop = data((d) => {
      d.jobs.push({ id: 'job-1', number: 'J1', name: 'Kitchen', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [cabinet('tpl-base-2door')] })
    })
    const before = shop.library.materials.find((m) => m.id === 'mat-pb18-white')!
    applyKeep(shop, 'material', before, { ...before, thickness: 19 })
    const cab = shop.jobs[0]!.cabinets[0]!
    expect(cab.params.carcassMaterialId).not.toBe('mat-pb18-white')
    expect(shop.library.materials.find((m) => m.id === 'mat-pb18-white')!.thickness).toBe(19)
    expect(shop.library.materials.find((m) => m.id === cab.params.carcassMaterialId)!.thickness).toBe(18)
    expect(shop.library.templates.find((t) => t.id === 'tpl-base-2door')!.params.carcassMaterialId).toBe('mat-pb18-white')
  })

  it('update keeps the same material id so the job follows the library', () => {
    const shop = data((d) => {
      d.jobs.push({ id: 'job-1', number: 'J1', name: 'Kitchen', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [cabinet('tpl-base-2door')] })
    })
    const before = shop.library.materials.find((m) => m.id === 'mat-pb18-white')!
    applyUpdate(shop, 'material', before, { ...before, thickness: 19 })
    expect(shop.jobs[0]!.cabinets[0]!.params.carcassMaterialId).toBe('mat-pb18-white')
    expect(shop.library.materials.find((m) => m.id === 'mat-pb18-white')!.thickness).toBe(19)
  })

  it('hinge update writes door cups, and keep leaves the job cabinet alone', () => {
    const kept = data((d) => {
      d.jobs.push({ id: 'job-1', number: 'J1', name: 'Kitchen', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [cabinet('tpl-base-2door')] })
    })
    const before = kept.library.hardware.find((h) => h.id === 'hw-hinge')!
    applyKeep(kept, 'hardware', before, { ...before, cupDepth: 15.5, cupCentre: 22 })
    expect(kept.jobs[0]!.cabinets[0]!.params.doors.cupDepth).toBe(13.5)
    expect(kept.library.templates.find((t) => t.id === 'tpl-base-2door')!.params.doors.cupDepth).toBe(15.5)
    expect(kept.library.templates.find((t) => t.id === 'tpl-base-2door')!.params.doors.cupEdgeDistance).toBe(22)

    const updated = data((d) => {
      d.jobs.push({ id: 'job-1', number: 'J1', name: 'Kitchen', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [cabinet('tpl-base-2door')] })
    })
    const hinge = updated.library.hardware.find((h) => h.id === 'hw-hinge')!
    applyUpdate(updated, 'hardware', hinge, { ...hinge, cupDepth: 15.5 })
    expect(updated.jobs[0]!.cabinets[0]!.params.doors.cupDepth).toBe(15.5)
  })

  it('plate keep pins the old setback on the job and update clears that pin', () => {
    const shop = data((d) => {
      d.jobs.push({ id: 'job-1', number: 'J1', name: 'Kitchen', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [cabinet('tpl-base-2door')] })
    })
    const before = shop.library.hardware.find((h) => h.id === 'hw-plate')!
    applyKeep(shop, 'hardware', before, { ...before, plateSetback: 50 })
    const cab = shop.jobs[0]!.cabinets[0]!
    expect(cab.pin?.hardware?.['hw-plate']?.plateSetback).toBe(37)
    expect(shop.library.hardware.find((h) => h.id === 'hw-plate')!.plateSetback).toBe(50)
    const ys = plateYs(shop.library, cab.pin)
    expect(ys.some((y) => Math.abs(y - 37) < 0.1)).toBe(true)

    applyUpdate(shop, 'hardware', { ...before, plateSetback: 37 }, shop.library.hardware.find((h) => h.id === 'hw-plate')!)
    expect(cab.pin?.hardware?.['hw-plate']).toBeUndefined()
    expect(plateYs(shop.library, cab.pin).some((y) => Math.abs(y - 50) < 0.1)).toBe(true)
  })
})
