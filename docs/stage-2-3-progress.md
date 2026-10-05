# Stage 2-3 progress

Read this first at the start of every run. Sources:

- Features and acceptance (source of truth): `docs/stage-2-3-spec.md`.
- How to work: `docs/stage-2-3-prompt.md`.
- Audit and 3D design: `docs/stage-2-3-audit.md`.

## Status

| Milestone | Status | Notes |
|---|---|---|
| M2.0 Audit | **Done** | `docs/stage-2-3-audit.md`. |
| M2.1 3D foundation | **Done** (October 2026) | Includes the approved additions: machine-model data, `StockModel` and the bull-nose cutter, and the WASM/CSP groundwork. |
| M2.2a CL-surface engine, parallel finishing, boundaries, independent gouge checker | **Done** (October 2026) | See below. |
| M2.2b Z-level roughing, waterline | **Done** (October 2026) | Flat-layer output as `<105>` contours (decision 2), behind its own switch, off. See below. |
| M2.2c Projection finishing, performance | **Done** (October 2026) | See below. M2.2 complete. |
| M2.3 Adaptive clearing, rest machining, pencil | **Next** | |
| M2.4 - M2.11 | Not started | Order as in the prompt. ART-01 stays at M2.11. |
| M3.1 - M3.7 | Not started | |

Test count: 218 at the start of Stage 2 (217 passed + 1 skipped), 263 after M2.1, 296 after M2.2a
(295 + 1 skipped), 325 after M2.2b (324 + 1 skipped), 347 after M2.2c (346 + 1 skipped).
Lint baseline: 17 warnings, all pre-existing (unchanged).

## Decisions received from the owner (October 2026)

1. Work on `main`. The audit branch was merged, and runs push straight to `main`.
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
- **The simulator screen still uses the heightfield directly.** It moves onto the `StockModel`
  interface in M2.4.

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

## Next run: M2.3

- **Adaptive clearing (NEW-01):** constant-engagement clearing in pockets and per Z level.
- **2D rest machining (2D-07):** cut only what earlier tools left, minimum path length.
- **3D rest and pencil (3D-06):** material left by a larger tool; pencil pass along valleys.
- Owner check: one Z-level roughing program in woodWOP before switching flat-layer output on.

## Run log

- **Run 1 (M2.0)**: audit and this file. Pushed `9492d66`; merged to `main` in run 2.
- **Run 2 (M2.1)**: commits `00b8c71`, `23ead2d`, `a96c23d`, `5998e05`, `40c481f`, `e3e9095`,
  `9d7e411`.
- **Run 3 (M2.2a)**: parallel finishing. Commit `c1bc896`.
- **Run 3 (M2.2b)**: Z-level roughing, waterline, flat-layer output (switch off). See `git log`.
- **Run 4 (M2.2c)**: projection finishing, faster clearance test, browser-preview fix. See `git log`.
