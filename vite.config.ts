import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' blob: data: https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://api.x.ai"

/** Production-only CSP: the dev server needs inline scripts for React refresh. */
const csp = (): Plugin => ({
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

/**
 * Third-party libraries shipped as separate, unmodified files next to the app (LGPL: anyone can
 * replace them). Served from node_modules by the dev server, copied into dist/ by the build. They
 * are loaded only when needed (see src/cam/solid/occt.ts), never in the start-up bundle.
 */
const VENDOR: { dir: string; from: string; files: string[] }[] = [
  { dir: 'vendor/occt-import-js', from: 'node_modules/occt-import-js/dist', files: ['occt-import-js.js', 'occt-import-js.wasm', 'license.occt-import-js.txt', 'license.occt.txt'] },
  // the OpenCascade B-rep kernel (M3.1g, LGPL-2.1): a face's true surface, loaded in the solid worker on first use
  { dir: 'vendor/opencascade-brep', from: 'node_modules/replicad-opencascadejs/dist', files: ['replicad_single.js', 'replicad_single.wasm'] },
  { dir: 'vendor/opencascade-brep', from: 'node_modules/replicad-opencascadejs', files: ['LICENSE'] },
  // the plugin sandbox (M2.10, MIT): its WebAssembly as a separate file, loaded on first use
  { dir: 'vendor/quickjs', from: 'node_modules/@jitl/quickjs-wasmfile-release-sync/dist', files: ['emscripten-module.wasm'] },
  { dir: 'vendor/quickjs', from: 'node_modules/@jitl/quickjs-wasmfile-release-sync', files: ['LICENSE'] },
]
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '': 'text/plain; charset=utf-8' }

const vendorFiles = (): Plugin => ({
  name: 'vendor-files',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url ?? '').split('?')[0]
      if (url === '/THIRD_PARTY_NOTICES.md') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(fs.readFileSync(path.resolve(import.meta.dirname, 'THIRD_PARTY_NOTICES.md')))
        return
      }
      for (const v of VENDOR) {
        const prefix = `/${v.dir}/`
        if (!url.startsWith(prefix)) continue
        const name = url.slice(prefix.length)
        if (!v.files.includes(name)) continue
        res.setHeader('Content-Type', TYPES[path.extname(name)] ?? 'application/octet-stream')
        res.end(fs.readFileSync(path.resolve(import.meta.dirname, v.from, name)))
        return
      }
      next()
    })
  },
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.md', source: fs.readFileSync(path.resolve(import.meta.dirname, 'THIRD_PARTY_NOTICES.md')) })
    for (const v of VENDOR) for (const name of v.files) this.emitFile({ type: 'asset', fileName: `${v.dir}/${name}`, source: fs.readFileSync(path.resolve(import.meta.dirname, v.from, name)) })
  },
})

export default defineConfig({
  // Relative base so the built app loads from file:// inside Electron.
  base: './',
  plugins: [react(), tailwindcss(), csp(), vendorFiles()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 41731,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 4000,
  },
})
