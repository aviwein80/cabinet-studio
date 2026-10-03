# Cabinet Studio

Offline desktop program for designing cabinets, then producing nested CNC programs for a
**HOMAG CENTATEQ N-200** nesting router. It runs on Windows and on a MacBook Pro (Apple Silicon).
It writes plain-text **woodWOP MPR 4.0** files, one per sheet, plus part labels, sheet maps, cut
lists and a BOM. It is meant to replace Cabinet Vision for one shop.

The current focus is learning to design in the program: units, a whole-room layout, and real
Salice hinge and Blum drawer-slide boring. Sending programs to the N-200, and filling in the real
tool table, are paused.

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
   shelf-pin rows, Salice Silentia+ 110° hinge cups with 3 mm mounting plates, Blum TANDEM
   undermount slides (15, 18 and 21 in, chosen from the cabinet depth), drawer boxes, and
   edgebanding. Hinge and slide holes are bored into the parts automatically.
3. **Per-job customisation**: each cabinet in a job is a copy of its template. You can change any
   parameter, exclude parts, change the edgeband on any edge, or add custom holes. A 3D view
   (orbit, exploded view, holes shown) updates live. The **Room** tab places every cabinet in the
   job side by side, in plan and in 3D, snapped to walls and to each other.
4. **Millimetres or inches.** The sidebar switches the whole shop. Lengths are stored in
   millimetres. Inches display as fractions to the nearest 1/16 in (for example `23-1/4"`), and
   you can type a decimal or a fraction. Showing the same value again does not change the stored
   millimetres.
5. **Cut list** with edgeband compensation and optional pre-mill allowance, plus a BOM: sheets,
   edgeband metres and hardware. The default sheet is **5 ft × 12 ft (1524 × 3658 mm)**.
6. **Nesting** (built in): MaxRects with 16 heuristic and order combinations, keeping the result
   with the fewest sheets. It respects grain, rotation rules, edge trim and part spacing (the
   cut-out tool diameter plus extra). The cut order puts small parts first.
7. **MPR per sheet**: `[H` header, `[001` variables, sheet contours, `<100 WerkStck`, then:
   - `<102 BohrVert`, addressed by diameter or by tool number.
   - `<103 BohrHoriz`, only when a horizontal unit is configured; otherwise the holes are listed
     on the labels.
   - `<112 Tasche` router pockets or `<109 Nuten` saw grooves.
   - `<105 Konturfraesen` cut-outs (clockwise, WRKL).

   Files are CRLF and cp1252.
8. **Validator**: checks depth against thickness and the spoilboard allowance, missing tools,
   coordinates outside the sheet, part overlap and spacing, ops outside parts, thin floors, ops
   hitting neighbours, small parts, grain, and skipped horizontal holes. Results show in the UI.
   MPR export is blocked while errors exist, and you must confirm that you will simulate in woodWOP.
9. **Labels**: PDF (100x70 or 100x80 mm) and raw ZPL (203 dpi Zebra). Each label has a Code128
   barcode with the part ID, an edge diagram, the sheet and cut order, and notes ("edge drill",
   "apply to back face"). A sheet-header label comes first for each sheet.
10. **Sheet map PDF**: one A4 page per sheet. It shows the parts, machining, label positions with
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

## Install on your own computer

Both builds are **unsigned** and use the default Electron icon. That is fine for the shop. The
program does not need an internet connection after it is installed.

Shop data is one JSON file, `cabinet-studio.json`, with atomic writes. The 30 most recent backups
(one at most every 10 minutes) sit in a `backups` folder next to it.

### Windows

1. Copy `release/CabinetStudio-Setup-0.1.0.exe` onto the PC (USB is fine).
2. Double-click the installer.
3. Windows SmartScreen will say the publisher is unknown, because the file is not signed. Click
   **More info**, then **Run anyway**.
4. Choose a folder if you want one, then finish. The installer adds a desktop shortcut and a
   Start-menu shortcut named Cabinet Studio.
5. Open Cabinet Studio. The shop file is
   `%APPDATA%\Cabinet Studio\data\cabinet-studio.json`.

To build the installer yourself: `npm run dist:win`. It is an NSIS installer for 64-bit Windows.
Signing is off (`win.signAndEditExecutable`), so the build does not need a certificate. On Linux
the NSIS step needs Wine, including the 32-bit `wine32` package.

### Mac (Apple Silicon)

The Mac file is a zip of the app, built for **arm64** (M1, M2, M3, M4). A disk image is not used,
because making a `.dmg` needs macOS.

1. Copy `release/CabinetStudio-0.1.0-arm64-mac.zip` onto the MacBook.
2. Double-click the zip to unpack it. Drag **Cabinet Studio.app** into **Applications**.
3. The first launch is blocked, because the app is unsigned. Do not double-click it.
   **Right-click** (or Control-click) **Cabinet Studio**, choose **Open**, then click **Open**
   in the dialog. macOS remembers that choice.
4. If macOS says the app is damaged, or from an unidentified developer, and Open is not offered,
   open Terminal and run:

   ```bash
   xattr -cr "/Applications/Cabinet Studio.app"
   ```

   Then right-click the app and choose **Open** again. `xattr -cr` clears the quarantine flag
   that Safari and AirDrop put on downloaded files.
5. The shop file is
   `~/Library/Application Support/Cabinet Studio/data/cabinet-studio.json`.

To build the zip yourself, from this repo: `npm run dist:mac`. That sets
`CSC_IDENTITY_AUTO_DISCOVERY=false` and `mac.identity` to null, so electron-builder does not look
for an Apple signing certificate. It can be built on Linux; it downloads the arm64 Electron
binary and packs a zip.

A shop file saved by an older build keeps the sheet sizes it already has. A new install, and
**New material** in the library, use 1524 × 3658 mm.

## Hardware numbers in use

These are the published figures the generator bores. Anything the catalogs leave open is called
out in `src/core/hardware/specs.ts`.

- **Salice Silentia+ Series 700, 110°, full overlay, K = 3.** Cup Ø35 × 13.5 mm deep, centre
  20.5 mm from the door edge. Plate screws Ø5 × 11 mm, 37 mm back from the front and 32 mm apart
  (euro-screw plate B2VGV, H = 3). Series 200 cups are 15.5 mm deep and are not used. The
  wood-screw plate B2V3V is not bored. How many hinges a door gets is by door height, then snapped
  onto the 32 mm grid; Salice's chart also depends on door weight, which this program does not
  model.
- **Blum TANDEM plus BLUMOTION 563H**, frameless. 15 in (`563H3810B`) for an 18 in cabinet, 18 in
  (`563H4570B`) for 21 in, 21 in (`563H5330B`) for 24 in. Cabinet-side holes are Ø5 × 12 mm on the
  37 mm System 32 line. Blum's maximum drawer-side thickness is 16 mm; box sides are cut from the
  carcass sheet (usually 18 mm) so they nest with the cabinet, and the editor warns about that.
  The elongated adjustment holes are not pre-bored.

## Why Electron (not Tauri)

- **One language end to end.** The geometry, nesting, MPR writer, PDF and ZPL code is all
  TypeScript, shared by the UI, the tests and the `sample` CLI. Tauri would add Rust for the
  shell. It would also use the system WebView2, whose WebGL and printing behaviour varies between
  Windows installs.
- **Predictable rendering.** Electron bundles a known Chromium, so the three.js view, the PDFs
  and printing behave the same on every shop PC.
- **File system.** Node `fs` writes directly to network shares such as `\\N200-PC\mpr` with no
  extra plugin permissions.
- **Packaging.** electron-builder produces an NSIS installer and an Apple Silicon zip from any OS.

The cost is installer size (about 100 MB) and memory, which doesn't matter on a workshop PC.

## Architecture

```
electron/          main process: window, JSON storage with backups, folder export (IPC)
src/core/          pure TypeScript, no React — everything below is unit tested
  types.ts         domain model (mm internally; cabinet X=width, Y=depth, Z=up; part x=length/grain)
  units.ts         mm storage, fractional-inch display, parse 23-1/4 and 23.25
  hardware/        published Salice Silentia+ and Blum TANDEM boring numbers
  room.ts          placements, wall snap, arrange a run along the back wall
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
