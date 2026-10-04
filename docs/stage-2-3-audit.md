# Stage 2-3 audit (M2.0)

Written October 2026, against `main` at `de85cbd` (spec `a3ee6e9`, build prompt `de85cbd`).
No code was changed in this milestone. This file and `docs/stage-2-3-progress.md` are the only
additions.

Plain-English summary for the owner is at the end of `docs/stage-2-3-progress.md` and in the
run report. This file is the technical record.

---

## 1. Baseline

Run in the cloud build container (Linux x64, Node 22). Laptop timings will differ.

| Check | Result |
|---|---|
| `npm install` | OK (deprecation notices only: rimraf 2, inflight, glob 7, all transitive) |
| `npm test` | **217 passed, 1 skipped (218 total)**, 21 files, ~15 s |
| `npm run typecheck` | Clean, ~17 s |
| `npm run lint` | 0 errors, **17 warnings** (all pre-existing, all in React UI files plus two `no-control-regex`) |
| `npm run build` | OK, ~20 s. Main chunk 2.98 MB (889 kB gzip); `batch.worker` 1.1 MB; pdf.js worker 1.26 MB |
| `npm run sample` | Runs. MPRs, CSVs and reports are byte-identical. **Two PDFs differ** (see below) |

Notes:

- The "218 passing" in the prompt is 217 passing + 1 skipped. The skipped test is
  `tests/mpr.test.ts` "parses reference samples (if present locally)", which only runs when real
  HOMAG MPRs are put in `reference/samples/` (gitignored). That is expected.
- The 17 lint warnings are the baseline. "Zero new warnings" is measured against this list.
- `npm run sample` differences (pre-existing, not caused by this audit; the working tree was
  restored afterwards):
  - `J1042_labels_100x70.pdf`: the committed file predates the label copy counter added in C7.
    The fresh output prints `cut 1 · 2 of 5` where the committed one prints `cut 1`. The committed
    example is simply stale.
  - `J1042_sheet-maps.pdf`: only `/CreationDate` and `/ID` differ. jsPDF stamps the current time,
    so this file can never be byte-identical between runs. This breaks the "same output" bar for
    this one file. Fix is one line (fixed creation date / ID from the job), but it changes the
    committed example, so it is listed as a decision.

---

## 2. Architecture as it stands

### 2.1 Data flow

```
CamPart (src/cam/types.ts)            one flat panel: L x W x T, layers, entities on faces 1-6,
  |                                   ordered CamOp list, variables, outlineId, door, review
  |  generatePart(part, machine)      src/cam/toolpath.ts, synchronous, pure
  v
Toolpath[]  { opId, kind, tool, feeds, moves: Move[], intents: Intent[], warnings, stats }
  |                 |                         |                         |
  | moves           | moves                   | intents                 | outline / apertures
  v                 v                         v                         v
sim.ts            post.ts runPost         mpr.ts partProgramOps     core/cutlist expandJob
buildTimeline     (generic text template, -> core/machining         -> nesting.ts / nestShape.ts
carve/heightfield  G-code style, not       buildSheetProgram          (true shape, apertures,
checkRapids        used for the N-200)     -> core/mpr/writer.ts       onion skin, offcuts)
looseMask                                  writeSheetMpr            -> validator.ts validateJob
SimulateDialog                             (+ _B turned-over file)  -> pipeline.ts runJob
                                                                    -> batch.ts runBatchCsv
```

Where it runs today:

- **Part designer**: `generateOp` for every enabled op runs in a `useMemo` on the UI thread on
  every edit (`src/pages/PartDesigner.tsx`). Fine for 2D, impossible for 3D.
- **Job output**: `runJob` runs in a `useMemo` on the UI thread with no cancel
  (`src/app/jobOutput.ts`).
- **Batch**: desktop runs in a `node:worker_threads` Worker in the main process with a
  `SharedArrayBuffer` cancel flag (`electron/main.ts`, `electron/batchWorker.ts`); browser runs
  in a module Web Worker (`src/app/batch.worker.ts`), cancelled by `terminate()`.
- **Simulation**: everything (timeline, carving, rapid check, loose pieces) on the UI thread.

### 2.2 Module summary

| File | Main exports | Notes for Stage 2/3 |
|---|---|---|
| `src/cam/types.ts` | `CamPart` (`version: 1` literal), `FaceId` 1-6, `Layer`, `Geom` (contour, circle, point, text, spline, **poly3d**), `Entity`, `Levels`, `Leads`, `Tags`, `CamOp` = profile / pocket / drill / engrave / vcarve / saw / sweep / code, `Recipe`, `QueryTest` (fields layer, type, closed, diameter, width, height, area, face), `LayerRule(Set)`, `HardwarePattern`, `DoorStyle` | `poly3d` exists but nothing creates it and it is flattened to 2D. No model/mesh/solid reference. |
| `src/cam/doc.ts` | `CAM_FILE_VERSION = 1`, `newPart`, `makeEntity`, `entityContours`, `transformEntity`, `partOutline`, `partApertures`, `fitWorkVolume` (2D only), undo `History`/`commit`/`undo`/`redo`, `serializePart`/`parsePart`, `fnv`, `opInputHash`, `opState` | `parsePart` refuses newer versions but has **no migration step**; it just spreads defaults. `opInputHash` = params + picked entities + tool + thickness. |
| `src/cam/geom.ts` | `P`, `Seg` (L / A with centre + ccw), `Contour`, `TOL {chord 0.001, fit 0.005, join 0.01}`, arcs/lines maths, `fitPoints`, `snapArcs`, transforms `Mat`, intersections, fillet/chamfer/relief | Pure 2D, arc-native. |
| `src/cam/kernel.ts` | `offset`, `boolean`, `normaliseWinding`, `overlapArea`, `unionPolys`, `inflatePolys`, `polyOverlap`, `offsetChain`, `joinContours`, `trim`, `extendTo`, `simplify` | Clipper2 at 1e4 units/mm, refit to arcs and snap to source circles. This is the base for slices, adaptive and 2D rest. |
| `src/cam/toolpath.ts` | `Move` (rapid / feed / arc / drill, **all carry Z**; arc Z is helical), `Intent` (contour with passes, vdrill incl. `back`, hdrill, pocket-rect, saw, comment), `Toolpath`, `GenContext {part, machine}`, `generateOp`, `generatePart`, `toolpathContours`, `orderContours`, `faceToPart`, `sectionDepth` | One sync generator per kind. Any op with `face != 1` other than drill/code is skipped with "needs an aggregate". No tool-axis vector. One tool per toolpath. |
| `src/cam/ops.ts` | `DEFAULT_LEVELS` (safeZ 20, rapidZ 3), `DEFAULT_LEADS`, `DEFAULT_TAGS`, `OP_LABEL`, `defaultOp`, `toTemplate`/`fromTemplate`, `resolveTool`, `feedsFor` (op > material table > tool > 18000 rpm / 5000 / 2000), `passDepths`, `orderByTool` | `resolveTool` knows routers, V, saw, drills only. |
| `src/cam/sim.ts` | `buildTimeline`, `programOrder` (drilling first), `segIndexAt`, `positionAt`, `Heightfield` (Float32 top per cell, default cell `max(0.5, maxSide/500)`), `createHeightfield`, `heightAt`, `carve`, `cutterZ` (flat, ball, V; **bull and `cornerRadius` ignored**), `checkRapids` (cutter footprint vs material, 0.05 mm), `cutSummary`, `looseMask` (4-connected islands; largest = part), `shadeHeightfield` | Part frame only (one part, not a sheet). No shank, holder, spoilboard, table or travel checks. |
| `src/pages/part/SimulateDialog.tsx` | Top view (canvas heightfield + SVG backplot), 3D view (r3f grid mesh downsampled to ~240 cells, tool drawn as a plain cylinder) | All on the UI thread. |
| `src/cam/mpr.ts` | `placeIntent`, `cutoutSegs`, `partProgramOps`, `backPlacement` (x mirrored), `hasBackSide`, `writePartMpr`, `writePartPrograms` (adds `_B.mpr` for face-6 drilling) | One MPR path: intents -> `ProgramOp` -> `writeSheetMpr`. |
| `src/core/mpr/writer.ts` | `writeSheetMpr`, `encodeCp1252`; macros `<100>`, `<101>` comment, `<102>` BohrVert, `<103>` BohrHoriz, `<105>` Konturfraesen (one per pass, ZA = T - depth), `<109>` Nuten, `<112>` Tasche; contour blocks `]n` with `KP`/`KL`/`KA` | **Z is written only on the start `KP`** (always 0); `KL`/`KA` have no Z. No point-count limit or check. So there is no 3D path encoding today. |
| `src/cam/mprRead.ts` | `readMpr`, `arcCentre` | Reads what we write (header, vars, contours, macros) for tests and the program viewer. Not back into toolpaths. |
| `src/cam/post.ts` | `PostTemplate`, `SAMPLE_TEMPLATE` (generic ISO), `parseTemplate`, `runPost` | Our own text-template format. Base for PST-02 script posts and the M2.10 "script post equals template post" test. |
| `src/cam/rules.ts` | `BUILTIN_RECIPES`, `BUILTIN_RULESETS`, `layerMatches` (exact/glob/regex), `depthFromLayerName`, `entityFacts`, `testPasses` (=, !=, <, <=, >, >=, contains, matches), `applyRules` | The minimal query engine CAD-17 extends. |
| `src/cam/solver.ts` | `solve(sketch)` damped least squares; constraints coincident, horizontal, vertical, distance, dx, dy, fix, equal, parallel, perpendicular, angle, onCircle, onLine, tangentCircles, ratio; reports dof and failing | Base for CAD-02 turn-by-turn sketch. |
| `src/cam/dxf.ts` | `parseDxf`, `importDxf`, `dxfToPart`, `importedPart`, `exportDxf` | Skips polyface/mesh entities. |
| `src/cam/doors.ts` | `buildDoor`, `rebuildDoor`, `fieldContour`, `solveCathedral`, `hingeCups` (face 6), `pullHoles`, `parseDoorCsv` | |
| `src/cam/cad.ts`, `snap.ts`, `expr.ts`, `font.ts`, `pdfVectors.ts` | CAD edits, snaps, expressions/typed coords, single-stroke font (`strokeText`, text on arc), PDF vectors | `font.ts` is the base for NEW-24; text-on-arc is a small start on NEW-07 wrap. |
| `src/core/types.ts` | `Tool` (id, number, type router/drill-vertical/drill-horizontal/saw, diameter, maxDepth, shape flat/ball/bull/v/drill/saw/profile, flutes, rpm, feeds, stepdown, centreCutting, maxPlunge, angle, cornerRadius, kerf, spindle, `length` unused), `MachineProfile` (no table size, travel, axes, safe Z or heads; `hasHorizontalDrillUnit`, `grooveMethod`, `spoilboardAllowance`, `throughDepth`, `cutoutToolNumber`, contour settings, header OP/FM, tools, feeds), `FeatureFlags` (10 flags), `AppData {version: 1, library, machine, settings, jobs}` | One machine only. No holder/shank/flute length. |
| `src/core/features.ts` | `DEFAULT_FEATURES` (all on except `camMprOutput: false`), `featuresOf` | |
| `src/core/defaults.ts` | `PLACEHOLDER_MACHINE` (spoilboardAllowance 0.5, throughDepth 0.3, cut-out T101); tools 101 compression 12, 102 spiral 8, 103 spiral 6, 104 V 90° 12.7, 201-204 drills, **140 saw 4 mm** | No ball-nose or tapered tools. The placeholder table **includes a saw** although the saw unit is not confirmed. |
| `src/core/validator.ts` | `validateJob`, `countBySeverity`; codes PLACEHOLDER_TOOLS, TOOL_MISSING, TRIM_SMALL, DEPTH_SPOILBOARD, NOT_NESTED, OUT_OF_SHEET, THICKNESS, GRAIN, SMALL_PART, OVERLAP, SPACING, OP_OUTSIDE, DEPTH, THIN_FLOOR, OP_HITS_NEIGHBOUR, SAW_RUNOUT, CAM_OUTPUT_OFF (error), CAM_TOOLPATH, CAM_BACKSIDE, HORIZONTAL_SKIPPED, SIMULATE | Any error disables MPR export (`JobPage` OutputTab) and blocks a batch order. No "machine cannot do this op", no collision, no gouge, no tool-length check. |
| `src/core/pipeline.ts` | `runJob` (expand -> nest -> programs -> validate -> labels), `mprFiles` | |
| `src/core/nesting.ts`, `nestShape.ts` | `nestMaterial` (MaxRects 16 combos; shape engine with NFPs, apertures, kits, priorities, cache, time limit 8 s), `orderForCutting`, `remnantsOf`; `Placement.flip` = 180° in-plane turn only | Onion skin lives in `core/machining.ts` (first cut-out pass leaves a skin, repeat pass at the end). |
| `src/core/offcuts.ts`, `batch.ts`, `batchWatch.ts`, `cancel.ts`, `units.ts` | `updateOffcutStock`; `parseBatchCsv`, `itemPart` (part / door / drawing), `runBatchCsv`; `InboxWatcher`; `Cancelled`, `checkCancel`; `formatInches`, `parseLength` | Batch kinds are part, drawing, door only. |
| `src/pages/MachinePage.tsx` | Machine settings, nesting, labels, Custom-part features switches, tool table | **Only 6 of the 10 flags have a switch** (camNesting, camBatch, camBackplot, hardwarePatterns are missing). Tool table edits only number, type, name, Ø, max depth, and shows them in mm even in inch mode. |
| `electron/` | IPC: data load/save (atomic, 30 backups), export, save file, open, pick folder, AI key store/call, batch start/stop/cancel/status | `contextIsolation`, `sandbox: true`. Renderer loaded from files. |
| `vite.config.ts` | `base './'`, CSP in production: `script-src 'self'`, `worker-src 'self' blob:` | **CSP has no `'wasm-unsafe-eval'`**, so any WASM (meshoptimizer, OpenCascade, Manifold, QuickJS) is blocked in the built app today. |

### 2.3 Tests

21 files. CAM: `cam-cad` (12), `cam-doors` (12), `cam-foundation` (6), `cam-golden` (~25 at
runtime), `cam-import` (9), `cam-kernel` (7), `cam-native` (10), `cam-rules` (6), `cam-sim` (8).
Reference parts `tests/cam-reference.ts` ref01..ref20 (holes, tabs, arched door, shelf side,
hinge cups, round top, pockets offset/island/zig-zag/spiral, engraving, text, V-carve star, saw
grooves, raised-panel sweep, edge drilling, peck, 38 mm three-cut, open shapes, bracket).
`digest(tp)` = op name, kind, tool number, move counts, cut length (0.1), XY box of non-rapid
moves (0.001), zMin, intent counts, warnings, first 4 moves. Each reference also checks the
`part.json` round trip, the MPR byte-for-byte, `readMpr` structure, Z floor and XY slack.

`UPDATE_GOLDEN=1` is read by `cam-golden.test.ts` and `mpr.test.ts`; `npm run
test:update-golden` only runs `mpr.test.ts`. A missing golden file is written on first run
(silently passes). For 3D goldens I will make a missing file **fail** unless `UPDATE_GOLDEN=1`,
so a lost fixture can never pass by accident.

---

## 3. Known overlaps, checked

| Question | Finding |
|---|---|
| Parallel finishing (3D-02) "Stage 1" | Not built. No 3D op kind, no mesh, no drop-cutter. Build it first in M2.2. |
| Loose-piece detection (SIM-05) | `looseMask` exists: 4-connected islands of uncut cells, largest island = the part. Missing: keep several parts (a sheet), mark scrap vs part, drop pieces from the stock, run on a sheet. |
| Turned-over face-6 program (NST-07) | Per part only, and only drilling: face-6 holes go into `<name>_B.mpr` with x mirrored. Nesting's `flip` is an in-plane half turn, not face-down. No face-6 milling, no whole-sheet flip program, no registration. |
| Onion skin (NST-05) | Exists for cut-outs of small parts (`onionSkin`, `onionSkinMaxArea` in nest settings, `machining.ts`). Bridged nesting can reuse its two-pass pattern. |
| Minimal query engine (CAD-17) | `entityFacts` + `testPasses` + `applyRules`: 8 fields, 8 operators, all-tests-pass, first rule wins. No OR groups, no solids/faces, no auto-query to layer without a recipe. |
| Tool shapes `ball` / `bull` | In `ToolShape`. `ball` only used by `sim.cutterZ`. `bull` and `cornerRadius` are unused anywhere (sim treats bull as flat). No holder, shank or flute-length fields. |
| Does `Move` carry Z everywhere? | Yes: rapid, feed, arc (helical end Z) and drill all carry Z, so 3-axis 3D paths fit the IR as is. Gaps: (1) no tool-axis vector (needed from M3.3/M3.4, add as an optional field then); (2) memory: one JS object per move is ~100 bytes; a 200k-triangle finishing pass can be several million points, so I propose one compact variant (section 5.3). |

Other findings (not asked, but they matter):

1. **`opInputHash` misses machine and material inputs.** It hashes op params, picked entities,
   the tool and thickness, but not `machine.throughDepth` or the material feed table, so changing
   the through depth or a material feed does not mark ops stale. Low risk today (MPR output is
   off), but 3D ops depend on more inputs (model, stock, machine), so I will fix the hash in
   M2.1. Side effect: every saved op shows "stale" once after upgrading until "Accept all" or a
   regenerate. Toolpaths and goldens do not change. (Decision 7.)
2. **Placeholder saw.** `PLACEHOLDER_MACHINE` has saw T140 and saw-groove ops write `<109 Nuten>`
   when custom-part output is on. The prompt says the saw unit is unconfirmed. Once the machine
   model exists (M2.1), saw output will need the model to declare a saw unit. (Decision 3.)
3. **WASM is blocked by the production CSP** (section 2.2). Needs `'wasm-unsafe-eval'` in
   `script-src`. That is the narrowest allowance that lets WASM compile without allowing `eval`.
4. **Electron and `.wasm` files.** The renderer is loaded from files inside `app.asar`.
   `WebAssembly.instantiateStreaming` needs a proper MIME type and fetch over `file://` is
   unreliable. Plan: register a privileged `app://` protocol (standard, secure, fetch-enabled)
   that serves the bundle, and `asarUnpack` the `.wasm` files. I will prove this on a small WASM
   (meshoptimizer) in M2.1 before OpenCascade depends on it.
5. **Sim frame.** The simulator works on one part. M2.4's "full 5 x 12 ft sheet at 1 mm cells"
   needs a sheet timeline built from the nest placements (`placementTransform`). 3658 x 1524 at
   1 mm is 5.6 M cells (22 MB as Float32), fine for memory; 30 fps needs the heightfield drawn
   as a GPU texture/displacement, not a rebuilt mesh.
6. **Spec counts.** I count **55** unique Stage 2 IDs (TOOL-04 appears in M2.1 and M2.7; counted
   once) and 23 Stage 3 IDs, 78 in all, not 54 + 23 = 77. No feature is missing either way; the
   table below lists all 78.

---

## 4. Feature-by-feature status

Done = usable as specified. Partly = something real exists to build on. Missing = nothing yet.

### Stage 2

| ID | Milestone | Status | What exists today |
|---|---|---|---|
| CAD-13 | M2.1 | Missing | No STL/OBJ/3MF reader. |
| NEW-18 | M2.1 | Missing | No mesh type or utilities. |
| SOL-05 | M2.1 | Partly | `fitWorkVolume` fits L x W to the 2D outline. No Z levels, no model, no oversize. |
| 3D-12 | M2.1 | Partly | Kernel tolerances are settable (`TOL`); batch already runs in a worker with cancel. Interactive toolpaths and sim run on the UI thread. |
| TOOL-04 | M2.1 (fields) / M2.7 (library) | Missing | Only an unused `Tool.length`. |
| 3D-02 | M2.2 | Missing | No 3D op kind. |
| 3D-01 | M2.2 | Missing | 2D pocket strategies (offset, zig-zag, spiral, helix/ramp entry honouring `centreCutting`/`maxPlunge`) can be reused per slice. |
| 3D-03 | M2.2 | Missing | |
| 3D-04 | M2.2 | Missing | 2D engrave and stroke text exist as the source patterns. |
| 3D-11 | M2.2 | Missing | |
| NEW-01 | M2.3 | Missing | Clipper2 booleans in place for swept-area engagement. |
| 2D-07 | M2.3 | Missing | |
| 3D-06 | M2.3 | Missing | |
| SIM-02 | M2.4 | Partly | Timed timeline, play/seek, heightfield carve (flat/ball/V), top and 3D views, cut summary. No `StockModel` interface, no bull cutter, no section/transparency, no STL export, no stop-at-tool-change, UI thread only, part only. |
| SIM-03 | M2.4 | Partly | Rapids into material (cutter footprint vs heightfield). No shank, holder, spoilboard, table or travel checks; not fed to the export checker. |
| SIM-05 | M2.4 | Partly | `looseMask` (see section 3). |
| NEW-13 | M2.4 | Missing | `MachineProfile` has no axes, travel, table, tool-change position, heads or capabilities. |
| CAD-14 | M2.5 | Missing | |
| CAD-16 | M2.5 | Missing | `poly3d` entity type exists, unused. |
| NEW-19 | M2.5 | Missing | |
| SOL-01 | M2.5 | Missing | Layer rules exist to receive recognised features. |
| SOL-02 | M2.5 | Missing | |
| SOL-03 | M2.5 | Missing | |
| SOL-04 | M2.5 | Missing | |
| 2D-11 | M2.6 | Partly | Saw-groove op: vertical, straight lines only, `<109 Nuten>`. No angle, extend-to-clear, minimum length, blade display, neighbour avoidance, collinear join, or machine-unit gate. |
| 2D-13 | M2.6 | Missing | V-carve and V tools exist. |
| 2D-15 | M2.6 | Missing | Profiled sweep is related (section along a guide). |
| 2D-16 | M2.6 | Missing | |
| NEW-09 | M2.6 | Missing | |
| NEW-11 | M2.6 | Partly | Profile start point (`start`), reverse, order. No feed/Z edits, corner slow-down, pocket start points, edit persistence. |
| 5AX-04 | M2.6 | Missing | Non-face-1 milling is refused with a warning. |
| CAD-02 | M2.7 | Partly | Constraint solver (`solver.ts`) used by doors. No element-by-element sketch UI. |
| CAD-08 | M2.7 | Partly | Measure tool only. No dimension entities, no print to scale. |
| CAD-17 | M2.7 | Partly | Minimal query engine (section 3). |
| CAD-18 | M2.7 | Partly | Rectangular array and bolt-circle helpers. No fill-a-boundary. |
| NEW-05 | M2.7 | Missing | |
| NEW-06 | M2.7 | Missing | |
| TOOL-05 | M2.7 | Partly | Tool table CSV export/import. Ops store only `toolId`; stale flag sees tool edits. No compare/update screen, no spreadsheet. |
| NEW-15 | M2.7 | Partly | `EditableTable` grid, 5 tool columns. |
| NST-04 | M2.8 | Missing | |
| NST-05 | M2.8 | Missing | Onion skin exists. |
| NST-07 | M2.8 | Partly | Per-part face-6 drilling program (section 3). |
| NST-09 | M2.8 | Missing | Sheet view is display only. |
| NEW-20 | M2.8 | Partly | Sheet utilisation % and remnants. No cost, no per-part area report. |
| AM-03 | M2.9 | Missing | |
| AM-06 | M2.9 | Missing | Single JSON file. |
| AM-08 | M2.9 | Missing | One machine in `AppData`. |
| AM-09 | M2.9 | Missing | Batch kinds: part, drawing, door. |
| AM-10 | M2.9 | Missing | |
| AM-13 | M2.9 | Partly | "Sort by tool" (`orderByTool`), missing-recipe list from `applyRules`. No password, no hidden screens. |
| API-01 | M2.10 | Missing | |
| PST-02 | M2.10 | Partly | Text-template post (not a script). |
| PST-04 | M2.10 | Partly | Program dialog shows macros and raw MPR. No editor, no copy to machine folder. |
| NEW-22 | M2.10 | Partly | `readMpr` reads our MPR structure, not back into `Move`s. No G-code reader. |
| ART-01 | M2.11 | Missing | |

### Stage 3

| ID | Milestone | Status | What exists today |
|---|---|---|---|
| 3D-05 | M3.1 | Missing | |
| 3D-07 | M3.1 | Missing | |
| 3D-08 | M3.1 | Missing | |
| 3D-09 | M3.1 | Missing | |
| NEW-08 | M3.2 | Missing | Helical arcs exist in the IR (pocket helix entry). |
| NEW-07 | M3.2 | Partly | Text on an arc only. |
| NEW-21 | M3.2 | Partly | jsPDF sheet maps and labels. No hatch, detail views, line types or scale prints of parts. |
| NEW-24 | M3.2 | Partly | Built-in single-stroke font. No editor. |
| 2D-18 | M3.2 | Missing | |
| 3D-10 | M3.3 | Missing | |
| NEW-14 | M3.3 | Missing | |
| 5AX-01 | M3.4 | Missing | |
| 5AX-02 | M3.5 | Missing | |
| 5AX-03 | M3.5 | Missing | |
| TOOL-07 | M3.5 | Missing | |
| NEW-26 | M3.5 | Missing | |
| SIM-06 | M3.6 | Missing | |
| SIM-04 | M3.6 | Missing | |
| FIX-01 | M3.6 | Missing | |
| 2D-19 | M3.7 | Out of scope | Not yet listed in `ROADMAP.md` (done in M3.7). |
| AM-14 | M3.7 | Out of scope | As above. |
| ROB-01 | M3.7 | Out of scope | As above. |
| LAT-01 | M3.7 | Out of scope | As above. |

Totals: Stage 2: 0 done, 19 partly, 36 missing. Stage 3: 0 done, 3 partly, 16 missing, 4 out of scope.

---

## 5. Proposed design for 3D

### 5.1 File layout (confirms the prompt's suggestion, two additions)

```
src/cam/mesh/        Mesh type, STL (binary/ASCII) / OBJ / 3MF read, weld, repair report,
                     simplify, Z sections, outline projection, facet delete, mesh->polylines
src/cam/model/       ModelRef, blob store interface, content hashing, migrations helper   (new)
src/cam/3d/          CL-surface engine (drop-cutter), Z-level roughing, parallel, waterline,
                     projection, pencil, rest; independent gouge checker
src/cam/adaptive/    constant-engagement clearing (2D and per Z level), 2D rest
src/cam/stock/       StockModel interface, heightfield implementation (later tri-dexel)
src/cam/collision/   shank / holder / rapid / spoilboard / table / travel checks
src/cam/machine/     MachineModel, N-200 profile, (later) kinematics
src/cam/solid/       OpenCascade wrapper (worker-only), recognition
src/cam/worker/      compute worker entry, typed task protocol, client with progress/cancel  (new)
src/cam/plugin/      plugin and script-post sandbox (M2.10)
src/pages/part/      UI
```

### 5.2 Mesh type and where models live in `CamPart`

```ts
// src/cam/mesh/types.ts
interface Mesh {
  positions: Float32Array      // welded vertices, mm, part frame (z = 0 at face 1, down negative)
  indices: Uint32Array         // 3 per triangle, outward CCW
  faceGroup?: Uint32Array      // per triangle: source face id (STEP faces, OBJ groups)
  bounds: { min: [number, number, number]; max: [number, number, number] }
}
interface MeshReport { triangles; vertices; welded; degenerate; flippedFixed; openEdges; nonManifoldEdges; units }

// src/cam/types.ts (additions)
interface ModelRef {
  id: string
  name: string
  kind: 'mesh' | 'solid' | 'heightmap'
  blob: string                 // content hash (SHA-256) of the stored data; also the cache key
  units: 'mm' | 'in' | 'cm' | 'm'
  /** Placement into the part: scale, rotation about Z (and 90° tilts), translation, mirror. */
  place: { scale: [number, number, number]; rotZ: number; tilt: 0 | 90 | 180 | 270; axis: 'x' | 'y'; at: [number, number, number]; mirror?: boolean }
  layer: string
  faces?: { id: number; color?: string; layer?: string; type?: string }[]   // solids: face ids kept
  report?: MeshReport
}
interface CamPart { ...; version: 1 | 2; models?: ModelRef[]; stock?: { top: number; bottom: number; oversize: { xy: number; z: number } } }
```

Positions are stored as Float32 (precision ~0.0001 mm at 3.7 m, well inside 0.005 mm), all
maths in Float64.

### 5.3 How 3D ops fit `CamOp`, and the IR

New op kinds, one generator each behind `generateOp`:

- `zrough`: Z-level roughing (`clear: 'offset' | 'zigzag' | 'spiral' | 'adaptive'`, step-down,
  intermediate slices, flats as levels, entry helix/ramp/pre-drill, stay-down links,
  `restFrom` previous ops/stock).
- `finish3d`: `strategy: 'parallel' | 'waterline' | 'projection' | 'pencil' | 'rest'` (Stage 3
  adds `radial | spiral | scallop | flat | helical | undercut | curve`). Common fields: step-over,
  angle, one-way/zig-zag, climb/conventional, slope limits, skip flats, fill shallow, tolerance.
- Shared `Surface3D` block on both: `modelId`, `boundary` (entity ids + `contained | centre |
  touching`), `protect` (face ids/groups), `stockToLeave {xy, z}`, `chordTol` (0.01 finish, 0.05
  rough), `gougeCheck: true`.
- 2D adaptive and 2D rest become pocket options (`pattern: 'adaptive'`, `rest: { from, minLength }`)
  rather than new kinds, so recipes and layer rules work unchanged.

IR: keep `Move`, `Intent`, `Toolpath`. Add **one** compact move variant for long 3D chains:

```ts
| { t: 'poly'; pts: Float64Array /* x,y,z triples */; f: FeedKind }
```

Every consumer (stats, sim timeline, post, digest, MPR) gets a case for it. This keeps one IR
while cutting memory roughly 4x and making worker transfer zero-copy. No new `Intent` until the
owner answers how 3D reaches woodWOP (5.9).

Associativity: `opInputHash` adds `model.blob` (the hash, never the data), the model placement,
stock settings, the machine fields an op reads, and the material feed row. Large data is hashed
once on import.

### 5.4 Algorithm choice

- **CL-surface engine** (own TypeScript): exact drop-cutter for flat, ball, bull-nose and V
  cutters against triangles (vertex, edge, facet tests), triangles bucketed in a 2D grid / BVH
  over XY. Parallel and projection finishing sample it along their 2D paths with adaptive
  refinement to the chord tolerance.
- **Waterline and Z-level slices** from the same engine: contours where the cutter-location
  height crosses a level (marching squares on a sampled grid, each crossing then refined by
  bisection with exact drop-cutter), fed into the 2D kernel as closed contours. Roughing then
  reuses the existing pocket strategies per level. Every final point is an exact drop-cutter
  result, so finishing cannot gouge by construction; the checker below proves it.
- **Independent gouge checker** (`src/cam/3d/check.ts`): brute-force distance from each cutter
  position (densely sampled along moves) to every nearby triangle using different code (sphere
  / torus / cylinder distance), not the drop-cutter. Tests also check analytic surfaces in
  closed form (hemisphere, sine, cove, raised field).
- OpenCAMLib: no maintained WASM build I would trust; write in TypeScript as the spec allows.

### 5.5 Workers

- One **module Web Worker** pool in the renderer (`src/cam/worker/`), same code in Electron and
  the browser preview: import/parse, simplify, sections, 3D generation, stock carving, collision.
  Pool size `min(4, cores - 1)`. Results come back as transferable typed arrays and are
  re-ordered by task index (determinism).
- **Progress** via messages. **Cancel**: cooperative `checkCancel` with a `SharedArrayBuffer`
  flag where available, and always a hard `terminate()` + respawn as the fallback (the work is
  pure, so killing it is safe).
- `generateOp` stays pure and synchronous. The designer stops calling it in `useMemo` for 3D
  kinds: it asks the worker and caches results keyed by `opInputHash`. Batch already runs in a
  worker and calls the pure functions directly. Tests call them directly.
- `runJob` in the UI moves to the worker too once 3D ops can appear in a job (M2.2).

### 5.6 WASM loading

Each WASM is a separate, unmodified file copied from its npm package into the build (not
inlined), loaded with `fetch` + `WebAssembly.instantiate` **inside the worker that needs it** on
first use. Never in the start-up bundle. Offline: shipped in the app. Production CSP gets
`'wasm-unsafe-eval'`; Electron serves the app through a privileged `app://` protocol and the
`.wasm` files are `asarUnpack`ed. Proven first on meshoptimizer (M2.1), then OpenCascade (M2.5)
on Windows x64 and macOS arm64 builds.

### 5.7 Stock model and collision interfaces

```ts
interface StockModel {
  carve(seg: { a: V3; b: V3 }, cutter: CutterProfile): void      // swept along a move
  heightAt(x: number, y: number): number
  occupied(x: number, y: number, z: number): boolean
  maxInDisc(x: number, y: number, r: number): number             // fast collision query
  removedVolume(): number
  toMesh(): Mesh                                                 // watertight
  snapshot(): StockSnapshot; restore(s: StockSnapshot): void
  bounds(): Box3
}
interface CutterProfile { flute: Revolved; shank: Revolved; holder: Revolved }   // z-from-tip -> radius
```

The heightfield implements it first (exact for a vertical 3-axis tool) and gains the bull cutter.
Collision: `checkCollisions(timeline, stock, machine, opts): Collision[]` with
`kind: 'shank' | 'holder' | 'rapid' | 'spoilboard' | 'table' | 'travel' | 'clamp'`, move index,
op, position, intrusion and message; margin default 2 mm (setting). The validator gets
`COLLISION` (error) and the export checker blocks on it. 3D ops also run the shank/holder check
against the design model at generation time and warn before simulation.

### 5.8 Machine model

`MachineProfile` gains an optional `model: MachineModel` (no second machine system):

```ts
interface MachineModel {
  axes: { id: 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C'; min: number; max: number }[]
  table: { length: number; width: number }               // N-200 default 3658 x 1524 until told otherwise
  spoilboard: { thickness: number }                      // allowance stays in spoilboardAllowance
  toolChange: { x: number; y: number; z: number }
  safeZ: number
  heads: { id: string; kind: 'spindle' | 'drill-block' | 'saw' | 'aggregate'; ... }[]
  capabilities: { mill3d: boolean; saw: boolean; aggregate: boolean; horizontalDrill: boolean; rotary: boolean; positional: boolean; simultaneous5: boolean }
}
```

The N-200 profile declares X/Y/Z, `saw: false`, `aggregate: false`, `rotary/positional/5: false`;
`horizontalDrill` mirrors the existing switch. Validator gets `MACHINE_CANNOT` (error) for any op
the model lacks. Travel limits, origin and tool-change position for the N-200 are unknown and stay
placeholder until the owner confirms (Decision 3). AM-08 (several machines) later turns
`AppData.machine` into a list with an active one, same type.

### 5.9 How 3D paths could reach woodWOP (owner decision, output stays off)

Today the writer cannot carry per-point Z. Options, none implemented until decided:

1. **Constant-Z ops as native contours.** Z-level roughing and waterline produce 2D contours at
   fixed depths, which are exactly what `<105>` with one `ZA` per pass already writes. No new
   encoding. Recommended first step.
2. **True 3D chains** (parallel, projection, pencil): a contour whose elements carry a Z per point,
   if woodWOP 4.0 accepts that. I will not guess the syntax or the point limit. I need either the
   woodWOP documentation page for 3D contour elements or a small 3D program saved from woodWOP on
   the shop PC; then I write it, split long chains at a point limit, and golden-test it.
3. Keep 3D finishing simulation-only for the N-200 and output G-code only for other machines via
   script posts.

New switches, all **off**: `cam3dMprOutput` (option 1 and later 2).

### 5.10 Feature switches (proposed)

Screens (default on once their milestone passes): `cam3d` (mesh import + 3D ops),
`camAdaptive`, `camStockSim`, `camCollision`, `camSolids`, `camCad2` (sketch, dimensions, queries,
trace), `camNesting2` (shared line, bridges, manual), `camBatch2`, `camPlugins` (default off:
runs third-party code), `camRelief`. Machine output (always default **off**): `cam3dMprOutput`,
`camSawOutput`, `camAggregateOutput`, `camFlipSheetOutput`, `camScriptPostOutput`. Also add the 4
missing switches (camNesting, camBatch, camBackplot, hardwarePatterns) to the Machine page.

### 5.11 Document format, storage and migration

- `CAM_FILE_VERSION` -> 2 in M2.1; `CamPart.version: 1 | 2`. `parsePart` runs an ordered list of
  `migrate(raw, from)` steps. v1 -> v2 adds nothing required (models and stock are optional), so a
  v1 part loads unchanged. Test: every `tests/golden/cam/refNN/part.json` (all v1) loads, matches
  the builder, and regenerates **byte-identical** toolpath digests and MPRs; Stage 1 goldens do not
  change.
- **Blobs (meshes, B-rep, height maps) never go into `cabinet-studio.json`.** They are stored
  content-addressed and compressed next to it: `data/blobs/<sha256>.bin.gz` via new IPC
  `blob:put/get/has` (desktop) and IndexedDB (browser preview). Blobs are immutable, so the 30
  JSON backups stay valid. Unreferenced blobs are removed only after 30 days. The batch worker
  reads the same folder. Part export (`.csp.json`) embeds its blobs (gzip + base64) so a single
  file stays portable; import splits them back out.
- `AppData.version` stays 1: new tool and machine fields are optional with defaults.

---

## 6. New dependencies proposed

None are added in M2.0. Each is added only in the milestone that needs it, after a transitive
licence check (`npx license-checker --production --summary`, results in the report).

| Package | Version seen | Licence | Size | Milestone | Why |
|---|---|---|---|---|---|
| `meshoptimizer` | 1.3.0 | MIT | 313 kB package (simplifier ~68 kB) | M2.1 | Mesh simplify with an error metric; small; also the WASM-loading pilot. Fallback: own quadric simplifier. |
| `replicad-opencascadejs` | 1.1.0 | LGPL-2.1-only | 22.5 MB `.wasm` (separate file) | M2.5 | OpenCascade build with full B-rep topology (face types, adjacency) needed for recognition within 0.01 mm. Loaded lazily in a worker, unmodified, licence + notice shipped. |
| `occt-import-js` | 0.0.23 | LGPL-2.1 | 7.6 MB `.wasm` | M2.5 (maybe) | Smaller STEP/IGES/BREP -> mesh with face groups, colours and assembly names. Mesh only (no face types), so not enough alone; used only if the B-rep build lacks assembly/colour reading. Decided by a spike in M2.5. |
| `opencascade.js` | 1.1.1 | LGPL-2.1-only | 67 MB package | Not proposed | Last release 2023; too large; custom builds need its Docker toolchain. |
| `three-mesh-bvh` | 0.9.15 | MIT | 2.3 MB | M2.4/M2.5 (maybe) | Fast picking of faces in the 3D view. Not used for toolpath maths (own code, testable). |
| `manifold-3d` | 3.5.4 | Apache-2.0 | 0.54 MB `.wasm` | Stage 3 (maybe) | Not needed for M2.4: a heightfield stock turns into a watertight mesh directly. Useful for tri-dexel stock and SIM-04. |
| `quickjs-emscripten` | 0.32.0 | MIT | 2.4 MB | M2.10 | Sandbox for plugins and script posts (no file/network unless granted). |
| SQLite | - | - | - | M2.9 | Prefer Node's built-in `node:sqlite` in Electron's main process (no native module to rebuild for Windows x64 and macOS arm64). Fallback `better-sqlite3` (MIT, native). Decided in M2.9. |
| `imagetracerjs` | 1.2.6 | Unlicense (public domain) | 3.2 MB package | M2.7 (maybe) | Image trace. Or own (marching squares + fit to arcs with the existing `fitPoints`). |
| Not allowed | CAMotics, LibreDWG, potrace, any GPL/AGPL | - | - | - | - |

---

## 7. Risks and unknowns

1. **3D output to woodWOP is undefined** (5.9). Without an answer, 3D work is simulation-only
   on the N-200. Constant-Z ops are the safe partial answer.
2. **N-200 facts are unknown**: travel limits, table size beyond the sheet, origin, spoilboard
   thickness, tool-change position, saw unit, aggregate. Collision and "off the table" checks use
   placeholders and say so.
3. **No real 3D tools.** I will add placeholder ball-nose (6 and 3 mm), bull-nose (12 mm r2) and
   tapered tools marked placeholder, with placeholder holders and stick-outs. Banner stays.
4. **Performance targets are set for a mid-range laptop**; I can only measure in the cloud
   container. I will report container numbers, keep perf tests that fail on a 2x regression, and
   give you a one-line command to time it on your own machine.
5. **WASM in the packaged Electron app** (CSP, `app://`, asar) is the main technical risk for
   M2.5. Retired early on a small WASM in M2.1.
6. **OpenCascade size** (22.5 MB) grows the installer roughly 25%, but not start-up (lazy).
7. **Large 3D toolpaths in the UI** (millions of points): drawn as GPU line buffers, not React
   elements.
8. **Determinism across Windows/macOS**: `Math.sin/cos` can differ in the last bit between
   platforms. Goldens hash quantised moves (0.001 mm), and generators avoid decisions that hinge
   on exact float ties.
9. **Schedule**: ~210 pw (Stage 2) + 80-100 pw (Stage 3) of estimate. One milestone per run;
   M2.2 and M2.5 will each take several runs.
10. **Pre-existing**: sample PDFs not reproducible (section 1); 4 feature switches missing from
    the Machine page; tool table can't edit shape/angle; `opInputHash` gap (section 3).

---

## 8. Changes to the milestone order (proposed, not applied)

1. **Machine model data (NEW-13 core) moves into M2.1.** Holder fields, the export checker's
   "machine cannot do this", collision limits and the saw gate all need it. Sim/collision use of
   it stays in M2.4.
2. **`StockModel` interface + bull cutter move into M2.1** (wrapping today's heightfield, no
   behaviour change). M2.2's gouge/stock checks and M2.3's rest machining need it.
3. **WASM/CSP/`app://` groundwork in M2.1** (with meshoptimizer), not M2.5.
4. **M2.2 split** into M2.2a CL-surface engine + parallel finishing + boundaries + independent
   gouge checker; M2.2b Z-level roughing + waterline; M2.2c projection finishing + performance.
5. **ART-01 height-map import could come straight after M2.2** (it only needs mesh import and
   M2.2 strategies), which gives you a carved-door workflow early. Optional; I'd keep it at M2.11
   unless you want reliefs sooner.

Everything else keeps the prompt's order.
