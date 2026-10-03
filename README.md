# Cabinet Studio

Offline Windows desktop program for designing cabinets and producing nested CNC programs for a
**HOMAG CENTATEQ N-200** nesting router. It writes plain-text **woodWOP MPR 4.0** files, one per
sheet, plus part labels, sheet maps, cut lists and a BOM. It is meant to replace Cabinet Vision for
one shop.

> **Safety.** Generated programs are **not machine-proven**. Open every MPR in woodWOP and run the
> simulation before cutting. The built-in tool table is **placeholder data**; replace it with the
> real N-200 tool table first (Machine & tools page, or import a CSV). The app only writes its own
> input files for woodWOP. It does not read, modify or reverse-engineer any HOMAG software.

## What it does

1. **Library**: cabinet templates, sheet materials, edgebands and hardware. Edit them in the app,
   or bulk-import CSV / XLSX / JSON (see `examples/import/`). The whole library can be exported or
   imported as a JSON bundle.
2. **Parametric cabinets**: base, wall and tall carcasses. Settings cover width, height and depth;
   materials; toe kick (notched sides); rails or a full top; a dado or butt bottom; and screw,
   dowel or confirmat joinery. The back can be grooved, rabbeted or applied. There are 32 mm
   shelf-pin rows, 35 mm hinge cups with mounting plates on the 32 mm grid, and edgebanding.
3. **Per-job customisation**: each cabinet in a job is a copy of its template. You can change any
   parameter, exclude parts, change the edgeband on any edge, or add custom holes. A 3D view
   (orbit, exploded view, holes shown) updates live.
4. **Cut list** with edgeband compensation and optional pre-mill allowance, plus a BOM: sheets,
   edgeband metres and hardware.
5. **Nesting** (built in): MaxRects with 16 heuristic and order combinations, keeping the result
   with the fewest sheets. It respects grain, rotation rules, edge trim and part spacing (the
   cut-out tool diameter plus extra). The cut order puts small parts first.
6. **MPR per sheet**: `[H` header, `[001` variables, sheet contours, `<100 WerkStck`, then:
   - `<102 BohrVert`, addressed by diameter or by tool number.
   - `<103 BohrHoriz`, only when a horizontal unit is configured; otherwise the holes are listed
     on the labels.
   - `<112 Tasche` router pockets or `<109 Nuten` saw grooves.
   - `<105 Konturfraesen` cut-outs (clockwise, WRKL).

   Files are CRLF and cp1252.
7. **Validator**: checks depth against thickness and the spoilboard allowance, missing tools,
   coordinates outside the sheet, part overlap and spacing, ops outside parts, thin floors, ops
   hitting neighbours, small parts, grain, and skipped horizontal holes. Results show in the UI.
   MPR export is blocked while errors exist, and you must confirm that you will simulate in woodWOP.
8. **Labels**: PDF (100x70 or 100x80 mm) and raw ZPL (203 dpi Zebra). Each label has a Code128
   barcode with the part ID, an edge diagram, the sheet and cut order, and notes ("edge drill",
   "apply to back face"). A sheet-header label comes first for each sheet.
9. **Sheet map PDF**: one A4 page per sheet. It shows the parts, machining, label positions with
   an orientation corner, the machine origin and a parts table. Label positions are worked out per
   part (largest clear spot, away from holes and edges), following the CabinetQuest and Cabinet
   Vision "label on sheet" practice.

## Example outputs

`examples/sample-job/` holds every file generated for the built-in sample kitchen, J1042: four
cabinet types, 43 parts and 3 sheets. It includes the MPRs, labels PDF and ZPL, sheet maps PDF,
cut list and BOM CSVs, and the validation report. To regenerate it, run `npm run sample`.

## Run locally

Requirements: Node 22+ and npm.

```bash
npm install
npm run dev            # browser preview at http://127.0.0.1:41731 (localStorage, downloads as zip)
npm run dev:desktop    # Electron window against the Vite dev server (real file system)
npm test               # vitest: construction, nesting, MPR golden files, validator, labels, import
npm run typecheck
npm run sample         # write examples/sample-job/
```

`npm run test:update-golden` regenerates the MPR golden files in `tests/golden/`. Review the diff
carefully: those files are the contract with woodWOP. If you put real HOMAG sample MPRs in
`reference/samples/` (gitignored), the parser test also reads them.

## Build the Windows installer

```bash
npm run dist:win       # -> release/CabinetStudio-Setup-<version>.exe (NSIS, x64)
```

This works on Windows, and on Linux or macOS without Wine, because `win.signAndEditExecutable` is
off. That leaves the exe unsigned and with the default icon. To sign it, build on Windows with a
code-signing certificate (`CSC_LINK` and `CSC_KEY_PASSWORD`), turn `signAndEditExecutable` back
on, and add `build/icon.ico`.

The installer is per-user, lets you choose the install folder, and creates Start-menu and desktop
shortcuts. Shop data is stored in `%APPDATA%\Cabinet Studio\data\cabinet-studio.json`. Writes are
atomic, and the 30 most recent backups (one at most every 10 minutes) are kept in `data\backups\`.

## Why Electron (not Tauri)

- **One language end to end.** The geometry, nesting, MPR writer, PDF and ZPL code is all
  TypeScript, shared by the UI, the tests and the `sample` CLI. Tauri would add Rust for the
  shell. It would also use the system WebView2, whose WebGL and printing behaviour varies between
  Windows installs.
- **Predictable rendering.** Electron bundles a known Chromium, so the three.js view, the PDFs
  and printing behave the same on every shop PC.
- **File system.** Node `fs` writes directly to network shares such as `\\N200-PC\mpr` with no
  extra plugin permissions.
- **Packaging.** electron-builder produces an NSIS installer from any OS.

The cost is installer size (about 100 MB) and memory, which doesn't matter on a workshop PC.

## Architecture

```
electron/          main process: window, JSON storage with backups, folder export (IPC)
src/core/          pure TypeScript, no React — everything below is unit tested
  types.ts         domain model (mm; cabinet X=width, Y=depth, Z=up; part x=length/grain)
  geometry.ts      frames, world<->part transforms, polygons
  construction/    parametric carcass generator -> parts with drilling/grooves in part coords
  cutlist.ts       job expansion, part numbering/IDs, edgeband cut-size compensation, BOM
  nesting.ts       MaxRects nesting with grain/rotation/spacing/trim
  machining.ts     sheet programs: tool selection, placement transforms, contours, pockets
  mpr/             woodWOP MPR 4.0 writer + minimal parser (tests)
  validator.ts     pre-export checks
  labels/          label placement on parts, labels/sheet-map PDF (jsPDF), ZPL
  library/         CSV/XLSX/JSON import with column aliases, upsert by code
  pipeline.ts      runJob(): expand -> nest -> programs -> validate -> labels
src/app/           zustand store, storage backend (Electron bridge or browser fallback)
src/pages/         Jobs, Job (cabinets / cut list / nesting / output), Cabinet editor, Library, Machine
src/components/    3D viewer (react-three-fiber), sheet view (SVG), forms, shadcn/ui
tests/             vitest + golden MPRs
docs/research/     notes on MPR format, HOMAG docs and label practice
```

Stack: Electron 44, Vite 8, React 19, TypeScript 6, Tailwind 4, shadcn/ui, three.js
(@react-three/fiber), jsPDF with JsBarcode, SheetJS and Papa Parse, and vitest.

## Machine assumptions to confirm

All of these can be set on the **Machine & tools** page:

- Tool numbers and diameters (placeholder data).
- Whether drills are addressed by diameter or by tool number.
- Whether a horizontal drill unit is fitted (off by default).
- Router pockets versus saw grooves.
- Through depth into the spoilboard and the spoilboard limit.
- Contour approach and direction.
- The `OP` and `FM` header values.

See [ROADMAP.md](ROADMAP.md) for the open questions and what comes next.
