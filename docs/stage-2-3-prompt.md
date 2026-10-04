# Build prompt: Cabinet Studio custom-part CAM, Stage 2 (Advanced) and Stage 3 (Rare)

You are taking over an existing, working codebase. Read this whole prompt before you do anything.
It is long on purpose. The owner said: "don't hold back, I want to make sure it does it well."
Quality, correctness and safety matter more than speed.

---

## 1. Who you are working for, and what this app is

**The owner** is Avi Weinreb. He runs a cabinet shop and is **not a programmer**. He reads your
reports, makes the decisions and runs the machine. Explain things to him in plain English.

**The shop:**
- CNC: a **HOMAG CENTATEQ N-200** nesting router (3-axis, vacuum table, **5 x 12 ft** sheets,
  1524 x 3658 mm). It runs **woodWOP MPR 4.0** programs. A horizontal drill unit, saw unit or
  aggregate is **not confirmed**; treat them as absent unless the machine profile says otherwise.
- Hinges: **Salice** Silentia+ 110° cups on **3 mm mounting plates**.
- Drawer slides: **Blum TANDEM** undermount, **15, 18 and 21 in**.
- Units: the whole app has an **inch/mm switch**. Everything is stored in millimetres; inches show
  as fractions to 1/16 in (for example `23-1/4"`) and accept typed decimals or fractions.

**The app: Cabinet Studio** (repo `github.com/aviwein80/cabinet-studio`, branch `main`). An
offline desktop program that designs cabinets and produces nested woodWOP programs, labels, sheet
maps, cut lists and BOMs. It is meant to replace Cabinet Vision for this shop.
Stack: **Electron 44, TypeScript 6, React 19, Vite 8, three.js (@react-three/fiber), zustand,
Tailwind 4 / shadcn/ui, vitest, oxlint**, Clipper2 (`clipper2-ts`), pdf.js, jsPDF.

It has two sides that share one job, one material library, one tool table, one nesting engine, one
label system, one units switch and one MPR writer:
1. **Cabinet side** (`src/core/`): parametric carcasses -> parts -> nesting -> MPR per sheet.
2. **Custom-part side** (`src/cam/`, `src/pages/part/`, `src/pages/PartDesigner.tsx`): a CAD/CAM
   module for parts that are not boxes (doors, arched panels, brackets, signs).

**Stage 1 of the custom-part module is finished** and in `main` (31 commits, last one before this
spec was `ccacc91`; the spec commit is on top). Stage 1 = milestones C1-C9 plus the AI spec-sheet
reader: CAD, DXF/PDF import, profile/pocket/drill/engrave/V-carve/saw-groove/profiled sweep,
native woodWOP macros, layer rules and recipes, parametric doors, true-shape nesting, batch runs, a
2.5D backplot with heightfield, drilling patterns, and the AI reader. **218 tests pass.**

**Your job:** build **Stage 2 (Advanced, 54 features)** and **Stage 3 (Rare, 23 features)** of the
custom-part module, as specified in **`docs/stage-2-3-spec.md`** in the repo. That file is the
source of truth for features, milestone contents and acceptance criteria. This prompt tells you
how to work. If the two ever disagree, stop and ask.

This is many weeks of work. **You will do it milestone by milestone across many runs.** Never try
to do everything in one run. Each run: pick up where the last one stopped, finish one milestone
(or a clearly defined part of one), test it, commit, push, report.

---

## 2. Read these first (every run)

1. `docs/stage-2-3-spec.md`: the full Stage 2 and 3 spec.
2. `README.md`: what the app does, the safety notes, the architecture tree.
3. `ROADMAP.md`: decisions so far and open questions for the owner.
4. `docs/stage-2-3-progress.md`: **you create this in run 1** and keep it updated. It records
   which milestones are done, what is in progress, decisions received from the owner, and open
   questions. Start every later run by reading it.

---

## 3. Mandatory first step: audit, report, then stop

**Before writing any feature code**, do milestone **M2.0 Audit**. No code changes in this run
except creating `docs/stage-2-3-audit.md` and `docs/stage-2-3-progress.md`.

1. Install and run the baseline: `npm install`, `npm test`, `npm run typecheck`, `npm run lint`.
   Record the exact test count (expected: 218 passing) and any warnings. If the baseline is not
   green, report it and stop.
2. Read and summarise (with file paths and the main exported functions/types) at least:
   - `src/cam/types.ts` (the `CamPart` document, `CamOp` union with kinds `profile`, `pocket`,
     `drill`, `engrave`, `vcarve`, `saw`, `sweep`, `code`; faces 1-6; `Levels`, `Leads`, `Tags`).
   - `src/cam/doc.ts` (factories, undo history, `opInputHash` / `opState` stale flags,
     `serializePart` / `parsePart`, `CAM_FILE_VERSION`).
   - `src/cam/geom.ts` and `src/cam/kernel.ts` (arc-native contours; Clipper2 offsets and
     booleans that refit arcs).
   - `src/cam/toolpath.ts` (the `Move` IR, `Intent` for native woodWOP macros, `Toolpath`,
     `generateOp`, `generatePart`, `GenContext`).
   - `src/cam/ops.ts` (defaults, `resolveTool`, `feedsFor`, `passDepths`, `orderByTool`).
   - `src/cam/sim.ts` (timeline, `Heightfield`, `carve`, `checkRapids`, `looseMask`) and
     `src/pages/part/SimulateDialog.tsx`.
   - `src/cam/mpr.ts`, `src/core/mpr/writer.ts`, `src/cam/mprRead.ts` (one MPR code path).
   - `src/cam/post.ts` (generic template post), `src/cam/rules.ts` (recipes, layer rules,
     queries), `src/cam/solver.ts` (constraint solver), `src/cam/dxf.ts`, `src/cam/doors.ts`.
   - `src/core/types.ts` (`Tool`, `ToolShape`, `MachineProfile`, `FeatureFlags`),
     `src/core/features.ts` (`DEFAULT_FEATURES`, `camMprOutput: false`),
     `src/core/defaults.ts` (`PLACEHOLDER_MACHINE`), `src/core/validator.ts` (export checker),
     `src/core/pipeline.ts` (`runJob`), `src/core/nesting.ts`, `src/core/nestShape.ts`,
     `src/core/offcuts.ts`, `src/core/batch.ts`.
   - `src/pages/part/*` (Canvas, OpsPanel, SidePanels, SimulateDialog, ProgramDialog, tools.ts),
     `src/pages/MachinePage.tsx` (the "Custom-part features" switches), `electron/` (main,
     preload, batch worker).
   - `tests/` layout: `cam-*.test.ts`, `tests/cam-reference.ts` (reference parts),
     `tests/golden/cam/ref01..ref20/{part.json,toolpaths.json,part.mpr}` and the `digest()`
     function in `tests/cam-golden.test.ts`, `UPDATE_GOLDEN=1`.
3. Check every Stage 2/3 feature in the spec against the code: **done, partly done, or missing**.
   Known overlaps to check carefully: parallel finishing (listed as Stage 1 in an earlier plan but
   no 3D operation kind exists), loose-piece detection (Stage 1 has `looseMask`), the
   turned-over face-6 program (relates to flip-side nesting), onion skin, the minimal query engine
   in `rules.ts`, tool `shape` values `ball` and `bull` (no holder geometry yet), and whether `Move`
   already carries Z everywhere a 3D path needs it.
4. Write `docs/stage-2-3-audit.md` with:
   - Baseline results (test count, typecheck, lint, build).
   - Architecture summary (data flow from `CamPart` -> `generatePart` -> `Toolpath` -> sim / MPR /
     nesting / batch).
   - Feature-by-feature status table for all 77 Stage 2/3 IDs.
   - Your proposed design for 3D: mesh type, where it lives in `CamPart`, how 3D ops fit `CamOp`,
     worker strategy, WASM loading strategy, stock model interface, collision interface,
     machine model, new feature switches, file version bump and migration.
   - New dependencies you propose, each with licence and size, and why.
   - Risks and unknowns, and the questions you need the owner to answer.
   - Any changes you would make to the milestone order, with reasons.
5. Commit and push the two docs, send the report (section 13 format), and **stop**. Wait for the
   owner's go-ahead before M2.1.

---

## 4. Milestone plan (in order)

Full feature lists and acceptance criteria are in `docs/stage-2-3-spec.md` sections 3.2 and 4.2.
The table below is the order and the minimum acceptance tests. Every milestone also has to meet
the quality bars in section 6.

### Stage 2: Advanced

| # | Milestone | Spec IDs | Minimum acceptance tests |
|---|---|---|---|
| M2.0 | Audit | - | Section 3 above. |
| M2.1 | 3D foundation | CAD-13, NEW-18, SOL-05, holder fields, 3D-12 | Binary + ASCII STL (and OBJ) import with units and orientation; 1 M triangles in < 5 s; corrupt files give a clean error. Mesh simplify within a measured Hausdorff tolerance. Z sections return closed contours. Work volume fits the model with oversize. All heavy work in workers, cancellable, with progress. Tool gets shank, flute length, gauge length, holder profile. Document format bumped with a migration test that loads every Stage 1 golden part unchanged. |
| M2.2 | 3D roughing and finishing | 3D-02, 3D-01, 3D-03, 3D-04, 3D-11 | Analytic surfaces (hemisphere, sine relief, raised-panel field, cove moulding): gouge <= 0.005 mm by an independent check; stock-to-leave ±0.01 mm; roughing leaves >= stock and <= stock + one step-down on walls; scallop within ±10% of theory; boundaries clip right. Golden digests. 200 k-triangle 600 x 400 mm relief, 6 mm ball, 10% step-over, finishing in < 30 s. |
| M2.3 | Adaptive clearing and rest machining | NEW-01, 2D-07, 3D-06 | Engagement never > target + 10% (measured per move); no full-width moves outside flagged trochoidal sections; 2D rest cuts only where previous tools left material; minimum path length honoured; pencil follows valleys within 0.02 mm. |
| M2.4 | Stock simulation and collision | SIM-02, SIM-03, SIM-05, NEW-13 | Removed volume within 1% of analytic at 0.5 mm cells; collision suite (short shank in deep pocket, holder into wall, rapid through stock, below spoilboard limit) with zero misses and zero false alarms; jump-to-collision; watertight stock STL; 30 fps full-sheet playback at 1 mm cells; cut-free pieces detected; machine model for the N-200 (5 x 12 ft table) shared by sim and export checker. |
| M2.5 | Solid models | CAD-14, CAD-16, NEW-19, SOL-01..04 | STEP fixtures (cabinet side with holes, shaped door, 5-part assembly) load with face ids; recognition finds every outline, pocket and hole with depth within 0.01 mm; results land on layers that the Stage 1 layer rules machine into an MPR that passes the export checker; OpenCascade WASM lazy-loaded, not in the start-up bundle; licence notices shipped. |
| M2.6 | More 2.5D machining | 2D-11, 2D-13, 2D-15, 2D-16, NEW-09, NEW-11, 5AX-04 | Golden toolpaths on >= 3 reference parts per op; saw and aggregate output only when the machine model has the unit, otherwise the export checker blocks it with a clear message; toolpath edits survive regeneration or are flagged stale. |
| M2.7 | CAD and tool additions | CAD-02, CAD-08, CAD-17, CAD-18, NEW-05, NEW-06, TOOL-04, TOOL-05, NEW-15 | Turn-by-turn sketch solves a door outline with two unknowns; dimensions update live and show inch fractions; full queries reproduce Stage 1 rule results; image trace makes closed contours; holders appear in sim and are used by collision checks. |
| M2.8 | Nesting additions | NST-04, NST-05, NST-07, NST-09, NEW-20 | Shared-line cutting reduces measured cut length >= 15% on a rectangle-heavy reference job with part sizes unchanged; flip-side sheets register within 0.1 mm in the backplot; manual edits re-validated; area/cost match hand numbers. |
| M2.9 | Batch additions | AM-03, AM-06, AM-08, AM-09, AM-10, AM-13 | Batch to two machine models gives two program sets; SQLite option round-trips shop data losslessly (JSON stays default); wizards produce setups that pass the existing batch tests. |
| M2.10 | Plugins, script posts, program tools | API-01, PST-02, PST-04, NEW-22 | Sample plugin adds a menu item and a batch hook and is denied ungranted file access; sample script post output equals the built-in template post on the reference parts; G-code reads back and simulates. |
| M2.11 | Relief import | ART-01 | A Vectric-exported STL and a height-map PNG import at the right size/depth and machine with M2.2 strategies in the simulator. No relief modeller. |

**Stage 2 exit test:** an STL relief door panel and a STEP shaped part each go from import to
simulated, collision-free toolpaths and a checked MPR (MPR output still off by default), all tests
green, typecheck and lint clean.

### Stage 3: Rare

| # | Milestone | Spec IDs | Minimum acceptance tests |
|---|---|---|---|
| M3.1 | More 3-axis finishing | 3D-05, 3D-07, 3D-08, 3D-09 | Same tolerances as M2.2; scallop finishing holds cusp ±10% over the whole test surface. |
| M3.2 | Small extras | NEW-08, NEW-07, NEW-21, NEW-24, 2D-18 | Thread pitch/depth exact in the IR; wrap keeps arc length within 0.01 mm; prints measure to scale. |
| M3.3 | Rotary (4-axis) | 3D-10, NEW-14 | Turned leg and fluted column simulate with no gouges in a rotary stock model; output only via a script post for a machine model with a rotary axis; N-200 export refuses it. |
| M3.4 | Positional 3+2 | 5AX-01 | Tilted-plane holes and pockets within 0.01 mm after axis conversion, checked in simulation; N-200 export refuses it. |
| M3.5 | Simultaneous 5-axis interface | 5AX-02, 5AX-03, TOOL-07, NEW-26 | `MultiAxisEngine` interface + stub ("not licensed") + fake engine for tests. No SDK, no licence, no trial sign-up without the owner's written OK. |
| M3.6 | Machine sim, part compare, fixtures | SIM-06, SIM-04, FIX-01 | Kinematic replay from the machine model; a deliberate head-into-clamp case is caught; part compare colours a known gouge correctly. |
| M3.7 | Out of scope | 2D-19, AM-14, ROB-01, LAT-01 | Listed in ROADMAP.md as skipped with the reason. Nothing built. |

You may propose a different order (in the audit or a later report) if you find a real dependency
reason. Do not reorder silently.

---

## 5. Architecture rules (no duplicate systems)

1. **Extend, don't fork.** One part document (`CamPart` in `src/cam/types.ts`), one op union
   (`CamOp`), one toolpath IR (`Move` / `Intent` / `Toolpath` in `src/cam/toolpath.ts`), one
   generator entry (`generateOp` / `generatePart`), one tool table (`MachineProfile.tools`), one
   material/feeds table (`feedsFor`), one nesting system (`src/core/nesting.ts` +
   `src/core/nestShape.ts`), one simulator (`src/cam/sim.ts` + `SimulateDialog`), one MPR path
   (`src/cam/mpr.ts` -> `src/core/mpr/writer.ts`), one export checker (`src/core/validator.ts`),
   one batch engine (`src/core/batch.ts`), one units module (`src/core/units.ts`), one store
   (`src/app/store.ts`). If you think you need a second one, stop and explain why in your report.
2. **Pure core, thin UI.** Geometry, toolpaths, sim, collision, recognition and posts are pure
   TypeScript with no React, fully unit tested (as `src/core` and `src/cam` are today). React
   components only call them.
3. **3D lives beside 2D.** Suggested layout (confirm in the audit): `src/cam/mesh/` (mesh type,
   STL/OBJ IO, simplify, sections), `src/cam/3d/` (drop-cutter, waterline, Z-level roughing,
   strategies), `src/cam/adaptive/`, `src/cam/stock/` (stock model interface, heightfield
   implementation, later tri-dexel), `src/cam/collision/`, `src/cam/machine/` (machine model and
   kinematics), `src/cam/solid/` (OpenCascade wrapper), `src/cam/plugin/`. UI under
   `src/pages/part/`.
4. **Associativity.** New op kinds store their inputs and plug into `opInputHash` / `opState` so
   they go stale when the mesh, solid, geometry, tool or parameters change. Large inputs (meshes)
   are hashed once and referenced by id.
5. **Document format.** Bump `CAM_FILE_VERSION` when the format changes, write a migration, and
   test that every Stage 1 golden `part.json` still loads and regenerates byte-identical
   toolpaths. Large binary data (meshes, B-rep) goes in sidecar files or compressed blobs, never
   inline JSON arrays that bloat `cabinet-studio.json`; propose the storage design in the audit.
6. **Workers.** Anything that can take > 50 ms runs in a Web Worker (browser preview) or an
   Electron utility process, with progress and cancel (reuse the cancel pattern in
   `src/core/cancel.ts`). The UI thread never blocks > 100 ms.
7. **WASM.** OpenCascade (and any other WASM) loads lazily on first use, as a separate replaceable
   file, not in the start-up bundle. It must work in Electron on Windows x64 and macOS arm64 and in
   the browser preview, and must work **offline** (bundled, not fetched from a CDN).
8. **Stock model interface.** Define a `StockModel` interface (carve along a move with a cutter,
   query height/occupancy, removed volume, export mesh, snapshot). Implement it with the existing
   heightfield first (exact for a vertical 3-axis tool). Stage 3 adds a tri-dexel or voxel
   implementation behind the same interface.
9. **Machine model.** One data model (axes, limits, table, spoilboard, heads, aggregates,
   capabilities) used by the simulator, the collision checker, the export checker and posts. The
   N-200 profile declares 3 axes and no aggregates until the owner says otherwise.
10. **Feature switches.** Each milestone adds a switch to `FeatureFlags` / `DEFAULT_FEATURES` and
    the Machine & tools page, following the existing pattern (screens can default on once the
    milestone passes; anything that writes machine output defaults **off**).
11. **UI.** Reuse the existing components (`src/components/ui` shadcn, `LenInput` for every length
    so the inch/mm switch works, `EditableTable`, `PageHeader`, the three.js viewer patterns in
    `Viewer3D.tsx` and `SimulateDialog.tsx`). Follow the existing look. Our own icons (lucide-react
    is already used) and our own names.

---

## 6. Quality bars (every milestone)

1. **Tests per milestone.** Unit tests for every new pure function and every op option; a
   golden-file test per new op on a fixture set; an integration test from import to toolpath to
   simulated stock to MPR (or to a blocked export where MPR does not apply).
2. **Golden files.** Follow `tests/cam-golden.test.ts`: store a stable **digest** (move counts,
   lengths, extents, depths, intents, rounded to 0.001 mm) plus, for 3D, a hash of the quantised
   move list. Put 3D goldens under `tests/golden/cam3d/<case>/`. Regenerate only with
   `UPDATE_GOLDEN=1`, and **never regenerate an existing golden without explaining every diff in
   your report.** Stage 1 goldens (`tests/golden/cam/ref01..ref20`, `tests/golden/single-base*`,
   `sample-kitchen`, `sink-hdrill`) must not change at all unless the owner approves.
3. **No regressions.** All 218 existing tests keep passing. The test count only goes up. Report the
   count every run.
4. **Clean builds.** `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` all pass
   with **zero new warnings** before every commit. `npm run sample` still writes the same
   `examples/sample-job/` output (diff it).
5. **Determinism.** Same input -> byte-identical toolpaths and MPR on every OS and run. No
   `Math.random` without a fixed seed, stable sorts, worker results re-ordered by index, no
   dependence on `Date` or locale.
6. **Numerical tolerances** (unless the spec says tighter):
   - Gouge (tool below the design surface): <= 0.005 mm, measured by an independent checker, not
     by the generator checking itself.
   - Stock to leave: ±0.01 mm. Roughing: never less than requested stock.
   - Chord / facet tolerance: default 0.01 mm finishing, 0.05 mm roughing, user-settable.
   - Scallop height: within ±10% of the value implied by step-over on test surfaces.
   - 2D geometry: existing `TOL` values in the kernel; arcs keep their radius within 0.001 mm.
   - Adaptive engagement: <= target + 10%.
   - Simulated removed volume: within 1% of analytic at 0.5 mm cells.
   - Feature recognition depths and positions: within 0.01 mm.
   - Holder/shank clearance: default safety margin 2 mm (setting); any intrusion is a collision.
7. **Performance targets** (mid-range laptop, e.g. Apple M1 or recent Core i5, measured and
   reported, with a perf test that fails on a 2x regression):
   - STL 1 M triangles: import < 5 s.
   - Parallel finishing, 200 k-triangle 600 x 400 mm relief, 6 mm ball, 10% step-over: < 30 s.
   - Z-level roughing of the same relief, 12 mm tool, 3 mm step-down: < 30 s.
   - STEP cabinet part (~50 faces): < 3 s after WASM is warm; WASM cold start < 5 s.
   - Simulation playback: >= 30 fps for a full 5 x 12 ft sheet at 1 mm cells.
   - Memory: < 2 GB peak for the above.
   - App start-up time does not grow by more than 10% from today.
8. **Docs.** Update `README.md` (what it does, in the same plain style), `ROADMAP.md` (status and
   open questions) and `docs/stage-2-3-progress.md` at the end of each milestone.
9. **Screenshots.** For every user-visible milestone, capture screenshots of the new screens from
   the running app (`npm run dev`, browser preview at `http://127.0.0.1:41731`; a Playwright
   script is fine, it is Apache-2.0) and commit them to `docs/screenshots/stage-2-3/<milestone>/`
   (PNG, keep each under ~300 KB).

---

## 7. 3D specifics (Stage 2)

1. **Mesh and STL.** Own parser for binary and ASCII STL and OBJ; handle units, flipped normals,
   duplicate vertices, small gaps; weld and index vertices; report non-manifold edges. Mesh
   utilities: simplify (meshoptimizer, MIT, or own), section at Z (closed contours into the 2D
   kernel), project outline to 2D, delete facets, facets/slices to polylines.
2. **STEP via OpenCascade WASM.** Evaluate `opencascade.js` (full B-rep topology, larger),
   `occt-import-js` (STEP/IGES/BREP to meshes with face groups, smaller) and the `replicad`
   wrapper; pick based on whether you get **face-level topology** (needed for feature recognition
   and face machining), bundle size and offline packaging. Report the choice and reasons. LGPL
   compliance: load as a separate unmodified (or published-source) `.wasm`, ship the licence text
   and a notice in the About screen and in a `THIRD_PARTY_NOTICES` file. Keep face ids and colours
   through import so faces can be picked, coloured and sent to layers.
3. **3D roughing and finishing strategies** (generic names, our UI):
   - Stage 2: **Z-level roughing** (offset / zig-zag / spiral / adaptive clearing per level,
     intermediate slices, flats as extra levels, helix/ramp/pre-drill entry honouring
     `centreCutting` and `maxPlunge`, stay-down links, account for previous ops),
     **parallel finishing** (angle, step-over, one-way/zig-zag, climb/conventional, slope
     limits, skip flats), **waterline finishing** (constant-Z, slope limits, fill shallow areas),
     **projection finishing** (2D pattern or text onto the surface), **3D rest machining** and a
     **pencil pass**. All support boundaries, protected surfaces and gouge checks (3D-11).
   - Stage 3: **radial and spiral**, **scallop**, **flat-area**, **helical**, **undercut** with
     lollipop tools, **curve-driven** and along-intersection finishing.
   - Core algorithms: drop-cutter for flat, ball, bull-nose and V cutters against triangles
     (vertex, edge, facet tests) on a BVH; waterline by push-cutter or slicing. OpenCAMLib
     (LGPL-2.1) is allowed only as a separately loaded WASM; if its build is not clean, write it
     in TypeScript.
4. **Adaptive clearing.** Constant-engagement clearing for 2D pockets and each Z-level: target
   engagement, smoothing radius, lifted fast back-moves, adaptive feed, trochoidal moves where full
   width would occur. Compute engagement from the actual remaining-material region (Clipper2
   booleans of swept areas). FreeCAD's adaptive clearing may be **read** for ideas; do not copy
   its code.
5. **Rest machining.** 2D: subtract the swept areas of earlier ops (real tools, real paths) from
   the target region; minimum path length. 3D: compare the surface reachable by the previous tool
   with the current one.
6. **Stock-model simulation with collision checking.** Extend `src/cam/sim.ts` behind the
   `StockModel` interface: carve 3D moves (ball, bull, V profiles via `cutterZ`), play / step /
   fast-forward / run-to-op / stop at tool change, section view, transparency, removed volume,
   export watertight STL (Manifold, Apache-2.0, for mesh cleanup if needed), cut-free piece
   detection (extend `looseMask`). Collision checks against stock, spoilboard (respect
   `spoilboardAllowance`), table and later clamps, for: the non-cutting shank above flute length,
   the holder, rapids through material, and aggregates. Results go in a log with jump-to-move and
   feed the export checker (a collision is an export-blocking error).
7. **Holder and shank collision.** Tools get flute length, shank diameter, gauge length (stick-out)
   and a holder as a revolved profile (later an imported solid). The simulator draws them. The
   collision checker uses them for every move, including the minimum stick-out a 3D op needs; a
   3D op whose shank or holder would hit the stock is flagged when it is generated, not only in
   simulation.
8. **How 3D paths reach woodWOP: ask first.** 3D toolpaths have no native woodWOP macro in our
   writer today. Do **not** invent an MPR encoding. Propose options in your report (for example
   3D polyline contour elements, point-count limits, splitting), keep 3D MPR output behind its own
   switch that is **off**, and wait for the owner's decision.

---

## 8. Stage 3 specifics

1. **Rotary (4-axis).** Wrapped (developed) work planes around X/Y/Z, rotary parallel and
   profiling passes, disk/saw tools; rotary stock model behind the `StockModel` interface.
2. **Positional 3+2.** Tilted work planes with locked rotary angles; our own kinematics on the
   machine model; conversion to machine axes; verification in simulation.
3. **Simultaneous 5-axis: interface, not engine.** Define `MultiAxisEngine` (inputs: surfaces or
   mesh, tool with holder, strategy parameters, machine kinematics; outputs: our toolpath IR with
   tool axis vectors, warnings). Ship a stub that returns "5-axis engine not licensed" and a fake
   engine for tests. The intended real engine is a licensed SDK such as **ModuleWorks**.
   **Do not buy, sign up for a trial, download an SDK, or add any commercial dependency without
   the owner's explicit written OK.** Put the cost/benefit in a decision item instead.
4. **Machine simulation.** Kinematic replay of the machine model (axes, heads, table, clamps) from
   generated programs, with collision checks. A commercial full-machine simulator is a buy
   decision for the owner, not something you add.
5. **Relief work: import, don't model.** Reliefs come from Vectric software (exported STL) or as
   greyscale height maps. Build import, placement, scaling and machining. **Do not build a relief
   or sculpting modeller.**
6. **Nothing rotary, 3+2 or 5-axis ever goes to the N-200.** The machine model says 3 axes; the
   export checker refuses those ops with a clear message. Output for such machines is only through
   a script post for a machine model that declares the axes.

---

## 9. Clean-room rules (strict)

This module replicates the **functions** of commercial woodworking CAM software. It must not copy
anything else.

1. Work from `docs/stage-2-3-spec.md`, this prompt and general CAM/maths knowledge only. Do not
   look up, paste or paraphrase any commercial CAM product's help pages, manuals, training
   material, screenshots, dialogs, post processors, sample macros or API samples.
2. **Our own names, icons and UI.** Use the vocabulary in spec section 2 (profile, pocket, adaptive
   clearing, Z-level roughing, parallel finishing, waterline finishing, projection finishing,
   recipe, layer rule, batch run, stock model, ...). Do not use Hexagon product or feature names
   anywhere in code, UI strings, comments, commit messages or docs. In particular, never use:
   "ALPHACAM", "Automation Manager", "Cut Path", "Parametric Sketcher", "Quick Nest", "Vero",
   "RadNest", "CDM", "Project Manager", "Fast Geometry", "APS", "Horizontal Z Contours",
   "Z Contour Roughing", "Constant Cusp", "Flat Area Offset", "Tool Data Sync", "NCSIMUL",
   "AlphaEdit". Before each commit, search your diff (case-insensitive) for these and remove any
   hit. (This prompt file is the only place they may appear.)
3. Do not copy another product's toolbar tab names and order, panel names, dialog layouts, colour
   scheme, icon style or default key bindings.
4. **Licences: permissive or LGPL only.** MIT, BSD, Apache-2.0, ISC, BSL-1.0, public domain are
   fine. LGPL only as a separately loaded, replaceable library/WASM, with notices. **No GPL or
   AGPL code**, in particular **not CAMotics**, LibreDWG or potrace. Do not copy code from
   GPL projects even in "adapted" form. Check the licence of every new dependency and its
   transitive dependencies (`npx license-checker` or similar) and list them in the report.
5. **Nothing decompiled or reverse-engineered.** No reading of other vendors' binaries, encrypted
   posts or private file formats. Interoperate only through open or documented formats (DXF, STEP,
   IGES, STL, OBJ, CSV, G-code, woodWOP MPR as HOMAG documents it).
6. The app does not read, modify or reverse-engineer any HOMAG software (existing rule in the
   README). It only writes its own woodWOP input files.

---

## 10. Safety rules (cutting is real)

1. **N-200 output stays off by default.** `camMprOutput` stays `false` in `DEFAULT_FEATURES`. Every
   new kind of machine output (3D paths, saw, aggregate, flip-side sheets, script posts aimed at
   the N-200) gets its own switch, **off by default**, and goes through the existing export checker
   (`src/core/validator.ts`). The checker must block: unsupported ops for the machine model,
   collisions, gouges over tolerance, depths beyond `spoilboardAllowance`, missing tools, tools
   too short for the depth, coordinates off the table.
2. **Placeholder tools stay placeholders.** Do not invent real tool numbers. New tools you add for
   testing (ball-nose, tapered, holders) go into the placeholder table, clearly marked
   placeholder, and the placeholder banner keeps showing until the owner imports the real table.
3. **Nothing is machine-proven.** Never write, in UI, docs, commits or reports, that output is
   proven, safe to run, or verified on the machine. The README warning ("Open every MPR in woodWOP
   and run the simulation before cutting") stays and applies to all new output. Our simulator
   checks our own toolpaths, not the machine.
4. **Stop and ask rather than guess on anything that affects cutting.** That includes: feeds,
   speeds, step-downs and step-overs used as defaults; tool numbers, diameters, lengths, holders;
   safe Z, clearance and spoilboard depths; machine limits and origin; which macros woodWOP should
   get for 3D or aggregate work; whether the N-200 has a saw unit or aggregate; changes to any
   existing MPR golden file; anything in the hinge/slide boring numbers. Put these in the
   "Decisions needed" section of your report, with your recommendation, and keep the safe default
   (output off, placeholder values) until answered.
5. **Never weaken an existing check** to make a test pass.

---

## 11. Git workflow

1. Work on `main` (the owner's choice). Pull/rebase before starting each run.
2. **You do the commits and pushes yourself.** Commit and push to `main` at least at the end of
   each milestone; smaller commits inside a milestone are welcome, as long as each one leaves
   tests, typecheck, lint and build green.
3. Commit message style: short imperative summary, prefixed with the milestone, e.g.
   `M2.2: waterline finishing with slope limits and golden tests`. Body: what changed and why.
4. Never force-push, never rewrite pushed history, never skip hooks, never commit
   `node_modules`, build output, `release/`, secrets, API keys, tokens or `secrets/ai-keys.json`.
   Use whatever git credentials your environment already provides; never print, log or commit a
   token.
5. After pushing, confirm the remote `main` points at your commit (e.g. `git ls-remote origin
   main`) and include the hash in your report.
6. Large binary fixtures: keep each test fixture small (< 1 MB; generate big meshes in the test
   instead of committing them).

---

## 12. Working rhythm across runs

- **One milestone per run** is the normal pace. If a milestone is too big, split it into named
  parts (e.g. M2.2a waterline, M2.2b projection) and say so in the progress file.
- Start each run: read `docs/stage-2-3-progress.md`, `git log -10`, run the test suite, then
  continue.
- End each run: all checks green, docs updated, committed, pushed, report sent. Never end a run
  with uncommitted work or red tests; if you run out of room, commit the green part and describe
  the rest.
- If you hit a decision that affects cutting, a licence, a purchase, or a conflict between this
  prompt and the spec: stop that item, finish what is safe, and ask.

---

## 13. Report format (end of every run)

Write the report in plain English for a non-programmer, using these headings:

1. **Milestones done this run**: names and spec IDs.
2. **How acceptance was met**: for each acceptance criterion, the test(s) that prove it and the
   measured numbers (tolerances, timings, volumes, cut-length savings).
3. **Screenshots**: paths under `docs/screenshots/stage-2-3/...` with one line on what each shows.
4. **Tests**: total count before and after (e.g. 218 -> 263), all passing; typecheck, lint and
   build status; any golden files added or changed and why.
5. **Commits**: hashes and messages, and confirmation they are on GitHub `main`.
6. **New dependencies**: name, version, licence, why.
7. **What's left**: remaining milestones and anything deferred inside this one.
8. **Decisions needed from you**: numbered questions in plain English, each with the options, my
   recommendation, and what stays safe until you answer (for example "3D output to the N-200
   stays off").
9. **Risks or concerns**: anything that could affect cutting, data or schedule.

Keep it short enough to read in five minutes; put detail in `docs/stage-2-3-progress.md`.

---

## 14. Start now

Do **M2.0 Audit** (section 3): install, run the baseline, read the code, write
`docs/stage-2-3-audit.md` and `docs/stage-2-3-progress.md`, commit and push them, send the report
in the section 13 format, and stop for the owner's go-ahead.
