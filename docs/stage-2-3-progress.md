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
| M2.4b - M2.4d Stock simulation, collision, cut-free pieces | In progress | Split below. |
| M2.5 - M2.11 | Not started | Order as in the prompt. ART-01 stays at M2.11. |
| M3.1 - M3.7 | Not started | |

Test count: 218 at the start of Stage 2 (217 passed + 1 skipped), 263 after M2.1, 296 after M2.2a
(295 + 1 skipped), 325 after M2.2b (324 + 1 skipped), 347 after M2.2c (346 + 1 skipped), 363 after M2.3a (362 + 1 skipped), 378 after M2.3b (377 + 1 skipped), 405 after M2.3c (404 + 1
skipped), 407 after M2.4a (406 + 1 skipped).
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

## Next run

- Continue M2.4 (b, c, d) as split above.
- Owner check: one Z-level roughing program in woodWOP before switching flat-layer output on.

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
