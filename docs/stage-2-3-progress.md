# Stage 2-3 progress

Read this first at the start of every run. Sources:

- Features and acceptance (source of truth): `docs/stage-2-3-spec.md`.
- How to work: `docs/stage-2-3-prompt.md`.
- Audit and 3D design: `docs/stage-2-3-audit.md`.

## Standing rule: push every finished milestone to `main`

The owner's Vercel deployment builds from GitHub `main` automatically. So:

1. Work only on `main`. No side branches.
2. After each milestone (or each clean chunk with all checks green), commit and push to `main`
   straight away.
3. After each push, run `git ls-remote origin refs/heads/main` and check it matches
   `git rev-parse HEAD`. If not, the push did not land; fix it before moving on.
4. Never leave finished work only on a side branch, in a local commit or in a stash.
5. Vercel deploys from `main`, so only green work goes there.

Full details: section 11 of `docs/stage-2-3-prompt.md`.

## Standing rule: every unconfirmed value shows "Configure" (from M2.6e, all future milestones)

The owner does not know many real values yet (tools, saw blade, aggregate, machine figures,
cutting defaults). Instead of waiting, every such value stays visible and easy to fix:

1. **Track it.** Any value that is a placeholder, assumed or a built-in default gets a key in the
   registry (`src/core/confirm.ts`: `machineUnconfirmed`, `toolUnconfirmed`, `opUnconfirmed`,
   `OP_FIELDS`, `CutDefaults`). Its state is stored: `MachineProfile.confirmed` for shop values,
   `CamOp.confirmed` for an operation's own values. Entering a real value marks it confirmed;
   "Mark as confirmed" keeps the shown value and marks it.
2. **Show it.** A "Configure" badge (`src/components/Configure.tsx`) wherever the value is used:
   operation editor, tool table and tool dialog, Machine page (banner list, machine model, default
   cutting values), simulator, and export-checker messages (`Issue.configure`, `UNCONFIRMED`).
   Clicking it opens the exact field (`data-cfg` key, `openConfigure` in the store).
3. **Editable any time.** Every such value can be changed later (tool table, Machine page, and a
   per-operation override where it makes sense). Changes mark the affected operations stale
   (they reach `opInputHash`) and the collision and export checks run again. Nothing is locked.
4. **Safety unchanged.** Confirming never switches on any output or fits a unit; no existing check
   is weakened. New milestones add their placeholders to the registry with tests (badge shown while
   a placeholder, gone once confirmed).


## Status

| Milestone | Status | Notes |
|---|---|---|
| M2.0 Audit | **Done** | `docs/stage-2-3-audit.md`. |
| M2.1 3D foundation | **Done** (October 2026) | Includes the approved additions: machine-model data, `StockModel` and the bull-nose cutter, and the WASM/CSP groundwork. |
| M2.2a CL-surface engine, parallel finishing, boundaries, independent gouge checker | **Done** (October 2026) | See below. |
| M2.2b Z-level roughing, waterline | **Done** (October 2026) | Flat-layer output as `<105>` contours (decision 2), behind its own switch, off. See below. |
| M2.2c Projection finishing, performance | **Done** (October 2026) | See below. M2.2 complete. |
| M2.3a 2D rest machining | **Done** (October 2026) | See below. |
| M2.3b Adaptive clearing (2D pockets) | **Done** (October 2026) | See below. Simulation only (woodWOP output blocked). |
| M2.3c Adaptive Z-level roughing, 3D rest and pencil | **Done** (October 2026) | See below. M2.3 complete. Simulation only (woodWOP output blocked). |
| M2.4a Roughing fix (models that do not cover the panel) | **Done** (October 2026) | See below. |
| M2.4b Stock simulation (SIM-02) | **Done** (October 2026) | See below. |
| M2.4c Collision checking (SIM-03, NEW-13 shared model) | **Done** (October 2026) | See below. |
| M2.4d Cut-free pieces (SIM-05), screenshots, docs | **Done** (October 2026) | See below. M2.4 complete. |
| M2.5a Solid import: reader choice, lazy WASM, face ids and types, packaging | **Done** (October 2026) | See below. |
| M2.5b Feature recognition to layers, rules and a checked MPR | **Done** (October 2026) | See below. |
| M2.5c Assemblies, faces to layers / colours / grain, machining picked faces | **Done** (October 2026) | See below. |
| M2.5d 3D wires and surfaces | **Done** (October 2026) | See below. |
| M2.5e Packaged-app check, screenshots, docs | **Done** (October 2026) | See below. M2.5 complete. |
| M2.6a Saw cuts, facing, format v4, switches | **Done** (October 2026) | See below. |
| M2.6b Chamfers, cuts between curves, along 3D curves, Z-waves | **Done** (October 2026) | See below. |
| M2.6c Hand-drawn toolpaths, toolpath edits | **Done** (October 2026) | See below. |
| M2.6d Edge work with a rotating aggregate, screenshots, docs | **Done** (October 2026) | See below. M2.6 complete. |
| M2.6e Unconfirmed values: Configure badges, confirmation tracking | **Done** (October 2026) | Owner request before M2.7. See below. |
| M2.7a Holders and aggregates, tool data compare, spreadsheet, tool grid | **Done** (October 2026) | See below. |
| M2.7b Turn-by-turn sketch, dimensions, print to scale | **Done** (October 2026) | See below. |
| M2.7c Geometry queries, fill with holes, panelling | **Done** (October 2026) | See below. |
| M2.7d Image trace, screenshots, docs | **Done** (October 2026) | See below. M2.7 complete. |
| M2.8a Area and cost (NEW-20) | **Done** (October 2026) | See below. |
| M2.8b - M2.8e | In progress | Shared-line cutting, bridged nesting, flip-side sheets, manual nesting. See "M2.8 split". |
| M2.9 - M2.11 | Not started | Order as in the prompt. ART-01 stays at M2.11. |
| M3.1 - M3.7 | Not started | |

Test count: 218 at the start of Stage 2 (217 passed + 1 skipped), 263 after M2.1, 296 after M2.2a
(295 + 1 skipped), 325 after M2.2b (324 + 1 skipped), 347 after M2.2c (346 + 1 skipped), 363 after M2.3a (362 + 1 skipped), 378 after M2.3b (377 + 1 skipped), 405 after M2.3c (404 + 1
skipped), 407 after M2.4a (406 + 1 skipped), 418 after M2.4b (417 + 1 skipped), 427 after M2.4c (426 + 1 skipped), 447 after M2.4d (446 + 1 skipped), 460 after M2.5a (459 + 1 skipped), 470 after M2.5b (469 + 1 skipped), 482 after M2.5c (481 + 1 skipped), 492 after M2.5d (491 + 1 skipped), 517 after M2.6a (516 + 1 skipped), 541 after M2.6b (540 + 1 skipped), 558 after M2.6c (557 + 1 skipped), 567 after M2.6d (566 + 1 skipped), 577 after M2.6e (576 + 1 skipped), 596 after M2.7a (595 + 1 skipped), 611 after M2.7b (610 + 1 skipped), 622 after M2.7c (621 + 1 skipped), 627 after M2.7d (626 + 1 skipped), 635 after M2.8a (634 + 1 skipped).
Lint baseline: 17 warnings, all pre-existing (unchanged).

## Decisions received from the owner (October 2026)

1. Work on `main`. The audit branch was merged, and runs push straight to `main`. Every finished
   milestone is pushed to `main` and confirmed with `git ls-remote` (see the standing rule above);
   Vercel deploys from `main`.
2. 3D output to woodWOP starts with the flat-layer operations (Z-level roughing, waterline) as
   normal contour-milling macros. True 3D output stays off until the owner supplies a sample
   program saved from woodWOP on the shop PC.
3. N-200 facts will come later. Use clearly marked placeholders. Treat the saw unit as absent
   until it is confirmed.
4. Placeholder 3D tools are fine: clearly marked, and the banner stays.
5. Placeholder cutting values are fine for now.
6. Store 3D models as separate compressed files next to the shop file.
7. Fix the stale flag. One-time "stale" marks are acceptable.
8. Regenerate the sample job and pin the PDF date.
9. The new milestone order and the M2.2 split are approved.
10. Report cloud speed numbers, and give the one-line command for timing on the owner's Mac.
11. DWG stays out. DXF only; DWG files go through the free ODA File Converter first.
12. Rhino (.3dm) and SketchUp (.skp): no reader. Export STL or OBJ from those programs (agreed,
    run 3).
14. Before M2.7 (M2.6e): the owner does not know the real T140 blade, the aggregate or the M2.6
    defaults. Make every unconfirmed value visible with a "Configure" badge and easy to fix any
    time; keep 200 mm as the T140 placeholder blade, treat the aggregate as not fitted, keep the
    M2.6 placeholder defaults, all with badges. Confirming never switches on output.
13. With the M2.6 go-ahead: keep the 2 mm collision margin, and full-panel roughing (with a
    warning) when there is no boundary and the model does not cover the panel (M2.4); keep the
    6 mm rebate reach and drill pointed holes to the straight-wall depth (M2.5); flat-layer 3D
    output, adaptive and true 3D output stay off; the saw unit and the rotating aggregate count
    as absent on the N-200 until confirmed (ship the operations; the checker blocks their output;
    no invented macros).

## Open questions for the owner

1. **N-200 figures** (machine model): travel limits, table size, origin, spoilboard thickness,
   tool-change position, and whether a saw unit and an aggregate are fitted. Placeholders until
   then.
2. **Real 3D tools and holders**: ball-nose, bull-nose and tapered tools; shank diameters; flute
   lengths; stick-outs; holder outlines.
3. **3D feeds, speeds, step-downs and step-overs** for the shop's materials.
4. **A small 3D program saved from woodWOP**, needed for true 3D output (decision 2).
5. **3D flat-layer output on the machine**: before switching on "Write 3D roughing and waterline
   to MPR", load one roughing program in woodWOP and check how many points a contour may hold
   (not confirmed; the app warns over 2,000 points per contour).
6. **Solid models (M2.5)**: open one STEP file in the installed app on the Windows PC and on the
   Mac with the network off. (The rebate reach of 6 mm and drilling pointed holes to the
   straight-wall depth were confirmed with the M2.6 go-ahead.)
7. **M2.6 (saw, aggregate, cutting values)**: see "M2.6 decisions needed" below.
8. **M2.7 (holders, aggregates)**: see "M2.7 decisions needed" below.

## M2.1 3D foundation: what was built

| Spec ID | What | Where |
|---|---|---|
| CAD-13 | STL (binary/ASCII), OBJ and 3MF readers; unit choice; up axis (auto = lay flat); repair report; bad-file errors | `src/cam/mesh/read.ts`, `build.ts`, `place.ts` |
| NEW-18 | Simplify (percent or measured tolerance), Z sections to closed contours, section series, outline projected to XY, feature edges to 3D polylines, delete facets, STL export | `src/cam/mesh/tools.ts`, `simplify.ts`, `distance.ts` |
| SOL-05 | Work volume fitted to a model with oversize around/above/below; outline resized | `fitWorkVolumeToModel` in `src/cam/mesh/place.ts` |
| TOOL-04 (fields) | `shankDiameter`, `fluteLength`, `gaugeLength`, `holderId`; machine `holders` (placeholder collet chuck); `cutterOutline` | `src/core/types.ts`, `src/core/machineModel.ts`, Machine page tool dialog |
| 3D-12 | Compute worker pool with progress and cancel; heavy 3D tasks run off the UI thread | `src/cam/worker/` |
| NEW-13 (data) | `MachineModel` on `MachineProfile.physical`; placeholder N-200; export checker `MACHINE_PLACEHOLDER`, `MACHINE_CANNOT` (saw), `OFF_TABLE` | `src/core/machineModel.ts`, `validator.ts`, Machine page |
| Stock | `StockModel` interface + `HeightfieldStock` (shares the simulator's carving); bull-nose cutter; watertight stock mesh | `src/cam/stock/` |
| Format | `CAM_FILE_VERSION` 2 with step migrations; models as SHA-256 blobs outside the shop file (desktop `data/blobs`, browser IndexedDB); part files embed their blobs; 30-day clean-up of unused blobs | `src/cam/doc.ts`, `src/cam/model/`, `electron/blobGc.ts` |

Housekeeping done in this milestone:

- **Stale flag**: now also reacts to the through depth and to the material feed row.
- **PDFs**: pinned to the job date in UTC, so they are byte-identical between runs.
- **Sample job**: regenerated.
- **Feature switches**: the 4 switches that were never read are now wired and shown.
- **Tool selection**: 2D operations never pick a ball-nose or bull-nose tool automatically.
- **CSP**: allows WebAssembly.
- **New switch**: "3D models" (`cam3d`, default on).

### Acceptance

| Criterion | Proof | Measured |
|---|---|---|
| Binary + ASCII STL and OBJ (and 3MF) with units and orientation | `tests/cam-mesh.test.ts` (import, units, up axis, 3MF transforms) | - |
| 1 M triangles in < 5 s | `tests/perf.test.ts` | 1.45-1.8 s alone, 2.4 s with the full suite (cloud container) |
| 10 MB ASCII STL imports | `tests/cam-mesh.test.ts` | ~10.4 MB, well under the 10 s limit |
| Corrupt files give a clean error | `tests/cam-mesh.test.ts` "bad files" | Each case raises `MeshReadError` with a plain message |
| Simplify within a measured Hausdorff tolerance | `tests/cam-mesh.test.ts` | 10 %: 0.066 mm on the sine relief (checked against the analytic surface); tolerance mode holds 0.02 and 0.05 mm |
| Z sections return closed contours | `tests/cam-mesh.test.ts` | Sphere, torus (outer + hole), plane through a vertex ring |
| Work volume fits the model with oversize | `tests/cam-mesh.test.ts`, `tests/cam-3d-foundation.test.ts` | - |
| Heavy work in workers, cancellable, with progress | `tests/cam-worker.test.ts` | Checked in the browser preview, the production build and Electron (Linux) |
| Tool gets shank, flute length, gauge length, holder | `tests/cam-machine-stock.test.ts` | - |
| Format bump; every Stage 1 golden loads unchanged | `tests/cam-model-store.test.ts` | All 20 parts are field-identical with byte-identical digests and MPRs; golden files untouched |
| Integration: import -> toolpath -> stock -> export checker | `tests/cam-3d-foundation.test.ts` | Blocked while MPR output is off; clean when it is on |

Time it on the shop Mac (in the repo folder, after `npm install`):

```bash
npx vitest run tests/perf.test.ts
```

### Deferred or limited (recorded, not hidden)

- **`app://` protocol and unpacked `.wasm` files** for Electron are deferred to M2.5. meshoptimizer
  embeds its WebAssembly, so `file://` loading works today (checked in Electron on Linux).
  Windows and macOS builds have not been run here.
- **The batch runner does not read model files yet.** No batch step uses 3D models until M2.2.
- **Holder outlines can't be edited in the UI yet.** Tools can only pick a holder; full holder
  editing is TOOL-04 in M2.7.
- **Simplify drops OBJ/3MF groups** from the simplified copy. The original is kept and can be
  restored.
- **Delete facets** in the UI removes downward-facing facets only. The core also deletes by group
  or below a Z; picking facets by hand comes with 3D picking (M2.5).
- **The simulator screen still uses the heightfield directly.** Moved onto the `StockModel`
  interface in M2.4b.

## M2.2a parallel finishing: what was built

| Spec ID | What | Where |
|---|---|---|
| 3D-02 | Parallel finishing: angle, step-over (span divided evenly, never wider), back and forth or one way, direction, slope limits, skip flats, stock to leave, tolerance; links stay down when short and safe, otherwise lift | `src/cam/3d/parallel.ts` |
| 3D-11 | Boundaries (tool centre inside, whole tool inside, overhang); protected facet groups (the tool lifts over them); machine only chosen groups; the tool keeps clear of every facet whatever is chosen | `src/cam/3d/region.ts`, `parallel.ts` |
| Engine | Exact drop-cutter for flat, ball, bull-nose and V cutters (facet, corner and edge contacts; closed forms, golden-section search for the bull-nose edge) on an XY grid with best-first pruning | `src/cam/3d/dropcutter.ts`, `cutter.ts` |
| Check | Independent gouge checker: exact for ball-nose (point-to-facet distance), sampled for the others (simulator's `cutterZ`) | `src/cam/3d/check.ts` |

Other changes:

- **IR:** a new `finish3d` op kind and a compact `poly` move. `simpleMoves()` expands it for the
  simulator, the posts, the stats and the 2D drawing.
- **Stale flag:** `opInputHash` now includes the model's blob hash and placement.
- **Export checker:** new `CAM_3D_NO_OUTPUT` error, whether custom-part output is on or off.
- **Designer:** 3D toolpaths are calculated in the compute worker (`use3dToolpaths`) with
  progress, and a newer request cancels an older one. There is an editor for the new operation.

### Acceptance (M2.2 criteria that apply to finishing)

| Criterion | Proof | Measured |
|---|---|---|
| No gouge > 0.005 mm, independent check | `tests/cam-3d-parallel.test.ts` | Ball-nose (exact) on the hemisphere, sine relief, raised panel and cove. Bull-nose and flat (sampled) on sine, raised panel and cove. Deepest seen 0.002 mm |
| Drop-cutter exact | `tests/cam-3d-dropcutter.test.ts` | Closed forms for each shape on planes, edges and spikes; random bumpy meshes vs brute force, never below it |
| Stock to leave ±0.01 mm | `tests/cam-3d-parallel.test.ts` | CL points 0.5 ± 0.01 mm from the surface; no move closer than 0.495 mm |
| Scallop within ±10 % on flat-to-gentle areas | `tests/cam-3d-parallel.test.ts` | Flat: 0.01489 mm against 0.01489 mm in theory. 5° slope: 0.01506 against 0.01506 (cross-section of the actual passes) |
| Boundaries clip right | `tests/cam-3d-parallel.test.ts` | Centre / contained / touching on a 30 mm circle: max reach 30 / 27 / 33 mm |
| Golden digests stable | `tests/golden/cam3d/parallel-*` | 4 cases, hash of every move to 0.001 mm; a missing golden fails |
| 200 k triangles, 600 x 400, 6 mm ball, 10 % step-over < 30 s | `tests/perf.test.ts` | 9.9 s alone, 10.3 s with the full suite (limit 20 s) |

Roughing criteria (stock >= requested, <= stock + one step-down on walls) belong to M2.2b.

### Limits recorded

- **Slope limits use the mesh's facets**, so on a coarse mesh a limit can be off by the facet
  angle (under 1° on the test dome).
- **Protected groups at a shared edge:** an edge contact is credited to one of the two facets
  sharing it, so along the border between a protected and a machined group the tool may count
  the edge as machined.
- **The simulator shows 3D finishing on the heightfield.** Collision checks of the shank and
  holder come in M2.4. For now the generator warns when a cut is deeper than the flute length.
- **The everyday suite checks fewer positions with the sampled checker.** `THOROUGH=1 npx vitest
  run tests/cam-3d-parallel.test.ts` checks six times more.

## M2.2b Z-level roughing and waterline: what was built

| Spec ID | What | Where |
|---|---|---|
| 3D-01 | Z-level roughing: levels every step-down from face 1, the bottom, and an extra level on each flat area; each level cleared by offset rings (inside out) or zig-zag, ending with a pass along the walls; helix, ramp or plunge entry (plunge becomes a ramp for a tool that is not centre-cutting or deeper than its max plunge); stock to leave on walls and on floors; stay-down links when short and clear; every cutting move checked against the model before it is kept | `src/cam/3d/zlevel.ts` |
| 3D-03 | Waterline finishing: passes at constant heights along the line where the tool touches the model; slope limits, skip flats, climb or conventional, nearest-first order, links that stay down only where exact checks show the tool clears; optional shallow-area fill with parallel passes | `src/cam/3d/waterline.ts` |
| Engine | Level lines of the tool-centre surface: exact drops on a grid, marching squares, each crossing moved onto the true line, each piece checked at its middle and quarters and split until within tolerance | `src/cam/3d/clgrid.ts` |
| Output | Flat-layer output: each pass of each level as one `<105>` contour at that depth (decision 2), behind a new switch "Write 3D roughing and waterline to MPR", **off**. The job page calculates 3D toolpaths in the compute worker before export | `src/cam/toolpath.ts` (`isFlatLayer`, `pathKey`), `src/core/machining.ts`, `src/app/jobOutput.ts` |

Other changes:

- **Export checker:** `CAM_3D_OUTPUT_OFF` (flat-layer operations while the switch is off),
  `CAM_3D_NOT_READY` (toolpath not calculated yet, e.g. in a batch run). `CAM_3D_NO_OUTPUT` now
  covers parallel finishing and waterline with the shallow-area fill, whatever the switches say.
- **Drop-cutter:** a fast "does the tool clear the model at this height?" test (`clears`), which
  skips every facet below that height; the bull-nose edge test got an exact upper-bound check and
  a shorter search. Parallel finishing on the 200 k relief: 9.2 s this run (9.9 s before); the goldens
  did not change.
- **Independent checker:** the exact (ball-nose) check now stops searching 1 mm from the tool
  (only nearness matters), 20 times faster on roughing paths. Same results.
- **Designer:** "3D roughing (Z-level)" and "3D finishing (waterline)" in the Add operation menu,
  with their own editors; the 3D finishing editor can switch between parallel and waterline.
- **A real bug found by the boundary test and fixed before commit:** an area's outer wall pass
  was dropped when its first point sat exactly on the area's edge.

### Acceptance (M2.2 criteria that apply)

| Criterion | Proof | Measured |
|---|---|---|
| Waterline: no gouge > 0.005 mm, independent check | `tests/cam-3d-zlevel.test.ts` | Ball-nose (exact): hemisphere 0.0021, sine 0.0021, raised panel 0.0019, cove 0.0000 mm. Bull-nose (raised panel) and flat (cove), sampled: under 0.005 |
| Roughing leaves at least the stock to leave | `tests/cam-3d-zlevel.test.ts` | Independent check with 0.5 mm stock: hemisphere (ball, exact) 0.0022 mm into the stock at most; sine and raised panel (bull) 0.0017 and 0.0013; cove (flat) 0.0007. Simulated stock: never less than 0.500 mm straight above the surface |
| Roughing leaves no more than stock + one step-down on walls | `tests/cam-3d-zlevel.test.ts` (simulated, measured to the nearest point of the model) | Hemisphere 2.365 mm (limit 3.5), sine 2.327 (2.5), raised panel 3.021 (3.5), cove 3.998 (4.5) |
| Stock to leave ±0.01 mm (waterline) | `tests/cam-3d-zlevel.test.ts` | Points 0.5 ± 0.01 mm from the surface; no move closer than 0.495 |
| Boundaries clip right | `tests/cam-3d-zlevel.test.ts` | Roughing, offset and zig-zag, inside a 30 mm circle: within 30.01 mm, reaching past 29 |
| Golden digests stable | `tests/golden/cam3d/{rough,waterline}-*` | 4 new cases; the 4 parallel cases and all Stage 1 goldens unchanged |
| Z-level roughing of the 200 k relief, 12 mm tool, 3 mm step-down < 30 s | `tests/perf.test.ts` | 7.5 s (test limit 20 s); 556 passes, 132 m of cutting |
| Flat-layer output, off by default | `tests/cam-3d-integration.test.ts` | Off: `CAM_3D_OUTPUT_OFF`, nothing written. On without toolpaths: `CAM_3D_NOT_READY`. On with toolpaths: one `<105>` per pass, no other errors |

### Limits recorded

- **woodWOP makes its own approach** for each flat-layer contour (the helix or ramp shown in the
  app is not written). Not machine-proven.
- **Contour point limit in woodWOP is unknown.** The app warns over 2,000 points per contour.
- **Batch runs cannot calculate 3D toolpaths** (they block with `CAM_3D_NOT_READY`).
- **Roughing does not yet account for earlier operations** (rest roughing): it assumes a full
  panel. Rest machining is in the M2.2 list (3D rest machining) and comes with M2.3/M2.4.
- **The sampled check of bull-nose and flat roughing looks at 400 spread positions** in the
  everyday suite (`THOROUGH=1` for 2,000). The simulated stock check covers every 0.5 mm cell.
- **Very narrow pockets in the tool-centre surface** (narrower than the grid, 1/3 of the tool
  radius) are not entered: material is left, never cut wrongly.

## M2.2c projection finishing and performance: what was built

| Spec ID | What | Where |
|---|---|---|
| 3D-04 | Projection finishing: the picked shapes on face 1 (lines, arcs, curves, circles, text) dropped onto the model; the tool centre follows them in plan; optional depth below the surface (engraving on a 3D face), in passes like 2D engraving (depth per pass, number of cuts); closed shapes stay down between passes; parts of shapes off the model are skipped with a warning; protected groups and groups not chosen are never cut, also below the surface (a second exact drop on just those facets); stock to leave; ball, bull, flat or V tool (auto: smallest ball-nose) | `src/cam/3d/projection.ts`, `genFinish3d` in `src/cam/toolpath.ts` |
| Shared | The drop-and-refine routine of parallel finishing is now shared with projection (moved, not changed: the parallel goldens are byte-identical) | `src/cam/3d/chain.ts` |
| 3D-12 (speed) | The drop-cutter's "does the tool clear the model here?" test stops at the first contact, skips grid cells wholly below the height or too far from the tool to reach it, and uses finer cells. Same answers (new test against the full drop at four cell sizes); every 3D golden unchanged | `src/cam/3d/dropcutter.ts` |

Other changes:

- **Designer:** "3D finishing (projection)" in the Add operation menu (all selected shapes are
  projected); the 3D finishing editor has the strategy, depth below the surface, depth per pass
  and number of cuts. The Machine page text says projection is never written to woodWOP.
- **Export checker:** projection is not a flat layer, so it is always blocked with
  `CAM_3D_NO_OUTPUT` (tested with both output switches on).
- **Bug fixed:** in the browser preview (React's development double mount) 3D toolpaths were
  cancelled on opening a part and never restarted; the part kept saying "Calculating in the
  background". The hook now forgets cancelled runs so they start again. Production builds were
  not affected.

### Acceptance (M2.2 criteria that apply to projection)

| Criterion | Proof | Measured |
|---|---|---|
| No gouge > 0.005 mm, independent check | `tests/cam-3d-projection.test.ts` | Ball-nose (exact) on hemisphere, sine, raised panel and cove, each with a circle, a zig-zag line and lettering: under 0.005, and the ball touches the surface at every point (distance error < 0.0001 mm). Bull-nose (sine), flat (raised panel), V-bit (sine, cove), sampled: under 0.005 |
| Tool centre on the drawn shape | same | Within 0.002 mm of a 30 mm circle in plan; a closed shape is one unbroken chain back to its start |
| Stock to leave ±0.01 mm | same | Points 0.5 ± 0.01 mm from the surface on sine and hemisphere; no move closer (independent) |
| Engraving depth | same | 1.5 mm in 3 passes on the dome: raised by its pass depth, every point touches the surface again (independent distance, error < 0.0001 mm); deepest cut into the surface seen by the gouge checker 1.4946 mm (measured square to the surface, so a little under 1.5 on slopes; test limit 1.505). On a flat field: exactly -1 and -2 mm |
| Protected / unchosen groups below the surface | same | Engraving 1 mm across a raised panel with the bevel protected (and, separately, only the field chosen): the bevel's facets alone are never cut (exact check, under 0.005), and the cut reaches within 1.5 mm of the bevel |
| Golden digests | `tests/golden/cam3d/projection-*` | 3 new cases (lettering on sine, V-bit engraving on the dome, bull-nose with stock on the raised panel). All earlier 3D and Stage 1 goldens unchanged |
| Export blocked | same | `CAM_3D_NO_OUTPUT` with custom-part and 3D output both on |

### Performance (cloud container, Linux x64, with the full suite running)

| Case | Before | After |
|---|---|---|
| Waterline, 51 k-facet dome, 6 mm ball, 40 levels | 5.7 s | 3.3 s (new perf test, limit 8 s) |
| Z-level roughing, 200 k relief, 12 mm bull-nose, 3 mm step-down | 6.4 s | 4.3-4.8 s |
| Parallel finishing, 200 k relief, 6 mm ball, 0.6 mm step-over | 7.6 s | 7.3-7.7 s (uses the full drop, unchanged) |

Time it on the shop Mac: `npx vitest run tests/perf.test.ts`.

### Limits recorded

- **Projection follows the shapes in plan**: on steep walls the groove is drawn straight down,
  so letters on a steep face look stretched. Engraving depth is measured straight down too.
- **Shapes are cut in drawn order**, each at every depth before the next shape; the tool lifts to
  the safe height between shapes.
- **Waterline is still about 16 drop tests per output point** (bisection onto the level line to
  0.0025 mm). A further 2-3x would need either fewer bisection steps (points move by less than
  the precision, but the waterline and roughing goldens would change) or levels calculated in
  parallel workers. Not done: the speed is fine in the background worker today.

## M2.3 split (same reasons as M2.2)

M2.3 is three large items, so it is done in named parts: **M2.3a** 2D rest machining, **M2.3b**
adaptive clearing in 2D pockets, **M2.3c** adaptive clearing per Z level, 3D rest machining and
the pencil pass.

## M2.3a 2D rest machining: what was built

| Spec ID | What | Where |
|---|---|---|
| 2D-07 | Pocket option "Rest machining": the material earlier operations left in the pocket, level by level, from their actual toolpaths (the area each tool swept at that depth, Clipper2 booleans; ball, bull-nose and V tools count with their width at that height, never wider). The pocket's follow-shape passes (inside out) are cut down to the pieces that reach it; pieces that cut less than the minimum length are skipped. A piece that starts clear of the material goes straight down (the column above it is already cut); one that starts in it uses the pocket's entry. "Left by": every earlier milling operation, or one picked | `src/cam/adaptive/rest.ts`, `genRestPocket` in `src/cam/toolpath.ts`, `restSources` in `src/cam/doc.ts` |
| Associativity | A rest pocket goes stale when any operation it follows changes (parameters, shapes, tool, the tool table when that tool is picked automatically) or when an operation is added before it | `opInputHash` in `src/cam/doc.ts` |
| Output | Each rest piece is one contour-milling pass at its depth, under the existing custom-part MPR switch (off). Program order keeps the operations of a part in their order, so the earlier operations run first | `genRestPocket` |
| Switch | "Rest machining and adaptive clearing" (`camAdaptive`, screens, on) | `src/core/features.ts`, Machine page |

Other changes: `generatePart` hands each toolpath to the later operations (no second
calculation); a recipe made from a rest pocket follows every earlier operation in the new part.

### Acceptance (M2.3 criteria for 2D rest)

| Criterion | Proof | Measured |
|---|---|---|
| Rest cuts only where the previous tool left material (simulated stock, independent of the booleans) | `tests/cam-rest.test.ts` | Corners (100 x 60 pocket, 12 mm then 6 mm): 4 pieces, every one finds material still there before it cuts. Neck (10 mm neck the 12 mm tool cannot enter): 8 pieces, same |
| Earlier tool + rest = what the small tool alone leaves | same | 0 of 95,872 cells (corners) and 0 of 116,544 cells (neck) differ, at 0.25 mm cells. Rest cutting length 75 mm against 2,106 mm for the small tool alone (corners), 238 against 3,903 mm (neck) |
| Verified against the swept-area boolean | same | Each piece's swept area overlaps the rest region; of 17.922 mm² of rest, 0.0035 mm² is left uncovered (a hair-thin edge at the small tool's reach) |
| Minimum path length honoured | same | 50 mm: nothing cut, with a clear warning; 2 mm: the 4 corners; neck: 15 mm keeps fewer pieces than 0 |
| Depth passes, wall stock | same | Each level cuts what was left at that level; 0.5 mm wall stock left by the earlier pocket is cut all the way round |
| Goldens | `tests/golden/cam2/rest-{corners,neck,wall}` | 3 new 2D digests. All Stage 1 and 3D goldens unchanged |
| woodWOP | same | 4 contour-milling passes for the corners, no export errors |

### Limits recorded

- **Rest from 3D operations is not counted** by 2D rest pockets (only profile, pocket, engrave,
  V-carve and sweep). 3D finishing has its own rest machining (M2.3c), which counts both.
- **woodWOP's own pocket macro**: for a rectangular earlier pocket written as `<112 Tasche`, the
  rest is worked out from our toolpath of that pocket, not from woodWOP's. Both use the same tool
  and step-over, so the corners match; a cusp woodWOP leaves between its own passes would not be
  seen.
- **Rest pieces always use follow-shape passes**, whatever the pattern setting.

## M2.3b adaptive clearing: what was built

| Spec ID | What | Where |
|---|---|---|
| NEW-01 | Pocket pattern "Adaptive": the tool holds a set width of cut (share of the diameter, or an engagement angle). The material still to cut is a bit raster; before each short straight step the heading is searched (turn into the material when light, away when heavy) so the step's removed area / length comes just under the target. Every step keeps the tool its radius from the pocket edge (exact distance to the wall edges). Smoothing radius limits the turn per step. Back-moves go straight through cleared area lifted a little (or up and over). New areas get a helix entry, kept only if a pass can follow it. Channels too narrow for passes get trochoidal loops: circles centred in the channel whose centre creeps forward in the first quarter of each loop (so each loop's front cuts exactly its own creep), the creep halved until the cut is under the target. Adaptive feed (off by default): lighter moves and the moves back run up to N times the feed | `src/cam/adaptive/adaptive.ts`, `raster.ts`, `walls.ts`, `genAdaptivePocket` in `src/cam/toolpath.ts` |
| Check | Independent engagement checker: per move, exact Clipper2 area of material removed (swept disc less what earlier moves removed, kept as per-tile unions) / length; full-width = material over 95 % of the tool's leading half | `src/cam/adaptive/check.ts` |
| IR | Feed moves may carry `k` (adaptive feed factor; posts write F x k, the simulator and times use it); toolpaths may carry `sections` (flagged trochoidal move ranges) | `src/cam/toolpath.ts`, `sim.ts`, `post.ts` |
| Screens | Adaptive pattern and its fields in the pocket editor; adaptive pockets (and rest pockets that follow one) are calculated in the compute worker with progress, like 3D operations | `OpsPanel.tsx`, `use3dToolpaths.ts`, `PartDesigner.tsx` |
| Export | Not written to woodWOP: `CAM_ADAPTIVE_NO_OUTPUT` (error) whenever a part has an enabled adaptive pocket. Export does not wait for it (it is skipped, not calculated) | `src/core/machining.ts`, `validator.ts` |

### Acceptance (M2.3 criteria for adaptive clearing)

| Criterion | Proof | Measured (6 mm tool, 0.9 mm target unless noted; limit = target + 10 %) |
|---|---|---|
| Engagement never > target + 10 %, per move, from the swept area | `tests/cam-adaptive.test.ts` (independent checker) | Square 60 x 40: widest 0.856 mm (95.1 %). With a 20 mm island: 0.865 (96.1 %). Conventional: 0.855 (95.0 %). 60° engagement (1.5 mm): 1.399 (93.3 %). Rooms with an 8 mm slot: 0.862 (95.7 %) on passes, 0.667 on the trochoidal loops |
| No full-width moves outside flagged trochoidal sections | same | 0 in every case; the slot's 4,165 trochoidal moves are flagged |
| Checker is right | same | A side cut measures its width to 0.001 mm; a slot measures 6 mm and full width |
| Stays clear of walls and islands | same | Every move at least the tool radius from the pocket edges (exact); against the simulated stock of a follow-shape pocket it never cuts anything that pocket leaves, and leaves 11 of 38,272 and 24 of 81,248 cells (scraps under 0.1 %) |
| Depth passes, determinism, adaptive feed | same | Each level repeats the plan with its own helix; same input gives the same moves; feed factors only between 1 and the limit, shorter time, same path |
| Export | same | Blocked with `CAM_ADAPTIVE_NO_OUTPUT`; nothing written; export of the job in under 2 s |
| Performance | `tests/perf.test.ts` | 300 x 200 mm with a 60 mm island, 8 mm tool: 3.4 s (limit 10 s), in the background worker |
| Goldens | `tests/golden/cam2/adaptive-{square,slot}` | 2 new digests |

### Limits recorded

- **Trochoidal loops need room**: a channel narrower than about the tool diameter plus 0.3 x the
  tool radius is left, with a warning to finish it with rest machining and a smaller tool. Nothing
  is ever cut at full width.
- **Adaptive per Z level of 3D roughing**: done in M2.3c.
- **woodWOP output** is a decision (see the report): each pass could become a contour-milling
  pass, but woodWOP would plunge at each start (our helix entries and lifted moves back are not
  in that form).

## M2.3c adaptive Z-level roughing, 3D rest and pencil: what was built

| Spec ID | What | Where |
|---|---|---|
| 3D-06 pencil | Finishing strategy "Pencil": one pass along each valley and inside corner, where the tool touches two surfaces at once. Found on the tool-centre surface: on a grid of exact drops, the point where the tool touches the model jumps across a valley. Each crossing is pinned to 0.001 mm by bisection (a real valley keeps its jump however short the step; a tight smooth curve does not), crossings are joined into chains, and each chain is split until its straight pieces follow the valley within half the tolerance. Heights are exact drops, refined like every other strategy. Setting: valleys sharper than N° (default 5, placeholder). Picks the smallest ball-nose | `src/cam/3d/pencil.ts`; the drop-cutter now records where it touches (`hitX`, `hitY`, `hitZ`) |
| 3D-06 rest | "Rest machining" for parallel, waterline and pencil finishing. The earlier operations' real toolpaths (2D and 3D) are carved into a heightfield (level moves exactly, sloped moves in short steps). The surface this tool can reach is found by dropping it at every cell near where material is left. Where the stock is thicker than a set amount over that surface (square to the surface), there is rest; the rest areas, grown by the tool radius, limit where the tool centre goes. "Left by": every earlier milling operation, or one picked | `src/cam/3d/rest3d.ts`, `cutRegion` in `genFinish3d`, `restSources` and `modelsFor` in `src/cam/doc.ts` |
| NEW-01 in 3D | Z-level roughing pattern "Adaptive": each level is planned by the pocket planner (steady width of cut, helix entries, lifted moves back, trochoidal loops, adaptive feed). The material is what the tool can reach at that level (where its centre may stand, grown by its radius, on the panel and up to its corner radius + 1 mm past the edges); the centre stays where it may stand (new planner option `wallGap`: 0.01 mm here, the tool radius for pockets, so pockets are unchanged). A bull-nose's helix stays inside its flat bottom. Every pass and entry goes through the roughing's exact-drop safety check before it is kept | `adaptiveLevel` in `src/cam/3d/zlevel.ts`, `src/cam/adaptive/adaptive.ts` |
| Screens | Pencil in the add menu and the strategy list (valley angle); rest machining switch, "Left by" and minimum thickness for 3D finishing; adaptive pattern and its fields for Z-level roughing (shared with pockets). All calculated in the compute worker; a rest pass also gets the earlier operations' models | `OpsPanel.tsx`, `use3dToolpaths.ts`, `src/app/jobOutput.ts` |
| Export | Pencil, and rest on parallel or pencil: true 3D, blocked (`CAM_3D_NO_OUTPUT`). Waterline with rest stays a flat layer (behind its switch, off). Adaptive Z-level roughing: blocked as adaptive clearing (`CAM_ADAPTIVE_NO_OUTPUT`, now worded for pockets or roughing); it is not a flat layer and makes no contour passes | `isFlatLayer`, `isAdaptive` in `src/cam/toolpath.ts`, `src/core/machining.ts`, `validator.ts` |

Other changes: `RAPID_RATE` and `simpleMoves` moved to `src/cam/moves.ts` (no import cycle with the
simulator); the simulator's `cutterOf` is exported; progress in the adaptive planner is counted
less often (no change to any toolpath).

### Acceptance (M2.3 criteria for 3D rest and pencil, and adaptive per level)

| Criterion | Proof | Measured |
|---|---|---|
| Pencil follows valleys on a test model within 0.02 mm | `tests/cam-3d-pencil-rest.test.ts` (analytic lines) | Raised panel, 6 mm ball (bevel 1 in 4 meeting the border): 1,908 points (moves sampled every 0.25 mm, 8 mm round the corners left out) within 0.0003 mm in plan of the line 0.369 mm outside the bevel's foot, height exact. 45° V groove: 0.0005 mm in plan and height (6 mm and 3 mm balls); diagonal groove 0.0003 mm. All the way round / along |
| Pencil: no gouges, no false valleys | same | Exact gouge check ≤ 0.005 mm on every model. Sine and cove (radius larger than the tool): no valleys found, clear warning. Valley angle 20° leaves out the 14° bevel and keeps the 90° groove. Stock to leave 0.3 mm held to 0.001 mm |
| 3D rest cuts only where the earlier tool left material | same | V groove after a 6 mm ball (1 mm step-over), rest with a 3 mm ball: every cut within 3.25 mm of the groove (limit 3.89 = where the 6 mm ball touches + tool radius + a cell); 653 mm of cutting against 17,684 mm for a full finish (3.7 %); exact gouge check ≤ 0.005 mm |
| 3D rest removes the rest | same (simulated) | Thickest a 3 mm ball can still remove, square to the surface: 0.428 mm after the 6 mm ball, 0.033 mm after the rest pass |
| Nothing to follow, nothing left | same | No earlier operation, or the same tool before: no moves and a clear warning |
| Associativity | same | Changing the earlier operation, the minimum thickness or the valley angle marks it stale; templates follow every earlier operation |
| Carving and model raster | same | Level moves carved exactly (0 difference from the analytic); sloped moves never below the swept tool, at most the set cusp above it; the model's top and slope per cell match exact needle drops |
| Adaptive per level: engagement ≤ target + 10 % per move | `tests/cam-3d-adaptive.test.ts` (independent checker, material worked out by hand) | Block 40 x 30 x 12 on 100 x 80, 12 mm R2 bull-nose, target 1.8 mm: levels -3 and -12 widest 1.661 mm (92.3 %). Hemisphere with 0.5 mm stock: levels -12 and -19.5 widest 1.690 (93.9 %) and 1.680 (93.4 %) |
| No full-width moves outside flagged trochoidal sections | same | 0 at every level checked |
| Clears the level | same (simulated) | Block: everything more than 2.5 mm from the block is down to the floor within 0.05 mm (0.03 mm at worst, in a corner). Hemisphere: 106.5 cm³ removed, the same as offset rings (within 1 %) |
| No gouges, feed, output | same | Sampled gouge check ≤ 0.005 mm. Feed factors between 1 and the set limit. Export blocked (`CAM_ADAPTIVE_NO_OUTPUT` once, no `CAM_3D_NO_OUTPUT`), no contour passes |
| Performance | `tests/perf.test.ts` | 600 x 400 mm relief, 4 levels, 12 mm tool: about 37 s on its own, 50 s under the test runner (limit 90 s); in the background worker with progress. 3D rest of a 200 x 150 mm panel: 0.65 s |
| Goldens | `tests/golden/cam3d/{pencil-raised-panel,pencil-v-diagonal,rest-v-groove,rough-hemisphere-adaptive}` | 4 new 3D digests. All Stage 1, 2D and earlier 3D goldens unchanged |

### Limits recorded

- **Pencil on meshes sampled on a grid**: a sharp ridge that runs across the grid becomes a row of
  small facet valleys, and a small ball follows them (seen on a 2 mm-cell relief door with a
  3 mm ball). Harmless (it rides the mesh) but wasted motion. Raise the valley angle, or use a
  mesh whose facets follow the ridge, as CAD exports do. On the coarse test dome, part of the
  ring rides up the facets' own valleys at the foot.
- **One pencil pass per valley** (no extra offset passes either side yet).
- **3D rest is cut with the strategy's own passes**, clipped to the rest areas. A parallel rest
  pass links across the part between rest strips on every pass (on the screenshot door, 11 min
  of mostly links for a 4.5 mm band round the bevel). Pencil is the efficient choice for valleys;
  ordering rest pieces is a later improvement.
- **3D rest accuracy**: heightfield cells of 0.25 mm (finer for tools under 3 mm). Sloped moves of
  the earlier operations are stamped in steps that can show up to a quarter of the minimum
  thickness more rest on slopes up to 70° (more on steeper walls): extra cutting, never less.
  The earlier operations are calculated again inside the rest calculation (seconds, in the
  background).
- **3D rest is for finishing only**: Z-level roughing does not yet follow an earlier roughing.
- **Adaptive per level treats the tool as a cylinder of its full radius**: a bull-nose leaves its
  corner radius at walls (as every pattern does); helix centres and panel edges are handled so the
  floor is clean (0.03 mm). It cuts a little air past the panel edges.
- **Z-level roughing of a model that does not cover the panel** found nothing to rough. Fixed in
  M2.4a (below).

## M2.4 split

M2.4 is done in named parts: **M2.4a** the Z-level roughing fix (owner asked for it first),
**M2.4b** the stock simulation on the `StockModel` interface (removed volume, section view,
transparency, stepping, stop at tool change, stock STL), **M2.4c** collision checking (shank,
holder, rapids, spoilboard) with a log, jump-to-move and the export checker, **M2.4d** cut-free
pieces, full-sheet playback speed, screenshots and docs.

## M2.4a Z-level roughing of a model that does not cover the panel: what was fixed

| What | Where |
|---|---|
| With no boundary drawn, the tool centre was kept inside the model's own footprint, so a model smaller than the panel (a closed box standing on its own) had nowhere below face 1 to cut. Now, when the model does not reach every edge of the panel (by more than 0.01 mm), the whole panel is the roughing area and the panel round the model is roughed down to the model's lowest point (plus the stock to leave in Z). A warning says so and gives the depth: "Draw a boundary to rough less." A drawn boundary works as before. Models that cover the panel (reliefs, doors) are unchanged | `genRough3d` in `src/cam/toolpath.ts` |
| Second bug found by the new test: the safety check threw away a whole straight piece when any spot on it touched the model. A zig-zag line is one piece, so lines next to the box's rounded corners vanished (material left standing at the panel edge). The check now splits a failing piece every check step and cuts out only the part that touches | `checked` in `src/cam/3d/zlevel.ts` |

Acceptance (`tests/cam-3d-zlevel.test.ts`): a 40 x 30 x 12 mm box on a 100 x 80 mm panel, 12 mm R2
bull-nose, 0.5 mm stock to leave, offset, zig-zag and adaptive. Simulated at 0.5 mm cells: the box
and its stock are never cut (highest cut 0.000 mm); everywhere more than 7 mm from the box is down
to the floor (-11.500 mm offset and zig-zag, -11.478 adaptive; limit -11.45); nothing below the
floor; sampled gouge check under 0.005 mm. A drawn 30 mm circle still limits the tool centre
(within 30.01 mm). Models that cover the panel get no new warning.

Golden changed (explained): `tests/golden/cam3d/rough-hemisphere` - the trim fix keeps 12 mm of
cutting the old check threw away (15,784 -> 15,796 mm, 36 more points, same move counts). Those
pieces pass the independent gouge check (0.0022 mm at most over 3,944 positions). No other golden
changed (Stage 1, 2D and every other 3D golden byte-identical).

## M2.4b stock simulation: what was built

| Spec ID | What | Where |
|---|---|---|
| SIM-02 | Simulation on the `StockModel` interface: carves lazily to any time; going back restores the stock saved at the nearest operation start (within 256 MB) instead of replaying from the start | `StockSimulation`, `carveStock` in `src/cam/stock/simulation.ts` |
| SIM-02 | Playback: separate speeds for cutting and for rapids, stop at a tool change (only where the tool number changes), run to a chosen move of a chosen operation, one move back or forward | `advance`, `stepMove`, `moveEnd` in the same file; every timeline segment now carries its move number and the tool number |
| SIM-02 | Section view (across the width or the length, any position) and stock transparency in the 3D view; the tool is drawn with its shank and holder from the tool table | `stockMesh` / `stockMeshTops` in `src/cam/stock/heightfield.ts`, `SimulateDialog.tsx` |
| SIM-02 | Save the stock as STL: closed (watertight). Stock over 2 million cells is written every few cells, each corner taking the lowest cell round it, so the file never shows material that was cut | `stockMesh(..., { exact: true })`, "Save stock as STL" |
| Speed | Only the cells that changed are carved and redrawn each frame (changed-area tracking in the stock); the backplot is a canvas drawn once and added to as it plays; cut-free pieces are worked out when paused. Cell size: as fine as 0.25 mm, at most about 6 million cells (1 mm for a full sheet) | `takeDirty`, `cellRect`, `shadeHeightfield(..., { rect })`, `simCell` |

Acceptance so far (`tests/cam-stock-sim.test.ts`, `tests/perf.test.ts`):

| Criterion | Measured |
|---|---|
| Removed volume within 1 % of analytic at 0.5 mm cells | Real pocket (100 x 60 R8, 6 mm in two passes, 8 mm tool): 35,682 against 35,670 mm³ (+0.033 %). Real profile (inside a 40 mm radius circle, 5 mm, 12 mm tool): 12,821 against 12,818 mm³ (+0.028 %) |
| Back-and-forth carving | Byte-identical to one straight carve at every time tried |
| Playback speeds, stops, steps | Whole program takes feed time / cutting speed + rapid time / rapid speed (within 0.02 s); stops at the one real tool change and not between two operations with the same tool; stops at a chosen time; steps land exactly on move ends |
| Redraw of what changed | Same picture as a full redraw, byte for byte |
| Watertight stock STL | Read back watertight; volume within 0.5 % of the block less what was removed; section and coarse meshes closed too |
| 30 fps for a full sheet at 1 mm cells | 3,658 x 1,524 cells, 27,033 segments, 64x: 1.7 ms a frame on average, 2.9 ms at the 95th percentile; after M2.4c's exact level-move carving 0.4-0.5 ms average and 0.5-0.6 ms at the 95th percentile (test limit 2 ms; a frame at 30 fps has 33 ms). First full draw 155-171 ms |

## M2.4c collision checking: what was built

| Spec ID | What | Where |
|---|---|---|
| SIM-03 | The program is replayed into the stock; at each tool position, before the stock is cut, the parts of the tool that do not cut are checked against the material still there: the shank (from the top of the flutes up to the holder, its radius plus the margin), the holder (its outline from the tool table grown by the margin all round), and on rapids the whole tool. The tip is checked against the spoilboard limit (`spoilboardAllowance` below the underside) and the table (under the spoilboard, from the machine model). Results are merged into runs of consecutive moves, each with its first position and time | `checkCollisions`, `collisionSetup`, `partCollisions` in `src/cam/collision/collision.ts` |
| SIM-03 | Collision log in the simulator (worked out in the background worker), each entry jumps to its move; replaces the old rapid check | `sim.collide` task, `SimulateDialog.tsx` |
| SIM-03 | Safety margin setting "Collision margin" (default 2 mm, as the prompt sets) on the Machine page | `MachineProfile.collisionMargin`, `MachinePage.tsx` |
| §7.7 | A 3D operation whose shank or holder would hit the model (plus the stock to leave) is flagged when it is calculated, with the stick-out or flute length it needs and the move where it starts | `src/cam/collision/model.ts`, `clearanceWarnings` in `src/cam/toolpath.ts` |
| Export | A collision is an export-blocking error, `CAM_COLLISION`, naming the first collisions and their moves | `src/core/machining.ts`, `validator.ts` |
| NEW-13 | One machine model: the simulator's spoilboard and table, the collision check and the export checker all read `machineModelOf(machine)` | |
| Speed | Level moves are now carved exactly (each cell takes the cutter's bottom at its distance from the move) instead of stamping the tool every half cell; sloped moves are still stamped. When no shank, holder or rapid can reach below face 1 at all, nothing is carved. A 1,200 x 450 mm door's check went from 5.2 s to 0.16 s; full-sheet playback from 2.9 to 0.6 ms a frame | `sweepLevel` in `src/cam/stock/heightfield.ts` |

How a shank collision is judged: material above the top of the flutes within the shank's reach
counts, even inside the cutter's own radius. Seen from above, the stock cannot tell a ledge left
above short flutes from solid wood, so a tool too short for the depth is always reported.

Acceptance (`tests/cam-collision.test.ts`; each case has a near-miss twin that must be clean):

| Case | Found | Twin |
|---|---|---|
| Shank too short for a deep pocket: 40 mm deep in 5 mm passes, 8 mm cutter with 30 mm flutes | Shank only, from the first pass below 30 mm (Z-35); worst 10.0 mm of wall above the flutes | 30 mm deep: clean |
| Holder into a wall: 49 mm deep, 10 mm test tool with 50 mm stick-out, placeholder holder | Holder only, at Z-49, 1.00 mm into the 2 mm margin | 47 mm deep: clean; margin 0 at 49 mm: clean |
| Rapid through stock: a rapid at Z-4 across uncut panel | Rapid, first touch at X20, 4.00 mm | The same rapid inside the cut pocket, or above the panel: clean |
| Below the spoilboard limit (0.5 mm): a profile 1 mm under the underside | Spoilboard, 0.50 mm past the limit | Through cut (0.3 mm) and 0.5 mm exactly: clean |
| Into the table (placeholder spoilboard 19 mm): 20 mm under the underside | Table, 1.00 mm | |
| Jump-to-move | Every collision's time puts the tool at its reported point, on its reported move | |
| False alarms on generated programs | None on the 20 Stage 1 reference parts, nor on Z-level roughing + parallel + waterline on the four 3D test surfaces | |
| Flagged when calculated | 60 mm cavity, 6 mm ball (25 mm flutes, 50 mm stick-out): "needs at least 60.0 mm" of flute and "62.0 mm" of stick-out (with the 2 mm margin), from the first level below the flutes | 20 mm cavity: no warning |
| Export checker | `CAM_COLLISION` error for the 40 mm pocket in a job | None for 30 mm |

No golden changed.

## M2.4d cut-free pieces: what was built

| Spec ID | What | Where |
|---|---|---|
| SIM-05 | After through cuts the stock falls into islands; each is classified: the **part** (the largest island inside the part's outline), **scrap** (any other island inside it: slugs from openings) or **offcut** (outside the outline). The simulator fades scrap and offcuts and drops them from the through-cuts-only view; the part stays; the stats say how many came free. The collision check keeps them in place (the safer choice: a slug may stay on the table) | `cutFreePieces`, `dropMask` in `src/cam/stock/pieces.ts`, `SimulateDialog.tsx` |

Acceptance (`tests/cam-pieces.test.ts`): all 20 Stage 1 reference parts simulated at 0.5 mm cells,
checked against an independent expectation from the drawing only (Clipper2; no toolpaths): the part
is the outline less the openings cut through; a slug is an opening shrunk by the tool's diameter;
an offcut is the panel less the outline grown by the tool's diameter.

| Part | Found | Expected |
|---|---|---|
| Part area, all 20 | within 0.05 % (worst ref20: 86,909 against 86,954 mm²) | |
| ref02 rounded panel (R50 corners) | 4 offcuts of 80 mm² | 4 of 80 |
| ref03 arched door | 2 offcuts of 3,897 mm² | 2 of 3,898 |
| ref06 round table top | 4 offcuts of 28,266 mm² | 4 of 28,270 |
| ref20 bracket | 2 slugs: 5,589 and 28 mm² (the 12 mm cutter leaves a 3 mm-radius slug in the 15 mm hole; the slot clears completely) | 5,776 and 28 (the lead-in and lead-out arcs run inside the larger slug and take 187 mm² of it, within the allowance for lead arcs) |
| The other 16 | no pieces cut free | none |

Where there is no offcut, what drops is cell for cell what the Stage 1 `looseMask` marks.

## M2.4 screenshots

`docs/screenshots/stage-2-3/M2.4/`:

- `01-simulate-top.png`: top view at the end of a program; collision check clear; "Cut free: 1 scrap" (the slug inside the circle, faded).
- `02-simulate-3d-section.png`: 3D, see-through stock, section across the width through the pocket and the ring, tool drawn.
- `03-collision-log.png`: a 40 mm pocket with a 30 mm-flute cutter: two shank collisions in the log; the first clicked (the tool at move 617, Z-35).
- `04-collision-3d.png`: the same in 3D with a section: the shank inside the pocket wall.
- `05-machine-collision-margin.png`: the new "Collision margin" setting on the Machine page.

## M2.4 limits recorded

- **Heightfield stock**: exact for a vertical 3-axis tool. It cannot hold a ledge left above short
  flutes, so material above the flutes within the shank's reach always counts as a collision
  (a tool too short for the depth is always reported).
- **Clamps and fixtures** are not modelled yet (SIM-03 says "later"; FIX-01 is M3.6). The table is
  checked only in depth (the spoilboard thickness from the machine model, a placeholder).
- **Travel limits in X and Y** are not checked on a single part (its place on the sheet is not known
  there); the export checker already checks sheets against the table size.
- **Sloped moves** (ramps, helixes, 3D chains) are carved in half-cell steps; level moves exactly.
- **Collision checks in export** run per custom part on its own panel (cells of 0.5 mm, coarser only
  for parts over about 6 million cells). Batch runs check only the toolpaths they can calculate (no
  3D yet, as before).
- **Stock STL** of stock over 2 million cells is written every few cells (each corner the lowest cell
  round it, so nothing that was cut is shown).
- **Cut-free pieces** need a part outline to tell the part from offcuts; without one, the largest
  island is the part.

## M2.5 split

M2.5 is done in named parts: **M2.5a** reader choice, lazy WebAssembly loading, solid import with
face ids, colours, names and exact face types, the document format, Electron `app://` packaging;
**M2.5b** feature recognition onto layers that the Stage 1 rules machine, checked MPR;
**M2.5c** assemblies split into parts, faces to layers / colours / grain, machining picked faces;
**M2.5d** 3D wires and surfaces; **M2.5e** packaged-app check, screenshots and docs.

## M2.5a solid import: what was built

**Reader choice (OpenCascade as WebAssembly).** Measured here (spikes in this run):

| Candidate | Size | Face-level data | Colours, names, assemblies | IGES | Verdict |
|---|---|---|---|---|---|
| `occt-import-js` 0.0.23 (LGPL-2.1) | 7.6 MB `.wasm` + 97 kB script | Every face as its own run of triangles, corners exactly on the true surface (hole radius error 1e-14 mm), so face types and parameters are recovered exactly in our code | Yes (STEP and IGES colour per face and per body, product names, assembly tree) | Yes | **Chosen** |
| `replicad-opencascadejs` 1.1.0 (LGPL-2.1) | 23 MB `.wasm` | Full B-rep (face types, adjacency, modelling) | **No** XDE STEP reader in this build (no colours or names on import) | **No** | Kept as the option for B-rep modelling later (Stage 3 curve-driven finishing), not needed now |
| `opencascade.js` 1.1.1 (LGPL-2.1) | 67 MB package | Full | Full | Yes | Last release 2023; too big; custom builds need its own toolchain |

So: occt-import-js reads the file; face types (plane, cylinder, cone, sphere, other), their exact
parameters, adjacency and boundary loops are worked out in our own TypeScript
(`src/cam/solid/classify.ts`) by least-squares fits to the exact surface points (the reader's
normals are only good to about 1e-4, so they are used as a first guess only). Measured fit on the
fixtures: planes and cylinders within 1e-11 mm (STEP, BREP), 4e-6 mm on IGES (it stores holes as
surfaces of revolution); the drill point comes out at 118.000000000°.

| Spec ID | What | Where |
|---|---|---|
| CAD-14 | STEP (AP203, AP214, AP242), IGES and BREP read in the background worker; face ids (1, 2, 3 ... in the file's order, kept when bodies are left out), face and body colours, product names, assembly path; user-defined properties and the file's unit read from the STEP text (our own ISO 10303-21 reader); IGES unit from its global section; a unit can be forced; bad files give a plain error | `src/cam/solid/convert.ts`, `step21.ts`, `classify.ts` |
| Storage | Solids are blobs like meshes ("CSS1": faces + float64 corners), plus the original file as a second blob; part files carry both. Any code that loads a mesh gets the solid as a mesh with one facet group per face, so 3D strategies and the simulator work on solids too | `src/cam/solid/encode.ts`, `src/cam/model/blobs.ts` |
| Format | `CAM_FILE_VERSION` 3: `ModelRef.kind: 'solid'` (+ face colours and layers by face id), `Entity.solid` (shapes made from faces), `ModelPlacement.frame` (a 3 x 3 turn). An older app refuses a v3 part instead of reading a solid as a mesh. v1 and v2 parts migrate with every field kept | `src/cam/doc.ts`, `src/cam/types.ts` |
| WASM loading | The two library files are copied unmodified into `vendor/occt-import-js/` (served by the dev server, copied by the build: `vite.config.ts`). The solid worker (one, kept alive) loads them on the first solid read with a dynamic `import()` and the AMD `define` hook: no `eval`, works under the production CSP. Nothing at start-up | `src/cam/solid/occt.ts`, `solidCompute()` in `src/cam/worker/client.ts` |
| Electron | The built app is now served as `app://bundle/...` (privileged standard scheme): fetch, workers and `.wasm` (served as `application/wasm`) work like a web origin. `dist/vendor/**` is unpacked from the archive (`asarUnpack`), so the LGPL files can be seen and replaced. This finishes the `app://` item deferred from M2.1 | `electron/main.ts`, `package.json` |
| Notices | `THIRD_PARTY_NOTICES.md` (component, source links, how to replace the files, full LGPL-2.1 text) is shipped in `dist/`; the licence texts ship next to the library; Settings → About lists the third-party parts and opens the notices and the LGPL text | `src/components/AboutSection.tsx` |
| Screens | The 3D model import takes STEP / IGES / BREP: format, schema, unit, bodies (pick which), face types, properties, warnings; faces drawn in their colours in the 3D view | `ModelImportDialog.tsx`, `Model3DView.tsx`, `solidData.ts` |
| Switch | "Solid models" (`camSolids`, screens, on). Machine output still goes through the custom-part MPR switch (off) | `src/core/features.ts`, Machine page |

Fixtures (`tests/fixtures/solid/`, made by `scripts/fixtures/make_solid_fixtures.py` with the
OpenCascade Python bindings as a dev-only tool, never shipped): cabinet side with holes (STEP
AP214, standing up as in a cabinet, a coloured inside face, properties), shaped door (STEP AP203,
turned 30° and offset; the same door as BREP), 5-part assembly (STEP AP242, two instances of one
side), shelf in inches (IGES). Each has a `.truth.json` written from the construction numbers only.

### Acceptance so far

| Criterion | Proof | Measured |
|---|---|---|
| STEP fixtures load with face ids | `tests/cam-solid-import.test.ts` | Side 106 faces, door 16, assembly 72 over 5 bodies; ids 1..N in file order; the coloured face found |
| Exact face types | same | Side: 56 flat, 48 round, 2 conical, worst fit 1e-11 mm; every hole radius exact to 1e-9 mm |
| IGES, BREP, units | same | IGES in inches read as 304.8 x 254 x 19.05 mm; holes within 0.0001 mm; BREP door = STEP door |
| Bad files | same | Empty, wrong type, cut short, no solids, noise, wrong extension: each a plain `SolidReadError` |
| Volume | same | Mesh of the side within 0.02 % of the volume from the design numbers (chord of round walls) |
| Lazy loading, not in the start-up bundle | same (source scan), browser and Electron checks | Nothing imports the library; start-up bundle +0.2 kB; no `vendor/` request at start-up; first read in the browser preview 1.4 s (cold, cabinet side), Electron (Linux, `app://`) 0.96 s (door) |
| Speed (STEP part ~50+ faces < 3 s warm, cold < 5 s) | same | Node: reader start 42 ms, first read of the 106-face side 0.8 s, warm 0.56 s |

## M2.5b feature recognition: what was built

| Spec ID | What | Where |
|---|---|---|
| SOL-01 alignment | Lay the panel flat: thickness = the direction with the most area of opposite flat faces; face 1 = the side the pockets open on (only drilling can be done from face 6, in the turned-over program), else the side more blind holes open on; length along the longer side of the smallest rectangle round the panel (rotating calipers on the convex hull); a face can be named as face 1 instead | `src/cam/solid/align.ts` |
| SOL-01 recognition | Outline (largest outer loop of the big faces, exact lines and arcs), cut-outs (openings whose walls reach the underside with no floor), pockets (each flat floor: depth, outline where its walls meet the face above, islands, smallest corner radius), holes (round walls going all the way round: diameter, depth to the shoulder, drill point tip depth and angle, flat / point / through, face 1 or 6), holes in the edges (faces 2-5 with Stage 1's (u, v)), pockets from the underside, rebates (pockets open to the edge: the shape reaches 6 mm past the edge, see decision 1), anything else listed with a reason. A round hole with no drill of that size becomes a round pocket or cut-out | `src/cam/solid/recognize.ts` |
| Layers | Features go on layers the built-in "Shop layer names" rules already read: `Outline`, `INSIDE`, `POCKET_D<depth>`, `DRILL_D<Ø>_<depth>`, `THRU_DRILL_D<Ø>`, `DRILL_D<Ø>_<depth>_BACK` (face 6), `DRILL_D<Ø>_<depth>_EDGE`; `BACK_POCKET_D<depth>` and `EDGE_HOLE_...` (no drill that size) on purpose match no rule. Every shape remembers its solid faces (`Entity.solid`); hole shapes carry their exact depth | `src/cam/solid/toPart.ts` |
| Part from a solid | Sized to the panel, the solid on it as a model turned flat (`ModelPlacement.frame`), material picked from the file's "Material" property when the library has one of that name | `solidToPart`, `material.ts` |
| Screens | Part designer, 3D tab, on a solid: "Find features" (table of what was found, warnings) and "Lay flat and use as the part" (with the layer rules applied). Parts list: "Import solid" makes one part per distinct body (quantities, properties, material), rules applied | `SolidFeatures.tsx`, `src/components/SolidImportDialog.tsx` |
| Worker | `solid.recognize`, `solid.part`, `solid.assembly` (recognition runs in the background) | `src/cam/worker/tasks.ts` |

A fifth fixture, `feature-block.step`, covers the rarer cases: an island, a hole in a pocket floor,
an underside pocket, a 60 mm round pocket, holes in all four edges, a rebate and a chamfer.

### Acceptance (M2.5 criteria for recognition)

| Criterion | Proof | Measured (worst over the fixture) |
|---|---|---|
| Every outline, pocket and hole found, depths within 0.01 mm | `tests/cam-solid-recognition.test.ts` against the `.truth.json` files | Cabinet side (30 holes, 4 pockets incl. a stepped one, 1 cut-out, L outline): position 0, Ø 0, depth 0, drill-point tip 4.8e-7 mm, area 3.6e-12 mm². Door (arch R250 exact, field R180, knob hole, 2 hinge cups on face 6): all 0, area 4e-6 mm². Feature block: all found, nothing left unexplained. IGES (holes as surfaces of revolution): within 0.0001 mm |
| Results on layers the Stage 1 rules machine | same | Cabinet side: every layer matched, 9 operations; door: every layer matched; feature block: only `BACK_POCKET_D5` left (by design) |
| MPR passes the export checker | same (`runJob`, custom-part output switched on for the test) | No errors for the cabinet side and the door. Off (the default): blocked with `CAM_OUTPUT_OFF`. The MPR read back: 26 x Ø5 at 13 mm, 2 x Ø8 at 13 mm, 2 x Ø8 through; door's turned-over program: 2 x Ø35 at 13 mm |
| Drill points | same | Depth = shoulder (13); tip depth (15.403) reported. Drill operations use their default "depth to the tip", so a pointed bit never goes deeper than the model's wall |
| Rebate stays inside the checker's limit | same | Cutter centre within radius + 0.5 mm of the part; floor cleared to the edge |
| Speed | same | Recognition: cabinet side 109 ms, door 21 ms (in the worker) |

### Limits recorded

- **2.5D panels.** Sloped walls, round-overs and free-form faces are listed (with a warning) and
  left for 3D machining; a chamfer or round-over along the outline is cut straight (warning).
- **Underside pockets** are found and put on `BACK_POCKET_...` (no rule machines them).
- **Holes**: a round wall that does not go all the way round is not a hole (pocket corners).
  Edge holes need a horizontal drill in the tool table (none in the placeholder table): they land on
  `EDGE_HOLE_...` and are not machined.
- **Pocket corners**: the Stage 1 pocket picks the widest cutter that fits the pocket's width; it
  does not look at the corner radius, so a 12 mm cutter in a 40 x 20 R3 recess leaves R6 corners.
  The feature list shows each pocket's smallest corner radius.

## M2.5c assemblies, faces and face machining: what was built

| Spec ID | What | Where |
|---|---|---|
| SOL-04 | Bodies grouped into parts: same name and same shape (panel size, face count, types and areas, and the holes, pockets and cut-outs in the panel's own frame, either way round). A turned copy counts as the same part; a mirrored copy (same areas, mirrored holes) is a separate part ("Side (2)"). Quantity = number of bodies; properties from the file's product; the parts go into the parts list they were imported from (a job's parts are nested with the job) | `src/cam/solid/assembly.ts`, `SolidImportDialog.tsx` |
| SOL-02 | Machine picked faces: pocket (pick the floor or a wall), drill (the hole's wall, floor or drill point), profile (a wall of the outline: outside, through; of a cut-out: inside, through; of a pocket: inside at its depth; loose upright walls: along their top edges at their depth), saw (along a straight upright wall's top edge, at its height). The picked faces are matched to the recognised feature they belong to, so the shapes are exact; they are made for you, linked to the faces, on the "Machined faces" layer (no rule reads it, so the layer rules never double them), with one operation | `src/cam/solid/faces.ts` (`machineFaces`, `faceShapes`) |
| SOL-03 | Faces to a layer by colour or by type (hole walls of one size, flat faces...): their shapes go on the layer (the layer rules machine it by its name), optionally with a recipe's operations; the faces remember the layer. Face colours set in the app (they win over the file's). Grain from faces: their longest straight edge becomes the part's length and the grain runs along it; the file's "Grain: Length" property also sets the grain | `sendFacesToLayer`, `setFaceColor`, `facesByColor`, `facesByType`, `grainDirection`; `solidToPart` (`grainFaces`) |
| Associativity | An operation on shapes made from solid faces includes the solid's current data in its input hash: a new version of the file marks those operations stale at once. "Update shapes" makes the shapes again from the same face ids (faces no longer there are listed, shapes left as they were). Parts without solid shapes hash exactly as before | `opInputHash` in `src/cam/doc.ts`, `staleSolidShapes`, `refreshSolidShapes` |
| Screens | 3D view: click a face of a solid to pick it, Shift-click to add (picked faces amber). Side panel "Faces": select by colour or type (hole size), Machine: Profile / Pocket / Drill / Saw, colour faces, send to a layer (with a recipe), "New version" of the file, "Update shapes" when the solid changed. "Features": grain along the picked faces | `Model3DView.tsx`, `SolidFacesPanel.tsx`, `facePick.ts`, `SolidFeatures.tsx` |

### Acceptance (M2.5 criteria and spec text for SOL-02/03/04)

| Criterion | Proof | Measured |
|---|---|---|
| 5-part assembly split into named parts with quantities and properties | `tests/cam-solid-faces.test.ts` | Side x2, Bottom, Top rail, Back; properties as in the file; sizes 720 x 560 x 19 ... 701 x 562 x 6 |
| Into the job and nesting | same (`runJob`, output on) | 5 pieces nested on 2 sheets (plywood, MDF back, materials from the "Material" property); no export-checker errors; cut list Side qty 2 |
| Turned copy grouped, mirrored copy kept apart | same | 2 parts: "Cabinet side" x2 and "Cabinet side (2)" x1; the mirrored copy still reads 30 holes, 4 pockets, 1 cut-out |
| Machine faces without a 2D extract | same | Floor of the 4 mm step -> pocket cut to 4.000; drill point -> drill Ø8 at 13; outline wall -> outside through profile; cut-out wall -> inside through (box 300,250-420,290 exact); straight wall -> saw line 720.000 long, refused by the export checker (no saw unit) |
| Faces to layers by type / colour; recipe | same | 26 hole walls Ø5 -> 26 circles at 13 mm on "SHELF_PINS"; with the drill recipe, 26 drill moves at 13; an outline wall sent to "cut" -> the shop rules give a through profile |
| Face colours; grain from a face | same | Red face found by colour; set / cleared in the app; side's grain along file Z (its 720 length); the door's 400 mm bottom edge face puts 400 along X |
| Stale when the solid changes | same | New version: every operation on its shapes stale, every shape listed; "Update shapes": all made again, same geometry; a different solid: shapes listed as missing |

## M2.5d 3D wires and surfaces: what was built

All in our own TypeScript; new surfaces are 3D models (meshes in part coordinates, stored like
imported ones) that the 3D strategies machine. Round shapes are divided so facets stay within
0.01 mm of the true surface.

| Spec ID | What | Where |
|---|---|---|
| CAD-16 | Edges where a solid's faces meet as 3D polylines (one per pair of faces; smooth joins left out; angles from the exact surfaces); contours joined from picked edges or paths (projected onto face 1); faces as a surface of their own; 3D polylines typed in and edited point by point (move, insert, remove; length in 3D) | `src/cam/solid/wires.ts`, `src/cam/mesh/poly3d.ts`, Properties panel |
| NEW-19 | Revolve (a profile: its left end is the axis, its top face 1; any angle), ruled between two curves, loft through sections, sweep a section along a path (no twist: rotation-minimising frames), extrude, flat (a closed shape with holes filled), fillet between two flat faces of a solid (outside edge or inside corner), split by a level plane (keep above or below), extend open edges (straight on, square corners), untrim a face (flat: its rectangle; round: the whole cylinder or cone; sphere), solid to mesh | `src/cam/mesh/surface.ts`, `wires.ts` |
| Screens | 3D tab: "Surfaces from the drawing" (Extrude, Flat, Ruled, Loft, Sweep, Revolve on the shapes picked in the drawing; Z1/Z2), "3D wires" (Join to contour, New 3D polyline). Faces panel: From faces, Untrim, Edges, Fillet (two flat faces, radius), To mesh. Mesh models: Extend by, Keep above / below Z | `SurfacesPanel.tsx`, `SolidFacesPanel.tsx`, `ModelsPanel.tsx` |
| Worker | Surface making and every face job (machining faces, sending to layers, updating shapes, untrim, edges, fillet) run in the background worker; recognition and surface code are not in the start-up bundle | `surface.make`, `solid.faces`, `solid.machineFaces`, `solid.sendFaces`, `solid.refresh` |

### Acceptance (analytic checks, `tests/cam-surfaces.test.ts`)

| Check | Measured |
|---|---|
| Revolve: quarter circle R50 -> hemisphere | Every point on the sphere (float32 storage); facet centres within 0.02 mm inside; area within 0.1 % of 2πr² |
| Ruled between circles R50 (z 0) and R30 (z -20) | Every point on the cone; area within 0.1 % of π(R+r)·slant |
| Loft, extrude, flat with a hole | Areas exact (to 1e-6) |
| Sweep: circle R5 along a line / a quarter arc R50 | Every point 5 from the path (1e-4); areas match Pappus within 0.1 % |
| Fillet between two flat faces | Every point at the radius from the centre line; tangent at both faces; outside edge and inside corner; on the solid: a round-over of the panel edge and of a pocket corner |
| Split, extend | Split cube areas add up; a 10 x 10 square extended by 2 is 14 x 14 |
| Edges, join, faces, untrim on the cabinet side | Inside face's outline edges = 2 x (720 + 560) mm exactly, all at 90°; joined into one closed contour of the L's area; face surface = face area; untrimmed inside face = 720 x 560 rectangle; R6 corner -> whole cylinder |

### Limits recorded

- **Fillet** is between two flat faces only. Curved-to-curved fillets, true trimming and untrimming
  of free-form faces need a B-rep modelling kernel (the replicad OpenCascade build is the option;
  23 MB, not added). Untrim of a free-form face says so.
- **Surfaces are meshes** (facets within 0.01 mm), not exact B-rep surfaces; the 3D strategies
  work on meshes anyway.
- **Extend** is straight on (linear), not along the surface's curvature.

## M2.5e packaged app, screenshots, docs

**Packaged desktop app (Linux x64, `electron-builder --linux dir`)**: the app runs from
`app.asar` as `app://bundle/index.html`; the reader's files are in
`resources/app.asar.unpacked/dist/vendor/occt-import-js/`. Reading the cabinet side through the
packaged app: first read (cold, WebAssembly compile) 1.17 s, warm 0.45 s, recognition 30 holes;
**no network requests** (everything from `app://`). With the `.wasm` hidden, the read fails with a
plain "HTTP 404" message (no crash), which shows the unpacked file is the one used (so it can be
replaced, as the LGPL asks). Windows x64 (`--win dir`) and macOS arm64 (`--mac dir`) packages were
also built here and have the vendor files in the same unpacked place; they cannot be run in this
Linux container. The owner's check on the shop computers is in the open questions.

**Screenshots** (`docs/screenshots/stage-2-3/M2.5/`):

- `01-import-step.png`: the 3D model import reading a STEP AP203 door: schema, faces, body, unit, face types.
- `02-import-assembly.png`: Import solid with the 5-part assembly: Side x2, Bottom, Top rail, Back, properties, sizes, materials.
- `03-assembly-parts.png`: the four parts added (5 pieces), with their operations from the layer rules.
- `04-find-features.png`: Find features on the cabinet side: the feature table (layers, faces, sizes, depths).
- `05-features-on-layers.png`: after "Lay flat and use as the part": 36 shapes, 9 operations, toolpaths.
- `06-face-picked-3d.png`: a face clicked in the 3D view (amber), the Faces panel.
- `07-machine-picked-faces.png`: the Ø8 hole walls selected by type and drilled in one operation.
- `08-revolved-surface.png`: a typed 3D polyline profile revolved into a dish surface (a 3D model).
- `09-machine-solid-switch.png`: the "Solid models" switch on the Machine page (custom-part output still off).
- `10-about.png`: Settings → About with the third-party parts and licences.
- `11-lgpl-text.png`: the LGPL-2.1 text shipped with the reader, opened from About.

## M2.5 decisions needed (see the report)

1. **Rebate reach (cutting).** A pocket open to the panel's edge (a rebate) gets a shape that
   reaches 6 mm past the edge, so the cutter clears the floor right to it while its centre stays
   within the export checker's limit (radius + 0.5 mm outside the part). Recommended as is; the
   alternative is to leave rebates off the machined layers. Until answered: as built (6 mm), and
   custom-part output stays off.
2. **Drill points.** A hole with a drill-point floor is drilled to the shoulder depth (the round
   wall's depth); the point's tip depth is reported. With the Stage 1 default "depth to the
   tip", a pointed bit never goes deeper than the model's wall. Recommended as is.
3. **Shop check of the packaged app** on the Windows PC and the Mac: open a STEP file once with
   the network off (the reader must load from the app's own files).

## M2.6 split

M2.6 is done in named parts: **M2.6a** saw cuts (2D-11), facing (2D-16), the document format and
the two switches; **M2.6b** chamfers (2D-13), cuts between curves, along 3D curves and Z-waves
(2D-15); **M2.6c** hand-drawn toolpaths (NEW-09) and toolpath edits (NEW-11); **M2.6d** edge work
with a rotating aggregate (5AX-04), screenshots and docs.

Owner decisions for this milestone (received with the M2.6 go-ahead): the saw unit and the
rotating aggregate are **absent** on the N-200 until confirmed; ops and screens ship, the export
checker blocks their machine output with a clear message; no saw or aggregate macro is invented as
proven output.

## M2.6a saw cuts and facing: what was built

| Spec ID | What | Where |
|---|---|---|
| 2D-11 | Saw-cut settings on the saw operation (absent = the Stage 1 groove, unchanged): blade tilt 0-45° and the side it leans to; extend to clear (full depth right to the line ends, the blade running past them by its run-out) or keep the surface cut on the line; extra length; minimum length; join lines that lie on one line and touch or overlap; keep off neighbours (the blade's cut never leaves the part outline; ends pulled back and the uncut length reported). Run-out = sqrt(2Rd - d²) from the blade diameter (new tool field; without it a PLACEHOLDER 200 mm blade with a warning: larger = longer run-out, so the checks err safe). The moves follow the floor of the cut, blade arcs at both ends, so the simulator carves what the blade cuts | `src/cam/more25d/saw.ts`, `genSawCuts` in `src/cam/toolpath.ts` |
| 2D-11 show the blade | Drawing: the cut's footprint at the surface (kerf wide, run-outs included) and the blade (diameter long) at both ends of the full-depth run. Simulator 3D: a disc standing in the cut, leaned for angled cuts | `Canvas.tsx` (`SawBlades`), `SimulateDialog.tsx` (`BladeModel`) |
| 2D-16 | Facing: back-and-forth lines plus a pass round the edge, or rings from the outside in; whole panel or picked closed shapes; depth in passes; tool centre past the edge (0 = on it); widest flat cutter by default; ramps in when the tool cannot plunge. "Re-set the stock top": later operations on face 1 measure depths from the faced surface (they are made for the thinner panel and moved down, so through cuts still end where they did); 3D operations keep following their model; rest and adaptive pockets say they still measure from face 1 | `genFace`, `shiftTop`, `stockTopShift` in `src/cam/doc.ts` |
| Format | `CAM_FILE_VERSION` 4 (new operation kinds, saw settings; toolpath edits come in M2.6c). v1-v3 parts migrate with every field kept; an older app refuses a v4 part | `src/cam/doc.ts` |
| Switches | "More 2.5D machining" (`camMore25d`, screens, on); "Write facing, chamfers and saw cuts to MPR" (`cam25dMprOutput`, **off**; also needs the custom-part switch) | `src/core/features.ts`, Machine page |
| Export checker | `MACHINE_CANNOT` for any enabled saw operation while the machine model has no saw unit, whatever the switches (before, only when grooves were written); `CAM_25D_OUTPUT_OFF` while the new switch is off; `CAM_NO_OUTPUT` for operations with no confirmed woodWOP form (angled saw cuts now; more in later parts); `OP_HITS_NEIGHBOUR` when a facing cutter's reach or a saw blade's run-out enters another part on the sheet | `src/core/validator.ts`, `src/core/machining.ts` |

### Acceptance

| Criterion | Proof | Measured |
|---|---|---|
| Golden toolpaths on 3 reference parts per op | `tests/golden/cam25d/{saw01,saw02,saw03,face01,face02,face03}` (digest + MPR) | Saw: joined grooves extended to clear; cuts kept inside with a short line and an arc left out; angled cut. Facing: whole panel then a pocket from the new top; rings in two passes; round top at 30°. All Stage 1, 2D and 3D goldens unchanged |
| Saw output only with a saw unit; otherwise blocked clearly | `tests/cam-saw-face.test.ts` | Placeholder N-200: `MACHINE_CANNOT` ("the machine model has no saw unit") with every switch combination. Saw unit declared: `CAM_25D_OUTPUT_OFF` until the new switch is on, then one `<109 Nuten>` and no errors. Angled cut: `CAM_NO_OUTPUT` with every switch on |
| Blade geometry | same | Run-out 39.192 mm for a 200 mm blade 8 mm deep (= sqrt(1536)); the floor of every planned cut equals R - sqrt(R² - e²) above full depth at e past the end (to 1e-9); angled 30° cut 10 mm deep: floor 5.774 mm beside the line, run-out from 11.547 mm along the blade |
| Simulated cut | same | 8.000 mm deep along the line (0.25 mm cells); past the end, between the blade arc and the arc shifted by half the kerf (the simulator cuts with a round cutter of the kerf's width); nothing 2.5 mm past the run-out |
| Neighbours | same | Six parts nested, run-out 39 mm, keep-off switched off: `OP_HITS_NEIGHBOUR`; switched on: no errors |
| Facing level | same | Whole panel at -1.000 mm in every 0.5 mm cell (both patterns); passes at -1, -2, -3; centre within the overhang |
| Re-set stock top | same | Pocket 5 mm after 2 mm of facing: cut to -7, macro depth 7; through profile still ends at -(19 + through depth); changing the facing marks the pocket stale |
| Facing on a sheet | same | 12 mm cutter (reaches 6 mm into the 12 mm gap): clean; 40 mm cutter: `OP_HITS_NEIGHBOUR` |

### Limits recorded

- **woodWOP's saw macro**: the groove is written with the full-depth span as XA..XE (EM MOD0). What
  woodWOP takes XA/XE to mean (cut length at the surface or at full depth) is not confirmed; it only
  matters once a saw unit is fitted (decision).
- **Angled saw cuts are simulated from above**: the heightfield cannot hold the overhang, so the
  simulator shows the material over the leaning blade as cut.
- **The simulator's saw is a round cutter of the kerf's width**, so at the ends of a cut it shows up
  to half the kerf more than the blade cuts.
- **Facing on shaped outlines** links passes along the edge only where the link stays inside the
  faced area; elsewhere it lifts.

## M2.6b chamfers and curve cuts: what was built

| Spec ID | What | Where |
|---|---|---|
| 2D-13 | Chamfer: a V cutter's flank lies on the bevel. Width- or depth-driven (for half-angle a, width = depth x tan a); the tip can run lower than the bevel's bottom (then it moves that much x tan a to the waste side, so the flank cuts); outside / inside / left / right, climb or conventional; passes. From shapes on face 1, or from level 3D edges of a solid (the 3D polylines M2.5 makes from edges) at their own height; edges that are not level are left out with a warning; a chamfer too big for the cutter is refused. Picks the largest V cutter. Written as contour-milling passes behind the M2.6 output switch | `genChamfer` in `src/cam/toolpath.ts` |
| 2D-15 between | Cut between two curves: the surface ruled between them (each resampled by length, open curves run the same way, closed ones lined up), finished with passes from one curve to the other no further apart than the step-over (measured on the surface). Every point is an exact drop-cutter position on that surface and the moves are refined like 3D finishing, so a ball, bull-nose, flat or V tool never cuts into it. 2D shapes take a depth each; 3D polylines keep their heights. Calculated in the background worker (0.1-0.45 s on the references) | `src/cam/more25d/curves.ts` (`betweenCurves`) |
| 2D-15 along 3D | The tool tip follows 3D polylines, or a smooth curve through their points (Catmull-Rom, chord within the tolerance), with a depth below them in passes | `smooth3`, `genCurve` |
| 2D-15 Z-wave | A 2D shape cut with the depth rising and falling between two depths every wave length (smooth or straight up and down); closed shapes get a whole number of waves so the ends meet; optional layers (each pass stops at its floor) | `zWave`, `waveDepth` |
| Output | Curve cuts move the tool up and down along the path: true 3D, so `CAM_NO_OUTPUT` (also when export skips the background calculation) | `genCurve`, `generatePart` |
| Screens | Add operation: Chamfer, Cut between two curves, Cut along a 3D curve, Z-wave along a shape, with their editors | `OpsPanel.tsx` |

### Acceptance

| Criterion | Proof | Measured |
|---|---|---|
| Golden toolpaths on 3 reference parts per op | `tests/golden/cam25d/{cham01-03, btw01-03, f3d01-03, zw01-03}` | Chamfer: panel outline by width; round opening by depth in two cuts with the tip lowered; a level 3D edge at -6 and an open edge. Between: plane bevel, cone between circles, twisted surface between 3D polylines. Along: ramp polyline, smooth curve in two cuts, closed loop. Z-wave: open sine, triangle round a circle, 2 mm layers round a rectangle. Earlier goldens unchanged |
| Chamfer geometry (simulated, independent of the generator) | `tests/cam-chamfer-curves.test.ts` | 90° cutter, 3 mm wide: the stock at distance u from the edge is -(3 - u) within 0.002 mm (0.1 mm cells) on two edges. 60° cutter, 4 mm deep, tip 1 mm lower: tip at -5, 0.577 mm outside the panel; bevel -(4 - u / tan 30°) within 0.003 mm |
| Between curves: no gouge | same (the exact ball-nose checker from M2.2, against the true surface) | Plane bevel and cone: deepest 0.005 mm or less; on the bevel the ball centre is its radius from the plane within 0.002 mm (it touches); 22 passes for a 41.2 mm slant at 2 mm |
| Along 3D / smooth | same | Tip exactly on the polyline's points; the smooth curve passes through every point (1e-9); depth passes at -5.5 and -6 |
| Z-wave | same | Shallowest at the start, deepest at half a wave; straight moves within 0.01 mm of the true wave; a closed circle gets 13 waves of 48.33 mm and joins; layers stop at -2, -4, -6; the simulated groove lies between the wave and the deepest point within the cutter's reach |
| Output | same | Chamfer: `CAM_25D_OUTPUT_OFF` until the switch is on, then no errors. Curve cuts: `CAM_NO_OUTPUT` with every switch on |

### Limits recorded

- **Chamfers from solid edges** need the edge as a level 3D polyline (from "Edges" on a solid); a
  chamfer along a sloping edge is not made.
- **Inside corners of a chamfer** are rounded by the cutter (a V cutter cannot make a sharp inside
  corner on the bevel).
- **Between curves**: a ball-nose cannot reach a sharp bottom edge of the surface (on the bevel
  reference the deepest point is 0.09 mm above the 10 mm line); passes at either end follow the
  curve, not past it.
- **Smooth curves through points** can swing outside the polyline at sharp corners (that is what a
  curve through the points does); use straight pieces there.

## M2.6c hand-drawn toolpaths and toolpath edits: what was built

| Spec ID | What | Where |
|---|---|---|
| NEW-09 | Hand-drawn toolpath: pick feed lines, arcs (through a point, then the end) and rapids on the drawing (snaps apply), at a set height; undo last; edit each step's X, Y, Z in a table or remove it; start point from the first pick or a selected point. Runs of cuts at one depth are written as contour passes (a straight plunge at a run's start is woodWOP's own approach) behind the M2.6 output switch; a run that changes depth while cutting is simulated only (`CAM_NO_OUTPUT`). Rapids below face 1 are warned about (and show as collisions) | `src/cam/more25d/edits.ts` (`appendStep`, `undoStep`, `arcThrough`), `genManual`, `EditsPanel.tsx` (`ManualFields`), the designer's pick mode |
| NEW-11 | Toolpath edits on any operation except notes and drilling: slow down in corners (sharp turns, and arcs tighter than the distance that turn at least the angle; distance each side, steps, feed % at the corner); feed % on single moves or stretches; Z point by point; moves between cuts at another height; reverse (last cut first, each the other way; native contours reversed too; refused when a new start would plunge deeper than the tool may or the tool is not centre-cutting); pocket start points (rings start at the nearest point, back-and-forth lines from the nearer end). Arcs now carry a feed factor like feed moves (simulator, times and the template post use it) | `applyEdits`, `slowCorners`, `reverseMoves` in `edits.ts`; `editToolpath`, `reverseIntents` in `src/cam/toolpath.ts`; `EditsGroup` |
| NEW-11 survive or flagged | Point edits are anchored to the unedited toolpath (move number + where it ended, and a hash of the whole path). On every calculation they are applied as made when the path is the same; moved to the move that now ends at the same point when it changed; otherwise counted as lost: the operation shows "Edits lost", a warning says so, and the export checker refuses it (`CAM_NO_OUTPUT`) until "Keep on the new toolpath" (re-anchors) or "Clear point edits". Rule-based edits always carry over | `locate`, `reanchor` |
| Output | Feed and rapid-height edits are not written to woodWOP (warning: its contour macro keeps one feed and makes its own moves between passes); heights edited point by point refuse output; any edited operation needs the M2.6 output switch | `isMore25d`, `editToolpath` |

### Acceptance

| Criterion | Proof | Measured |
|---|---|---|
| Golden toolpaths on 3 reference parts per op | `tests/golden/cam25d/{man01-03, edit01-03}` | Hand-drawn: square groove; lines, an arc and a rapid between two depths; a ramp (refused for output). Edits: outline slowed in its 4 rolled corners; engraving reversed with lower moves between cuts; pocket from a start point with a slower stretch and one lower point (anchored as the screen anchors them). Earlier goldens unchanged |
| Edits survive regeneration or are flagged | `tests/cam-manual-edits.test.ts` | Same path (only the feed changed): 1 applied as made. Two passes instead of one: the point at -6 found again on the last pass, 1 moved. Depth 8: 1 lost, warning, `CAM_NO_OUTPUT` ("keep or clear them"). After "keep": applied as made again; after clearing a lost one: written again |
| Corner slow-down | same | Square 100 x 100, 10 mm, 2 steps, 40 %: pieces 90-95 at 70 %, 95-100 and 100-105 at 40 %, 105-110 at 70 %, the rest full; outline with rolled corners: 4 corners, factors 1 / 0.75 / 0.5, longer time |
| Reverse | same | Engraving: simulated stock identical cell for cell (0.5 mm cells), first cut the old last one, native contours reversed; refused with a non-centre-cutting tool |
| Hand-drawn path | same and a browser check | Picks become feed / arc (centre and direction from three points) / rapid steps; undo last; two contour passes at 2 and 4 mm for the two-depth path, no export errors with both switches on, `CAM_25D_OUTPUT_OFF` without the new one |
| Start points | same | Every depth of a ring pocket plunges in the quarter nearest the start point; back-and-forth starts nearer it than without |

### Limits recorded

- **Point edits are for operations calculated in the designer** (not 3D or adaptive ones, which are
  calculated in the background); rule-based edits work on all.
- **A moved edit goes to the move ending at the same point** (within 0.01 mm), nearest in number;
  on a path that visits the same point several times at the same height, it can land on another
  visit. It is then reported as moved, so it can be checked.
- **Reverse plunges straight down** at each new start (where the old cut ended); ramp and helix
  entries become exits.


## M2.6d edge work with a rotating aggregate: what was built

| Spec ID | What | Where |
|---|---|---|
| 5AX-04 | Edge work: a flat tool on an aggregate that turns about the vertical axis, kept square to the edge of the picked shapes (the part outline by default), its tip pushed a set reach into the edge with its axis a set height below face 1, in passes; material on the left or right of travel; open edges run on past their ends; it comes in from 2 mm outside the edge and goes back out. The tool must cut the whole reach (flute length). The simulator draws the path and the tool lying flat with a block for the aggregate; it does not carve it (the heightfield sees the stock from above) and the collision check leaves it out, as for edge drilling | `genEdge` in `src/cam/toolpath.ts`, `buildTimeline` in `src/cam/sim.ts`, `FlatToolModel` in `SimulateDialog.tsx` |
| Output | Never written: `CAM_NO_OUTPUT` (no confirmed woodWOP aggregate macro), plus `MACHINE_CANNOT` while the machine model has no aggregate (the N-200 default) | `src/core/validator.ts`, `src/core/machining.ts` |
| Screens | Add operation → Edge work (aggregate), with a warning when the machine model has no aggregate; the Machine page's aggregate switch now says edge work is simulated only without it | `OpsPanel.tsx` (`EdgeFields`), `MachineModelSection.tsx` |

### Acceptance

| Criterion | Proof | Measured |
|---|---|---|
| Golden toolpaths on 3 reference parts | `tests/golden/cam25d/edge01-03` | Groove round a rectangle; arched door edge in two passes; one straight edge with run-on |
| Aggregate output only with the unit; otherwise blocked clearly | `tests/cam-edge.test.ts` | Placeholder N-200: `MACHINE_CANNOT` ("need a rotating aggregate, and the machine model has none") and `CAM_NO_OUTPUT`. Aggregate declared: `CAM_NO_OUTPUT` only ("no confirmed woodWOP macro") |
| Geometry | same | Every cutting point 4.000 mm inside the outline at -9.5; moves in and out 2 mm outside; open edge runs on to x = 610; too much reach for the tool refused |
| Not carved, no false collisions | same | Every simulated cutting segment marked as under the surface; heightfield untouched; collision check clean |

## M2.6 screenshots

`docs/screenshots/stage-2-3/M2.6/` (browser preview, Playwright):

- `01-add-operation-more-25d.png`: the Add operation menu with the More 2.5D group.
- `02-saw-cuts-blade.png`: saw cuts kept inside the part: footprints with run-outs, the blade at each end, the placeholder-blade and pulled-back warnings.
- `03-saw-blade-3d.png`: simulator 3D, looking along the groove: the blade standing in the cut at the end of its run-out.
- `04-facing-reset-top.png`: the facing editor with "Re-set the stock top".
- `05-chamfer.png`: the chamfer editor on the door's outline.
- `06-wave-chamfer-simulate-3d.png`: simulator 3D after facing, chamfer and the Z-wave groove.
- `07-between-curves.png`: passes between two circles (a bevel) and a smooth 3D curve.
- `08-hand-drawn-toolpath.png`: a path drawn with feed lines, an arc and a rapid; the steps table.
- `09-toolpath-edits.png`: a pocket from a start point with corner slow-down; the move table for point edits.
- `10-edge-aggregate.png`: the edge-work editor with the no-aggregate warning.
- `11-edge-aggregate-3d.png`: simulator 3D: the flat tool entering the panel's edge.
- `12-edits-lost-flagged.png`: after changing the pocket's depth, a point edit no longer matches: "Edits lost" and the keep / clear banner.
- `13-machine-switches.png`: the two new switches on the Machine page (screens on, output off).

## M2.6 decisions needed (see the report)

1. **Saw blade (cutting).** The blade diameter of T140 (needed for the run-out; a placeholder
   200 mm is used meanwhile, which errs long) and, if a saw unit is ever fitted, what woodWOP's
   saw-groove XA / XE mean (cut length at the surface or at full depth). We write the full-depth
   span. Until answered: saw output is refused (no saw unit), and the new output switch is off.
2. **Rotating aggregate.** Whether one will be fitted, and if so a small program saved from
   woodWOP that uses it, so the macro can be matched. Until then: simulated only, always refused.
   Our reading of 5AX-04 is a flat tool on an aggregate turning about the vertical axis; say if
   you meant something else.
3. **Placeholder cutting values for the new operations**: facing step-over 45 %, corner
   slow-down 45° / 10 mm / 2 steps / 50 %, edge-work height 9.5 mm and reach 5 mm, Z-wave 1-4 mm
   every 40 mm, between-curves step-over 1 mm. Replace with the shop's values when ready.

## M2.6e unconfirmed values: what was built

| What | Where |
|---|---|
| Registry of unconfirmed values, each with a key, the value in use and where the real one goes: per tool (number / diameter / depth while the table is placeholder; saw blade diameter, assumed 200 mm when absent; shank, flute and stick-out of 3D tools; feeds, speed and step-down, also when the built-in 18000 rpm / 5000 mm/min is used), holders, the seven machine-model facts (table, travel, tool change, safe Z, spoilboard, saw unit fitted or not, aggregate fitted or not) and twelve default cutting values (pocket, facing, 3D finishing and roughing step-overs and step-downs, adaptive width, corner slow-down, edge-work height and reach, Z-wave, between-curves step-over) | `src/core/confirm.ts` |
| Confirmation stored in the data: `MachineProfile.confirmed` (shop values), `CamOp.confirmed` (an operation's own); `MachineProfile.cutDefaults` (the shop's default cutting values). Optional fields: no format change. Confirming an operation value does not mark it stale (it is left out of `opInputHash`) | `src/core/types.ts`, `src/cam/types.ts`, `src/cam/doc.ts` |
| An operation value is a placeholder while it equals the shop default, that default is not confirmed, and the operation has not confirmed it. Typing a value in the operation editor confirms it for that operation (an override); a different value set earlier counts as the owner's | `opFieldPlaceholder`, `confirmOp` |
| Shop defaults on the Machine page ("Default cutting values"). New operations take them; changing one confirms it and moves every operation still on the old value (jobs and the part library), which marks them stale. Saw cuts also take a per-operation blade diameter | `setCutDefault`, `retargetDefault`, `newOpDefaults`, `CutDefaultsSection.tsx`, `SawSettings.blade` |
| Badges: operation editor (a strip of every value the operation uses, plus a badge on each field from a default, on the tool and on the feed), tool table (per row) and tool dialog (data, blade, lengths, feeds, holder; new feed / speed / step-down fields), Machine page (banner listing all, machine model, defaults), simulator (values behind the simulation and collision check), export checker (`UNCONFIRMED` warning with the values the job uses; `PLACEHOLDER_TOOLS`, `MACHINE_PLACEHOLDER` and the saw / aggregate `MACHINE_CANNOT` carry their Configure links), sidebar banner (count) | `Configure.tsx`, `configureFocus.ts`, `OpsPanel.tsx`, `opConfigure.tsx`, `EditsPanel.tsx`, `MachinePage.tsx`, `ToolDialog.tsx`, `MachineModelSection.tsx`, `SimulateDialog.tsx`, `JobPage.tsx`, `App.tsx` |
| Configure opens the exact field: the store holds the target (`openConfigure`), the page opens what holds it (Machine page: the tool dialog; designer: the operation) and focuses it with a highlight | `useConfigureTarget`, `focusField` |

Owner decisions applied: T140 keeps the placeholder 200 mm blade (badge); the aggregate counts
as not fitted (badge on the fact); the M2.6 defaults stay as they were (badges). Confirming all
machine-model facts clears the model's placeholder flag but never fits a unit; output switches
are untouched.

### Acceptance

| Criterion | Proof | Measured |
|---|---|---|
| Badges show for placeholders and clear once confirmed | `tests/confirm.test.ts`; browser check | Placeholder machine lists the T140 blade ("Ø200 mm (assumed)"), tool data, 3D lengths, feeds, the holder, all 7 machine facts (aggregate "not fitted") and the defaults. "Mark as confirmed" clears exactly that one and changes no value. In the browser: typing 250 in T140's Blade Ø cleared its badge (sidebar 44 -> 43); "Mark as confirmed" on a default cleared it; typing a facing step-over cleared that operation's badge |
| Operation values | same | A new facing takes the shop default and shows its badge; typing a value or marking it clears it; confirming the shop default clears it everywhere; a saw cut with its own blade drops the tool's blade badge; edge work shows height, reach and the aggregate |
| Edits mark operations stale and re-run the checks | same | Changing the facing default to 60 % moved the job and library operations on 45 % (stale) and left the one confirmed at 45 %; a 20 mm blade instead of the placeholder 200 mm: the saw cut is stale, run-out 9.8 instead of 39.2 mm, and `OP_HITS_NEIGHBOUR` goes away; confirming a value does not mark anything stale |
| Safety unchanged | same | With every value confirmed: `CAM_OUTPUT_OFF` and the saw `MACHINE_CANNOT` still there; capabilities unchanged; output switches off. All earlier tests and goldens unchanged |
| Export checker messages | same | `UNCONFIRMED` lists the values the job uses with targets (T140 blade -> the tool's blade field); after confirming the blade it leaves the list and every other check is still there |

The sample job's `validation.txt` gains one line: the new `UNCONFIRMED` warning (14 values the
sample job uses). Nothing else in the sample output changed.

### Screenshots

`docs/screenshots/stage-2-3/M2.6e/`:

- `01-machine-banner.png`: the Machine page banner listing what is unconfirmed (Configure / Mark as confirmed each), the sidebar count, and badges in the tool table.
- `03-configure-opens-blade-field.png`: Configure on the T140 blade: the tool dialog opens with the Blade Ø field focused and highlighted.
- `04-blade-entered-badge-cleared.png`: after typing 250 mm the blade's badge is gone.
- `05-machine-model-facts.png`, `06-default-cutting-values.png`: machine-model facts and the default cutting values with their badges.
- `07-op-editor-facing.png`: the operation editor's strip (the facing step-over, the tool's data and feeds) and field badges.
- `08-op-editor-edge-aggregate.png`: edge work: height, reach and the aggregate (not fitted) with Configure.
- `09-simulator-placeholders.png`: the values behind a simulation.
- `10-op-editor-saw.png`: a saw cut: blade, tool and the saw unit, plus the per-operation blade field.
- `11-export-checker-configure.png`: the job's validation list with Configure links on each placeholder message.

## M2.7 split

M2.7 is done in named parts, each green, pushed and recorded here before the next starts:
**M2.7a** holders and aggregates (TOOL-04), tool data compare and spreadsheet export/import
(TOOL-05), tool table grid (NEW-15); **M2.7b** turn-by-turn sketch (CAD-02) and dimensions with
print to scale (CAD-08); **M2.7c** geometry queries (CAD-17), fill with holes (CAD-18), panelling
(NEW-05); **M2.7d** image trace (NEW-06), screenshots, README, ROADMAP. New switch "CAD and tool
additions" (`camCadTools`, screens only, on). Nothing in M2.7 writes machine output.

## M2.7a holders, aggregates, tool data: what was built

| Spec ID | What | Where |
|---|---|---|
| TOOL-04 | Holders reach every router: a tool's own holder, else the shop's **default holder** (new `MachineProfile.defaultHolderId`, the placeholder collet chuck). Stick-out: the tool's own, else **assumed = the flute length** (the shortest possible, so a check can only report more), with a Configure badge saying "assumed". Drills (drill block), saws and tools on an aggregate have no spindle holder. One function, `toolOutline`, feeds the simulator's tool drawing, the collision checks and the 3D clearance warnings | `effectiveHolder`, `effectiveGauge`, `toolOutline` in `src/core/machineModel.ts`; `collision.ts`, `toolpath.ts`, `SimulateDialog.tsx` |
| TOOL-04 | Holder library on the Machine page: outlines point by point (height above the face : radius, with a drawing of holder and tool), the default holder, delete when unused. **Holder from a model**: STL, OBJ, 3MF, STEP, IGES or BREP (axis chosen); the outline is the model's widest point in every 1 mm band round the axis, so it is never smaller than the model. Typing an outline in marks it confirmed | `src/cam/tools/holder.ts` (`holderEnvelope`), worker task `holder.fromModel`, `HoldersSection.tsx` |
| TOOL-04 | Aggregates and angle heads: offsets (spindle to the tool's face), tool tilt, allowed head angles (any, or a list), housing size; assigned per tool. Edge work with an assigned aggregate: the simulator draws its housing and the spindle above it; warnings when the cut needs a head angle the aggregate cannot be set to, when the housing would come within the margin of the panel's edge (stick-out less reach), or reach below the underside into the spoilboard. A placeholder aggregate is in the library with a badge; the machine model still has none fitted | `Aggregate` in `src/core/types.ts`, `anglesOutOfReach`, `genEdge`, `AggregatesSection.tsx`, `FlatToolModel` |
| TOOL-05 | Each operation keeps the tool data its toolpath was accepted with (`CamOp.toolData`, not an input, never in recipes). The operation editor says what changed in the tool table since ("diameter 8 → 10") with "Update to the table"; Machine page → "Tool data in operations" lists every operation in the jobs and part library that differs, has no data yet, or sets its own feeds, with Update / Use table feeds / Update all | `src/core/toolData.ts` (`toolSnapshot`, `compareOpTool`, `toolDataReport`, `updateOpTool`), `ToolCompareDialog.tsx`, `OpsPanel.tsx` |
| TOOL-05 | Spreadsheet export (.xlsx with a "Read me" sheet, or CSV) of every tool field, lengths in mm; import with every change shown before it is applied (rows by tool number; an empty cell keeps the value; new numbers become tools; bad rows skipped with the reason). Imported values count as the shop's own (badges clear); the placeholder-table switch is not touched | `toolsXlsx`, `toolsCsv`, `toolsFromRows`, `applyToolTable`, `ToolSheetDialog.tsx` |
| NEW-15 | The tool table is a grid: arrows, Tab, Enter, Home/End move; typing edits (lengths in the shop unit, inch fractions accepted); Delete clears an optional cell; changes are a draft with Undo / Redo (Ctrl+Z / Ctrl+Y) and Save (Ctrl+S) / Discard; changed cells are tinted; a table changed elsewhere meanwhile blocks Save | `ToolGrid.tsx`, `moveCell`, `parseCell` |
| Stale | The holder outline, stick-out used and aggregate are inputs of `opInputHash`: changing them marks the operations using that tool stale (a one-time stale mark on existing operations after the update) | `src/cam/doc.ts` |

Placeholder data (all with Configure badges): the 2D routers T101-T104 got invented stick-outs (62,
50, 40, 32 mm = flute + 20); a shop file saved before M2.7 with the placeholder table gets them only
on tools still exactly as invented (`normalize.ts`); real tables are never touched. The placeholder
aggregate (offset Z -120, housing 70 wide, 45 above and 6 below the axis, 90 long, any angle) is
invented.

### Acceptance (M2.7 criterion: holders appear in the simulator and are used by collision checks, 2D tools included)

| Check | Proof | Measured |
|---|---|---|
| 2D tools in holders | `tests/cam-tools-holders.test.ts` | T101-T104: default holder, outline from their stick-out; drills and saws none |
| Collision checks use a 2D tool's holder | same | 10 mm flat, 45 mm flutes, no stick-out given, 44 mm pocket: holder collisions only, worst 1.0 mm into the 2 mm margin; with the real 60 mm stick-out: clean; with no default holder: clean (as before). T102 in a 49 mm pocket: shank and holder |
| No false alarms | `tests/cam-collision.test.ts` (unchanged) | The 20 Stage 1 reference parts and the 3D programs stay clean with holders on every router |
| Simulator draws it | browser check, screenshot 06 | T102 in the default collet chuck in 3D, the holder collision in the log |
| Holder from a model | same test | Revolved collet chuck (cone 17.5 → 21 over 30 mm, shoulder to 32, 70 high), 1 mm bands: never below the true radius anywhere; at most 0.13 mm over on the cone (one band's growth); 70 mm high, R32 |
| Aggregates | same | Rectangle edge with angles 0/90/180/270: fine; arched edge: "cannot be turned to N of the angles"; stick-out 5 with 4 mm reach: housing hits the edge; housing 30 mm below the axis at 9.5 mm on a 19 mm panel: spoilboard |
| Badges, stale | same | Default holder badge on 2D operations ("shop default"), assumed stick-out badge even on a real table; holder or stick-out change: stale; confirming: not stale; confirming an aggregate fits nothing |
| Spreadsheet | same | .xlsx and CSV of every field read back with zero changes (notes with commas and quotes included); a filled cell changes, an empty one keeps; a new tool with holder by name; two bad rows skipped with reasons; imported parts confirmed, placeholder switch unchanged |
| Tool data compare | same | Diameter 8 → 10, stick-out 50 → 55, feed 5000 → 7000 listed; after Update none; toolData not in recipes, not an input |
| Grid | same + browser | Inch fractions, required fields, whole tool numbers; Tab wraps rows; Ctrl+Z undoes |

Goldens: none changed. One existing test changed its expectation on purpose:
`tests/cam-machine-stock.test.ts` asserted that T102 had no stick-out (M2.1 data); the M2.7 data
gives it the placeholder 50 mm, as the owner asked for holders on 2D tools. Sample job:
`validation.txt` lists 17 placeholder values instead of 14 (T101 and T103 stick-outs, the default
holder); nothing else changed.

### Limits recorded

- **Holder from a model** takes the holder's axis as the vertical through the middle of the
  model's footprint (after the chosen axis is turned up) and the face at its lowest point.
- **Aggregate collisions** are checked as above (edge and spoilboard) when edge work is calculated;
  the stock simulation still does not carve edge work or check the housing against neighbouring
  parts on a nested sheet.
- **Drills in the drill block** have no holder outline (the block is not modelled).

### Screenshots

`docs/screenshots/stage-2-3/M2.7/`: `01-tool-grid.png` (grid with an edited cell, Undo / Save),
`02-holder-editor.png` (outline points and drawing), `03-aggregate.png` (placeholder aggregate),
`04-tool-dialog-holder.png` (T102 in the shop default holder, stick-out, aggregate),
`06-simulate-2d-tool-holder.png` (T102 drawn with its holder in a 49 mm pocket; shank and holder
collisions in the log).

## M2.7b turn-by-turn sketch and dimensions: what was built

| Spec ID | What | Where |
|---|---|---|
| CAD-02 | Turn-by-turn sketch: from a start point, lines (length, direction) and arcs (radius, sweep, turning left or right), each direction from +X or as the turn from the element before (0 = tangent); any value can be "?" and is worked out by the constraint solver so the outline closes (a closed outline works out two). Blends and chamfers on the corners after solving. More than one answer (two unknown directions): every answer found, in a fixed order, "Next answer" to switch. Too many unknowns, conflicting values or impossible sizes are refused in plain words. The sketch is kept with the shape (`CamPart.sketches`), so it can be opened, changed and solved again; the shape keeps its id and its operations | `src/cam/turnSketch.ts`, new solver constraints `polar`, `chord`, `lin` in `src/cam/solver.ts`, `TurnSketchDialog.tsx` |
| CAD-08 | Dimensions: linear (horizontal, vertical or aligned, chosen by where the line is put), angle, radius, diameter, ordinate (from a set origin). Ends snap to nodes and to centres of circles and arcs and refer to them, so every dimension measures again when the shapes change (moved, edited node by node, transformed); a dimension whose shape is gone is listed, not drawn. Shown in the shop unit, inches as fractions to 1/16 in, the other unit beside it on request. "Measure angle" at a vertex (distance and angle were already measured). Dimensions are notes: never machined or exported | `src/cam/dims.ts`, the Dimension tools in `src/pages/part/tools.ts`, `DimsLayer` in `Canvas.tsx`, `DimsPanel.tsx` |
| CAD-08 print | Print to scale: face 1 and its dimensions as a PDF at 1:1 to 1:50 on Letter, Tabloid, A4 or A3; big drawings over several sheets with crop marks and a 10 mm overlap strip; each sheet has a check bar (100 mm, or 4 in when in inches) and says "print at actual size". Deterministic output | `src/cam/print.ts`, `PrintDialog.tsx` |

Part file: dimensions, the ordinate origin and kept sketches are optional fields (notes only, nothing
an older app needs to machine); `CAM_FILE_VERSION` stays 4.

### Acceptance

| Criterion | Proof | Measured |
|---|---|---|
| A turn-by-turn sketch solves a door outline with two unknowns | `tests/cam-sketch-dims.test.ts` | Raked-top door 450 wide, 600 right, 700 left: top worked out as 460.977 mm at 167.471° (exact to 1e-9). Arched door with the arch tangent to both sides: right side 600 mm and radius 225 mm worked out (area exact to 1e-6). Pointed door of two R400 arcs: right side 500 and the 210° start of the second arc worked out, a blend and a chamfer added. Two unknown directions: both answers found, the same every run |
| Dimensions update live and show inch fractions | same, browser screenshot 07 | 450.85 mm shows `17-3/4"`, with the other unit `17-3/4" [450.85 mm]`; moving the corner to 609.6 mm: `24"`; moving the shape 30/40 mm: same value, the dimension moved with it; Ø35 hole `Ø1-3/8"` |
| Print to scale | same | 1:10: the 1200 x 600 outline is 120 x 60 mm on paper; full size: 6+ sheets, nothing outside the drawing area, sheets one area less the overlap apart; in the PDF itself the 100 mm check bar is 283.46 pt and the 1200 mm edge at 1:5 is 240 mm |

### Limits recorded

- **Dimensions measure on face 1** (top view); there are no dimensions on edge faces.
- **A shape edited by hand after a sketch** is replaced by the sketch's answer when the sketch is
  opened and solved again.
- **Print** draws face 1 shapes and dimensions only (no toolpaths, no hatch: hatch and line types
  are NEW-21 in M3.2).

### Screenshots

`07-dimensions-inches.png` (an arched door with linear, radius, diameter, angle and ordinate
dimensions in inches; one with mm beside it), `08-turn-by-turn-sketch.png` (the door with two
unknowns worked out, shown in blue), `09-print-to-scale.png` (the print preview at 1:10 with the
check bar).

## M2.7c queries, fill with holes, panelling: what was built

| Spec ID | What | Where |
|---|---|---|
| CAD-17 | Query engine: tests (field, operator, value) on **shapes** (the Stage 1 fields plus length round it, radius, depth given, segments, arcs, closed shapes inside it, lies inside another, is the outline, tag, made-from-solid role, middle X/Y), on **faces of solid models** (type, diameter, area, facing up/down/side/sloped and depth below the top as the part lies, colour, layer, body) and on **models** (name, kind, faces, triangles, size, format, file, layer); operators =, ≠, <, ≤, >, ≥, between, one of, contains / not, matches pattern / not; all tests or any. Results: select, move shapes to a layer, send faces to a layer (as shapes, M2.5c), put models on a layer. **Auto-queries** kept in a rule table run before its rules on every import (shapes they find move to their result layer; Library → Rules lists them). The Stage 1 layer rules now run on this engine: a rule is the query "layer matches the pattern and its extra tests", each shape going to the first that passes | `src/cam/query.ts`, `applyRules` in `src/cam/rules.ts`, `QueryDialog.tsx`, `RulesTab.tsx` |
| CAD-18 | Fill with holes: the selected closed shapes (shapes inside are islands) filled with a grid (any angle), a staggered grid or rings round the middle; hole diameter, margin from every edge (to the hole's edge), spacing; the pattern centred; holes on a layer (`DRILL_<Ø>` by default) with an optional drilling operation; spacing tighter than a hole refused | `src/cam/holeFill.ts`, `FillHolesDialog.tsx` |
| NEW-05 | Panelling: shapes bigger than a sheet split into equal panels no bigger than the given size (default: the part's material sheet less the edge trim), neighbours overlapping by exactly the overlap; closed shapes cut by a join are closed again along it (Clipper2 intersection, arcs refitted), open shapes cut into pieces, circles and text whole where they fit; each panel a new part starting at 0,0 with the operations that machine its pieces | `src/cam/panelling.ts`, `PanelDialog.tsx` |

### Acceptance

| Criterion | Proof | Measured |
|---|---|---|
| Full queries reproduce the Stage 1 rule results | `tests/cam-query-fill-panel.test.ts` | The Stage 1 claim (written out in the test as it was) and the query engine agree on every shape of 40 mixed parts (shop layer names, circles, rectangles, open shapes, text, points), the 20 reference parts and an imported DXF: 2,400+ shapes, 1,000+ claimed. `applyRules` makes operations on exactly the shapes Stage 1 claimed. All Stage 1 rule tests and goldens unchanged |
| Queries add solid and face tests | same | STEP cabinet side (stands on edge in the file): "hole, Ø5" finds the 26 shelf-pin holes; flat faces facing up between 0.1 and 18.9 deep (over 200 mm²) give the pocket floors at 3, 4, 9.5 and 10 mm; model query by kind and thickness |
| Auto-queries | same | "Ø5 circles → DRILL_5_12" before the shop rules: the two 5 mm circles drilled 12 deep, the 35 mm one left |
| Fill with holes | same | 300 x 200 panel, Ø5, margin 10, pitch 20: 14 x 9 = 126 holes, symmetric, all at least 10 mm from the edge; staggered rows offset by half a pitch, island clear; a 30° grid stays inside with no two holes closer than the pitch; rings 0/30/60/90 mm with 1/6/12/18 holes |
| Panelling | same | 5000 x 1200 sign in 2440 x 1220 panels with 50 mm overlap: 3 equal panels; every panel's outline piece is closed; the pieces add up to the sign plus the two overlap strips; the cut-out and engraving operations follow their pieces |

### Limits recorded

- **Face facts "facing" and "depth"** use the model's lay-flat turn when it has one (feature
  recognition), else the same panel alignment recognition uses (thickness along Z).
- **Auto-queries in rule tables are on shapes**; face and model queries run from the designer.
- **Panelling** gives each panel the original's operations on its pieces; joins get no extra
  machining (a dowel or biscuit joint at the join is not drawn).

### Screenshots

`10-geometry-query.png` (circles of 5 mm diameter: 3 found, result layer DRILL_5_12, keep as
auto-query), `11-fill-with-holes.png` (a staggered fill of a 4200 x 1300 sign with a window and a
ring kept clear), `12-split-into-panels.png` (the sign split into two panels with the overlap).

## M2.7d image trace: what was built

| Spec ID | What | Where |
|---|---|---|
| NEW-06 | Image trace, our own method (not potrace, which is GPL; no library added): each pixel is ink or paper by a brightness threshold (transparent = paper; invert for light ink); specks of ink and pin-holes under a set size are cleaned away; the borders between ink and paper pixels are followed round, so every loop is closed by construction (ink pixels touching at a corner count as joined); each loop goes through the middle of its pixel edges, sharp corners (direction turning more than the corner angle within a few pixels) are kept on the pixel corner, the rest is smoothed, and the runs between corners are fitted with lines and arcs. Pixels to mm by the width on the part; outer loops counter-clockwise, holes clockwise. Runs in the background worker; the dialog shows the contours over the picture as the settings change and puts them in the middle of the part on their own layer | `src/cam/trace.ts`, worker task `image.trace`, `ImageTraceDialog.tsx` |

Fixture: `tests/fixtures/trace/logo.png` (400 x 240 px, 3 kB, anti-aliased), made by
`scripts/fixtures/make_trace_fixture.ts`; the tests read it with a small PNG reader in
`tests/png.ts` (the app decodes pictures with the browser).

### Acceptance (image trace turns a logo PNG into closed contours)

| Check | Proof | Measured |
|---|---|---|
| Closed contours from a logo PNG | `tests/cam-trace.test.ts` | 4 closed contours (ring outside and hole, square, L), every segment joined to the next; the 2 x 2 px speck cleaned away; the hole clockwise |
| Shapes true to the picture (0.5 mm a pixel) | same | Areas: ring outside 5,013.4 against 5,026.5 mm² (-0.26 %), hole 1,970.0 against 1,963.5 (+0.33 %), square 1,225.0 and L 1,575.0 exact; the ring as arcs within 0.3 mm of its radius; square corners within half a millimetre (one pixel), its edges within 0.3 mm; the L's inside corner kept |
| Robust and repeatable | same | A random 64 x 48 picture: every loop closed; the same picture gives the same contours byte for byte; pixels touching at a corner make one loop; threshold, invert, transparency and speck / pin-hole cleaning checked |

## M2.7 screenshots

`docs/screenshots/stage-2-3/M2.7/` (browser preview, Playwright):

- `01-tool-grid.png`: the tool table as a grid, one cell changed (tinted), Undo / Save.
- `02-holder-editor.png`: the placeholder collet chuck's outline, point by point, with its drawing.
- `03-aggregate.png`: the placeholder rotating aggregate: offsets, tilt, housing, angles.
- `04-tool-dialog-holder.png`: T102 (a 2D tool) in the shop default holder, its stick-out, aggregate choice.
- `05-tool-data-compare.png`: after T102's diameter changed from 8 to 10: the accepted pocket listed with "Diameter 8 → 10" and Update.
- `06-simulate-2d-tool-holder.png`: T102 drawn with its holder in a 49 mm pocket; shank and holder collisions in the log.
- `07-dimensions-inches.png`: an arched door with linear, radius, diameter, angle and ordinate dimensions in inches (one with mm beside it).
- `08-turn-by-turn-sketch.png`: the door sketch with two unknowns worked out.
- `09-print-to-scale.png`: print preview at 1:10 with the check bar.
- `10-geometry-query.png`: circles of 5 mm: 3 found, result layer, keep as auto-query.
- `11-fill-with-holes.png`: a staggered fill round a window and a ring.
- `12-split-into-panels.png`: a 4200 mm sign split into two panels.
- `13-image-trace.png`: the logo traced, contours over the picture.
- `14-traced-logo-on-part.png`: the traced contours on the part.

## M2.7 licences

No new dependencies. The image tracer is our own code (potrace is GPL and was not used or read);
holder envelopes, queries, panelling, hole fill, dimensions and the sketch use the existing
kernel (Clipper2, BSL-1.0), solver, OpenCascade reader (LGPL-2.1, separate WebAssembly, already
shipped), SheetJS (already in the app) and jsPDF (already in the app).

## M2.7 decisions needed (see the report)

1. **Real stick-outs and holders** for every router (2D ones now too), and which holder is the
   shop's usual one. Until then: invented stick-outs on T101-T104, the placeholder collet chuck as
   the default, flute length assumed for tools with none (all badged; checks err safe).
2. **Aggregates**: offsets, housing and allowed angles of any angle head or aggregate the shop
   has or may buy. Until then: one invented entry, not fitted.

## M2.8 split

M2.8 is done in named parts, each green, pushed and recorded here before the next starts:
**M2.8a** areas and costs (NEW-20); **M2.8b** shared-line cutting (NST-04); **M2.8c** bridged
nesting (NST-05); **M2.8d** flip-side sheets with registration and the sheet backplot (NST-07);
**M2.8e** manual nesting (NST-09), screenshots, README, ROADMAP. One nesting system: everything
extends `src/core/nesting.ts` / `nestShape.ts` and the sheet programs in `machining.ts`. New switch
"Nesting additions" (`nestAdditions`, screens only, on). Every new kind of program output (shared
lines, bridges, flip-side sheets) gets its own switch, **off**.

## M2.8a areas and costs: what was built

| Spec ID | What | Where |
|---|---|---|
| NEW-20 | Areas: each part's true area (outline less its through openings); per sheet the parts, the remnant strips kept and the scrap (everything else: edge trim, gaps, small leftovers), which add up to the sheet exactly. Costs: a material is costed per m² of sheet (typed per ft² in inch mode) or per kg with its density; both become one rate per m². A sheet costs its whole area (an offcut its own); parts, remnants and scrap split it by area; a part's "share of the sheet" spreads the sheet's cost less the remnants kept over its parts by area; weights when a density is given. Job totals. CSV export "Areas and costs" (not part of the sample job's files) | `src/core/areas.ts`, `AreaCostPanel.tsx` (Nesting tab), `MaterialCostFields.tsx` (Library, Materials, Edit), `output.ts` |
| Badges | No invented prices: a material without a price (or, by weight, without a density) shows "not set" with a Configure badge on the Nesting tab; it opens the material's price field. Entering it clears the badge. Prices are labels: nothing cut changes, so nothing goes stale | `materialUnconfirmed`, new Configure target `material` |

### Acceptance (area and cost numbers match hand calculation)

| Check | Proof | Measured |
|---|---|---|
| Part areas | `tests/nest-areas.test.ts` | 1000 x 500 = 0.5 m²; 600 x 400 less a 200 x 100 opening = 0.22 m²; L shape 400 x 400 less 200 x 200 = 0.12 m² (exact) |
| Sheet areas | same | 2440 x 1220 sheet: parts 0.84, remnant 0.732, scrap 1.4048, sheet 2.9768 m² (exact; they add up) |
| Cost by area, $40/m² | same | sheet $119.072, parts $33.60, remnant $29.28, scrap $56.192; shares $53.4476 / $23.5170 / $12.8274 (sum = sheet less remnant) |
| Cost by weight, $0.50/kg, 700 kg/m³, 18 mm | same | 12.6 kg/m², $6.30/m², sheet 37.50768 kg and $18.75384 |
| Real job | same | Sample job at $25/m²: every sheet adds up, shares add up to sheets less remnants |

Sample job output unchanged (the new CSV is a separate export).

### Test-suite note

`tests/perf.test.ts` "adaptive clearing per Z level" (limit 90 s with the whole suite running in
parallel, about 37 s alone) measured 90.2 s on the untouched M2.7d code in this container this run,
so it fails by timing alone when the full suite runs; it passes when run on its own. The limit was
not changed.

## Run log

- **Run 1 (M2.0)**: audit and this file. Pushed `9492d66`; merged to `main` in run 2.
- **Run 2 (M2.1)**: commits `00b8c71`, `23ead2d`, `a96c23d`, `5998e05`, `40c481f`, `e3e9095`,
  `9d7e411`.
- **Run 3 (M2.2a)**: parallel finishing. Commit `c1bc896`.
- **Run 3 (M2.2b)**: Z-level roughing, waterline, flat-layer output (switch off). See `git log`.
- **Run 4 (M2.2c)**: projection finishing, faster clearance test, browser-preview fix. See `git log`.
- **Run 4 (M2.3a)**: 2D rest machining. See `git log`.
- **Run 4 (M2.3b)**: adaptive clearing in pockets. See `git log`.
- **Run 4 (M2.3c)**: adaptive Z-level roughing, 3D rest machining, pencil pass. See `git log`.
- **Run 5 (M2.4a)**: Z-level roughing of models that do not cover the panel. See `git log`.
- **Run 5 (M2.4b)**: stock simulation on the stock-model interface. See `git log`.
- **Run 5 (M2.4c)**: collision checking, export checker, flags when 3D operations are calculated. See `git log`.
- **Run 5 (M2.4d)**: cut-free pieces, screenshots, docs. M2.4 complete. See `git log`.
- **Run 6 (M2.5a)**: solid import, reader choice, lazy WebAssembly, `app://`. See `git log`.
- **Run 6 (M2.5b)**: feature recognition, layers, solid parts, checked MPR. Also fixes a lint error
  that went out with M2.5a (a test helper named like a React hook). See `git log`.
- **Run 6 (M2.5c)**: assemblies, faces to layers / colours / grain, machining picked faces. See `git log`.
- **Run 6 (M2.5d)**: 3D wires and surfaces; face jobs moved to the worker. See `git log`.
- **Run 6 (M2.5e)**: packaged-app check (Linux), screenshots, README, ROADMAP. M2.5 complete.
- **Run 7 (M2.6a)**: saw cuts, facing, format v4, switches. See `git log`.
- **Run 7 (M2.6b)**: chamfers, cuts between curves, along 3D curves, Z-waves. See `git log`.
- **Run 7 (M2.6c)**: hand-drawn toolpaths and toolpath edits. See `git log`.
- **Run 7 (M2.6d)**: edge work with a rotating aggregate, screenshots, README, ROADMAP. M2.6 complete.
- **Run 8 (M2.6e)**: Configure badges and confirmation tracking for every unconfirmed value. See `git log`.
- **Run 9 (M2.7a)**: holders and aggregates, tool data compare, spreadsheet, tool grid. See `git log`.
- **Run 9 (M2.7b)**: turn-by-turn sketch, dimensions, print to scale. See `git log`.
- **Run 9 (M2.7c)**: geometry queries, fill with holes, panelling. See `git log`.
- **Run 9 (M2.7d)**: image trace, screenshots, README, ROADMAP. M2.7 complete. See `git log`.
