/**
 * Solid-model fixtures (tests/fixtures/solid, made by scripts/fixtures/make_solid_fixtures.py)
 * and a Node loader for the OpenCascade reader.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { readSolid, type SolidReadOptions } from '@/cam/solid/convert'
import { type OcctModule, occt, setOcctLoader } from '@/cam/solid/occt'
import type { SolidData } from '@/cam/solid/types'

const require = createRequire(import.meta.url)
export const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'solid')

export function registerNodeOcct() {
  setOcctLoader(() => {
    const factory = require('occt-import-js') as (m: object) => Promise<OcctModule>
    return factory({ print: () => {}, printErr: () => {} })
  })
}

export const fixtureBytes = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)))

export interface Truth {
  name: string
  length: number
  width: number
  thickness: number
  outline: { area: number; vertices?: [number, number][]; archRadius?: number }
  holes: { x: number; y: number; d: number; depth: number; face: 1 | 6; through: boolean; floor: 'flat' | 'cone' | 'none'; tipAngle?: number; tipDepth?: number }[]
  pockets: { depth: number; area: number; box?: [number, number, number, number]; archRadius?: number }[]
  cutouts: { area: number; box: [number, number, number, number] }[]
  properties?: Record<string, string>
}

export const truthOf = (name: string): Truth => JSON.parse(fs.readFileSync(path.join(FIXTURES, name.replace(/\.[^.]+$/, '.truth.json')), 'utf8'))

const cache = new Map<string, SolidData>()
export async function readFixture(name: string, opt: SolidReadOptions = {}): Promise<SolidData> {
  const key = `${name}|${JSON.stringify(opt)}`
  const hit = cache.get(key)
  if (hit) return hit
  registerNodeOcct()
  const s = readSolid(await occt(), fixtureBytes(name), name, opt)
  cache.set(key, s)
  return s
}
