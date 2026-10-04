import fs from 'node:fs'
import path from 'node:path'
import type { BatchFs } from '../src/core/batchWatch'

export const nodeBatchFs: BatchFs = {
  list: (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name)
    } catch {
      return []
    }
  },
  size: (p) => {
    try {
      return fs.statSync(p).size
    } catch {
      return null
    }
  },
  readText: (p) => {
    try {
      return fs.readFileSync(p, 'utf8')
    } catch {
      return null
    }
  },
  writeFile: (p, data) => fs.writeFileSync(p, data),
  mkdirp: (p) => void fs.mkdirSync(p, { recursive: true }),
  rename: (a, b) => {
    try {
      fs.renameSync(a, b)
    } catch {
      fs.cpSync(a, b, { recursive: true })
      fs.rmSync(a, { recursive: true, force: true })
    }
  },
  remove: (p) => fs.rmSync(p, { recursive: true, force: true }),
  exists: (p) => fs.existsSync(p),
  join: (...parts) => path.join(...parts),
  isAbsolute: (p) => path.isAbsolute(p),
}
