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
| M2.8b Shared-line cutting (NST-04) | **Done** (October 2026) | See below. Output switch off. |
| M2.8c Bridged nesting (NST-05) | **Done** (October 2026) | See below. Output switch off. |
| M2.8d Flip-side sheets (NST-07), sheet backplot | **Done** (October 2026) | See below. Output switch off. |
| M2.8e Manual nesting (NST-09), screenshots, docs | **Done** (October 2026) | See below. M2.8 complete. | Shared-line cutting, bridged nesting, flip-side sheets, manual nesting. See "M2.8 split". |
| M2.9a Other machines and process steps (AM-08) | **Done** (October 2026) | See below. Output switch for other machines off. |
| M2.9b SQLite storage option (AM-06) | **Done** (October 2026) | See below. JSON stays the default. |
| M2.9c Assemblies and fittings by face, batch steps (AM-09, AM-10) | **Done** (October 2026) | See below. |
| M2.9d Wizards, admin tools, screenshots, docs (AM-03, AM-13) | **Done** (October 2026) | See below. M2.9 complete. |
| M2.10a Plugin sandbox and API (API-01) | **Done** (October 2026) | See below. Plugins run sandboxed; nothing granted until the owner grants it. |
| M2.10b Script posts (PST-02) | **Done** (October 2026) | See below. Output switch off; never the N-200. |
| M2.10c Reading programs back (NEW-22) | **Done** (October 2026) | See below. Also fixes the template post's feed on helical entries, and text posts now refuse operations without one tool. |
| M2.10d Program manager and editor (PST-04), screenshots, docs | **Done** (October 2026) | See below. M2.10 complete. Copying edited programs has its own switch, off. |
| M2.11a Relief import: readers, sizing, placement, machining guard, dialog (ART-01) | **Done** (October 2026) | See below. Screens only (switch "Relief import", on). |
| M2.11b Stage 2 exit test, screenshots, docs | **Done** (October 2026) | See below. **M2.11 complete. Stage 2 complete.** |
| M3.1a Radial and spiral finishing (3D-05), format v5, switch | **Done** (October 2026) | See below. Simulation only (true 3D output stays off). |
| M3.1b Scallop finishing (3D-07) | **Done** (October 2026) | See below. Cusp within ±10 % measured independently. Simulation only. |
| M3.1c Flat-area and helical finishing (3D-08, first part) | **Done** (October 2026) | See below. Simulation only. |
| M3.1d Undercut finishing with lollipop tools (3D-08, second part) and a dexel stock | **Done** (October 2026) | See below. Simulation only. |
| M3.1e Curve-driven finishing (3D-09) | **Done** (October 2026) | See below. Simulation only. |
| M3.1f Screenshots, README, ROADMAP | **Done** (October 2026) | See below. **M3.1 complete.** |
| M3.1g Owner follow-ups: flat-area flat layers, lollipop badges, undercut roughing, solid face rows and columns, plan view | **Done** (October 2026) | See below. Output switches all off; undercut roughing simulation only. |
| M3.2 Small extras (NEW-08, NEW-07, NEW-21, NEW-24, 2D-18) | **Done** (October 2026) | See below. Thread milling simulation only; rapid surfaces not in woodWOP output; every output switch still off. |
| M3.3a Rotary core: wrapped planes (NEW-14), rotary machining (3D-10), rotary stock, checks, format v8 | **Done** (October 2026) | See below. Simulation only; the N-200 export refuses a turned part. |
| M3.3b Rotary output through a script post for a machine model with a rotary axis | **Done** (October 2026) | See below. Rotary-post switch off. |
| M3.3c Rotary screens, simulator, screenshots, README, ROADMAP | **Done** (October 2026) | See below. **M3.3 complete.** |
| M3.4a Positional 3+2 core (5AX-01): tilted planes, kinematics, conversion, three-way stock, checks, format v9 | **Done** (October 2026) | See below. Simulation only; the N-200 export refuses a part with tilted operations. Also owner item 3 (`CAM_ROTARY` names each turned part). |
| M3.4b 3+2 output through a script post for a machine model with 3+2 axes | **Done** (October 2026) | See below. 3+2-post switch off. |
| M3.4c 3+2 screens, simulator, screenshots, README, ROADMAP | **Done** (October 2026) | See below. **M3.4 complete.** Also owner item 4 (simulator step-back: stock checkpoints from the background check). |
| M3.5a 5-axis core: `MultiAxisEngine` interface, "not licensed" stub, preview / test engine, tool axes in the IR, barrel and form tools, format 10 | **Done** (October 2026) | See below. No engine licence bought, nothing downloaded. |
| M3.5b Simultaneous kinematics with head flip, 5-axis simulation, axis-turn check, N-200 refusal, script post | **Done** (October 2026) | See below. 5-axis-post switch off; never the N-200. Closes the M3.4 limit on the axis turn between planes. |
| M3.5c 5-axis screens, screenshots, README, ROADMAP | **Done** (October 2026) | See below. **M3.5 complete.** |
| M3.6a Clamps, pods and rails (FIX-01), convex distance engine, fixtures in every collision check, format 11 | **Done** (October 2026) | See below. A tool, shank or holder into a fixture blocks the export (`CAM_COLLISION`). |
| M3.6b Machine simulation (SIM-06) and part compare (SIM-04) cores | **Done** (October 2026) | See below. Simulator only; nothing new is written to any machine. |
| M3.6c Machine view, compare screens, fixtures panel, screenshots, README, ROADMAP | **Done** (October 2026) | See below. **M3.6 complete.** |
| M3.6d Pocket and facing toolpaths open over their first cut (owner decision 24.4) | **Done** (October 2026) | See below. Goldens explained; woodWOP output byte-identical. |
| M3.7 | Not started | |

Test count: 218 at the start of Stage 2 (217 passed + 1 skipped), 263 after M2.1, 296 after M2.2a
(295 + 1 skipped), 325 after M2.2b (324 + 1 skipped), 347 after M2.2c (346 + 1 skipped), 363 after M2.3a (362 + 1 skipped), 378 after M2.3b (377 + 1 skipped), 405 after M2.3c (404 + 1
skipped), 407 after M2.4a (406 + 1 skipped), 418 after M2.4b (417 + 1 skipped), 427 after M2.4c (426 + 1 skipped), 447 after M2.4d (446 + 1 skipped), 460 after M2.5a (459 + 1 skipped), 470 after M2.5b (469 + 1 skipped), 482 after M2.5c (481 + 1 skipped), 492 after M2.5d (491 + 1 skipped), 517 after M2.6a (516 + 1 skipped), 541 after M2.6b (540 + 1 skipped), 558 after M2.6c (557 + 1 skipped), 567 after M2.6d (566 + 1 skipped), 577 after M2.6e (576 + 1 skipped), 596 after M2.7a (595 + 1 skipped), 611 after M2.7b (610 + 1 skipped), 622 after M2.7c (621 + 1 skipped), 627 after M2.7d (626 + 1 skipped), 635 after M2.8a (634 + 1 skipped), 646 after M2.8b (645 + 1 skipped), 654 after M2.8c (653 + 1 skipped), 661 after M2.8d (660 + 1 skipped), 669 after M2.8e (668 + 1 skipped), 677 after M2.9a (676 + 1 skipped), 684 after M2.9b (683 + 1 skipped), 695 after M2.9c (694 + 1 skipped), 704 after M2.9d (703 + 1 skipped), 727 after M2.10a (726 + 1 skipped), 736 after M2.10b (735 + 1 skipped), 744 after M2.10c (743 + 1 skipped), 749 after M2.10d (748 + 1 skipped), 771 after M2.11a (770 + 1 skipped), 774 after M2.11b (773 + 1 skipped), 801 after M3.1a (800 + 1 skipped), 819 after M3.1b (818 + 1 skipped), 834 after M3.1c (833 + 1 skipped), 845 after M3.1d (844 + 1 skipped), 864 after M3.1e (863 + 1 skipped), 865 after M3.1f (864 + 1 skipped), 871 after M3.1g items 1-2 (870 + 1 skipped), 883 after item 3 (882 + 1 skipped), 894 after items 4-5 (893 + 1 skipped), 923 after M3.2a-c (922 + 1 skipped), 935 after M3.2d-e (934 + 1 skipped), 955 after M3.3a (954 + 1 skipped), 960 after M3.3b (959 + 1 skipped), 961 after M3.3c (960 + 1 skipped), 974 after M3.4a (973 + 1 skipped), 978 after M3.4b (977 + 1 skipped), 979 after M3.4c (978 + 1 skipped), 1006 after M3.5a (1005 + 1 skipped), 1021 after M3.5b (1020 + 1 skipped), 1022 after M3.5c (1021 + 1 skipped), 1032 after M3.6a (1031 + 1 skipped), 1049 after M3.6b (1048 + 1 skipped), 1049 after M3.6c (1048 + 1 skipped), 1050 after M3.6d (1049 + 1 skipped).
Lint baseline: 17 warnings, all pre-existing (unchanged). (M2.8a-d went out with one extra
warning in the new material price field, missed because the comparison list was taken with new
files present; fixed in M2.8e, back to 17.)

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
15. With the M2.10 go-ahead, for M2.8: material prices come later through Configure badges;
    hold-down and bridge sizes stay badged placeholders; sheets are flipped end for end with a
    5 mm reference strip; shared-line, bridge and flip-side output stay off.
16. With the M2.10 go-ahead, for M2.9: no second machine (the N-200 only), output for other
    machines stays off; process steps do not share the work; part lists keep the app's own face
    words; waste areas stay a report only.
17. With the M2.10 go-ahead: plugins run sandboxed, with file, network and machine-output access
    only by an explicit owner grant; no plugin may switch output on or get past the export
    checker; script posts never target the N-200 for rotary, 3+2, 5-axis or other unsupported
    work; every machine output switch stays off.

18. With the M2.11 go-ahead, for M2.10: half-circle arcs stay as they are; the owner simulates
    one circle in woodWOP first (option b), and arcs change only if that circle is off. Copying
    hand-edited programs to the machine stays off. The machine folder stays empty. No plugins
    are trusted and nothing is granted.
19. With the M2.11 go-ahead (repeated): M2.9 and M2.8 answers stand (decisions 15 and 16);
    stick-outs, holders, aggregates and the T140 blade stay badged placeholders, no aggregate
    fitted; every machine output switch stays off; reliefs are imported, never modelled.

20. With the M3.2 go-ahead, on the M3.1 report: (1) flat-area finishing on level flats goes out
    as ordinary contour passes behind the existing 3D flat-layer switch, which stays off, the
    checker blocking it by default; (2) lollipop sizes are unknown: keep the placeholder ball,
    neck, flute and stick-out with Configure badges; (3) build undercut roughing, with gouge and
    collision checks and dexel simulation, simulation only (output blocked); (4) rows and columns
    on imported solids with a full OpenCascade B-rep WASM (LGPL, about 23 MB) loaded on first
    use as a separate replaceable file, offline, with notices; keep occt-import-js for import
    unless one kernel can cleanly replace both; (5) fix the plan view freezing on very large
    toolpaths without changing the toolpath data.

21. With the M3.4 go-ahead, on the M3.3 report: (1) rotary step-over and step-down stay
    placeholders with Configure badges; (2) there is no rotary machine in the shop: the sample
    rotary post stays a labelled generic example and the rotary-post switch stays off (do not ask
    for a rotary post or sample program again); (3) turned parts in an N-200 job keep blocking the
    whole job with `CAM_ROTARY`, the message naming the turned part(s) and saying to remove them
    from the job to export the rest; (4) going back in the simulator on large rotary parts is
    acceptable for now: move the replay off the screen's thread if cheap, else note it here.

22. With the M3.5 go-ahead, on the M3.4 report: (1) the application of the M3.3 answers to 3+2 is
    approved: badged placeholder kinematics, a generic labelled sample post, its switch off,
    tilted parts blocking the whole N-200 job with the part named; (2) the deferred M3.4 items
    (3D finishing, through cuts, rest and adaptive on tilted planes; the axis turn between planes
    not collision-checked; the remaining ~2 s step-back on the screen's thread) may stay deferred,
    listed here, and are closed where M3.5 builds the same machinery; (3) there is no 3+2 or
    5-axis machine in the shop: do not ask for a real post or sample program.

23. With the M3.6 go-ahead, on the M3.5 report: (1) **do not buy a 5-axis engine licence**
    (ModuleWorks or any other engine): the shop's engine stays the "not licensed" stub, 5-axis
    output stays off and the N-200 always refuses 5-axis work; (2) the two M3.5c fixes are
    approved (a groove cut as deep as asked is not a gouge; near-flat normals snapped upright in
    the preview engine only); (3) the remaining deferred items (3D finishing, through cuts, rest
    and adaptive on tilted planes; the ~2 s step-back on the screen's thread; the hold on far
    jumps) stay deferred and listed, closed where a later milestone builds the same machinery.

24. With the M3.7 go-ahead, on the M3.6 report: (1) the N-200's head and gantry sizes are not
    known yet: keep the invented machine parts with their Configure badge; (2) the shop's clamps,
    pods and rails are not known (a vacuum table, maybe none): keep the badged examples, and a part
    with no fixtures is a valid set-up; (3) a machine-part hit is a **warning** on the export (it
    does not block it) while the machine's parts are invented; once real sizes are entered and
    confirmed (badge cleared) it **blocks** the export; build that switch-over now and test both
    states (M3.6e); (4) fix the pocket toolpath's opening rapid to the part's corner 3 mm above the
    top: start with a proper approach over the first cut, update the affected goldens with a
    one-line reason each, woodWOP output byte-identical (M3.6d); (5) the deferred items stay
    listed and are closed only if M3.7 builds the same machinery.

## Open questions for the owner

1. **N-200 figures** (machine model): travel limits, table size, origin, spoilboard thickness,
   tool-change position, and whether a saw unit and an aggregate are fitted. Placeholders until
   then.
2. **Real 3D tools and holders**: ball-nose, bull-nose and tapered tools; shank diameters; flute
   lengths; stick-outs; holder outlines.
3. **3D feeds, speeds, step-downs and step-overs** for the shop's materials.
4. **A small 3D program saved from woodWOP**, needed for true 3D output (decision 2).
5. **3D flat-layer output on the machine**: before switching on "Write 3D roughing, waterline
   and flat areas to MPR", load one roughing program in woodWOP and check how many points a contour may hold
   (not confirmed; the app warns over 2,000 points per contour).
6. **Solid models (M2.5)**: open one STEP file in the installed app on the Windows PC and on the
   Mac with the network off. (The rebate reach of 6 mm and drilling pointed holes to the
   straight-wall depth were confirmed with the M2.6 go-ahead.)
7. **M2.6 (saw, aggregate, cutting values)**: see "M2.6 decisions needed" below.
8. **M2.7 (holders, aggregates)**: see "M2.7 decisions needed" below.
9. **M2.8**: answered (decision 15); still to come: the prices themselves, the hold-down and bridge
   sizes, and one sheet of each kind checked in woodWOP before any of those switches goes on.
10. **M2.9**: answered (decision 16).
11. **M2.10**: answered (decision 18); still to come: the result of simulating one full circle
    from our MPR in woodWOP.
12. **M2.11 (relief import)**: see "M2.11 decisions needed" below.
13. **M3.1 (more 3D finishing)**: answered (decision 20); still to come: real lollipop sizes
    (see "M3.1g decisions needed").
14. **M3.1g / M3.2**: see "M3.1g decisions needed" and "M3.2 decisions needed" below.
15. **M3.3 (rotary)**: see "M3.3 decisions needed" below.
16. **M3.3**: answered (decision 21). **M3.4 (3+2)**: nothing blocking; see "M3.4 decisions needed" below.
17. **M3.4**: answered (decision 22). **M3.5 (5-axis interface)**: one decision for the record, a
    5-axis engine licence (see "M3.5 decisions needed"); nothing blocking.

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

## M2.8b shared-line cutting: what was built

| Spec ID | What | Where |
|---|---|---|
| NST-04 | "Shared-line cutting" (Machine page, Nesting): rectangular parts nest exactly one cut-out tool diameter apart (extra spacing is not used), so the tool-centre lines of neighbours lie on top of each other. The plan walks the parts in the sheet's cut order; for each it cuts what is still uncut of the rectangle one tool radius outside it, so every line is cut once, collinear pieces join into one straight cut (one pass along a whole row of parts) and pieces that meet round a corner join into one path. Each part is cut free at (or before) its own turn | `sharedLinePlan` in `src/core/sheetCuts.ts`, `nestJob` / `buildSheetProgram` in `machining.ts` |
| Hold-down | Parts under 0.05 m² or narrower than 120 mm (PLACEHOLDER limits = the export checker's small-part rule, Configure badge), onion-skinned parts, shaped parts, custom parts and parts in or around cut-outs keep their own cut-out (and skin pass) | `ownReason`, `nestConfirm.ts` |
| Output | Switch "Write shared-line cuts to MPR" (`nestSharedOutput`), **off**. Off: the plan is drawn on the sheet (Nesting tab, "Shared lines", with the saving) and listed by the checker; every part keeps its own cut-out. On: each shared path is a `<105>` contour along the tool centre with `RK="NOWRK"` (no radius compensation), open paths end where they end | `writer.ts`, `SheetView.tsx`, `JobPage.tsx` |
| Checks | Export checker, on the program's own paths (independent of the planner): `SHARED_GOUGE` (a path closer than the tool radius to any part on the sheet), `SHARED_UNCUT` (an edge of a planned part not cut); `SHARED_LINES` info with the measured saving | `validator.ts`, `pathToRegion`, `uncutLength` |
| Badges | "Shared lines: smallest part that shares lines" while shared lines are on and unconfirmed (Machine page banner and field, sidebar count); typing a value confirms it; the plan follows any change at once (sheet programs are rebuilt from the settings) | `nestUnconfirmed` |

### Acceptance (shared lines cut the measured cut length by at least 15 % on a rectangle-heavy job, part sizes unchanged)

| Check | Proof | Measured |
|---|---|---|
| Cut length, measured on the programs written both ways | `tests/nest-shared.test.ts` (`programCutLength`: tool-centre length of every cut-out pass; compensated outlines grown by the radius with round corners) | Sample kitchen (3 sheets): 92.70 m → 75.77 m, **18.3 % less**. Eight base and wall cabinets (5 sheets): 152.45 m → 114.17 m, **25.1 % less** |
| Part sizes and places unchanged | same | Same nest, same placements, same cut sizes with the output on or off; same export-checker errors |
| No cut into a part | same (independent check: every path sampled every 0.5 mm against every part rectangle) | Closest approach exactly the tool radius, 6.000 mm |
| Every edge cut | same (every 0.5 mm round each part's tool-centre rectangle lies on a path) | Nothing uncovered |
| By hand | same | Two 500 x 300 parts: 1648 + 1336 = 2984 mm against 2 x (1600 + 12π); 3 x 2 grid: 3 x 1836 + 4 x 824 = 8804 mm |
| Checker catches mistakes | same | A path moved 3 mm into the parts: `SHARED_GOUGE`; a path removed: `SHARED_UNCUT` |
| Off = unchanged | same | With shared lines off, nest and programs identical; all goldens and the sample job unchanged |

### Limits recorded

- **Only rectangles share lines.** Shaped and custom parts keep their own cut-outs.
- **One side of each shared line is cut climb, the other conventional** (a single pass between two parts).
- **Corners of the plan are square at the tool centre** (the part corners stay sharp); a part cut on its own goes round its corners in arcs. The measured lengths include this.
- **Not machine-proven.** The `NOWRK` contour form and the vertical (or ramped) entry on the line are as the MPR 4.x description gives them; output stays off until a sheet is checked in woodWOP.

## M2.8c bridged nesting: what was built

| Spec ID | What | Where |
|---|---|---|
| NST-05 | "Bridged nesting" (Machine page, Nesting): small rectangular parts (under 0.1 m²) are linked by bridges between facing edges no further apart than the longest bridge (20 mm), 6 mm wide, in the middle of the stretch the edges share, never within a tool diameter of another part (the tool has to pass). Links form a tree, shortest gaps first, so no waste is boxed in. Each group is cut as **one continuous path** round its parts and bridges (Clipper2 union); with an onion skin set, the group's path leaves the skin and a final pass at the end of the sheet cuts it. Bridged parts are left out of shared lines and of the per-part onion skin | `bridgePlan` in `src/core/sheetCuts.ts`, `buildSheetProgram` |
| Output | Switch "Write bridged groups to MPR" (`nestBridgeOutput`), **off**. Off: the groups are drawn (Nesting tab, "Bridges") and listed by the checker; every part keeps its own cut-out. On: one compensated `<105>` contour per group (waste boxed in by a group, if any, cut first, the other way round), and a program comment to break the bridges off | `writer.ts`, `SheetView.tsx` |
| Checks | `BRIDGE_LONG` (a bridge longer than allowed), `BRIDGE_CLOSE` (a bridge within a tool diameter of another part), `BRIDGE_GOUGE` (a group's path runs into a part), `BRIDGE_SHAPE` (the path does not enclose exactly its parts and bridges); `BRIDGES` info | `validator.ts` |
| Badges | Bridge width, longest bridge and largest part linked are PLACEHOLDER values with Configure badges while bridged nesting is on | `nestUnconfirmed` |

### Acceptance (spec: link parts with short bridges into one continuous path, onion-skin passes, maximum bridge length)

| Check | Proof | Measured |
|---|---|---|
| By hand | `tests/nest-bridges.test.ts` | Three 300 x 200 parts 14 mm apart: bridges at x 310-324 and 624-638, y 107-113; outline area 3 x 60,000 + 2 x 84 mm² |
| Limits | same | 25 mm gap (over 20): not linked; 0.12 m² parts: not linked; a part 7 mm from the bridge spot: no bridge; 2 x 2 block: 3 bridges, no enclosed waste |
| One path per group, nothing cut into a part | same (independent: the band one diameter wide that the tool sweeps outside each path, intersected with every part) | Sample kitchen: 4 small parts in 2 groups, 2 bridges, 2 paths; swept band meets no part; no `BRIDGE_*` error; same other errors as without |
| Onion skin | same | Group paths at 0.4 mm first, final through passes at the end of the sheet |
| Off = unchanged | same | Programs identical with the switch off |
| Checker catches mistakes | same | Path moved 40 mm: `BRIDGE_GOUGE`; path shrunk: `BRIDGE_SHAPE`; longest bridge 10 mm: `BRIDGE_LONG` |

### Limits recorded

- **Only rectangles are linked**, and only to other small parts (not to a large neighbour).
- **The parts keep a small radius of material where each bridge meets their edge** (the tool cannot cut an inside corner sharp); it comes off with the bridge stub.
- **Not machine-proven**; output off.

## M2.8d flip-side sheets: what was built

| Spec ID | What | Where |
|---|---|---|
| NST-07 | "Flip-side sheets" (Machine page, Nesting): parts with underside (face 6) work nest on their own sheets. Each gets a **side-1 program**, run first with the sheet face 6 up and its factory edges against the stops: it mills a reference strip (5 mm) off the far end and drills the underside holes, mirrored. The sheet is then turned over (end for end, or over its long edge) with the milled edge against the stop, and its **normal program** is side 2 (top work and cut-outs; it opens with a program stop and the turning instruction). Registration: the milled edge is cut by the machine, so side 2 finds it exactly where side 1 put it whatever the real sheet length; the other direction keeps the same factory edge on the stops. The nest leaves the strip off the sheet; areas and costs count the whole sheet | `src/core/flipSide.ts`, `nestJob` (`underside`), `runJob`, `mprFiles` |
| Backplot | Nesting tab, on a flip-side sheet: "Backplot side 1" (the sheet as it lies face down: parts mirrored, underside holes, reference strip and cut), "Backplot side 2" (as turned over, the milled edge marked), "Both sides" (side-1 holes turned back over onto side 2), with the registration figure | `SheetBackplot.tsx`, `registrationError` |
| Output | Switch "Write flip-side sheet programs" (`nestFlipOutput`), **off**; it also needs the custom-part switch (the holes are custom-part work). Off: side 1 is only shown and listed; underside holes stay in each part's own turned-over program (Stage 1). On: `<sheet>_side1.mpr` is written, and parts on that sheet get no separate turned-over program | `pipeline.ts` |
| Checks | `FLIP_OUTSIDE` (a side-1 hole that lands outside its part once turned over, checked by mapping it back), `FLIP_REFERENCE` (reference cut not on the turned-over edge, or into a part), `DEPTH_SPOILBOARD` and `TOOL_MISSING` on the side-1 holes; `FLIP_SHEETS` info | `validator.ts` |
| Badges | How the sheet is turned and the reference strip are PLACEHOLDER values with Configure badges while flip-side sheets are on | `nestUnconfirmed` |

### Acceptance (flip-side sheets register within 0.1 mm in the backplot)

| Check | Proof | Measured |
|---|---|---|
| Registration, read back from the written side-1 MPR | `tests/nest-flip.test.ts` (the side-1 file parsed with `readMpr`; every `<102>` hole turned back over by the test's own formula and compared with where the part design puts it, placement worked out in the test) | 12 holes on 3 parts: **0.0000 mm**, turned end for end and over the long edge |
| Backplot figure | same, browser check | `registrationError` ≤ 0.001 mm; the "Both sides" view shows "within 0.000 mm" |
| Reference edge | same | `<105>` along x = sheet length less 5 mm (end for end) or y = width less 5 mm (long edge), `RK="WRKR"` (tool on the strip's side) |
| Grouping | same | The 3 underside panels on their own sheet (3653 long); no underside panel on any other sheet; flip off: nest identical |
| Output off / custom-part output off | same | No side-1 file; per-part turned-over program kept; flip switch alone writes nothing |
| Checker catches mistakes | same | Hole moved 700 mm: `FLIP_OUTSIDE`; 25 mm deep: `DEPTH_SPOILBOARD`; reference cut moved 20 mm: `FLIP_REFERENCE` |

### Limits recorded

- **Underside work is drilling only** (as in Stage 1: face 6 holes). Face 6 milling is not supported.
- **The registration is only as good as the stops and the reference cut.** Not machine-proven; output off.
- **With the output off the front program's sheet is 5 mm shorter than the sheet** (the strip is left at the far end, unprogrammed); this is harmless but is noted.

## M2.8e manual nesting: what was built

| Spec ID | What | Where |
|---|---|---|
| NST-09 | Nesting tab → **Edit layout**: drag parts on a sheet; **snap** (on by default) puts a part's edge at the nest spacing beside a neighbour, in line with a neighbour's edge (edge alignment) or on the trim line, each direction separately, within 20 mm; **Turn** a quarter about the middle (R), or **end for end** (a grain-locked part on a grained sheet only turns end for end); arrow keys nudge 1 mm (Shift 10 mm); Shift-click picks several; **Move to sheet** or **New sheet** (split); **Undo**; **Save layout** keeps it with the job (`Job.nestEdit`); **Automatic nest** goes back. A **live check** marks parts that overlap, are closer than the cut-out tool, closer than the nest spacing (amber), off the trim or turned against the grain. **Nest list** files: save the layout as JSON and load it again, parts matched by id or by label part id, materials by id or code; parts in the list that the job no longer has are reported | `src/core/manualNest.ts`, `src/pages/job/NestEditor.tsx`, `applySavedNest` in `runJob` |
| Re-validation | A saved layout goes through the same sheet programs and the same export checker as an automatic nest (`OVERLAP`, `SPACING`, `OUT_OF_SHEET`, `GRAIN`, `THICKNESS`, every machining check), plus `NEST_SPACING` (closer than the nest spacing although the tool fits, warning), `NEST_MISSING` (parts in the layout no longer in the job), `NEST_MATERIAL`, `NEST_ADDED` (new parts nested after the saved sheets) and `NEST_MANUAL` info. Parts sitting in another part's opening keep "cut first" | `validator.ts`, `openingsOf` |

### Acceptance (manual edits keep spacing rules and are re-validated)

| Check | Proof | Measured |
|---|---|---|
| Unchanged layout = same programs | `tests/nest-manual.test.ts` | The automatic nest saved as a layout gives identical placements and programs |
| Re-validated | same | Part moved over a neighbour: `OVERLAP`; 5 mm away: `SPACING` (error); 13 mm (tool fits, nest wants 14): `NEST_SPACING` only; past the far trim: `OUT_OF_SHEET`; grain-locked part turned on a grained sheet: `GRAIN` |
| Job changed after saving | same | A cabinet removed: `NEST_MISSING`; one added: its parts nested on extra sheets, every part placed once, nothing overlapping |
| Split | same | Two parts moved to a new sheet: one more program, same errors as before |
| Snap and turn | same | Beside a neighbour at the spacing, top edges in line, the trim corner; nothing near: left alone; a quarter turn about the middle and back |
| Nest list | same | Saved and reloaded unchanged; a part with a changed id found by its label id; a part not in the job reported; other files refused with a plain message |
| In the browser | screenshots 08, 09 | Dragging #13 onto its neighbours marks it red ("#13 overlaps #41 / #16 / #7"); Undo; Save layout; "laid out by hand" |

## M2.8 screenshots

`docs/screenshots/stage-2-3/M2.8/` (browser preview, Playwright; a sample job with three panels
that have underside holes, and a price on the white melamine):

- `01-areas-and-costs.png`: the Nesting tab's area and cost panel (parts, remnants, scrap, sheet; the selected part's area, material cost and share of the sheet; the unpriced HDF with its Configure badge).
- `02-material-price-configure.png`: Configure on the HDF price opens the material with the price field focused.
- `03-nesting-settings-badges.png`: shared-line cutting, bridged nesting and flip-side sheets on the Machine page, each placeholder with Configure / Mark as confirmed.
- `04-shared-lines-and-bridges.png`: a sheet with the shared-line plan (tool-centre paths, a dot where each starts) and two bridged groups.
- `05-flip-backplot-side1.png`: backplot of side 1: the sheet face down, parts mirrored, underside holes, reference strip.
- `06-flip-backplot-side2.png`: side 2 as turned over, the milled edge at the stop.
- `07-flip-both-sides-registration.png`: both sides together, underside holes on their parts, "within 0.000 mm".
- `08-manual-nesting-live-check.png`: the layout editor with a part dragged onto its neighbours, the live check listing the overlaps.
- `09-manual-layout-checked.png`: the saved layout's export checks (Output tab).

## M2.8 licences

No new dependencies. Everything uses the existing kernel (Clipper2, BSL-1.0) and our own code.

## M2.8 decisions needed (see the report)

1. **Material prices** (per m² or per ft², or per kg with the density). Until then nothing is
   costed and each material shows a Configure badge.
2. **Hold-down limits**: the smallest part that shares lines (0.05 m² / 120 mm, from the export
   checker's small-part rule); bridge width 6 mm, longest bridge 20 mm, parts under 0.1 m². All
   placeholders with badges.
3. **Turning a sheet over**: end for end (as the Stage 1 turned-over part programs) or over the
   long edge, and the reference strip (5 mm placeholder; it has to be less than the edge trim).
   Recommendation: end for end, 5 mm, and check one sheet in woodWOP.
4. **Before switching on any of the three new outputs** (shared-line cuts, bridged groups,
   flip-side programs): open one generated sheet of each in woodWOP and simulate it. In
   particular: the tool-centre contour (`RK="NOWRK"`) with a vertical or ramped entry on the line
   for shared lines, and the side-1 program with its reference cut and program stop.

## M2.8 test-suite note

`tests/perf.test.ts` "adaptive clearing per Z level" (limit 90 s with the whole suite running in
parallel, about 37 s alone) measured 90.2 s on the untouched M2.7d code in this container this run,
so it fails by timing alone when the full suite runs; it passes when run on its own (66-75 s this
run). In the full suite it passed once and failed four times this run, on the old and new code
alike. The limit was not changed.

## M2.9 split

M2.9 is done in named parts, each green, pushed and recorded here before the next starts:
**M2.9a** other machines and process steps (AM-08); **M2.9b** the SQLite storage option (AM-06);
**M2.9c** assemblies and fittings by face in part lists, and batch steps (AM-09, AM-10);
**M2.9d** the setup wizards and admin tools (AM-03, AM-13), screenshots, README, ROADMAP. One batch
engine: everything extends `src/core/batch.ts`. New switch "Batch additions" (`batchAdditions`,
screens only, on). Programs for machines other than the main one have their own switch "Write
programs for other machines" (`batchMachinesOutput`), **off**.

## M2.9a other machines and process steps: what was built

| Spec ID | What | Where |
|---|---|---|
| AM-08 | **Machines and process steps** (Machine page): the main machine stays as it is; others are added as a copy of the main machine or of the placeholder N-200, each with its **own complete profile** (tool table, machine model, spoilboard, holders, aggregates, confirmations) and its own post (the woodWOP writer for now; script posts for other controllers come with M2.10, PST-02). "Edit" shows that machine on the Machine page (a blue strip says which); nesting, labels, the default cutting values and the switches stay shared on the main machine's page | `src/core/machines.ts`, `AppData.machines`, `MachinesSection.tsx`, store `machineEdit` |
| AM-08 | **Batch setups** carry the machines a part list goes to (Batch page, "Batch setup"). For each machine the same part list is nested, programmed and export-checked **with that machine's profile** (one engine: `runBatchCsv` runs `runJob` once per machine). The main machine's files stay in the order folder exactly as before; each other machine gets a sub-folder with its programs, labels, sheet maps and areas (the cut list and BOM do not depend on the machine and are written once). The report lists every machine | `runBatchCsv`, `BatchSetup`, `activeBatchSetup`, `writeBatchResult` |
| Output | Switch "Write programs for other machines" (`batchMachinesOutput`), **off**. Off: the other machines are nested and checked, the report and the Batch page say what would be written, nothing is written for them. On: their sets are written | `features.ts`, Machine page |
| Safety | A new machine starts with **every value a placeholder**: tool table and machine model marked placeholder and no confirmations carried over, even when the main machine's values are confirmed, so every value shows its Configure badge on that machine. An export-checker error on **any** machine holds back the whole order (report only), as before | `newMachineSetup` |

### Acceptance (a batch run to two machine models gives two sets of programs)

| Check | Proof | Measured |
|---|---|---|
| Two machine models, two program sets | `tests/batch-machines.test.ts` | Main N-200 (HOMAG header, tools 101-204) and a second machine (WEEKE header, tools renumbered +100, 10 mm cut-out tool T201): 1 set in the order folder, 1 in `WEEKE-second/`, every MPR read back without errors, the right header and only that machine's tool numbers in each |
| Main machine unchanged | same | The order folder's files with the main machine alone, with an explicit main-only setup, and with a second machine added are byte-identical; all earlier batch tests unchanged |
| Switch off | same | The second machine is nested and checked (sheets counted) but nothing is written for it; report and warning say so |
| Errors hold the order | same | Second machine's table 2000 x 1000: `OFF_TABLE` on that machine only, the order blocked, report only |
| Missing machine | same | A setup naming a removed machine runs the rest and reports it |
| On disk | same | The order folder gets a `WEEKE-second/` sub-folder with one MPR per sheet |
| New machine is all placeholder | same | With every main-machine value confirmed, a copy still has its 49 values to configure; saving and loading keeps the machines and setups |

### Limits recorded

- **Only woodWOP machines** for now. A machine with another controller needs a script post (M2.10, PST-02).
- **A process step gets a full program set** like a machine; splitting operations between steps (for example drilling on one machine, cutting out on another) is not built. It would change what each machine cuts, so it waits for the owner (decision 2 below).
- **Other machines are used by batch runs only.** The job page's Output tab still writes for the main machine.
- **Custom-part operations are generated per machine**: an operation that picks its tool automatically picks from that machine's table; an operation with a fixed tool number needs that number on the other machine, or its check fails.

## M2.9b SQLite storage option: what was built

| Spec ID | What | Where |
|---|---|---|
| AM-06 | **Shop data storage** (Settings): the JSON file stays the default. The SQLite option keeps the shop data in `cabinet-studio.sqlite` beside it: materials, tools (of every machine, by machine) and jobs are tables of their own with their main facts as columns (code, name, thickness, tool number, diameter, job number, customer, ...) so other programs can query them; everything else is one JSON shell in a `meta` table. The app then loads from the database (so a change made there by another program is what the app sees) and every save writes the database in one transaction **and still writes the JSON file** beside it, so backups, the blob clean-up and switching back keep working. Switching either way copies the data first; switching to SQLite builds the file beside the old one, reads it back, compares it with the shop data and only then swaps it in | `src/core/shopDb.ts`, `electron/shopStore.ts`, `electron/main.ts`, `StorageSection.tsx` |
| Import / export | "Export to a database file" (any time) and "Import from a database file" (shows what the file holds and what it replaces, then asks) | same |
| Batch | The folder watcher loads from whichever store is in use; `npm run batch -- ... --data shop.sqlite` reads a database file | `electron/batchWorker.ts`, `scripts/batch.ts` |
| Engine | Node's **built-in SQLite** (`node:sqlite`; Node 22 in the tests, Node 24.21 inside Electron 44, checked by running the store in Electron's own Node). No new dependency and nothing to compile, so the Windows and Mac builds need no native module. The spec suggested better-sqlite3 (MIT), which would need a native build per platform; the built-in one does the same job. | - |

### Acceptance (the SQLite option round-trips the shop data without loss; JSON stays the default)

| Check | Proof | Measured |
|---|---|---|
| Lossless | `tests/shop-db.test.ts` | Shop data with the sample job, a custom part with an operation, the part library, a second machine with its own tools, batch setups, a price of 0.1 + 0.2, 1e-9 and 12345678901234 in text, quotes, backslashes, line breaks and non-English letters: written and read back **byte-identical** as JSON (compact and indented, so every key in its place); also through a file on disk |
| Rows are real tables | same | Material codes, tool numbers per machine and job numbers / customers read with plain SQL match the shop data; the shell holds no copy of them |
| Saves replace, outside edits are seen | same | A save with fewer jobs leaves no old rows; a price changed with SQL is read back |
| Bad files | same | Not ours, a newer layout, a missing file and a non-database file are refused with a plain message |
| JSON default, switching both ways | same | A new data folder uses JSON; switch to SQLite and back: same data each way; saves in SQLite mode write both files; an edit made in the database by another program survives switching back |
| Batch runner | same | `npm run batch -- run ... --data shop.sqlite` writes the programs |

### Limits recorded

- **Desktop app only.** The browser preview keeps its data in browser storage.
- **Only one program should write the database at a time.** Another program may read it any time; if it changes rows while the app is open, the app's next save overwrites them (the app reads the database when it starts).
- **Backups stay JSON** (every 10 minutes of saving, as before): they hold the same data.

## M2.9c assemblies, fittings by face and batch steps: what was built

| Spec ID | What | Where |
|---|---|---|
| AM-09 | **Assemblies** in part lists: an `assembly` column; panels of one assembly are kept together on a sheet when they fit (as a kit, unless a kit is given) and their labels show the assembly instead of "Custom" | `parseBatchCsv`, `CamPart.assembly`, `expandJob` |
| AM-09 | **Fittings by face**: a row of type `fitting` puts a library hardware item (`hardware`, by code) on a panel (`panel` = its item number, same assembly) on a face: `top`, `bottom` (underside), `front` (the Y = 0 edge), `back`, `left` (the X = 0 edge) or `right`, as the panel lies face up on the machine. Top and bottom fittings are placed from an `edge` (default front); `at` is the distance along that edge, in the same running direction as the Parts designer's "Place hardware holes"; `mirror` gives the other hand. The holes come **only** from the hardware's verified or approved drilling pattern, placed by the same function the designer uses (bottom: the pattern's top-face holes go to the underside, same places), with the same drilling operation. A fitting with no approved pattern goes in the BOM only (said in the report). Nothing is assumed: a drilled fitting without `at`, an unknown face, edge, panel or hardware is a row problem | `src/core/fittings.ts`, `patternDrillOp` (shared with `PatternDialog`) |
| AM-09 | BOM counts every fitting (its quantity x the panel's); the report lists each assembly with its panels and fittings | `fittingBom`, `orderReport` |
| AM-10 | **Batch steps** at two points of the one engine, for every machine of the setup: **after nesting** (they can report or hold the order back) and **before output** (they can add report files). They get a frozen copy of the job, nest and programs, so they cannot change what is cut; a step that tries, fails, or adds a program file (`.mpr`, `.nc`, ...), a file with a folder or one that already exists, holds the order back with the reason | `src/core/batchSteps.ts`, `runBatchCsv` |
| AM-10 | Built-in step **Waste areas**: each sheet's sheet, parts, remnant and scrap areas, scrap percent and the remnant pieces (sizes) in `<order>_waste-areas.csv`; a warning when a sheet is over half scrap. It does not cut the waste (that would be new machine output) | `WASTE_AREAS_STEP` |
| AM-10 | **Plugin-provided steps**: `registerBatchStep` adds a step to the list the Batch page shows; M2.10's plugin API will call it from its sandbox | `registerBatchStep`, `batchSteps` |
| Screens | Batch page: steps per setup (check boxes), the new columns explained, the example list has an assembly and a fitting | `BatchPage.tsx` |

### Acceptance (spec: batch input carries assemblies and fittings placed by panel face; hooks after nesting and before output; waste areas; plugin steps)

| Check | Proof | Measured |
|---|---|---|
| Holes where hand numbers put them | `tests/batch-assemblies.test.ts` | Cruciform plate (±16, 37 in, Ø5 x 11) on a 720 x 560 side, top face from the front edge at 100: holes at (84, 37) and (116, 37), face 1. On the bottom face: same places, face 6. On a 720 x 300 side's left edge at 100: (37, 184) and (37, 216). Hinge cups (20.5 in, Ø35 x 13.5) on a door's front edge at 100 and 616: (100, 20.5) and (616, 20.5). The designer's placement of the same pattern gives the identical holes |
| Rows checked, nothing assumed | same | Unknown hardware, bad face, bad edge, drilled fitting without `at`, missing panel, panel number in two assemblies: each a row problem with a plain message |
| Batch run | same | Order written; every program reads back clean; BOM: plate 4 (2 sides x 1 + 1 side x 2 copies), cups 2, dowels 4; report lists assemblies and fittings ("BOM only" for the dowels); labels show "Base B1" / "Wall W1"; with custom-part output off the order is held back as before |
| Waste areas add up | `tests/batch-steps.test.ts` | Per sheet the CSV equals the area module on the same nest (to 0.001 m²); parts 2.6928 m² by hand; every other file byte-identical to a run without the step |
| Hooks | same | After nesting: a step holds the order back with its reason (report only). Before output: a step adds a report file and a warning. A step that changes the programs fails (frozen copy) and holds the order; adding `extra.mpr`, an existing name or `../escape.txt` is refused. Steps run for each machine (waste areas in the order folder and in `Second/`). Unknown step: warning. Registration adds and removes a step |

### Limits recorded

- **Face words follow the part model's own face numbers** (`src/cam/types.ts`: 1 top, 2 front edge at Y = 0, 3 right edge, 4 back edge, 5 left edge, 6 underside), and `at` runs along an edge from its left end seen from outside the panel, as edge faces and the designer already do. A part list from another program may still name faces differently (decision 3 below).
- **Edge fittings** (front/back/left/right with edge bores) are drilled only if the machine has a horizontal drill unit; the N-200 profile has none, so the export checker treats them as today (edge holes listed for manual drilling).
- **Waste areas are reported, not cut.** Cutting waste into small pieces would be new machine output with its own switch; not built (decision 4 below).
- **Plugin steps** need the plugin API and sandbox of M2.10; today only built-in steps (and steps registered in code) exist.

## M2.9d wizards and admin tools: what was built

| Spec ID | What | Where |
|---|---|---|
| AM-03 | **Batch-setup wizard** (Batch page → New batch setup): name, machines, outputs, extra steps, then a check: a small list (shelves, a door, a cabinet side with a hinge plate) runs through the one batch engine with the new setup in the background worker, and the result is shown; nothing is saved or written. "Create and use" adds the setup and makes it the one in use. A setup picker appears on the Batch page once there are several | `src/core/wizards.ts`, `BatchSetupWizard.tsx`, `src/core/batchExample.ts`, `batch.worker.ts` |
| AM-03 | **Layer-rule wizard** (Library → Machining rules → New table with the wizard): name; layer names typed or read from a DXF; for each layer the machining (a recipe or "leave alone") and depth from the name, starting from what the shop's first rule table does with that name (its shape filter kept); the outline layer and turning; a check that applies the new table to the drawing (operations made, layers left over). Layer names become exact rules (names with `*` or `?` stay exact) | `wizards.ts`, `RuleSetWizard.tsx` |
| AM-13 | **Tool-change order** (Machine page): the order "Order by tool" in the designer uses; per machine; nothing is reordered unless that button is pressed | `toolOrderOf`, `ToolOrderSection.tsx`, `OpsPanel.tsx` |
| AM-13 | **Missing-recipe report** (Settings → Admin tools, CSV): rules and door styles pointing at deleted recipes, empty recipes and rule tables, and shapes in jobs and the part library that no operation machines (the part outline and construction layers do not count) | `missingRecipeReport` |
| AM-13 | **Password on the defaults** (Settings → Admin tools): the Machine page (every machine) and the Machining rules tab show everything but cannot be changed until the password is entered for the session; set, change (needs the current one), remove, lock now. Stored as a salted SHA-256, never the password. Said plainly on screen: it is not security, the data file can still be edited. Configure badges still show and still open their field; unlocking makes it editable (the standing rule) | `admin.ts`, `AdminLock.tsx`, `AdminSection.tsx` |
| AM-13 | **Hide screens** from the side bar (Custom parts, Library, Batch runs, Machine & tools; never Jobs or Settings); they come back while unlocked, and the placeholder banner still opens the Machine page | `hiddenScreens`, `App.tsx` |

Also fixed: the batch report printed unmatched layers as "[object Object]" (Stage 1); it now
names each layer with its shape count.

### Acceptance (wizards create setups that pass the existing batch tests)

| Check | Proof | Measured |
|---|---|---|
| Batch-setup wizard | `tests/batch-wizards.test.ts` | Each step's checks (name, duplicate name, no machine, unknown machine, no output, unknown step). A wizard setup runs the Stage 1 batch test list: statuses done / done, the C8 folder, part count and file names, and **every file byte-identical** to the run without a setup; with custom-part output off, held back exactly as before |
| With two machines and a step | same | Two program sets, the same program names for each machine (sheet programs and the door's turned-over program), waste areas in both folders |
| Shipped lists | same | The Batch page's example list reads with no row problems; the wizard's check list runs done with output on, held back with it off |
| Layer-rule wizard | same | Layers read from the Stage 1 test drawings: CUTOUT, POCKET_D8, DRILL_5_12 (and NOTES left alone); suggestions match the shop table (profile, pocket 6 with depth from the name, drill with depth from the name); the new table, used as the only table **or** named in a rules column next to the shop table, gives MPR files **byte-identical** to the shop table's, with no unmatched layers |
| Admin tools | same + browser check | Tool order (saved order first, unknown and repeated numbers dropped, move up/down; "Order by tool" follows it, unchanged without one). Missing-recipe report on a deleted pocket recipe, an empty recipe and table, a door style without its recipe and a part's unmachined pocket. Password: salted hash, right / wrong / none, under 4 characters refused. In the browser: with the password set, the Machine page's switches and fields are disabled and a click changes nothing |

### Limits recorded

- **The password is a guard against accidents**, not security.
- **The wizards make setups and tables; editing them later** uses the existing screens (Batch page, Machining rules tab).
- **Folder-watcher folders** are still one pair (Batch page); the setup in use decides what each list gets.

## M2.9 screenshots

`docs/screenshots/stage-2-3/M2.9/` (browser preview, Playwright; 03 from the desktop app under Xvfb):

- `01-other-machine-editing.png`: a second machine being edited on the Machine page (blue strip), its 49 values to configure, the machine list.
- `02-batch-setup-machines.png`: the Batch page's setup card with both machines ticked; programs for the other machine checked, not written.
- `03-storage-sqlite.png`: Settings → Shop data storage in the desktop app, switched to SQLite.
- `04-batch-steps-and-assemblies.png`: a part list with an assembly and fittings run with the Waste areas step (waste-areas CSV among the files).
- `05-batch-wizard-machines.png`: batch-setup wizard, machines step.
- `06-batch-wizard-check.png`: batch-setup wizard, check step: held back by the export checks while custom-part output is off, for both machines.
- `07-rule-wizard-machining.png`: layer-rule wizard, machining per layer read from a DXF.
- `08-rule-wizard-check.png`: layer-rule wizard, check on the drawing (3 operations, NOTES left over).
- `09-admin-tools.png`: Settings → Admin tools (password, hidden screens, missing-recipe report).
- `10-machine-locked-tool-order.png`: the Machine page locked (strip, disabled fields), the tool-change order, Custom parts hidden from the side bar.

## M2.9 test-suite note

The known timing test `tests/perf.test.ts` "adaptive clearing per Z level" (limit 90 s with the
whole suite running) failed once more by timing alone in this container: 92.3 s on the untouched
baseline and 93.2 s on the final M2.9d run, with everything else green; it passed in the full
suite on the M2.9a, M2.9b and M2.9c runs. Run on its own it passes (66.4 s on the baseline,
66.1 s after M2.9d). The limit was not changed. One unrelated test (the M2.4c holder collision
case) timed out once at 5 s while screenshots ran alongside, and passed in every later full run.

## M2.9 licences

No new dependencies. The SQLite option uses `node:sqlite`, built into Node (22 for the tests and
command line) and into Electron 44's Node 24; SQLite itself is public domain. Everything else is
our own code on the existing libraries.

## M2.9 decisions needed (see the report)

1. **Other machines**: does the shop have, or plan, a second machine or a separate drilling step?
   Until then programs for other machines stay off and every value on a new machine is a
   placeholder with a Configure badge.
2. **Process steps that share the work** (for example drilling on one machine, cut-out on the
   other): wanted? Today each step gets the whole program set.
3. **Face words in part lists**: they follow the app's own face numbers (top = face 1, face up;
   bottom = face 6, underside; front = face 2, the Y = 0 edge; right = 3; back = 4; left = 5).
   If the shop's part lists will come from another program, send one sample so we can check it
   uses the same words. Custom-part output stays off until then.
4. **Waste areas**: report only (as built), or also cut large scrap into pieces for the vacuum and
   dust extraction? Cutting would be a new output with its own switch, off.

## M2.10 split

M2.10 is done in named parts, each green, pushed and recorded here before the next starts:
**M2.10a** the plugin sandbox and API (API-01: menu items, batch hooks, grants, macro recorder);
**M2.10b** script posts (PST-02) on the one post path; **M2.10c** reading programs back (NEW-22,
G-code and our own MPR into toolpaths for the simulator); **M2.10d** the program manager and
editor (PST-04), screenshots, README, ROADMAP. New switch "Plugins and program tools" (`plugins`,
screens only, on). Script-post output gets its own switch, off (M2.10b).

## M2.10a plugin sandbox and API: what was built

| Spec ID | What | Where |
|---|---|---|
| API-01 | **Sandbox**: each plugin runs in its own QuickJS interpreter compiled to WebAssembly (MIT). Inside it there is no `require`, `fetch`, `process`, window or file access; the only way out is the `cs` object, and everything crosses as JSON copies. Each run is stopped after 5 s and at 64 MB (QuickJS's own count); random numbers repeat from run to run | `src/cam/plugin/host.ts`, `prelude.ts`, `quickjs.ts` |
| API-01 | **Grants**: a plugin's header (comment lines, read without running it) *asks* for folders to read or write, https hosts and machine output; the owner ticks what is granted (only what was asked). Paths are normalised (no `..` climbing, Windows paths without case, `C:/Shop/Lists2` is not inside `C:/Shop/Lists`); hosts must match exactly, https only, no redirects. Every refusal is logged. Grants belong to the exact code (SHA-256): new or changed code starts switched off with nothing granted, and code that does not match its hash will not start. The desktop app's main process checks the grants again on the real file system (following links, so a link in a granted folder cannot lead out) | `access.ts`, `manifest.ts`, `src/core/sha256.ts`, `electron/pluginIo.ts` |
| API-01 | **Typed API** (`cs`): part (shapes, operations, layers, fields), geometry (rectangles, circles, polylines, offsets, booleans, areas, lengths), operation kinds and defaults, the tool table (read only, marked placeholder), units, files and network (with grants), menu items, batch steps, script posts (M2.10b). Reference for authors: `api.ts`, offered on the Plugins screen as `cabinet-studio-plugin.d.ts`; a test keeps it and the sandbox in step | `api.ts` |
| API-01 | **Menu items**: the part designer's new Plugins menu and a Plugins menu on the job page. A designer command works on a copy of the part; the copy is checked before it replaces the part as one undo step: well-formed shapes and operations, operations only on shapes that exist, and a plugin cannot confirm a value (Configure badges stay), approve a draft, mark a toolpath up to date or change 3D models; every operation it adds or changes is calculated again. Job commands are read only and may offer a text file to save (never a program). Commands run in a background worker, so the screen never waits on a plugin | `partEdit.ts`, `PluginMenu.tsx`, `JobPluginMenu.tsx`, `src/app/plugin.worker.ts`, `src/app/plugins.ts` |
| API-01 / AM-10 | **Batch hooks**: a plugin's `cs.batch.step` is a step of the one batch engine, chosen per batch setup like the built-in ones (Batch page and the setup wizard list them). It sees a copy of the order (parts, sheets, programs by name, export-checker results), can report, hold the order back and add report files; it cannot add a program (the file-name check now also refuses names Windows would save as a program, such as `x.mpr.`), a folder or an existing name. A plugin that cannot start holds back orders whose setup uses its steps. Runs in the page's batch worker, the desktop folder watcher and `npm run batch` | `steps.ts`, `runSteps(..., extra)`, `batchStepChoices`, `electron/batchWorker.ts`, `scripts/batch.ts` |
| API-01 | **Macro recorder**: Plugins → Record a macro; stop and save: what changed (shapes, operations, layers, part fields, operation order) becomes a plugin with one command that makes the same changes, through the API, in the sandbox | `recorder.ts` |
| Screens | Settings → Plugins: install a file, add the sample, switch on (starts it once to list what it adds), grants per request, what it adds, check, show code, save as file, remove, the session log of refusals; locked while the admin password is set. Machine page: switch "Plugins and program tools" | `PluginsSection.tsx` |
| Sample | `examples/plugins/sample-shop-tools.js`: a designer command (pocket the closed shapes on layer POCKET), a job command (parts list as text), a batch step (sheet-use check and a parts summary CSV) and a command that reads `C:/Shop/Lists/prices.csv` (asked for, not granted by default) | - |

### Acceptance (a sample plugin adds a menu item and a batch hook and is denied file access it was not granted)

| Check | Proof | Measured |
|---|---|---|
| Menu item and batch hook | `tests/plugins.test.ts` | The sample lists 3 menu items (2 designer, 1 job) and 1 batch step. Its designer command adds one pocket on the 2 closed POCKET shapes (the open one left out); the other operation keeps its state; the new one has no confirmations and is calculated again. Browser check: the same from the Plugins menu, undo takes it back |
| Batch hook in the one engine | same | Order P1 (2 shelves, 1 side): the step's warning ("sheet 1 (PB18-WHT) is only n % used") and `P1_parts-summary.csv` (3 parts); **every other file byte-identical** to the run without the step. Also run end to end through the built desktop folder-watcher thread (`dist-electron/batchWorker.cjs`): the plugin's file written, an ungranted read refused and logged |
| Denied what it was not granted | same | Without the grant: the price-list command fails with "Reading C:/Shop/Lists/prices.csv was not granted", the file is never read, the log has the refusal. With the grant: read, 3 lines. Also refused: `C:/Shop/Lists/../Accounts/pay.csv`, a relative path, writing with only a read grant, listing the parent folder, an ungranted host and http to a granted host (6 of 6, each logged) |
| Sandbox | same | No `require`, `process`, `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `window`, `document` or the bridge function; `cs` frozen. An endless loop is stopped (0.3 s test limit) in set-up and in a command, and the plugin still answers after; a memory grab is stopped at 64 MB |
| Plugin output cannot reach the machine | same | A step adding `extra.mpr.` or `../up.txt` holds the order back (report only); a plugin that cannot start holds back orders that use its steps; a switched-off plugin's step is reported as not available |
| Saved and loaded | same | Plugins and grants survive JSON loading (the loader used to drop unknown keys: fixed) and the SQLite option |
| Recorder | same | 7 kinds of change recorded and replayed on the starting part: identical to the recorded part. Replayed twice: the second run's shape and operation get new ids and the operation follows its shape |

### Limits recorded

- **Batch steps cannot wait for the network** (the batch engine runs straight through); file access in batch steps works in the desktop app and `npm run batch`, not in the browser preview.
- **The browser preview has no files or network for plugins**; only the desktop app does.
- **The 64 MB limit is QuickJS's own count**; all plugins share one WebAssembly memory of at most 2 GB.
- **A recorded macro replays changes**, not the commands that made them (for example "offset by 5 mm" is recorded as the resulting shape).
- **Two copies of the 0.5 MB WebAssembly** are in the built app (the bundler copies the package's own, unused); harmless.
- Plugin set-up code (outside its commands) should not use files or the network.

### Test-suite note (M2.10)

This run's container is about 1.8 times slower than earlier ones. On the untouched baseline the
known timing test "adaptive clearing per Z level" took 169 s in the full suite and **119 s run on
its own** (limit 90 s; 66 s alone on earlier runs), so it fails here by time alone; the limit was
not changed. Three heavy geometry tests also hit vitest's 5 s default timeout (alone too); they now
have the 60 s their neighbours already had (`deefe9e`, no assertion changed). Everything else is
green.

### Licences (M2.10a)

New: `quickjs-emscripten-core` 0.32.0 and `@jitl/quickjs-wasmfile-release-sync` 0.32.0 (MIT,
Jake Teton-Landis; contains QuickJS, MIT, Fabrice Bellard and Charlie Gordon); their only
dependency `@jitl/quickjs-ffi-types` 0.32.0 is MIT. The WebAssembly ships unmodified as
`vendor/quickjs/emscripten-module.wasm` with its licence; About screen and
`THIRD_PARTY_NOTICES.md` updated.

## M2.10b script posts: what was built

| Spec ID | What | Where |
|---|---|---|
| PST-02 | **One post path for text programs**: `postInput(...)` turns toolpaths into plain data (operations in run order, tool, spindle speed, every move with Z from the top, feeds per move, arc centres absolute and as I/J). The built-in template post now reads it (output byte-identical to before, proved against a frozen copy of the old code), and so do script posts. The woodWOP writer stays the built-in path for the N-200 | `src/cam/post.ts` |
| PST-02 | **Script posts**: a plugin adds `cs.post.add({ id, name, ext, run(input) })`; `run` gets the post input in its sandbox and returns the program text (checked: text, no NUL, at most 50 MB; stopped after 5 s like any plugin code) | `src/cam/plugin/posts.ts`, `prelude.ts` |
| PST-02 | **Which machine**: a machine other than the main one can use the woodWOP writer, the sample template post or any switched-on plugin's script post (Machine page → Machines and process steps). Not the N-200: the main machine always uses woodWOP, and text posts cannot be chosen for a machine whose model or name still says N-200 (every new machine starts as a copy of it, so the owner must name the other machine first) | `MachinesSection.tsx`, `isN200` |
| PST-02 | **Export checker for text posts** (`checkTextPost`, in `validator.ts`): writing is refused for the N-200; while the new switch "Write programs through script posts" (`scriptPostOutput`) is **off**; without the plugin's machine-output grant, or with the plugin off or missing; for work a G-code post cannot describe (edge drilling, drilling from the underside after turning the part, edge work with an aggregate, saw cuts without a saw unit, 3D without 3D milling in the machine model, and any toolpath without a confirmed program form); and every error of the job's own export check for that machine is kept (so custom-part output off still blocks) | `src/core/validator.ts` |
| PST-02 | **Program dialog**: "Program for" picks the N-200 (woodWOP, as before) or another machine's text post: the part's toolpaths with that machine's tools, the post's text, and the checks. "Save program" only when every check passes | `ProgramDialog.tsx`, `planPartPost` |
| Batch | A machine with a text post never gets woodWOP files in batch runs: its set is nested and checked, then held with a plain reason (batch runs do not write sheet programs through text posts) | `runBatchCsv` |
| Sample | `examples/plugins/iso-router-post.js` (also "Add the sample script post" on the Plugins screen): the same G-code as the built-in template, as a starting point for another controller; asks for machine output | - |

### Acceptance (a sample script post's output equals the built-in template post's on the reference parts)

| Check | Proof | Measured |
|---|---|---|
| Script post = template post | `tests/script-posts.test.ts` | All **44 reference parts** (the 20 Stage 1 parts and the 24 M2.6 parts: saw, facing, chamfer, curve, hand-drawn, edge): the sample script post's text equals the built-in template post's, byte for byte (216 KB of G-code), same file type |
| One post path, nothing changed | same | The template post on the shared post input equals the old template post on all 44 parts, with the top at 0 and at 19 mm (over 5,000 lines) |
| Never the N-200, never unsupported work | same | Main machine and a copy still described as an N-200: refused. Switch off, plugin missing / off / ungranted / without the post: each refused with its own message. Edge drilling, turned-over drilling, aggregate edge work, saw without a saw unit, 3D without 3D milling, no confirmed form: each refused; the M2.6 edge parts are refused |
| Writable only when all is clear | same | A part through the script post on "Router two": refused with the switch off (and the job's own custom-part output check kept); with both switches on and the grant: writable, text equal to the template post, `G81 X40.000 Y40.000` present. Browser check: preview shown, "Save program" disabled with the reasons listed |
| Batch | same | Two machines (main + one with a template post), every output switch on: main written, the other held with its reason, no files in its folder |
| Bad script posts | same | Returning a number, NUL text, a missing post, an endless loop: each refused |

### Limits recorded

- **Text posts write single parts** (from the Program dialog), not nested sheets: sheet programs for another controller would need the cabinet side's drilling and cut-outs as toolpaths too. Not built; the owner has no second machine (decision of M2.9).
- The template post's I/J can read `-0.000` for tiny negative values (as before M2.10; unchanged on purpose so the output stays identical).
- Rotary, tilted (3+2) and 5-axis work do not exist yet (Stage 3); `checkTextPost` is where their machine-model checks go.

## M2.10c reading programs back: what was built

| Spec ID | What | Where |
|---|---|---|
| NEW-22 | **G-code reader**: G0/G1/G2/G3 (I/J relative or absolute with G90.1, or R for short and long arcs), helical arcs, G17, G20 inches, G21, G90/G91, canned drilling G81/G82/G83 with G98/G99, repeats and G80, T and M6 tool changes (or T alone when a program has no M6), S, F per move, comments in brackets (brackets inside a comment, as in our tool names, stay with it) or after ";", line numbers, "%", block delete, M30/M2 end. Into the one toolpath IR: **one toolpath per tool change**, named from its comment, the tool taken from the tool table by number, feeds kept per move. Where it would draw wrongly it refuses with the line (arcs in G18/G19, G92/G52 shifts, incremental drilling cycles, arcs without a centre, unreadable words); what it ignores is listed (work offsets, G28/G53, cutter compensation G41/G42 drawn on the programmed line, unknown codes, an arc end off its circle, a tool not in the table) | `src/cam/programRead.ts` |
| NEW-22 | **Our own MPR read back** (`mprRead.ts` underneath): contour milling with its radius correction applied (the tool centre offset by the tool radius to the side RK says), heights from woodWOP's (above the table) to ours (below the top), passes, vertical and horizontal drilling, rectangular pockets as clearing rings, saw grooves; the workpiece size (also when given through the program's variables L, B, D); consecutive macros on one tool share a toolpath. woodWOP's own approach and leave moves are drawn as a straight plunge and lift (said) | same |
| NEW-22 | **Read a program** (Custom parts page): pick a G-code or MPR file; it is read in the background worker; the toolpaths, tools, moves, cutting length and minutes, the refusals and warnings, the stock size (from the MPR's workpiece, or as far as the G-code's cutting moves reach, editable) and where the G-code's Z0 is (top of the stock or the table); then the simulator (backplot, stock, collision check) on it | `ProgramReadDialog.tsx`, compute task `program.read` |
| Fix | **Template post: helical entries at the plunge feed.** Arcs the toolpath marks as plunging (helical entries of pockets) were written with the cutting feed, faster than the toolpath and the simulator use. Now the plunge feed (the safe direction). Measured on the 44 reference parts: 184 lines differ from the Stage 1 template post, all feed words of helical entries in ref07, ref08, ref10 and face01 and the feed word right after them; nothing else changed. The N-200's MPR output is not affected | `postInput` |
| Fix | **Text posts refuse an operation without one tool** (for example holes drilled by diameter): the template post writes no tool change for it, so a G-code machine would drill with whatever tool is loaded. Found while reading programs back | `checkTextPost` |

### Acceptance (G-code reads back and simulates)

| Check | Proof | Measured |
|---|---|---|
| Reads back | `tests/program-read.test.ts` | All **44 reference parts** through the template post and back: 7,244 lines, 6,627 moves, every move the same kind within 0.0005 mm (3 decimals written), arc centres within 0.0015 mm, drill R and peck exact, **every feed the same**; in the 38 programs where every operation has its tool, each operation is its own toolpath with its tool and name, and **writing it again gives the same program byte for byte**. The one extra move is the post's own lift to Z50 after the spindle stops |
| Simulates | same | 8 parts (one tool per operation): the same number of operations, cutting length within 10 ppm, time within 1 % (drill dwells are not in the template's G-code), **removed volume within 0.1 %** (ref02 32.9 cm³ ... ref08 502.0 cm³). Browser check: a 782-line pocket program read and simulated with the collision check |
| Hand-written G-code | same | Inches, incremental moves, R arcs both ways, absolute centres, a peck cycle with repeats and G99: positions, feeds (2,540 / 508 mm/min) and three holes where expected; it simulates. Tool changes split and name the toolpaths; refusals and warnings as listed above |
| Our MPR | same | Reference parts: every vertical hole at its place and depth; 14,103 contour points on the tool-centre path woodWOP follows (profiles: the toolpath; pockets: the native contour passes the MPR holds), at the passes' depths, worst 0.054 mm (see the note below). Full circles read back exactly round. The sample job's sheet programs read back with no errors, every drilling macro a drill move, and simulate |

### Note for the owner: half circles in MPR (decision 1 in the report)

MPR arcs are written with their end points and radius only, to 4 decimals. Our writer writes every
full circle as two exact half circles, and splits every arc over 180 degrees into two arcs just
under 180 degrees. For such arcs the centre is poorly fixed by end points and radius: rounding alone
can move it by about **0.05 to 0.07 mm** (measured: 0.067 mm on an 80 mm half circle, 0.054 mm on a
9 mm ring of a spiral pocket). Our reader treats exact half circles as exact; how woodWOP treats them
is not known. Writing such arcs in pieces of at most 90 degrees would remove the doubt, but changes
the MPR output and its approved golden files, so it waits for the owner. Nothing changed in the
writer.

### Limits recorded

- **G-code is one plane (G17)**, no coordinate shifts, absolute drilling cycles only; cutter compensation is drawn on the programmed line (warned).
- **Programs from other software** read as far as these codes go; dialects with macros, variables or subprograms are not read (their words are refused with the line).
- **MPR: our own macros only** (what our writer produces); other woodWOP macros are listed as not drawn.
- **Large programs**: read in the background worker; the simulator's limits are those of M2.4.

## M2.10d program manager and editor: what was built

| Spec ID | What | Where |
|---|---|---|
| PST-04 | **Program list** (job → Output → Programs): the job's programs as the job makes them (sheet programs, flip-side and turned-over programs), each marked as generated, edited by hand, or edit out of date, with why it cannot be copied yet | `ProgramManager.tsx` |
| PST-04 | **Editor**: the program with line numbers; **simple maths on values**: one G-code word (X, Y, Z, F ...; comments left alone) or one MPR key (XA, TI, ZA, X / Y in contours; XA is not X), add / subtract / multiply / divide / set, on all lines or a range; each number keeps its decimals (at least three when the result needs them), the line ends stay. **Check** (reads back with no refusals; cutting moves on the table, a tool radius beyond its edge allowed for outside cuts; not deeper than the stock plus the spoilboard allowance; tools from the table), **Simulate** (read back and the simulator), back to the generated program, **keep the edit** with the job | `src/core/programEdit.ts` |
| PST-04 | **Edits belong to the program they were made on** (SHA-256 of the generated text): when the job changes the program, the edit is marked out of date and is not used | `Job.programEdits`, `programState` |
| PST-04 | **Copy to the machine folder** (new setting on the Machine page, "Machine folder"): programs as generated follow the export rules (no export-checker errors, the "simulate in woodWOP" tick); the app asks before replacing a file there. Programs edited by hand also need the new switch "Copy hand-edited programs to the machine folder" (`editedProgramOutput`, **off**) and a clean check of the edited text. The job's normal export still writes the generated programs | `copyProblems`, `files:existing` (desktop) |

### Acceptance (spec: list generated programs, open them in a text editor with line numbers and simple maths on values, copy to the machine folder)

| Check | Proof | Measured |
|---|---|---|
| Maths on values | `tests/program-manager.test.ts` | G-code: Y + 5 on 4 of 5 lines (the comment's "Y100" and the ";" comment untouched), decimals kept (25.5, 5.25, `Y-4.000` → `Y1.000`, `X.5` → `X-.5`), F × 0.8 = 800, F × 0.3333 = 333.300, a line range. MPR: TI + 1 on every TI (216 on the S02 sheet), X + 10 on every contour X and no XA; quotes and CRLF kept. Bad key, divide by 0, no number: refused |
| Checks on an edited program | same | The generated sheet and G-code pass; TI deeper than stock + allowance, X moved off the table, an unknown tool: each caught with a plain message. Browser check: TI + 0.5 on S02 → "16 cutting moves go deeper than 18.50 mm below the top" |
| Copy rules | same | Generated: copyable with a folder, no errors and the tick; each missing piece named. Edited: switch off → refused; no check yet → refused; check with problems → refused; all clear → allowed. Out of date → refused |
| Screens | browser (Playwright) | Program list, editor with maths and check, copy buttons disabled with the reason (screenshots 11, 12) |

### Limits recorded

- **Copy is a plain file copy** into the machine folder (the desktop app asks before replacing); in the browser preview programs download as a zip.
- **Maths works in the program's own units** (mm for our programs), one word or key at a time; no expressions inside the program.
- **The check of an edited program** is as good as reading the text back: it cannot know what the edit meant (for example a moved hole that now hits another one). That is why copying edited programs has its own switch, off.

## M2.10 screenshots

`docs/screenshots/stage-2-3/M2.10/` (browser preview, Playwright):

- `01-plugins-settings.png`: Settings → Plugins: the sample plugin (asks to read `C:/Shop/Lists`, not granted, what it adds), the sample script post (asks for machine output, not granted) and a recorded macro.
- `02-designer-plugins-menu.png`: the designer's Plugins menu: plugin commands and Record a macro.
- `03-designer-plugin-command.png`: the sample's pocket command applied: a pocket on the two closed POCKET shapes, marked New.
- `04-plugin-file-refused.png`: the price-list command refused: "Reading C:/Shop/Lists/prices.csv was not granted".
- `05-macro-recorder-save.png`: saving a recorded macro as a plugin, with the changes listed.
- `06-batch-plugin-step.png`: the Batch page with the plugin's "Sheet use check" beside the built-in step.
- `07-machines-script-post.png`: a second machine ("Router two", its own model name) using the sample script post.
- `08-program-script-post.png`: the Program dialog through Router two's script post: the G-code, and why it is not written (switch off, no grant).
- `09-read-program.png`: Read a program: a 782-line G-code pocket program read back (toolpath, tool, moves, length, time, stock).
- `10-read-program-simulated.png`: the same program in the simulator, with the collision check.
- `11-program-manager.png`: job → Output → Programs, with the machine folder and why copying waits.
- `12-program-editor.png`: the editor after TI + 0.5 on a sheet program: line numbers, the maths row, the check catching the too-deep holes.
- `13-machine-switches.png`: the Machine page's switches: "Plugins and program tools" (on), "Write programs through script posts" and "Copy hand-edited programs to the machine folder" (off).

## M2.10 licences

New in M2.10a: `quickjs-emscripten-core` 0.32.0, `@jitl/quickjs-wasmfile-release-sync` 0.32.0 and
their dependency `@jitl/quickjs-ffi-types` 0.32.0, all MIT (QuickJS itself MIT). Checked with
`npx license-checker`. No GPL or AGPL. Everything else in M2.10 is our own code on the existing
libraries.

## M2.10 decisions needed (see the report)

1. **Half-circle arcs in MPR** (found by reading programs back): every full circle is written as
   two exact half circles and every arc over 180 degrees as two arcs just under 180, each given
   only by its ends and radius to 4 decimals, which fixes the centre only to about 0.05-0.07 mm.
   How woodWOP reads them is not known. Options: (a) write such arcs in pieces of at most 90
   degrees (removes the doubt; changes the MPR output and its golden files); (b) keep as is and
   check one circle in woodWOP first. Recommendation: (b) then (a) if woodWOP's circle is off.
   Nothing changed until then.
2. **Hand-edited programs to the machine**: should they ever be copied to the machine folder?
   Switch off until the owner says so.
3. **Machine folder**: the folder the N-200 reads its programs from (empty until set).
4. **Template post feed fix** (made, the safe direction): helical entries are now written at the
   plunge feed. Only affects G-code from the sample template; the N-200's MPR is unchanged.
5. **Plugins to trust**: the sample plugin and script post are examples; nothing is granted by
   default. Which plugins (if any) the shop wants, and what to grant them, is the owner's call.

## M2.11 split

- **M2.11a**: height-map readers, relief surfaces made to size and depth, mesh reliefs (base
  found and taken off), placement, the panel-round-the-relief guard in the 3D operations, the
  Import relief dialog, switch, tests and goldens.
- **M2.11b**: the Stage 2 exit test, screenshots, README, ROADMAP and this file.

## M2.11a relief import: what was built

| Spec ID | What | Where |
|---|---|---|
| ART-01 | Height-map pictures: our own PNG reader (every colour type, 1-16 bits, interlaced, palette and transparency, check sums verified) and TIFF reader (strips or tiles; none, LZW, Deflate, PackBits; 8/16/32-bit whole numbers, 32/64-bit floating point; horizontal predictor; either byte order). 16-bit pictures keep all 65,536 heights (a browser canvas would cut them to 256). Damaged files give a plain message | `src/cam/relief/image.ts` |
| ART-01 | Height map to surface: exactly the length, width and depth given (X along the picture's width, picture top at the far edge), white or black high, stretch to the picture's own lightest-darkest, point spacing (one point per pixel by default, at most 250,000 points; pixels averaged where a point covers several), smoothing passes, transparent pixels as top or bottom; warns about 8-bit steps | `heightMapMesh` in `src/cam/relief/relief.ts` |
| ART-01 | Mesh reliefs (STL, OBJ, 3MF; units from the file or chosen): a flat base under the carving is found and can be taken off (downward facets and the upright sides below the carving); the relief is made to its size and depth (X, Y and Z separately) | `checkReliefMesh`, `stripBase`, `sizeRelief` |
| ART-01 | A relief is a normal stored model (blob) already at its size, with `ModelRef.relief` (size, outline seen from above, how it was read). Placed centred or at a corner, top flush with face 1 or lower; optional Z-level roughing and parallel finishing added with the usual placeholder values (Configure badges) | `src/cam/relief/part.ts`, `src/cam/types.ts` |
| Safety | **The panel round a relief is never cut.** On a relief, 3D operations without a drawn boundary stay inside the relief's outline (not its bounding box), the M2.4a full-panel roughing never applies, and the panel face round the outline (and inside any hole in it) is added as a flat surface at face 1 that the tool drops onto. So a tool overhanging the edge, or roughing that reaches past it, stops at the face, also for a relief set below the face. A relief turned off face up is refused | `model3d`, `genRough3d`, `genFinish3d` in `src/cam/toolpath.ts`; `centreRegion` in `src/cam/3d/region.ts`; `reliefSurround`, `placedReliefOutline` |
| UI | Import relief dialog (part designer toolbar "Relief", 3D tab "Import relief…"): picture preview and details, size with proportions kept, depth (typed in for a picture: it has none of its own), picture options, base switch for meshes, placement with notes (past the edge, deeper than the part), add roughing and finishing. The 3D tab marks reliefs and keeps them face up | `src/pages/part/ReliefImportDialog.tsx`, `ModelsPanel.tsx`, `PartDesigner.tsx` |
| Workers | `relief.imageInfo`, `relief.fromImage`, `relief.checkMesh`, `relief.fromMesh` run in the compute worker with progress and cancel | `src/cam/worker/tasks.ts` |
| Switch | "Relief import" (`camRelief`, on): screens only. No new machine output: relief toolpaths follow the 3D output rules | `src/core/features.ts`, Machine page |

No file format change: the relief's size is in its stored mesh, so an older app reads the same
geometry (it ignores `relief` and would treat the model as a plain mesh). Stage 1 and earlier
goldens are unchanged; the hash of operations on plain models is unchanged.

### Acceptance (a relief-software STL and a height-map PNG import at the right size and depth and machine with the M2.2 strategies in the simulator)

| Criterion | Proof | Measured |
|---|---|---|
| Picture readers exact | `tests/cam-relief.test.ts` against files written by Pillow and ImageMagick (`tests/fixtures/relief/`, `make.py`): 8/16-bit PNG, interlaced, colour, palette, grey + alpha; TIFF none/LZW/Deflate/PackBits, tiles, big-endian with predictor, RGB, float | Every pixel exact (16-bit to 1/65535) |
| Height map at the right size and depth | same file | Bounds exactly 200 × 100 × 6.35 mm (to 0.0001 mm); black at -6.35, white at 0, mid-grey band where the picture puts it |
| STL at the right size and depth | same file: an 8 × 12 in block with a 0.75 in base, read in inches | Base found and taken off (12,928 facets of base and sides); made 250.000 × 375.000 × 8.000 mm (to 0.001 mm) |
| Machined with the M2.2 strategies in the simulator | same file: each relief centred on a 400 × 600 × 19 door, 12 mm R2 bull-nose Z-level roughing (3 mm levels, 0.5 mm stock) then 6 mm ball parallel finishing (1.5 mm step-over), simulated at 0.5 mm cells | Independent gouge check: finishing 0.0006 mm, roughing 0.0009 mm (STL) / 0.0003 mm (PNG), limit 0.005. Simulated: deepest below the relief 0.0002-0.0003 mm; most left inside 0.098 mm (theory 0.095 mm scallop). Cells cut outside the relief: 0. Collisions: none |
| The guard matters | same file: the same relief without its relief information | Roughed as a model that does not cover the panel (warning; panel cut below -5 mm); with it, nothing outside the outline is cut, also with the relief set 2 mm below the face |
| Golden digests | `tests/golden/cam3d/relief-png-parallel`, `relief-stl-rough` | New; no existing golden changed |

Speed (cloud container): a 200 × 300 16-bit picture reads in about 0.1 s and becomes a
120,000-facet surface in about 0.04 s; on that 250 × 375 mm relief, roughing takes about 1.4 s
and parallel finishing at 1.5 mm step-over about 1.6 s.

### Limits recorded

- **Relief outline**: for a mesh relief, the outline seen from above is stored simplified within
  0.01 mm. If the model is later simplified (3D tab), the outline is not recalculated; the
  change is within the simplify tolerance.
- **A relief must stay face up** (+Z up, no lay-flat turn): turning and scaling about Z are fine.
- **Base detection** assumes upright sides and a flat bottom (most relief exports). A block with
  sloping sides keeps them; the depth shown in the dialog then includes them and can be typed in.
- **The panel round a relief is always kept.** To cut a background away round a relief, draw it
  as its own pocket, or make the background part of the relief file.
- **Relief finishing to woodWOP**: parallel finishing has no woodWOP form yet (decision 2), so
  the checker stops it. Roughing and waterline can be written once their switch is on.

## Stage 2 exit test

`tests/stage2-exit.test.ts`. Spec: "an STL relief door panel and a STEP shaped part each go from
import to simulated, collision-free toolpaths and a checked MPR (MPR output still off by default),
all tests green, typecheck and lint clean."

| Part | Steps | Result |
|---|---|---|
| STL relief door | STL in inches (block with a base) → base taken off, made 250 × 375 × 8 mm → centred on a 400 × 600 × 18 MDF door → Z-level roughing (T107), finishing (T105, parallel; and a second run with waterline), cut-out (profile) → toolpaths in the compute-worker task → simulated → collision check → export checker → part program written, read back and simulated again | No gouge (0.005 mm limit, exact check); relief carved, nothing outside it cut; no collisions. Checker with the default switches: blocked (`CAM_OUTPUT_OFF`). With custom-part and 3D flat-layer output on (test only): waterline run has **no errors**; parallel run has one, `CAM_3D_NO_OUTPUT` (parallel finishing has no woodWOP form until decision 2). Program read back: same material left as the toolpaths it came from (0.0004 mm parallel run, 0.0012 mm waterline run, 1 mm cells) |
| STEP shaped door | `shaped-door.step` → feature recognition onto layers → Stage 1 layer rules choose the operations (nothing unmatched) → toolpaths → simulated → collision check → export checker → front and turned-over programs written, read back and simulated again | No collisions. Checker: blocked by default (`CAM_OUTPUT_OFF`), **no errors** with output on. Front program read back: 0.0000 mm difference; turned-over program reads back with no errors |

All tests green (774: 773 + 1 skipped), typecheck clean, lint at the 17 old warnings, build OK.
**Stage 2 is complete**, with one item that stays with the owner: writing parallel (true 3D)
finishing to woodWOP (decision 2, open question 4).

## M2.11 screenshots

`docs/screenshots/stage-2-3/M2.11/` (browser preview, Playwright):

- `01-relief-heightmap-dialog.png`: Import relief with a 500 × 750 16-bit PNG: preview, size (proportions kept), depth typed in, points, placement.
- `02-relief-on-part-3d-tab.png`: the relief on the part; the 3D tab marks it "relief · height map" and keeps it face up.
- `03-relief-operations.png`: the roughing and finishing added, roughing levels drawn inside the relief.
- `04-relief-3d-view.png`: the 3D view of the part with the relief.
- `05-relief-simulated-backplot.png`: the simulator after both operations (top view), collision check clear, placeholder values listed.
- `06-relief-simulated-material.png`: the material left, in 3D: the relief carved, the panel round it untouched.
- `07-relief-stl-dialog.png`: Import relief with an STL in inches: block with a base found, base taken off, made 250 × 375 × 8 mm.
- `08-machine-relief-switch.png`: the Machine page's new "Relief import" switch.

## M2.11 licences

No new dependency. The PNG and TIFF readers are our own; decompression uses the platform's
built-in `DecompressionStream`. The test pictures were written once with Pillow (HPND licence)
and ImageMagick (ImageMagick licence, Apache-2.0 style) by `tests/fixtures/relief/make.py`;
neither is used by the app or the tests at run time.

## M2.11 decisions needed (see the report)

1. **A real relief file from the shop's relief software**: units, with or without a base, and
   whether the edge of the relief sits at the top of the panel. One sample would confirm the
   importer's defaults (units as the file says, base taken off when found). Nothing changes
   until then.
2. **Relief cutting values**: which tools, step-overs and step-downs the shop uses for reliefs.
   The added operations use the placeholder values with Configure badges until then.
3. **Relief finishing to woodWOP**: covered by decision 2 / open question 4 (a sample 3D program
   saved from woodWOP). Until then parallel finishing is simulation only.

## M3.1 split

M3.1 is four large features, so it is done in named parts, each pushed to `main` when green:
**M3.1a** radial and spiral finishing (3D-05), the shared pass code, file format 5 and the switch;
**M3.1b** scallop finishing (3D-07); **M3.1c** flat-area and helical finishing (3D-08);
**M3.1d** undercut finishing with lollipop tools (3D-08), with a stock model that can hold
material under an overhang; **M3.1e** curve-driven finishing (3D-09); **M3.1f** screenshots,
README, ROADMAP and this file.

## M3.1a radial and spiral finishing: what was built

| Spec ID | What | Where |
|---|---|---|
| 3D-05 | Radial finishing: straight passes out from a centre (set, or the middle of the boundary), first pass at a chosen angle, inner radius left uncut, out-and-back or one way (out or in). The pass count is a multiple of 8 so the largest gap, at the outer edge, is at most the step-over; towards the centre every other pass stops where its neighbours are still within the step-over of each other (and every other one of those further in), so passes do not pile up at the centre | `src/cam/3d/radial.ts` |
| 3D-05 | Spiral finishing: one Archimedean spiral, turns the step-over apart in plan, out from the centre or in to it, counter-clockwise (climb) or clockwise; divided within 0.0005 mm of the true curve; clipped to the boundary | `src/cam/3d/radial.ts` |
| Shared | The drop sampler (slope limits, groups, protected groups), passes along any plan polyline, clipping to the boundary and the moves that join passes (stay down on short safe links, lift otherwise) moved out of parallel finishing into one module for every strategy. Parallel finishing's goldens are byte-identical | `src/cam/3d/passes.ts`, `parallel.ts` |
| Format | `CAM_FILE_VERSION` 5 (new strategies and their settings, all optional). An older app refuses a v5 part instead of machining a new strategy as parallel passes | `src/cam/doc.ts` |
| Switch | "More 3D finishing" (`cam3dFinishMore`, screens, on). None of the new strategies is written to woodWOP: the export checker blocks them with `CAM_3D_NO_OUTPUT` whatever the switches say | `src/core/features.ts`, Machine page |
| Screens | Add operation: "3D finishing (radial)" and "(spiral)"; editor with gap, first angle, centre (middle of the boundary or X/Y), inner radius, pattern, travel, turn, slope limits, rest machining. The step-over is the shop's 3D finishing step-over with its Configure badge | `src/pages/part/OpsPanel.tsx` |

### Acceptance (M2.2 tolerances)

| Criterion | Proof | Measured |
|---|---|---|
| No gouge > 0.005 mm, independent check | `tests/cam-3d-radial.test.ts` | Radial and spiral, 6 mm ball (exact check) on the hemisphere, sine relief, raised panel and cove: all under 0.005 mm and touching the surface (closest approach < 0.001 mm). Bull-nose and flat (sampled) on sine, raised panel and cove: under 0.005 |
| Stock to leave ±0.01 mm | same | 0.5 mm on sine and hemisphere, both strategies: every sampled CL point 0.5 ± 0.01 from the surface; no move closer (exact check) |
| Gaps never over the step-over | same | Radial layout checked at 400 radii for four cases: worst gap = step-over (ratio ≤ 1.000); passes lie on their rays (< 0.000001 mm) and reach the corners of the model. Spiral: every point on the spiral (turns exactly the pitch apart, < 0.001 mm), the true curve within 0.0005 mm of every straight piece |
| Boundaries clip right | same | Centre / contained / touching on a 30 mm circle, both strategies: reach 30 / 27 / 33 mm (+0.01) |
| Import to simulated stock, blocked export | same | STL dome imported in the compute worker, toolpaths in the worker, simulated at 0.5 mm cells: deepest below the model 0.0005 mm (both); most left on slopes under 45° 0.09 mm (radial) and 0.18 mm (spiral) at 1.5 mm; no collisions; export blocked with `CAM_3D_NO_OUTPUT` |
| Golden digests | `tests/golden/cam3d/{radial-hemisphere,radial-raised-panel-oneway,spiral-hemisphere,spiral-sine-bull-stock}` | 4 new; every existing golden unchanged |

### Limits recorded

- **Radial out-and-back lifts at the inner ends** where neighbouring passes start at different
  radii (more than two step-overs apart); the outer ends stay down.
- **Spiral pitch is in plan**, like parallel passes: on slopes the 3D gap is wider. Scallop
  finishing (M3.1b) is the strategy for an even finish on slopes.

## M3.1b scallop finishing: what was built

| Spec ID | What | Where |
|---|---|---|
| 3D-07 | Scallop finishing: passes offset over the surface so the cusp between neighbours is the same everywhere. The step-over is set as on flat ground (the shop's 3D finishing step-over, with its Configure badge); the editor shows the cusp it gives. Passes start from the boundary and work in (or from the middle out), or start from picked shapes (open or closed) and work away from them on both sides; loops counter-clockwise (climb) or clockwise; slope limits, skip flats and rest machining as the other strategies | `src/cam/3d/scallop.ts`, `genFinish3d` and `scallopStarts` in `src/cam/toolpath.ts` |
| Method | (1) the tool-centre surface on a grid of exact drops; (2) the distance over that surface (3D, not plan) from the start, solved by fast marching over the grid triangles plus sweeps, never interpolating across a crease where fronts from two sides meet; (3) the spacing for the target cusp at each point: on a flat R - sqrt(R² - d²/4); over a curve the chord between two passes sags below a hill (or rises in a hollow) and the spacing is solved so the cusp comes out at the target, from exact drops across the passes; (4) the distance again with that spacing, one unit per pass; passes are its whole levels; (5) a pass along every crease (corner diagonals, the middle line), because there the material is farther than half a spacing from the passes (0.59 of a spacing at a square corner); (6) a check: the distance from every pass over the surface; material more than 0.505 of a spacing from all passes gets a pass along the middle of the gap, and the check runs again | same |
| Ball and bull-nose | Ball-nose: exact cusp. Bull-nose: spaced for its corner radius (said in a warning; the cusp is then at most the target). Flat end mills and V cutters, and a step-over as wide as the rounded end, are refused with a clear message | same |
| Associativity | Start shapes are part of the stale hash (moving one marks the operation out of date); a missing start shape is reported | `opInputHash` in `src/cam/doc.ts` |
| Screens | "3D finishing (scallop)" in the Add operation menu; editor: step-over on flat ground with the cusp it gives, start from the boundary or picked shapes ("Use selection as start"), order, loop direction, slope limits, rest | `src/pages/part/OpsPanel.tsx` |

### Acceptance (scallop holds the cusp within ±10 % over the whole test surface; M2.2 tolerances)

The cusp is measured by an independent check that shares nothing with the generator
(`tests/cusp.ts`): from points on the model, along the surface normal, how much material is left
under the balls the cutting moves sweep (ray against capsule, exact). Ridges are found by walking
square to every pass, every 4 mm along it, from where the tool touched to where it touched again.
Target cusp 0.0606 mm (6 mm ball, 1.2 mm step-over on flat ground).

| Surface | Ridges measured | Highest anywhere | Between passes one level apart, away from creases, sharp turns and the innermost loops |
|---|---|---|---|
| Hill and hollow (new test surface: slopes to 22°, curving both ways), from the boundary | 5,987 | +2.5 % | 4,519 ridges, -3.0 % to +2.5 %, median -0.8 %: all within ±10 % |
| Sine relief, from the boundary | 5,953 | +3.2 % | 4,974 ridges, -4.5 % to +3.1 %, median -0.8 %: all within ±10 % |
| Hill and hollow, from a start line along one edge | 6,095 | +3.9 % | 4,716 ridges, -2.9 % to +3.9 %, median -0.7 %: all within ±10 % |

No ridge anywhere is higher than the target + 10 %. Next to creases, sharp turns of passes and the
innermost loops (where passes close in) the passes come closer than one spacing, so the ridge there
is lower (down to 15 % of the target): extra cutting, never a higher ridge. Overall 96-98 % of all
ridges are within ±10 %.

| Criterion | Proof | Measured |
|---|---|---|
| The spacing maths | `tests/cam-3d-scallop.test.ts` | On spheres of radius 15, 20, 40 and 100 mm, hill and bowl: the cusp of the spacing found is the target within 1 % (exact two-ball geometry) |
| No gouge > 0.005 mm, independent check | same | 6 mm ball (exact check) on the hemisphere, sine, raised panel, cove and the hill-and-hollow surface: under 0.005, touching the surface. Bull-nose (sampled) on sine: under 0.005 |
| Stock to leave ±0.01 mm | same | 0.5 mm on sine: CL points 0.5 ± 0.01; no move closer |
| Golden digests | `tests/golden/cam3d/{scallop-sine,scallop-bumps-outward,scallop-raised-panel-bull}` | 3 new; every existing golden unchanged |
| Export blocked | same | `CAM_3D_NO_OUTPUT` with both output switches on |

Speed (cloud container): 150 x 100 mm hill-and-hollow, 6 mm ball, 1.2 mm step-over: about 7 s
(sine relief 4 s), in the background worker with progress.

### Limits recorded

- **Steep walls**: the distance is solved on a grid in plan, so on walls steeper than about 70°
  passes crowd into a few grid cells; use waterline (or the slope limits) there. The gouge safety
  does not depend on this (every point is an exact drop).
- **Crease passes run after all the level passes** (going in), across the finished passes.
- **Bull-nose**: spaced for the corner radius only, so on flats (where the flat bottom cuts) the
  passes are closer than they need to be.

## M3.1c flat-area and helical finishing: what was built

| Spec ID | What | Where |
|---|---|---|
| 3D-08 | Flat-area finishing: offset passes only where the tool rests on a face flatter than 0.5° (and in the groups chosen, inside the boundary). The flat areas come from a grid of exact drops; their edges are traced to 0.005 mm by bisection with exact drops; the first ring runs 0.005 mm inside the edge, the next ones step in by the step-over (from the edge in, or from the middle out; counter-clockwise or clockwise). Every pass is dropped exactly and kept only where the tool still rests on a flat face; links stay down only over flat faces. The widest flat-bottomed tool is picked automatically (bull-nose first) | `src/cam/3d/flat.ts`, `onCutOnly` in `src/cam/3d/passes.ts` |
| 3D-08 | Flat-area rest: with rest machining on, rest counts only on flat faces and only where the tool can reach resting on one | `flatter` in `restArea` (`src/cam/3d/rest3d.ts`) |
| 3D-08 | Helical finishing: one continuous descent round steep walls. Waterline level lines every step-down; a closed line with exactly one closed line below it (round a hill, inside a hollow) is a stack; round each level the tool sinks one step-down, every point found exactly on the wall at its interpolated height (bisection with exact drops towards the line below), each piece checked at its middle and quarters and split until within tolerance; one level round at the bottom. Lines that split, join, open or leave the slope limits are cut as waterline passes. Short slope-only misses (under the tool radius, where the facet read at a corner of the model is not the real contact) do not break a stack | `src/cam/3d/helical.ts` |
| Screens | Add operation: "(flat areas)" and "(helical)"; editors: step-over, order and ring direction (flat areas); step-down per round (the shop's waterline step-down, now "Waterline and helical step-down", with its Configure badge), direction and slope limits (helical); rest machining for both | `src/pages/part/OpsPanel.tsx`, `src/core/confirm.ts` |

### Acceptance (M2.2 tolerances)

| Criterion | Proof | Measured |
|---|---|---|
| Flat areas only, at the face | `tests/cam-3d-flat-helical.test.ts` | Every CL point on the hemisphere's base (6 mm ball) and the raised panel (8 mm flat): the exact drop rests on a face flatter than 0.5°, at the point's height (< 0.002 mm) |
| Edge traced to 0.01 mm | same | Round the dome: 406 of 406 points of the ring nearest the dome are within 0.011 mm of where the ball stops resting on the base (found by exact drops in the test) |
| Floors finished | same | Raised panel, 8 mm flat, 4 mm step-over, simulated at 0.5 mm: 27,280 floor cells more than the tool radius from the bevel, most left 0.0000 mm |
| Rest | same | After the same pass: nothing left, no moves. After a 6 mm ball parallel finish at 3 mm: the base is cut again (only at -20) |
| No gouge > 0.005 mm | same | Flat areas: ball (exact) on the hemisphere; flat and bull-nose (sampled) on the raised panel. Helical, 6 mm ball (exact): bowl 0.0022, hemisphere 0.0019, raised panel 0.0019, cove (falls back to waterline passes) under 0.005 |
| Stock to leave ±0.01 mm | same | Bull-nose flat areas, 0.3 mm: the tool sits 0.300 mm above the face it touches. Helical, 0.5 mm on the hemisphere: 0.5 ± 0.01 |
| One continuous descent | same | Bowl: one descent of 15.000 mm (16 levels, 1 mm a round), one feed-down for the whole operation; hemisphere and raised panel: one descent each; never rises more than 0.003 mm; every point within 0.0042 mm of the surface (exact distance) |
| Golden digests | `tests/golden/cam3d/{flat-raised-panel,flat-hemisphere-ball,helical-bowl,helical-raised-panel-conventional}` | 4 new; every existing golden unchanged |
| Export blocked | same | `CAM_3D_NO_OUTPUT` for both with both output switches on; neither is a flat layer |

### Limits recorded

- **Flat-area passes on level flats are true 3D for now.** They run at constant heights and could go
  out as flat layers like waterline; that is a decision for the owner (see the report).
- **Tiny level facets** that a mesh's triangulation makes along ridges (e.g. the corner hips of the
  raised-panel test mesh) count as flats where the tool can rest on them, and get passes.
- **Helical** is made for walls steeper than the slope limit (placeholder 30°); on gentle slopes the
  levels are far apart in plan and waterline or scallop finish better.

## M3.1d undercut finishing with lollipop tools: what was built

| Spec ID | What | Where |
|---|---|---|
| 3D-08 | Lollipop tool shape: a ball on a thinner neck ("Neck Ø" in the tool dialog). New placeholder tool T108, 12 mm ball on a 4 mm neck, with the Configure badge like every placeholder tool | `src/core/types.ts`, `src/core/defaults.ts`, `src/pages/machine/ToolDialog.tsx`, `src/core/confirm.ts` |
| 3D-08 | Undercut finishing: parallel passes that run in under an overhang. For each point the exact heights where the ball would touch the model are found (vertical line against every triangle: vertex spheres, edge cylinders, face slabs); the ball sits on the surface in the gaps. The neck (with the machine's collision margin) is checked against the model as a cylinder down to the ball, and a point is only used where both are clear. Passes come in and go out sideways, inside the boundary; the tool only goes up or down where the way up is clear. Passes with no way out inside the boundary are left out with a warning | `src/cam/3d/undercut.ts` |
| 3D-08 | Tool choice: the lollipop that reaches furthest under is picked automatically; a ball-nose, a lollipop whose neck (plus margin) is as thick as its ball, or a model with no overhang give a clear warning | `resolveTool` in `src/cam/ops.ts`, `src/cam/toolpath.ts` |
| Stock | Dexel stock: each column of the stock holds up to 6 pieces of material (bottom to top), so material left over a lollipop's cut (an overhang) is kept. It keeps a heightfield copy for the top view. A vertical tool carves it exactly as the heightfield does. Used automatically when a lollipop is in the operations; otherwise the heightfield stock is used as before | `src/cam/stock/dexel.ts`, `src/cam/stock/choose.ts` |
| Simulator and collision | The simulator and the collision checker use the dexel stock when needed; the neck is part of the simulated cutter; the stock mesh (and its STL) shows material under overhangs | `src/pages/part/SimulateDialog.tsx`, `src/cam/sim.ts`, `src/cam/collision/collision.ts` |
| Screens | Add operation: "(lollipop undercuts)"; editor: angle, step-over, direction, rest; the switch text lists it | `src/pages/part/OpsPanel.tsx`, `src/pages/MachinePage.tsx` |

### Acceptance (M2.2 tolerances)

Test model: an 80 × 60 × 50 block with a lip overhanging a recess (`tests/undercut-fixtures.ts`).

| Criterion | Proof | Measured |
|---|---|---|
| No gouge > 0.005 mm | `tests/cam-3d-undercut.test.ts` | Ball, checked exactly at every point: −0.0005 mm worst (T108 and a 20 mm test lollipop) |
| Neck clear with the margin | same | Neck against the model with the 2 mm margin: 0.0000 mm worst (it reaches exactly to the margin, never into it) |
| On the surface (stock to leave ±0.01 mm) | same | Every cutting point within 0.011 mm of the surface (exact distance) |
| Reach under the overhang | same | T108 reaches the underside to x 36.393 mm, the geometry allows 36.393; the 20 mm test lollipop 33.655, allows 33.655 |
| Way in and out | same | Every point inside the part's 80 × 60 outline; every vertical move has nothing above it the ball could touch |
| Dexel stock | same | A vertical tool carves it the same as the heightfield (top within 0.0001 mm, volume within 0.01 %). A lollipop slot inside a block: 5513.6 mm³ removed, analytic 5506.5 (0.13 %); the mesh is closed |
| Simulation | same | On a stock the shape of the part: the lip stays (two pieces of material in its columns), under 5 mm³ of slivers cut; the same moves on a heightfield would cut the lip away. No false collision alarms |
| A real collision is caught | same | Passes made with a 0 mm margin, checked with the 2 mm margin: shank warnings found |
| Golden digests | `tests/golden/cam3d/{undercut-lip-t108,undercut-lip-lolly20-underside}` | 2 new; every existing golden unchanged |
| Export blocked | same | `CAM_3D_NO_OUTPUT` with both output switches on; not a flat layer |

### Limits recorded

- **Reach** is limited by the neck: contact gets no further under than the neck radius plus the
  collision margin from the overhang's edge (minus the ball's own reach). A bigger margin means
  less reach; with a 4 mm margin T108 cannot get under at all (warning).
- **Passes that cannot get out inside the boundary** (e.g. passes running along the lip) are left
  out with a warning rather than lifting the tool through the overhang. Cut them at another angle.
- **Dexel stock** holds up to 6 pieces per column; beyond that the smallest gap is filled, so the
  simulator may show a little cut material as still there (never the reverse). Not seen in tests.
- T108 is a placeholder: its ball, neck and lengths are not a real tool (Configure badge).

## M3.1e curve-driven finishing: what was built

| Spec ID | What | Where |
|---|---|---|
| 3D-09 | Curve-driven finishing: a new 3D finishing strategy whose passes are guided by a drive. The drive only says where in plan each pass runs; every point is an exact drop-cutter position refined to the tolerance by the shared pass code, so no drive can make the tool dig in | `src/cam/3d/curve.ts`, `CurveDrive` in `src/cam/types.ts` |
| 3D-09 | One drive curve (a shape on face 1): the curve and copies of it a step-over apart in plan, to both sides or one, a set number each side or as many as the boundary holds. Open drives' copies stop square to their ends; closed ones stay closed and start level with the drive's start | `offsetDrive` |
| 3D-09 | Two drive curves: passes blended from the first to the second, as many as keep neighbouring passes no more than a step-over apart (in plan); the two curves are the first and last passes | `blendPasses` |
| 3D-09 | An earlier toolpath: the cutting moves of an earlier, enabled operation on face 1 (arcs followed to 0.005 mm), with copies as for one curve. Changing that operation marks this one stale; a later operation cannot be followed (no circles) | `toolpathRuns`; `driveSource`, `modelsFor` and `opInputHash` in `src/cam/doc.ts` |
| 3D-09 | Where two surfaces meet: the lines where facets of two sets of facet groups share an edge (corners welded to 0.001 mm), chained. A ball-nose (picked automatically: the smallest) touches both where they make a valley (its centre the same distance from both, refined against the true facets square to the line) and sits on the edge where they make a ridge. Stretches running nearly upright are left out with a warning | `seamLines`, `seamCentre` |
| 3D-09 | A surface's rows and columns: surfaces made in the app now keep their layout (`gridMesh` → `Mesh.grid` → `ModelRef.grid`, tied to the stored data). Lines along the rows or the columns, spaced so neighbouring lines are never more than a step-over apart on the surface; the tool placed to touch each line (moved out along the surface normal by its rounded end, and by its flat bottom square to the line). The surface can be the machined model or another surface made in the app | `gridLines`; `src/cam/mesh/surface.ts`, `src/pages/part/modelData.ts` |
| 3D-09 | Tool kept on one side of a surface: chosen facet groups are never cut, and no point is cut where the tool's centre is on their other side (judged by the facet nearest it); links never run over them. Front is the side the facets face (the outside of a solid) | `sideKeeper` |
| Screens | Add operation: "(curve-driven)"; editor: guided by, step-over (with its Configure badge), drive shapes from the selection, the earlier operation to follow, copies (side, count or as many as fit), the two surfaces' groups, the surface and rows or columns, pattern, direction, slope limits; "Keep to one side" (groups, front or behind); rest machining. The switch text lists it | `src/pages/part/OpsPanel.tsx`, `src/pages/MachinePage.tsx` |

### Acceptance (M2.2 tolerances)

| Criterion | Proof | Measured |
|---|---|---|
| No gouge > 0.005 mm | `tests/cam-3d-curve.test.ts` | Ball-nose, checked exactly, on every drive: one curve with copies 0.0013 mm worst; blended passes, a toolpath followed, intersections, rows and columns, kept to one side all within 0.005. Bull-nose on rows and columns (sampled check) within 0.005 |
| Stock to leave ±0.01 mm | same | One drive, 0.3 mm left: 0.3000 to 0.3000 mm. Rows and columns, and intersections: the ball 0.0000 mm off the surface |
| Copies where they belong | same | Copies at 1.5, 4 and 9 mm: every point within 0.002 mm of that distance, on its side, from square off the start to square off the end. On the hemisphere, every cutting point within 0.01 mm of the drive or one of its three copies each side (the stay-down links between passes aside: never longer than two step-overs, always from pass to pass) |
| Blended passes | same | Each pass within a step-over of the one before; the first and last are the two curves; every cutting point within 0.01 mm of a pass |
| A toolpath followed | same | An engraved circle (r 26) with two copies each side: every cutting point within 0.01 mm of r 20, 23, 26, 29 or 32 (links aside); stale when the circle changes; a later operation is refused |
| Where two surfaces meet | same | Floor and 45° wall: the ball 0.0000 mm from touching both, its centre at x 53.757 (exact: 53.757). Floor and a round wall (radius 30): 0.0000 mm, x 32.861 on the faceted model (the true circle: 32.863). Over a ridge: touching the edge within 0.01 mm. A bull-nose, groups that do not meet or that overlap: refused with the reason |
| Rows and columns | same | A dome made by revolving: along its rows (meridians) every contact within 0.0001 mm of a line, along its columns (circles) 0.0057 mm; neighbouring lines never more than a step-over apart; a model with no rows and columns, or whose data changed, refused with the reason |
| Kept to one side | same | A thin upright sheet at x 50, 6 mm ball: kept in front, the passes reach x 47.0000; kept behind, 53.0000; never on the sheet, nothing crosses it |
| Golden digests | `tests/golden/cam3d/{curve-copies-hemisphere,curve-toolpath-hemisphere-oneway,curve-intersection-valley,curve-keepside-front}` | 4 new; every existing golden unchanged |
| Export blocked | same | `CAM_3D_NO_OUTPUT` with both output switches on; not a flat layer |
| File | same | The drive, the side kept and a model's rows and columns are saved and read back (format 5, which already covers all of M3.1) |

### Limits recorded

- **Copies and blends are spaced in plan.** On steep ground they are further apart over the
  surface. Scallop finishing keeps an even finish on slopes; rows and columns are spaced on the
  surface.
- **Where two surfaces meet = where their facets share an edge** (faces of a solid, groups of one
  mesh). Two separate surface models that cross are not intersected; draw the line and use it as
  a drive curve instead. Ball-nose only.
- **Rows and columns only on surfaces made in the app** (revolve, ruled, loft, sweep, extrude, a
  solid's face untrimmed). Imported meshes and solids have none (the solid reader gives facets
  only). Surfaces made before this change must be made again to get theirs. On upright stretches
  a 3-axis tool cannot follow a line down the wall: it rides at the top.
- **Keep to one side** judges the side by the facet nearest the tool's centre; beyond the edge of
  an open surface that is the plane of its last facet.
- **Simulation only**: no curve-driven pass is written to woodWOP (export checker).

## M3.1f screenshots, README, ROADMAP

**M3.1 complete.** README (3D finishing: "More 3D finishing", rest machining, the output rules)
and ROADMAP (Stage 3 in progress, M3.1 done) are updated.

**Screenshots** (`docs/screenshots/stage-2-3/M3.1/`, browser preview, Playwright; the demo parts
were made through the app's own code in the page, then every screen used as a user would):

- `01-add-operation-menu.png`: Add operation with the new 3D finishing entries (radial, spiral, scallop, flat areas, helical, undercut, curve-driven).
- `02-radial.png`: radial passes on the dome (gap 3 mm at the outer edge; passes stop in turn towards the centre) and the editor.
- `03-spiral.png`: one spiral round the dome, 2 mm between turns.
- `04-scallop.png`: scallop passes on the hill-and-hollow surface, working in from the boundary; the editor shows the cusp (0.172 mm for 2 mm on the 6 mm ball).
- `05-flat-areas.png`: flat-area rings on the raised panel's field and border only.
- `06-helical.png`: one continuous descent round the bowl.
- `07-lollipop-tool.png`: the tool dialog with the Lollipop shape and its neck diameter (T108, placeholder, Configure badges).
- `08-undercut.png`: undercut passes on the lip part and the editor (finishes only; clear under the overhang first).
- `09-undercut-simulated-3d.png`: the simulator in 3D after Z-level roughing and the undercut pass: material kept above the cut under the lip's edge (the layered stock). The collision list shows the placeholder roughing tool's flute is too short for the 40 mm depth (placeholder values).
- `10-curve-drive-copies.png`: curve-driven passes: a drive curve with four copies each side.
- `11-curve-intersection.png`: one pass along each line where the picked surfaces meet (two valleys and a ridge); no step-over asked for.
- `12-curve-rows.png`: passes along the rows of a dome made by revolving (meridians), 3 mm apart on the surface.
- `13-machine-switch.png`: the "More 3D finishing" switch and what it covers.

Found while taking them: the plan view draws very large toolpaths slowly. A Z-level roughing of
the 80 x 60 x 40 mm-deep lip part with the default settings and the placeholder 12 mm tool makes
472,100 points; with it the browser preview stopped drawing. The screenshot used coarser roughing
(10 mm levels, back and forth: 47,810 points). This is not new in M3.1 (Stage 2 drawing); it is
recorded as a risk.

## M3.1 decisions needed

1. **Flat-area passes on level flats as flat-layer output?** They run at constant heights, like
   waterline, and could be written as contour-milling passes behind the 3D output switch (still
   off). Today they count as true 3D and the checker refuses them. Yes / no.
2. **Lollipop tools**: does the shop have any (ball and neck diameters, flute length, stick-out)?
   T108 is a placeholder. Reach under an overhang is the ball radius less the neck radius and the
   collision margin (2 mm placeholder): a smaller margin reaches further but leaves less room.
3. **Clearing under overhangs**: undercut finishing only finishes. Nothing in the app roughs under
   an overhang (Z-level roughing works from above). Needed later, or are undercuts done another
   way in the shop?
4. **Rows and columns of imported solids**: parameter lines work on surfaces made in the app
   (and a solid's face untrimmed). True parameter lines on an imported solid's free-form faces
   would need a B-rep kernel: the OpenCascade build already reviewed (LGPL-2.1, about 23 MB of
   WebAssembly, loaded as a separate replaceable file). Not added; say if it is wanted.
5. Unchanged: placeholder step-overs (finishing 0.6 mm, with Configure badges), the helical slope
   limit (30°) and the 3D tools; true 3D output waits for a woodWOP sample program (decision 2).

## M3.1g owner follow-ups: what was built

The five decisions on the M3.1 report (decision 20), each pushed to `main` when green: items 1-2
`077d6d3`, item 3 `3ea2283`, items 4-5 `f0a258d`.

| Item | What | Where |
|---|---|---|
| 1 Flat-area flat layers | Flat-area finishing is a flat-layer operation (`isFlatLayer`): each level pass becomes one contour-milling pass at its depth, behind the existing switch "Write 3D roughing, waterline and flat areas to MPR" (off). Points in line with their neighbours are left out of the contour (within 0.0005 mm); passes at face 1 are not written (nothing to cut there), with a note. A pass on a face flatter than 0.5° but not level changes height: the whole toolpath is blocked (`noOutput`, `CAM_NO_OUTPUT`) whatever the switches say | `src/cam/3d/flat.ts` (`levelPasses`), `genFinish3d` in `src/cam/toolpath.ts`, checker texts in `src/core/validator.ts` |
| 2 Lollipop badges | A lollipop's "number, ball Ø and depth" and "neck Ø, flute and stick-out" keep their Configure badges until each is confirmed, even once the rest of the tool table is real (the badges name the ball and the neck; a missing neck says so) | `toolUnconfirmed` in `src/core/confirm.ts` |
| 3 Undercut roughing | New Z-level roughing pattern "Undercuts (lollipop)": see below | `src/cam/3d/undercutRough.ts`, `genRough3d`, `lollipopOf` in `src/cam/toolpath.ts` |
| 4 Solid face rows and columns | The B-rep kernel reads the solid's own file again (in the solid worker), finds the picked face and samples its true surface on its own parameters; added as a surface model with rows and columns that curve-driven passes follow, stopping at the face's edges | `src/cam/solid/brep.ts`, `src/cam/solid/faceGrid.ts`, task `solid.faceGrid`, `gridPasses` in `src/cam/3d/curve.ts`, "Rows and columns" in `src/pages/part/SolidFacesPanel.tsx` |
| 5 Plan view | Toolpaths drawn simplified for the screen, built once per toolpath (large ones in the compute worker), runs of straight feeds simplified too; the tool-width band is left out above 20,000 drawn points; a note says when a drawing is simplified or still being made | `src/cam/display.ts`, `src/pages/part/displayPaths.ts`, `src/pages/part/Canvas.tsx`, task `toolpath.display` |

**Undercut roughing (item 3).** At each level (ball-centre heights from the highest underside the
ball can touch down to the lowest floor beneath an overhang, the step-down apart) the ball's centre
goes only where the ball (radius + stock) and its neck (radius + collision margin + stock, from
the centre up) are both clear of the model: exactly per grid node from the heights where the ball
touches each facet (`BallLine`) and a flat-cutter drop for the neck. Where it could rise straight
up is open; elsewhere it is under the overhang. Passes run along the lines a step-over, two
step-overs, ... in from the open side (distance measured through the clear set, so a pass is made
only where the tool can get to it sideways), then one along the edge of the clear set. Every
point is checked exactly and every move every 0.05 mm. The tool comes down and goes up only in
the open; under the overhang it moves level and leaves sideways (down the distance field, or back
the way it came). Ball centres stay inside the part's own outline (the default "touching" boundary
would otherwise let passes wrap round the part's ends, where its neighbours are on a sheet). A
warning asks for roughing from above first if no Z-level roughing comes before it. Own placeholder
step-down (1 mm) and step-over (10 % of the ball) with Configure badges (`undercutStepdown`,
`undercutStepover`). Never a flat layer; `noOutput` set, so no post writes it. Part file format 6.

**Kernel choice (item 4).** `replicad-opencascadejs` 1.1.0 (LGPL-2.1-only, 22.98 MB WebAssembly +
60 KB script), the build already reviewed in M2.5. It cannot cleanly replace occt-import-js: it
has no XDE STEP reader (no face colours, product names or assembly tree, which M2.5's faces to
layers by colour and assembly split rely on) and no IGES reader; occt-import-js is also a third
of the size and is what every solid import loads. So the reader stays, and the B-rep kernel loads
only when a face's rows and columns are asked for. Loading: two unmodified files in
`vendor/opencascade-brep/` (copied from the package by `vite.config.ts`, unpacked in the desktop
app by the existing `asarUnpack: dist/vendor/**`), imported by URL inside the solid worker. Its
script makes small functions at run time (`new Function`, embind); the page's security policy
forbids that and is unchanged; a worker loaded from the app's own files has no such policy. Checked
in Chromium 141 (Electron 44 is the same engine): the page refuses it (EvalError), the worker runs
it. The start-up bundle grew 14.7 KB (0.4 %) for all of M3.1g; the kernel is not in it.

**Face found again.** Faces are matched by where they lie, not by their order in the file (the
reader and the kernel walk files differently): the kernel's face whose own triangles all lie on
the stored face's triangles (box and area first), within 0.2 mm. The unit is taken from the file
as the reader did (`readStepMeta`). The grid: as many rows and columns as keep the straight pieces
between grid points within 0.01 mm of the surface (checked at a spread of cells; at most 250,000
points, otherwise a warning with the gap reached). Points outside the trimmed face (its own
triangles in its parameter plane) are left out of the facets; such grids are marked `trimmed`, and
lines along them stop where they leave the face.

### Acceptance

| Item | Proof | Measured |
|---|---|---|
| 1 | `tests/cam-3d-flat-helical.test.ts` (M3.1g block) | Raised panel, 8 mm flat: 437 level passes become 437 contours (47 on the border floor at 10 mm; the rest on the test mesh's tiny level hip facets, a recorded limit); every corner is a point of the toolpath at the contour's depth. Default (switches off): `CAM_3D_OUTPUT_OFF`, nothing written; switches on, not calculated: `CAM_3D_NOT_READY`; calculated: written as `<105>` contours. A 0.23° pocket floor: blocked (`CAM_NO_OUTPUT`) even with both switches on |
| 2 | `tests/confirm.test.ts` (M3.1g block) | T108: ball Ø12 / 40 deep and neck Ø4, flute 12, stick-out 60 badged; still badged with a real tool table; gone only when confirmed; listed in the undercut editor and by the export checker; confirming switches nothing on |
| 3 | `tests/cam-3d-undercut-rough.test.ts` | Exact distance along every move: T108 with 0.3 mm stock, ball 0.3000 mm from the model, neck 2.3000 mm (margin 2 + stock), reach exactly at the neck's limit (centre x 42.300, 2.000 mm under the lip's edge); no stock: 0.0000 / 2.0000; 20 mm test lollipop: 0.3000 / 2.3008, 4.999 mm under. Vertical moves only where the ball is clear all the way up. Levels the step-down apart down to the floor (+0.3). Dexel stock (0.1 mm cells), stock the shape left by roughing from above: 2,880 mm³ removed under the lip, the lip kept; where undercut finishing then touches, at most 0.420 mm left (0.3 stock + 0.084 cusp + probe), from 1.980 mm before; no false collision alarms; a 0 mm margin case is caught (shank). Refusals: ball-nose, neck too thick, no overhang; warning without roughing from above. Placeholder step-down/step-over badged; format 6 round trip. Export: `CAM_3D_NO_OUTPUT` with both switches on |
| 4 | `tests/cam-3d-brep-grid.test.ts` | Kernel cold start 0.24-0.30 s in Node (1.15 s in the browser incl. the 23 MB download; 0.32 s warm). Dome face (B-spline): 168 rows × 246 columns, 0.49 mm apart, chord 0.0004 mm, every grid point within 0.000002 mm of the true surface, rows on one y and columns on one x (0.000000), nothing in the hole, every point 2 spacings from the hole in the face. BREP file: same. IGES and missing faces refused with the reason. Curve-driven along rows: 29 lines, columns: 42 lines (a step-over or less apart on the surface); the ball touching the solid's facets (0.0000 mm; 0.047 mm from the true surface, the import's facet tolerance), contacts within 0.0001 mm of a line, gouge 0.0025 / 0.0021 mm, none over the hole. Same result through the worker task |
| 5 | `tests/cam-display.test.ts`; browser check | The lip part's default Z-level roughing: 472,100 points drawn as 2,964 within 0.01 mm (worst real point 0.0095 mm from the drawing), every point drawn a real point, the toolpath unchanged, 85 ms once (before: 4.1 MB of path data built in 128 ms on every redraw, twice per render, and stroked with a 12 mm band). In the browser (dev build): drawn with the note "drawn simplified (within 0.01 mm)"; while panning and zooming over it every main-thread task stays under 100 ms (max 89 ms) |

### Limits recorded

- **Flat layers**: tiny level facets a mesh's triangulation makes along ridges (the raised-panel test
  mesh's corner hips) are level flats too and get their own small contours. Two border rings of
  the raised panel have more than 2,000 points (the edge traced to 0.005 mm along a faceted
  bevel): the existing warning about woodWOP's unconfirmed point limit says so.
- **Undercut roughing** reaches in only as far as the ball radius less the neck and the collision
  margin (2 mm for the placeholder T108; 4 mm margin: no reach at all); material further in stays
  (warning). Between levels it leaves the ball's cusp (0.08 mm at 2 mm step-down with a 12 mm
  ball). It needs roughing from above first (warning otherwise). Simulation only.
- **Solid face rows and columns**: STEP and BREP only (no IGES reader in the kernel build: save as
  STEP). Lines stop up to one grid spacing (about 0.5 mm) short of a face's trimmed edges. The
  passes are dropped onto the solid's facets (made within 0.05 mm of the surface at import), so
  they follow the true surface within that. A face too large for 250,000 grid points gets a coarser
  grid and a warning with the gap reached. Relies on the worker having no content policy of its
  own: if a server ever sends one with `script-src` and no `'unsafe-eval'`, the kernel stops
  loading (the page's policy is not loosened).
- **Plan view**: while a very large 3D toolpath is being calculated the page still re-renders on
  each progress step (about 100 ms per render in the development build), and the moment the
  finished toolpath arrives from the worker takes about 0.25 s (unpacking hundreds of thousands
  of move objects; the toolpath format is unchanged). Above 20,000 drawn points the drawing shows
  the centre line only (no tool-width band).

## M3.1g decisions needed

1. **Lollipop tools**: still to come when known: ball and neck diameters, flute length and
   stick-out of any lollipop the shop gets. Until then T108 stays a badged placeholder and
   undercut work is simulation only.
2. **Flat-area output on the machine**: before switching on "Write 3D roughing, waterline and flat
   areas to MPR", load one flat-area program in woodWOP (as for roughing and waterline, open
   question 5).

## M3.1g screenshots

In `docs/screenshots/stage-2-3/M3.1g/`: `01-flat-areas-output-switch-off` (the flat-layer switch,
off, now naming flat areas), `02-undercut-roughing` (the undercut roughing editor: lollipop
Configure badges, the reach warning), `03-undercut-roughing-simulated` (simulated after Z-level
roughing; the collision check flags the Z-level rough's placeholder flute length, as it should),
`04-solid-face-rows-and-columns` (the dome face of the STEP fixture: 168 rows × 246 columns from the
B-rep kernel; the new surface lies on the solid's face, hence the mottled look),
`05-plan-view-large-toolpath` (the 472,100-point roughing drawn simplified, with the note).

## M3.2 small extras: what was built

Pushed to `main` in two green parts: `d68e3d3` (thread milling, fold/flatten/wrap, annotation and
print) and `9d40204` (stroke fonts, rapid surfaces), then screenshots and docs. Part format 7
(thread operations; annotations, layer line types, fonts kept with texts and rapid surfaces are
optional fields).

| Item | What | Where |
|---|---|---|
| NEW-08 Thread milling | New operation on picked circles: internal/external, diameter (default: the circle), pitch, hand, top-down or bottom-up, length, thread depth (ISO 68-1 basic depth: 5/8 H inside, 17/24 H outside, H = 0.866 P), radial passes (placeholder 2, Configure badge) and a spring pass. Half-turn helical arcs, each dropping exactly its share of the pitch; climb or conventional follows from hand and direction (spindle clockwise). Checks: a thread mill; fits the core hole; the tooth reaches the depth past the neck; a core hole cut by an earlier operation (warning otherwise; **Add core holes** makes them). Edge feed (`k`) on the arcs. Placeholder T109 (Ø6 single-profile, neck Ø4) with badges. Simulated in the dexel stock with the 60° tooth (as many pieces per column as the turns need). `noOutput`: never written | `src/cam/more25d/thread.ts`, `genThread` in `src/cam/toolpath.ts`, `carveThread` in `src/cam/stock/dexel.ts`, `ThreadFields` in `src/pages/part/OpsPanel.tsx` |
| NEW-07 Fold, flatten, wrap | Wrap: shapes mapped by arc length along a curve (x along, y out from it, square to it), refitted with lines and arcs within 0.005 mm; past an open curve's end they carry on straight (warning). Flatten: facets unrolled across shared edges, each keeping its edge lengths; developability from each inner corner's angle defect (and the gap it leaves); overlap when the pattern runs over itself. Fold: each fold line splits the piece it runs across; pieces turn about the folds on their way from the fixed piece, the nearest first; corners joined where the pattern joins them | `src/cam/develop.ts`, `src/pages/part/DevelopPanel.tsx` (3D tab) |
| NEW-21 Annotation and print | Hatch (associative: by shape id; holes even-odd; angle, spacing in part mm, crossed), detail view (circle, magnification, placed view, letters A, B, ...), per-layer line types (solid, dashed, hidden, centre, dotted; dashes in paper mm in prints, pixels on screen). Printed to scale with the drawing; dashes laid out on the paper before clipping so they run on across sheets | `src/cam/annotate.ts`, `src/cam/print.ts`, Hatch / Detail view tools, Annotations list, layer line type, print switch |
| NEW-24 Stroke font editor | Library → Fonts: glyph strokes on a grid (snap 0.25/0.5/1 or off), per-glyph advance, gap, cap height; new, copy of the built-in, import/export JSON (checked on reading). Text keeps the glyphs it uses (`embedFont`); missing letters use the built-in glyph scaled to the font's grid; DXF writes such text as strokes | `src/cam/font.ts`, `src/pages/library/FontsTab.tsx`, text tool and text properties |
| 2D-18 Rapid surfaces | Per operation: cylinder along X or Y, or a sphere. After the toolpath is made (and edited), rapids to the safe height end on the surface and rapids across follow it in steps that keep each straight move within 0.1 mm of it; never below the operation's clearance height (held there, warning); beside the surface the flat safe height stays (warning). Suggested arch from the panel size marked "Suggested: check it" until checked or edited | `src/cam/more25d/rapidSurface.ts`, `withRapidSurface` in `src/cam/toolpath.ts`, `src/pages/part/RapidSurfaceGroup.tsx` |

### Acceptance

| Criterion | Proof | Measured |
|---|---|---|
| Thread pitch and depth exact in the toolpath | `tests/cam-thread.test.ts` | M10 × 1.5 internal, bottom-up, 12 mm, 2 passes: 32 helix arcs, Z drop per turn 1.5 mm (worst error 1.1e-15 mm), the thread's end exactly at its length; last pass puts the tooth tip on Ø10.000000 (major), the first on half the depth; external threads put it on the minor diameter. Simulated (dexel, 0.05 mm cells): 7 grooves up a column halfway up the flank, mean spacing 1.5000 mm; material just inside Ø10 cut, just outside untouched. Golden `thread-m10-internal` |
| Wrap keeps arc length within 0.01 mm | `tests/cam-develop.test.ts` | A 140 mm baseline wrapped onto an arc (r 100), a circle (r 60), a polyline with corners: length error 0 / 2.8e-14 / 0 mm; onto a sine wave fitted with lines and arcs: 0.0015 mm. Every checked point on the curve within 0.01 mm, at the same distance along it. A 10 × 6 box 20 mm along a r 100 arc stays between r 94 and 100 and between 20 and 30 mm along; its top edge comes out 9.40 mm (10 × 94/100) |
| Flatten / fold | `tests/cam-develop.test.ts` | Cylinder segment (r 80, 120°, 24 facets) and cone frustum (r 60 → 30, 32 facets): angle defect 0, edges kept within 1.5e-13 mm, flat area = surface area; cone corners 100 / 50 mm from the flattened apex within 0.01 mm. Whole cylinder cut open, no overlap. Dome: 1.46° defect, 0.24 mm gap, "not developable" warning. Box net (100 × 100 base, 50 mm sides) folded 90° on four lines: side corners meet within 4e-15 mm, sides vertical; flattened back: area 30,000.000 mm², perimeter 800.0000 mm |
| Prints measure to scale | `tests/cam-annotate.test.ts` (segments read back from the PDF) | At 1:5 on A3: 400 mm edge = 80.00 mm on paper, check bar 100.00 mm; hatch at 10 mm spacing = lines 2.000 mm apart, 20.00 mm long across the 100 mm pocket; a 4× detail of a hatch chord (34.64 mm) = 27.71 mm on paper (34.64 × 4 / 5); dashed layer: 4.000 mm dashes at 1:5 and at 1:2. Hatch lines exactly the spacing apart at 45°, ends on the boundary, none in a hole, follows its shapes, gone (listed as broken) when they are deleted |
| Stroke fonts | `tests/cam-font.test.ts` | The built-in font as a stroke font draws identical strokes and widths; a 10-unit font at 20 mm: 2 mm per unit, advances 7 + 5 units = 14 / 24 mm; fallback glyphs identical to the built-in; edit steps; JSON round trip and refusals; a part's text unchanged after the library font is edited, and after saving and reading back |
| Rapid surfaces | `tests/cam-rapid-surface.test.ts` | 600 × 300 panel, five pockets, suggested cylinder: every raised rapid on the surface (or the clearance height), every straight rapid within 0.1 mm of it, none below the clearance height; cutting moves and woodWOP intents identical to the flat version; a low surface held at the clearance height and the flat safe height kept beside it, with warnings; saved and read back |

Also: `npm run sample` output unchanged (byte for byte); Stage 1 goldens unchanged; the one golden
changed in this run, `thread-m10-internal`, is new, then gained one warning line (the neck within
the collision margin, below), moves unchanged.

### Limits recorded

- **Thread milling** is simulation only. The collision check keeps its safety margin (2 mm
  default) round a thread mill's neck as round any shank, so with the placeholder T109 (neck 0.19
  mm from the crests of an M10 × 1.5) it reports a shank collision on every internal thread; the
  operation says so up front. The check is not relaxed (decision needed below). Metric (ISO)
  profiles only; no tapered threads; one start.
- **Wrap** maps points, then refits: straight lines of a shape become curves along a curved
  baseline (as they should), fitted within 0.005 mm. Text is wrapped as strokes (its letters, not
  a text object).
- **Flatten** lays facets out from one facet across shared edges: a closed surface is cut where
  the two ways round meet (not where you choose). A surface that is not developable gets an
  approximate pattern with the warning; no stretch is spread out.
- **Fold** lines must cross the piece they fold (a line along the outline is left out, with a
  note); a piece cut into separate parts by one straight line is not handled (U-shaped pieces).
  Sides that touch only once folded are not joined.
- **Detail views** draw their magnified lines solid (layer line types are not carried into them).
  Hatching and details are on face 1 only. The Hatch and Detail view tools are in the Dimension
  group (CAD and tool additions switch).
- **Rapid surfaces** change nothing in woodWOP programs (the machine moves between macros at its own
  safety height). A suggested surface is worked out from the panel size, not from clamps or the
  machine: it is marked until checked.

## M3.2 screenshots

In `docs/screenshots/stage-2-3/M3.2/`: `01-thread-milling` (editor, Configure items, the bottom-up
note), `02-thread-simulated` (core holes then the thread; the collision check's neck report),
`03-fold-flatten-wrap` (text wrapped along an arc; the Fold, flatten, wrap panel),
`04-folded-box` (a box net folded into a surface model, 3D view), `05-hatch-detail-linetypes`
(hatch with a hole left empty, detail A at 2.5:1, a centre-line layer, the Annotations list),
`06-print-to-scale` (the same at 1:4), `07-stroke-font-editor` (Library → Fonts, editing R),
`08-rapid-surface` (the suggested cylinder, marked to check), `09-rapid-surface-simulated` (a rapid
at Z 12.5 over the arch).

## M3.2 decisions needed

1. **Thread mill necks in the collision check**: the check keeps its 2 mm margin round a thread
   mill's neck (as round every shank), so real thread milling will always show a shank collision,
   because a neck passes the crests by design with well under 2 mm. Options: keep it (conservative;
   threads stay simulation-only anyway), or check the neck inside the hole at its true size with a
   small margin you choose. Not changed without your word.
2. **Thread mills**: the real tools, when the shop has them (diameter, tooth, neck, reach). T109
   stays a badged placeholder.
3. **Thread output**: before any thread is written to the N-200, a woodWOP sample with a helical
   or thread macro from the shop PC (the same route as true 3D output).
4. **Rapid surfaces on other machines**: they reach text programs today (the script post path);
   the N-200 is unaffected. Confirm that is wanted before any non-N-200 machine runs them.

## M3.3 split

Three green parts, each pushed to `main`: **M3.3a** the rotary core (set-up, wrapped planes,
rotary passes, rotary stock, checks, part format 8), **M3.3b** output through a script post for a
machine model with a rotary axis, **M3.3c** the screens (3D tab, operation editor, drawing,
simulator, Machine page, Program dialog), screenshots and docs.

## M3.3 rotary (4-axis): what was built

Commits `d966d34` (M3.3a), `f73544e` (M3.3b), `1d5a33e` (M3.3c), then screenshots and docs. Part format 8 (a part's optional rotary
set-up and the rotary operation; format 7 parts read unchanged).

| Item | What | Where |
|---|---|---|
| NEW-14 Wrapped work planes | A part's rotary set-up: the axis along X, Y or Z of the drawing through a point, angles from straight up, right-handed (A about X, B about Y, C about Z); a round blank (diameter) or a square one (side), between two places along the axis. Wrapped planes: a radius, angles from/to, along from/to; made from the blank's radius, from extents, or fitted to a solid's cylindrical face on the axis (radius, length and angle span from the face; a face off the axis is refused). Each is drawn unrolled on the part's drawing (along the axis as it is; round it as arc length at its radius) with 90° ticks; shapes drawn inside it wrap onto it, keeping their lengths at that radius. The axis can also be put on a solid's cylindrical face | `src/cam/rotary/frame.ts`, `src/cam/rotary/face.ts`, `src/pages/part/RotaryPanel.tsx` (3D tab), planes in `src/pages/part/Canvas.tsx` |
| 3D-10 Rotary machining | One rotary operation with four strategies on a plane: passes along the axis, rings round it (one-way or zig-zag), one spiral, on a model (a drop-cutter turned round the axis, refined against the tool tip's surface; roughing in levels from the blank's surface in, with stock to leave); wrapped shapes drawn on the plane cut to a depth below the plane or below the model (drive geometry through the axis). Saw blades straight along the axis (blade in the axis plane) or round it (blade square to it). The tool stands square to the axis and points at it; between passes it lifts a clearance above the blank before it turns. Moves are made on the plane's unrolled frame, so a straight move there is a straight move of the machine's axes. Step-over and roughing step-down are placeholders with Configure badges | `src/cam/rotary/paths.ts`, `src/cam/rotary/drop.ts`, `genRotary` in `src/cam/toolpath.ts`, `src/pages/part/RotaryFields.tsx` |
| Rotary stock | A new stock model behind the same `StockModel` interface: rays out from the axis on a grid along and round it, each holding up to 8 pieces of material (so groove walls are kept). Exact for moves straight along or round the axis and for plunges; other moves sampled at a quarter cell. Used by the one timeline, playback, the collision check (new kind: the tool tip reaching the axis) and the simulator | `src/cam/rotary/stock.ts`, `src/cam/rotary/sim.ts` |
| Checks | Independent gouge check (exact for a ball-nose, sampled otherwise; no drop-cutter code). Collision check: shank, holder, rapids through material, tip past the axis; positions written as X, A and the distance from the axis | `src/cam/rotary/check.ts`, `rotaryCollisions` in `src/cam/rotary/sim.ts` |
| N-200 refuses | A turned part is left out of the cut list and nesting (warning) and the job export is refused (`CAM_ROTARY`, error, whatever the switches); a rotary operation never reaches the MPR writer; a job holding only a turned part now lists why nothing is written on its Output tab | `src/core/validator.ts`, `src/core/pipeline.ts`, `src/pages/JobPage.tsx` |
| Output through a script post | Post input carries the rotary axis and letter; moves against the axis (along it, 0, the tip's distance from it) with the angle in degrees (never wrapped) and each feed move's tip travel for inverse-time feeds. Text-post checks: a script post (the template post refuses and never writes the moves), the "Write rotary programs through script posts" switch (off), a machine model declaring that axis, angles inside its travel, a saw unit for a blade, no flat operations mixed in. Rotary toolpaths for that machine are calculated in the background in the Program dialog. Sample `examples/plugins/rotary-4axis-post.js` (G-code with the A word, G93 inverse-time feeds when the axis turns; not machine-validated), added from Settings → Plugins | `src/cam/post.ts`, `checkTextPost` in `src/core/validator.ts`, `src/cam/plugin/posts.ts`, `src/pages/part/ProgramDialog.tsx` |
| Machine model rotary axis | Machine & tools → machine model → Rotary axis (none, A, B or C) and its travel, for machines other than the N-200 (the N-200 shows "none") | `rotaryAxisOf` / `withRotaryAxis` in `src/core/machineModel.ts`, `src/pages/machine/MachineModelSection.tsx` |
| Simulator | Rotary mode: the top view is the blank's surface unrolled (backplot wrapped across the seam); 3D turns the stock under an upright tool (or blade) as the machine would, with section and see-through; readout X, A, distance from the axis; the collision check runs in the background and hands back the finished stock, so the dialog opens straight away and shows the end. Flat operations on a turned part are left out of the rotary simulation (noted) | `src/pages/part/SimulateDialog.tsx`, `src/pages/part/RotaryView3D.tsx`, `sim.rotaryCollide` in `src/cam/worker/tasks.ts` |
| Switches | "Rotary (4-axis)" (screens, on) and "Write rotary programs through script posts" (off) | `src/core/features.ts`, `src/pages/MachinePage.tsx` |

### Acceptance

| Criterion | Proof | Measured |
|---|---|---|
| A turned leg simulates in a rotary stock with no gouges | `tests/cam-rotary.test.ts` | Leg 300 mm on a 40 mm square blank: a 50 mm square pommel, then bead, cove, taper and foot (a revolved mesh). Roughing along the axis (T102 flat Ø8, 4 mm step-over, 5 levels, 0.5 mm left) and finishing in rings (T105 ball Ø6, 2 mm step): independent gouge check 0.0004 mm (roughing, sampled, against 0.5 mm stock) and 0.0005 mm (finishing, exact); simulated on the rotary stock (0.5 mm cells), no collisions; the stock against the model on 213,000 rays at most 0.0011 mm below it; what is left on the turned part within the 2 mm / Ø6 cusp (95th percentile); the pommel stays square. Goldens `rotary-leg-rough-along`, `rotary-leg-finish-rings` |
| A fluted column simulates with no gouges | `tests/cam-rotary.test.ts` | Ø50 × 200 column, eight stopped flutes drawn on a wrapped plane (x 30 to 170), 2.5 mm deep with a Ø6 ball: eight plunges, no collisions; the stock within 1e-6 mm of the analytic design on 502,400 rays; the flute floor 22.5 mm from the axis (within 0.001 mm); lands and ends untouched. Golden `rotary-column-flutes` |
| Output only through a script post for a machine model with a rotary axis | `tests/cam-rotary-post.test.ts` | The fluted column through the sample post for a router with an A axis reads back move for move within 0.0005 (mm and degrees); the leg's rings with G93 inverse-time feeds where the axis turns. Refused, each with its reason: the N-200, a machine without that axis, the template post, the switch off, flat work mixed in, angles past the axis's travel, a blade without a saw unit |
| The N-200 export refuses it | `tests/cam-rotary.test.ts`, `tests/cam-rotary-post.test.ts` | A job with a turned part: left out of nesting, `CAM_ROTARY` error with every switch on; no MPR holds a rotary operation; a rotary operation on a flat part is refused like any operation without a woodWOP form |
| Wrapped planes (NEW-14) | `tests/cam-rotary.test.ts` | Frames round X, Y, Z round-trip; unrolled shapes keep their length; plane fitted to a cylindrical face on the axis (and one off it refused); from a STEP solid's Ø5 hole wall: radius 2.5, length 13, 0° to 360°, moved with the model's placement |

Also: `npm run sample` output unchanged (byte for byte); Stage 1 goldens and every earlier 3D
golden unchanged; four new goldens (`rotary-*`).

### Limits recorded

- **Simulation and checks**: the rotary stock is a grid of rays (cells of 0.5 mm or more in the
  simulator; 0.25 to 0.5 mm in the tests); moves that go along and round at once are sampled at a quarter
  cell. The independent gouge check is exact for a ball-nose and sampled for flat and bull-nose
  tools. The simulator's top view shows the outer surface; material inside a groove (walls) is
  seen in 3D.
- **Tool orientation**: the tool always points at the axis (no lead or lag angle, no tilt); the
  axis runs along X, Y or Z of the drawing (not at an angle). Indexed 3+2 work and 5-axis are later
  milestones.
- **From a cylindrical face**: the face must run along the set-up's axis; its angle span comes
  from the face's mesh points (a face with very few points round it is read as the whole way
  round when no gap is wider than three times the usual spacing).
- **Output**: the sample rotary post is an example for a generic G-code router with an A axis,
  not for any machine in the shop; nothing is machine-validated. Rotary output switch off.
- **Simulator opening**: a rotary simulation opens at the end (the background check hands back
  the finished stock); going back replays on the screen's own thread from the start (or an
  operation's start once reached), which can hold the screen for some seconds on a part as big
  as the leg.

## M3.3 screenshots

In `docs/screenshots/stage-2-3/M3.3/`: `01-rotary-setup` (3D tab → Rotary: axis, square blank,
a wrapped plane; the plane unrolled on the drawing with the roughing passes), `02-rotary-operations`
(rings round the axis: plane, step-over and step-down with Configure badges), `03-leg-simulated-unrolled`
(the turned leg's surface unrolled, collision check clear, readout X / A / distance from the axis),
`04-leg-simulated-3d` (the leg turned: square pommel, bead, taper), `05-fluted-column` (eight
flutes drawn on the unrolled plane, wrapped shapes operation), `06-column-simulated-3d` (the
fluted column), `07-machine-rotary-axis` (another machine's model with an A axis and its travel),
`08-feature-switches` (Rotary (4-axis) switch), `09-program-rotary-post` (the column through the
sample rotary post: A words; not written because the script-post and rotary-post switches are
off), `10-n200-refuses` (a job with the turned leg: `CAM_ROTARY`, nothing written for the N-200).

## M3.3 licences

No new dependencies. All new code is our own (frames, wrap maths, rotary stock, checks).

## M3.3 decisions needed

1. **Rotary step-over and step-down**: placeholders (Configure badges) until the shop gives
   values for turned work.
2. **A real rotary machine**: none is in the shop as far as this file knows. The sample post is
   an example only; before any rotary program is run, the machine's own post (or its sample
   program) and its axis conventions (zero angle, direction, work offset on the axis) are needed,
   and the rotary-post switch stays off until then.
3. **Turned parts in N-200 jobs**: today they are refused with an error (the job cannot be
   exported while one is in it). If you would rather they were left out with a warning so the
   rest of the job still exports, say so.

## M3.4 split

Three green parts, each pushed to `main`: **M3.4a** the 3+2 core (tilted planes, kinematics,
conversion both ways, the three-way stock, checks, part format 9, and owner item 3 on turned
parts), **M3.4b** output through a script post for a machine model with 3+2 axes, **M3.4c** the
screens (tilted planes, operation editor, drawing, simulator, Machine page, Plugins), owner item 4
(simulator step-back), screenshots and docs.

## M3.4 positional 3+2: what was built

Commits `9519a5d` (M3.4a), `5610196` (M3.4b), M3.4c (screens, simulator, screenshots and docs;
see `git log`). Part format 9 (a part's optional tilted planes and an operation's work plane;
format 8 parts read unchanged).

| Item | What | Where |
|---|---|---|
| 5AX-01 Tilted work planes | A plane through the part at any angle: an origin, a tilt (0 to 180°), the direction it tilts towards (0° = towards +X, -90° = towards the front), a turn on the plane and a size; its x stays level and its y runs up the slope. Made from angles typed in, a side of the part's block (front, right, back, left, top, underside) or a flat face of a solid (fitted to the face's points; how far they stray is kept and shown). Each plane has a rectangle on the drawing; shapes drawn inside it lie on the plane | `src/cam/positional/frame.ts`, `src/cam/positional/face.ts`, `src/pages/part/TiltedPlanesPanel.tsx` (3D tab), rectangles and labels in `src/pages/part/Canvas.tsx` |
| Operations on a tilted plane | Drilling, pockets, profiles and engraving pick a work plane; the toolpath is made on the plane exactly as on a flat part (same code) and carried onto it, depths below the plane, the tool along its normal. Refused with the reason: router tools only (not the drill block, an aggregate, a saw, a lollipop or a thread mill), a drilling without a tool picked, through cuts, rest and adaptive pockets, faces other than the top, shapes outside the plane's rectangle; warned: a hole larger than the drill, a cut reaching below the part | `generateTilted` in `src/cam/toolpath.ts`, Work plane in `src/pages/part/OpsPanel.tsx` |
| Own kinematics | Three layouts: a fork head (head-head: both axes turn the tool), a trunnion table (table-table: both turn the part about the table's centre) and a rotary table with a tilting head (table-head); any pair of A, B, C. Both solutions worked out in closed form; the one inside the travel with the least turn of the first axis is used (or the other one, per plane). Pivot length (pivot to spindle nose plus the tool's stick-out) unless the control keeps the tool tip on the point. Machine X, Y, Z from part points and back | `src/cam/positional/kinematics.ts`; machine model 3+2 axes in `src/core/machineModel.ts` and `src/pages/machine/MachineModelSection.tsx` |
| Conversion | To machine axes: every move as a straight move (arcs within 0.001 mm, helical entries within 0.01 mm, drill cycles with their pecks spelled out), with the two locked angles per operation, and back again (replay). To vertical: each operation in its plane's own frame, arcs kept, for a control with its own tilted-plane cycle | `src/cam/positional/convert.ts` |
| Three-way stock | A new stock model behind the `StockModel` interface: rays along X, Y and Z on one grid, each holding up to 12 pieces of material (6 for very large blocks). Cut exactly along each ray for flat, ball and bull-nose tools and the shank, for moves along the tool and sideways; moves that do both (ramps, helices) sampled at a quarter cell. The blank can be cut by planes (chamfers). Its top view and 3D mesh come from the same rays | `src/cam/stock/tridexel.ts` |
| Timeline and checks | The operations in the part's frame with the tool direction on every move; between planes the tool backs off 10 mm clear of the block before the axes turn (that turn is not checked). Collision check: shank, holder, rapids through material, spoilboard and table, the side of the cutter in a tilted cut, shank or holder reaching below the part. Can replay the machine's own program instead of the part-frame path (the tests do) | `src/cam/positional/sim.ts` |
| N-200 refuses | A part with tilted operations is left out of the cut list and nesting (warning) and the job export is refused (`CAM_POSITIONAL`, error, whatever the switches), naming the part and its tilted operations and saying to remove the part (or switch those operations off) to export the rest; no tilted operation reaches the MPR writer | `src/core/validator.ts`, `src/core/cutlist.ts`, `src/core/pipeline.ts` |
| Output through a script post | Post input per operation: the two axis letters and locked angles, layout, tip control, where the part sits, pivot length, tool direction, the plane, the machine moves and the vertical (plane-frame) moves. Text-post checks: a script post (the template post refuses and writes only a comment), the "Write 3+2 programs through script posts" switch (off), a machine model with two rotary axes for 3+2 that can tilt the tool every way, angles and X, Y, Z inside the travel, no turned work in the same program. Sample `examples/plugins/positional-3plus2-post.js` (retract, turn both axes, G0/G1 in X Y Z against G54 at the part origin; not machine-validated), added from Settings → Plugins | `src/cam/post.ts`, `checkTextPost` in `src/core/validator.ts`, `src/cam/plugin/posts.ts`, `src/pages/settings/PluginsSection.tsx` |
| Machine model 3+2 axes | Machine & tools → machine model → 3+2 axes: layout (none, fork head, trunnion table, table and head), the two letters, their travel, pivot length, table centre, where the part sits, tip control; problems listed (e.g. a layout that cannot tilt the tool every way). The invented placeholder figures carry a Configure badge; the N-200 shows "none" | `withPositional` in `src/core/machineModel.ts`, `src/core/confirm.ts`, `src/pages/machine/MachineModelSection.tsx` |
| Simulator | 3+2 mode: the three-way stock, the tool drawn along each plane's normal, readout "tool tilted …°"; the collision check runs in the background and hands back the finished stock | `src/pages/part/SimulateDialog.tsx`, `sim.positionalCollide` in `src/cam/worker/tasks.ts` |
| Owner item 4: going back in the simulator | Rotary and 3+2: the background check also hands back up to eight stock states (within 128 MB), spaced by carving time; going back restores the nearest earlier one and replays only from there | `takeMarks` in `src/cam/collision/collision.ts`, `src/cam/rotary/sim.ts`, `src/cam/worker/tasks.ts`, `src/pages/part/SimulateDialog.tsx` |
| Owner item 3: turned parts in N-200 jobs | Still blocks the whole job (`CAM_ROTARY`); the message names each turned part and ends "Remove <part> from this job to export the rest of it." | `src/core/validator.ts` |
| Switches | "Positional 3+2" (screens, on) and "Write 3+2 programs through script posts" (off) | `src/core/features.ts`, `src/pages/MachinePage.tsx` |

### Acceptance

The test block (`tests/positional-fixtures.ts`): 120 x 100 x 60 mm, its blank cut by a 45°
chamfer along the right top edge, a 30° chamfer along the front top edge and a corner facet at
the back left (54.7° tilted towards 135°, a compound angle, plane made from the facet as a face).
Five holes (Ø8 x 12 on the 45° chamfer, Ø6 x 10 on the 30° chamfer, Ø8 x 15 on the corner facet,
Ø8 x 20 on the upright back side) and three pockets (Ø16 x 5 on the 45° chamfer, 40 x 14 R4 x 6 on
the 30° chamfer, 30 x 16 R5 x 4 on the back), T102 Ø8 and T103 Ø6, helical entries.

| Criterion | Proof | Measured |
|---|---|---|
| Tilted-plane holes and pockets land within 0.01 mm after the axis conversion, checked in simulation | `tests/cam-positional.test.ts` | Converted to each test machine's two locked angles and X, Y, Z, read back through the kinematics (within 1e-13 mm) and simulated on the chamfered blank (three-way stock): **fork head C/B, no tip control, pivot 150 mm** (C0 B45 / C-90 B30 / C-45 B-54.7356 / C90 B90; 0.25 mm rays, 93,190 cut points, 10.9 s), **trunnion table A/C** (A45 C90 / A30 C180 / A-54.7356 C135 / A-90 C180; 0.5 mm rays, 23,292 points, 2.8 s), **rotary table C with tilting head B, tip control** (C0 B45 / C90 B30 / C45 B-54.7356 / C-90 B90; 0.5 mm rays, 23,292 points, 2.7 s). On every machine: hole walls and floors 0.0000 mm, pocket walls 0.0010 mm (the 0.001 mm chord tolerance on arcs), pocket floors 0.0000 mm from the design; no cut point on any undesigned surface; every feature cut; no collisions. The other solution (head turned the other way round) cuts the same. Goldens `positional-*` |
| N-200 export refuses it | `tests/cam-positional.test.ts` | A job with the block and a plain panel, every output switch on: `CAM_POSITIONAL` error naming the part and its two tilted operations and saying to remove it to export the rest; the block left out of the cut list and nesting (the plain panel is still nested); no MPR holds a tilted operation; with its tilted operations switched off the block nests again. The machine program for the N-200 is refused ("Its machine model has no 3+2 (positional) axes.") |
| Convert to vertical | `tests/cam-positional.test.ts`, `tests/cam-positional-post.test.ts` | The front pocket in its plane's own frame gives the same moves as the tilted toolpath, within 1e-9 mm, arcs kept as arcs; the post gets it with every operation |
| Output only through a script post for a machine model with 3+2 axes | `tests/cam-positional-post.test.ts` | The test block through the sample post for each layout: 2,133 moves read back through the kinematics, worst 0.0014 mm (fork head C/B, pivot 150), 0.0011 mm (trunnion A/C), 0.0008 mm (table C, head B, tip control); 3 decimals written. The axes turn after a retract wherever the angles change. Refused, each with its reason: the N-200, a router without 3+2 axes (its post gets no tilted move), axes too short for an angle or for X, the template post (comment only), a layout that cannot tilt the tool every way, turned work in the same program, no grant, the 3+2 switch off |
| Collisions are caught | `tests/cam-positional.test.ts` | A 45 mm hole on the back with T102 (30 mm flutes): "shank hits material above the flutes" (5.75 mm); a hole 5 mm above the underside on the back: "shank or holder reaches below the part's underside" (29 mm) |
| Kinematics | `tests/cam-positional.test.ts` | Round trip part → machine → part for 3 layouts, 6 axis pairs, 6 tool directions and both solutions: worst 5.4e-12 mm |

Also: `npm run sample` output unchanged (byte for byte); Stage 1 goldens and every earlier 3D
golden unchanged; seven new goldens (`positional-*`: four tilted toolpaths, three machine
programs).

### Limits recorded

- **Operations**: drilling, pockets, profiles and engraving on a tilted plane, from the top face
  of the plane; no through cuts, rest or adaptive pockets, aggregates, saws or lollipop tools on
  a tilted plane yet; 3D finishing on a tilted plane (and simultaneous 5-axis) are later
  milestones.
- **Turning between planes**: the tool backs off 10 mm clear of the block before the axes turn;
  the turn itself is not collision-checked (the machine's own path while turning depends on its
  control). **Closed in M3.5b**: the turn is now modelled (back off, rise clear above the block,
  turn while moving over, come down) and every part of it is checked.
- **Three-way stock**: rays every 0.5 mm or more in the simulator (0.25 to 0.5 mm in the tests);
  exact along each ray, with ramps and helices sampled at a quarter cell; up to 12 pieces of
  material per ray (6 for very large blocks; extra pieces are merged, which can only put
  material back, and the tests check nothing is left off the designed surfaces).
- **Kinematics**: the pivot length, table centre and part position of the placeholder 3+2 axes
  are invented (Configure badges). No machine with 3+2 axes is in the shop; the sample post is a
  generic example, not machine-validated, and the 3+2-post switch stays off.
- **Simulator step-back (owner item 4)**: with the stock states from the background check, going
  back on the turned leg replays at most about 2 s on the screen (it was about 12 s from the
  start); that stretch still runs on the screen's own thread. Moving the replay itself to the
  background would mean sending the stock back and forth on every scrub, so it is left as is.

### Test-suite note (M3.4)

This run's container is as slow as the M2.10 one. On the untouched baseline (`339f84e`) the
known timing test "adaptive clearing per Z level" took 168 s in the full suite and 120 s on its
own (limit 90 s), so it fails here by time alone, before and after M3.4 (169 s in the final
suite); the limit was not changed. Every other test passes: 977 passed, 1 skipped, that 1
timing failure. The 3+2 tests take 27 s on their own.

## M3.4 screenshots

In `docs/screenshots/stage-2-3/M3.4/` (a demo block, 200 x 150 x 80 mm): `01-tilted-planes` (3D tab →
Tilted planes: four planes, two sides of the block and two typed in, 30° to the front and a
compound 25° to the back right, with the tool direction and how far the block reaches below each;
their dashed rectangles on the drawing), `02-work-plane-operation` (a pocket on the front side:
Work plane, "Depth below the plane", no through cut), `03-simulated-top` (the finished block from
the top with the backplot, readout "tool tilted 90.00°", collision check clear),
`04-simulated-3d-tilted-tool` (3D, the tool tilted 30° drilling the leg holes),
`05-simulated-3d-end` (the finished block in 3D), `06-machine-32-axes` (another machine's model
with 3+2 axes: both in the head, C then B, travel, pivot, part origin, tip control, with the
Configure badge), `07-feature-switches` (Positional 3+2, on), `08-program-32-post` (the block
through the sample 3+2 post: retract, turn C-90 B30, then X Y Z; preview only, naming the
script-post and 3+2-post switches that are off), `09-n200-refuses` (a job with the block:
`CAM_POSITIONAL` naming the part and its five tilted operations, the part left out of the cut
list and nesting), `10-output-switch-off` (the Machine page output switches, "Write 3+2 programs
through script posts" off).

## M3.4 licences

No new dependencies. All new code is our own (plane frames, kinematics, conversion, three-way
stock, checks).

## M3.4 decisions needed

None blocking. For the record, applied from earlier answers without asking again:

1. **3+2 kinematics figures** (pivot length, table centre, where the part sits): placeholders
   with Configure badges; there is no 3+2 machine in the shop (no rotary machine, decision 21),
   so the sample 3+2 post stays a labelled generic example and its switch stays off.
2. **Parts with tilted operations in N-200 jobs**: they block the whole job, like turned parts
   (decision 21, item 3); the message names the part and says to remove it to export the rest.

## M3.5 split

Three green parts, each pushed to `main`: **M3.5a** the 5-axis core (the `MultiAxisEngine`
interface, the "not licensed" stub, the preview / test engine, tool axes in the toolpath IR, our
checks on what an engine returns, barrel and form tools, part format 10), **M3.5b** our own
simultaneous kinematics (head flip, poles, axes never wrapped), the simulation with the tool tilted
on every move, the check of the axis turn between operations, the N-200 refusal and output through
a script post for a machine model with simultaneous 5-axis, **M3.5c** the screens, screenshots and
docs.

## M3.5 simultaneous 5-axis interface: what was built

Commits `4e80843` (M3.5a), `836c846` (M3.5b), M3.5c (screens, screenshots and docs; see `git log`). Part format 10 (5-axis operations;
format 9 parts read unchanged).

**The intended real engine is a licensed commercial SDK (ModuleWorks is the usual choice). Nothing
was bought, downloaded or signed up for.** The shop's engine slot holds the stub, which answers
"5-axis engine not licensed".

| Item | What | Where |
|---|---|---|
| `MultiAxisEngine` interface | An engine gets plain data (it can run in the compute worker or another process): the model placed in the part, or the drive / top / guide curves; the boundary; the tool with its cutting outline, shaft and holder; the strategy's settings; the machine's two rotary axes, layout and travel; the head-flip choice as a hint. It returns our toolpath IR with a tool direction on every move, and warnings, or "not licensed" / "unsupported" / "failed" with the reason | `src/cam/multiaxis/engine.ts` |
| Stub ("not licensed") | The shop's engine until a licensed one is installed: every request answers "5-axis engine not licensed: …" and nothing is calculated | `STUB_ENGINE` in `engine.ts` |
| Preview / test engine | Our own simple methods: along 3D curves or solid edges (tip a depth below the curve along the tool), swarf (bottom and top curves walked together, the side of the tool on the wall), ball-nose surface finishing (our 3-axis parallel finishing finds where the ball sits, then the tool turns about the ball's centre, so the ball cuts exactly what the 3-axis passes cut). No roughing. In the app it is "Built-in preview (for the simulator only)"; its toolpaths are never written. The tests declare the same code licensed to stand in for a licensed engine | `src/cam/multiaxis/fake.ts` |
| Tool-axis control (5AX-02) | Straight up, fixed tilt, along the surface normal or square to the curve (with lead along the cut and tilt to the left), through or away from a point or a line, towards a guide curve; largest tilt; axis smoothing (degrees per mm). Strategies (5AX-03): along curves, swarf, surface finishing, multi-axis roughing (licensed engine only) | `src/cam/multiaxis/axis.ts`, `MultiAxisOp` in `src/cam/types.ts` |
| Toolpath IR with tool axes | Rapid and feed moves carry `a`, 3D chains `axes` (unit, tip to spindle, part frame); a 5-axis toolpath has them on every move and no arcs or drill cycles (`Toolpath.multiAxis` says which engine made it, licensed or preview, largest tilt and turn, our gouge check) | `src/cam/toolpath.ts`, `src/cam/moves.ts` |
| Our side of any engine result | The moves are checked (straight moves only, unit directions, numbers); cut as made, reversed, or there and back (NEW-26); the axis measured; our independent gouge check (exact for a ball-nose at any tilt) | `src/cam/multiaxis/result.ts`, `src/cam/multiaxis/check.ts` |
| Barrel and form tools (TOOL-07) | Barrel: widest at the diameter, side arc (barrel radius), rounded tip. Form: any outline typed in point by point (heights, radii, arcs), cutting up to the flute length, the shaft above it for the collision checks. Used by the simulator, the stocks (swept correctly when the tool moves along itself) and the collision checks. Placeholder barrel T110 with Configure badges | `src/cam/tools/form.ts`, `src/core/types.ts`, `src/pages/machine/ToolDialog.tsx` |
| Simultaneous kinematics and head flip (NEW-26) | Both closed-form solutions per point; one branch followed (each point nearest the last; angles never wrapped); head flip usual / other / whichever fits the travel; at a pole the free axis is held; a rotary axis swinging round within a cutting move (out of travel, or through a pole) is refused; moves split until the machine's even axis motion keeps the tip within 0.01 mm of each straight move; machine X, Y, Z and both angles per move; the kinematic replay back into the part | `src/cam/multiaxis/kinematics5.ts` |
| Simulation | The tilted-tool (three-way) stock with the tool direction on every move (moves split to turn at most 1°), the collision checks along the tilted tool; replayed through a machine's kinematics when one is given | `src/cam/positional/sim.ts`, `SimulateDialog.tsx` |
| Axis turn between operations (closes an M3.4 limit) | Where the tool direction changes between operations the tool backs off along itself clear of the block, rises straight up clear above it, turns the axes while moving over, comes down and goes in along the new direction (the way the sample posts retract before they turn); every part of it is checked: the whole tool, shank and holder against the material left and against the table round the part | `src/cam/positional/sim.ts` |
| N-200 refuses | A part with 5-axis operations is left out of the cut list and nesting (warning) and the job export is refused (`CAM_MULTIAXIS`, error, whatever the switches), naming the part and its 5-axis operations and saying to remove it (or switch them off) to export the rest | `src/core/validator.ts`, `src/core/cutlist.ts`, `src/core/pipeline.ts` |
| Output through a script post | Post input per operation: both axis letters, layout, tip control, where the part sits, pivot length, the branch, and every move with X, Y, Z, both angles, the tool direction and (feed moves) the tip's travel for inverse-time feeds. Text-post checks: a script post (the template post writes only a comment), the "Write 5-axis programs through script posts" switch (off), a licensed engine's toolpath (never the preview), our gouge check passing, a machine model with simultaneous 5-axis, every angle and position inside the travel, no turned work in the same program. Sample `examples/plugins/simultaneous-5axis-post.js` (G-code with both rotary words, G93 inverse-time feeds where a rotary axis turns while cutting; not machine-validated), added from Settings → Plugins | `src/cam/post.ts`, `checkTextPost` in `src/core/validator.ts`, `src/cam/plugin/posts.ts` |
| Machine model | Machine & tools → machine model → 3+2 axes → "The rotary axes also move while it cuts (simultaneous 5-axis)", for machines other than the N-200 | `withSimultaneous` in `src/core/machineModel.ts`, `src/pages/machine/MachineModelSection.tsx` |
| Switches | "Simultaneous 5-axis" (screens, on) and "Write 5-axis programs through script posts" (off) | `src/core/features.ts`, `src/pages/MachinePage.tsx` |

### Acceptance

Spec (M3.5): a `MultiAxisEngine` interface, a stub engine that returns a clear "not licensed"
result, and tests with a fake engine; no licence bought and no SDK added without the owner's
written OK. Measured in `tests/cam-multiaxis.test.ts`, `tests/cam-multiaxis-sim.test.ts` and
`tests/cam-multiaxis-post.test.ts`:

| Criterion | Proof | Measured |
|---|---|---|
| The interface | `cam-multiaxis.test.ts` | The request is plain data (structured-clone round trip); a licensed engine plugs into the shop's slot (`GenContext.engine`) and every move it returns carries a unit tool direction; an engine returning moves without directions, non-unit directions or arcs is refused with the reason, nothing kept |
| The stub: "not licensed" | `cam-multiaxis.test.ts`, `cam-multiaxis-post.test.ts` | With no licensed engine every 5-axis operation answers "5-axis engine not licensed: …", no moves; an unknown engine name falls back to the shop's engine with a note; in the Program dialog a not-calculated 5-axis operation blocks writing (`POST_NOT_READY` with that text) |
| Tests with a fake engine (5AX-02, 5AX-03) | `cam-multiaxis.test.ts` | Tool-axis rules exact (through / away from a point or line within 1e-9; fixed tilt, lead and tilt, square to a curve, guide curve to 1e-9°; tilt limit; smoothing ≤ 2°/mm after a 60° step). Along a 3D curve on the hemisphere (T106 Ø3, 0.5 mm deep): 144 points, the tip 0.5 mm below the curve within 7.1e-15 mm, the tool within 1.4° of the sphere's normal (the faceted model's normals; smoothing off). On a flat leaning face the tool stands on its normal within 1e-4°. Swarf on a wall leaning 20° (T102 Ø8): 100 points, the axis in the wall within 5.6e-17, the side of the tool on the wall within 1.8e-15 mm. Ball-nose surface finishing with the tool on the normal (≤ 35°): 4130 points, 3923 tilted over 1°, largest 35.00°; ball centres equal the 3-axis passes' within 7.3e-15 mm; our independent gouge check 0.0005 mm over 9902 positions. Goldens `multiaxis-curve-latitude`, `multiaxis-swarf-wall`, `multiaxis-surface-hemisphere` (the 3D digest now also hashes tool directions; earlier goldens have none and are unchanged) |
| Independent gouge check | `cam-multiaxis.test.ts`, `cam-multiaxis-post.test.ts` | A ball 0.3 mm into the dome at 30° tilt is found at 0.30 mm; a groove meant to go 0.3 mm into the model is not a gouge, 0.1 mm meant finds 0.2; an engine whose toolpath digs 0.2 mm deeper is refused for output (`POST_MULTIAXIS_GOUGE`) |
| Barrel and form tools (TOOL-07) | `cam-multiaxis.test.ts` | Barrel T110 outline on its tip ball and side arc within 1e-9 mm, widest Ø12 at its widest point; the simulator's underside within the 0.002 mm chord; plunged along its axis into the three-way stock the hole matches the outline within 0.01 mm (widest radius carried up); form-tool outline arcs within 0.002 mm; outline typed as text round-trips; Configure badges on T110 |
| Head flip and cutting reversed / both ways (NEW-26) | `cam-multiaxis.test.ts`, `cam-multiaxis-sim.test.ts` | Reversed: the same points backwards, way in and way out swapped; both ways: twice the cutting; the other solution: first axis 180° apart, second axis the other sign, the same tip within 1e-9 mm; auto takes the other one when the usual one leaves the travel (noted) |
| Simultaneous kinematics | `cam-multiaxis-sim.test.ts` | Every machine move turns back into the tip within 1e-9 mm and direction within 1e-7° (3 layouts, both solutions); axes never wrapped (two turns of the tool keep counting, refused on a C axis of ±300°: "would swing … within one cutting move"); the free axis held at a pole (C held at 90° through upright stretches); a cone at 45° tilt, 12 points, fork head C/B without tip control (pivot 150 mm + stick-out): 195 machine moves, played back within 0.0047 mm of the straight moves |
| Simulation | `cam-multiaxis-sim.test.ts` | Swarf wall leaning 20° (T102 Ø8, 0.25 mm rays): 18 wall points within 0.000 mm of the design, no collisions; hemisphere finished with the ball tilted up to 35° (0.5 mm rays): deepest below the model 0.0140 mm (the sampling of the faceted model), 2442 sampled columns cut; a 5-axis program replayed through a fork head without tip control plays every cutting point within 0.01 mm |
| Axis turn between operations (M3.4 limit closed) | `cam-multiaxis-sim.test.ts`, `cam-positional.test.ts` | The M3.4 test block with the placeholder holder: clear (all M3.4 acceptance tests unchanged); with a holder 200 mm across the turn is caught: 3 collisions while the axes turn, the first "Holes Ø8 (Back side), move 1: tool or holder reaches below the part's underside while the rotary axes turn" |
| N-200 refuses | `cam-multiaxis-post.test.ts` | A job with the 5-axis part and a plain panel, every output switch on: `CAM_MULTIAXIS` naming the part and its operation; the part left out of the cut list and nesting (the plain panel is still nested); with its 5-axis operation off it nests again |
| Output only through a script post for a machine model with simultaneous 5-axis | `cam-multiaxis-post.test.ts` | The sample post on three layouts, every move read back through the kinematics: head-head C/B (pivot 150 mm) 2696 moves, tip within 0.0024 mm; table-table A/C (pivot 150 mm) 2259 moves, 0.0014 mm; table-head C/B with tip control 1755 moves, 0.0010 mm; tool direction within 0.0005° (3 decimals written); 63 inverse-time (G93) switches each. Refused, each with its reason: the N-200, the switches, no grant, the preview engine's toolpath, no licensed engine, a gouge, a machine with 3+2 axes that do not move while cutting (its post gets no 5-axis move), axes too short, the template post (comment only) |

Also: `npm run sample` output unchanged (byte for byte); Stage 1 goldens and every earlier 3D
golden unchanged; three new goldens (`multiaxis-*`). Two of them were regenerated within this run
after fixes made before the M3.5c commit, each explained: `multiaxis-curve-latitude` (only its
warning text: a groove cut as deep as asked no longer counts as a gouge, so "0.509 mm into the
model" became "0.009 mm … beyond the 0.5 mm depth asked for"; moves unchanged) and
`multiaxis-surface-hemisphere` (the preview engine now treats normals within 0.2° of upright as
upright, so on the flat round the dome the tool stands exactly upright instead of turning its
first axis round for nothing; the box corner moved from 0.002 to 0).

### Limits recorded

- **No real 5-axis engine.** The preview engine is ours and deliberately simple: no collision
  avoidance for the shaft and holder (our collision check reports them), no axis optimisation
  beyond the tilt limit and smoothing, no roughing, swarf exact only where the wall is flat
  across each line from bottom to top. Its toolpaths are never written.
- **Gouge check**: exact for a ball-nose at any tilt; other tool shapes are not checked against
  the model by us (the simulator's stock shows them; the export checker warns).
- **Simulation**: 5-axis moves are split so the tool turns at most 1° per piece, each piece cut
  with its middle direction; the three-way stock is exact along its rays (cells 0.5 mm or more in
  the simulator). A move where only the tool direction changes (the tip standing still) is not
  carved. Jumping far ahead on a big 5-axis part replays on the screen's thread (as in M3.4) and
  can hold the screen.
- **Kinematics**: our own, on the machine model; the machine's real behaviour (tip control,
  which way an axis takes round, inverse-time rules) depends on its control. The turn between
  operations is modelled as back off, rise, turn while moving over, come down.
- **Output**: the sample 5-axis post is a generic example for a G-code router with two rotary
  axes, not for any machine in the shop; nothing is machine-validated; its switch stays off.

### Deferred items still open (from M3.4, owner decision 22)

- 3D finishing, through cuts, rest machining and adaptive clearing on tilted planes.
- Going back in the simulator: the remaining stretch (about 2 s on the turned leg) still replays
  on the screen's thread.
- (Closed in M3.5b: the axis turn between planes is now collision-checked.)

## M3.5 screenshots

In `docs/screenshots/stage-2-3/M3.5/` (a demo dome cap, 160 x 160 x 50 mm, with Z-level roughing,
a 5-axis surface finishing and a 5-axis groove round the dome made by the preview engine, and one
operation asking for the licensed engine): `01-add-5axis-operation` (Add operation → 5-axis:
along curves, swarf, surface finishing, roughing), `02-engine-not-licensed` (the operation on the
shop's engine: "5-axis engine not licensed …"), `03-surface-finishing-settings` (engine, strategy,
model, step-over with its Configure badge), `04-tool-axis-head-flip` (tool axis along the surface
normal with lead and tilt, largest tilt, axis smoothing, cut as made / reversed / there and back,
head flip, gouge check), `05-simulated-3d-tilted-tool` (the finished dome in 3D, readout "tool
tilted 33.73°", collision check clear), `06-simulated-top` (top view with the backplot),
`07-barrel-tool` (the placeholder barrel T110: tip and side arc radii, its outline drawn, Configure
badges), `08-machine-simultaneous-5axis` (an example machine's model: 3+2 axes C then B and "The
rotary axes also move while it cuts"), `09-feature-switches-engine` (the Simultaneous 5-axis switch
and the engine status: not licensed; the preview for the simulator only), `10a-plugins-sample-post`
(Settings → Plugins with the sample 5-axis post, machine output not granted),
`10-program-5axis-post` (the dome through the sample 5-axis post: both rotary axes on every line,
G93 where they turn; preview only, naming every reason it is not written: switches off, no grant,
made by the preview engine, the licensed-engine operation not calculated), `11-n200-refuses` (the
job with the dome: `CAM_MULTIAXIS` naming the part and its three 5-axis operations; the part left
out of the cut list and nesting).

## M3.5 licences

No new dependencies. All new code is our own (engine interface, stub, preview engine, tool-axis
rules, barrel and form outlines, simultaneous kinematics, checks). The screenshots were taken with
Playwright (Apache-2.0) installed outside the project, not added to it.

## M3.5 decisions needed

1. **A 5-axis engine licence (for the record; nothing to do now).** Simultaneous 5-axis toolpaths
   for real cutting need a licensed engine (ModuleWorks is the usual choice). Cost: a commercial
   licence (price on request from the vendor, usually a yearly fee plus integration work);
   benefit: real 5-axis strategies with full gouge and collision avoidance and axis optimisation.
   With no 5-axis or 3+2 machine in the shop (decision 22), my recommendation is **do not buy**;
   revisit only if such a machine is coming. Until then: the shop's engine answers "not
   licensed", the preview engine is for the simulator only, and 5-axis output stays off (and never
   reaches the N-200). Nothing was bought, downloaded or signed up for.
2. **Placeholder 5-axis cutting values** (step-over, step-down, largest tilt, axis smoothing) and
   the barrel T110: Configure badges, like every other placeholder (no answer needed now).

## M3.6 split

Three green parts, each pushed to `main`: **M3.6a** clamps, pods and rails (FIX-01) with our own
convex distance engine and fixtures in every collision check (part format 11), **M3.6b** the
machine simulation (SIM-06: the machine's parts on its kinematic chain, the replay of toolpaths
or of a program read back, the machine collision check) and the part compare (SIM-04) as worker
tasks, **M3.6c** the screens (machine view, compare views, fixtures panel and drawing layer,
Machine & tools sections), screenshots and docs.

## M3.6 machine simulation, part compare and fixtures: what was built

Commits `5d28787` (M3.6a), `54131fe` (M3.6b), M3.6c (screens, screenshots and docs; see `git log`).
Part format 11 (fixtures on parts; format 10 parts read unchanged). Switch "Machine simulation,
part compare and fixtures" (screens, on). No new dependencies.

| Item | What | Where |
|---|---|---|
| Convex distance engine | Solids given by their support function: prisms, frusta with a rounded edge, spheres, boxes; a solid swept along a straight move (exact: the swept volume of a moving convex solid is convex), two poses joined (hull) and grown (the bulge of a turn), placed and turned. Distance by GJK (Ericson's closest point on the simplex), an overlap depth estimate, boxes for quick rejection. Our own code | `src/cam/collision/convex.ts` |
| Fixtures (FIX-01) | A fixture on a part: clamp, pod or rail; a block, a round, a closed shape drawn on the part stood up to a height (triangulated, exact), or a model file (STL, OBJ, 3MF, STEP, IGES, BREP) kept as 12 height slices, each the convex outline of what the model has between two heights (an arm over the part leaves the space under it free). Placed at X, Y, Z and turned; switched off = not checked. Clamps stand on the table beside the part, pods and rails under it | `src/cam/fixtures/fixture.ts`, `Fixture` in `src/cam/types.ts` |
| Fixture library | The shop's clamps, pods and rails (Machine & tools → Fixtures). Four invented examples (toggle clamp 60 x 40 x 50, vacuum pod 120 x 120 x 100, round pod Ø120 x 100, rail 1500 x 100 x 50) with Configure badges until the shop enters its own; a fixture placed from an invented type carries its own badge | `PLACEHOLDER_FIXTURE_TYPES`, `src/core/confirm.ts`, `src/pages/machine/MachineSimSections.tsx` |
| Automatic placing | Clamps round the part (its outline split into stretches, the nearest station to each stretch's middle, pushed out until clear), pods under it on a grid where no tool reaches below; each kept clear of the whole tool (cutter, shank and holder plus the collision margin) along every move, swept, in the worker | `src/cam/fixtures/place.ts` |
| Fixtures in the collision checks | 3-axis, tilted (3+2) and 5-axis: cutter, shank and holder against every fixture, swept along each move (rapids too), the first place found by halving, with the collision margin (2 mm, the machine's own). A hit is a collision (`fixture`) naming the part of the tool and the fixture, jumping to its move, and **blocks the export** (`CAM_COLLISION`). The tool is never expected to cut a fixture | `src/cam/collision/fixtureCheck.ts`, `collision.ts`, `src/cam/positional/sim.ts` |
| Machine's parts (SIM-06) | Boxes and cylinders, each carried by one link of the kinematic chain (frame, X, Y, Z, the head's two rotary axes, the table's two). Invented for each layout until measured (N-200: gantry beam and legs, Y carriage, head plate, spindle motor, vertical drill block; fork head, table-table and table-head examples), one Configure badge for the set; the spoilboard and table from the machine model's figures | `src/cam/machine/model.ts`, `MachineModel.bodies` |
| Kinematic replay | The toolpaths as machine moves: 3-axis through the straight moves (arcs within 0.01 mm), 3+2 through `machineProgram`, 5-axis through the simultaneous kinematics; or a program read back: the part's own woodWOP program (MPR reader) or a program file such as a post's output (G-code with the rotary words; G53 Z from the top of the Z travel; G54 at the part's origin). Between operations it goes to the tool change, and rises and turns the axes while moving over, as the sample posts do. Every link placed by the chain at any time | `src/cam/machine/replay.ts`, `readGcodeAxes` in `src/cam/programRead.ts` |
| Machine collision check | Every machine part against the table, the part's block and its fixtures; the tool and holder against the fixtures and the table; exact along straight moves (swept), in half-degree steps where a rotary axis turns (each step grown by its bulge); every axis against its travel. Each hit names what hits what, the operation, move or line, the axes, how deep, and jumps there. **Simulator only** (the machine's parts are invented): it does not block the export | `src/cam/machine/check.ts` |
| Part compare (SIM-04) | The finished stock (the simulator's own, simulated to the end) against the part's visible 3D models: signed distance from each stock surface point (one per cell) to the design, a closed model as its solid, an open one (a relief or surface) counted down to the underside inside its outline. Gouges red, material left blue, within the tolerance (0.05 mm, settable) green, full colour at 2 mm (settable); the deepest gouge and the most material left with where they are; a small top view. In the worker | `src/cam/compare/compare.ts`, `src/cam/compare/parts.ts` |
| Screens | Part designer 3D tab → Clamps, pods and rails (cards with sizes and badges; add from the library, from closed shapes, from a model file; Place automatically); fixtures drawn on the drawing and dragged there; Simulate → **Machine** (machine and source chosen, part placement, the machine in 3D with its own player, hits list, readout); Simulate → 3D → **Compare with the model** (colour map, red dot at the deepest gouge, legend, tolerance); Custom parts → **Compare with models…** (several parts, a row each with a top view); Machine & tools → Machine parts, Fixtures; the switch | `src/pages/part/FixturesPanel.tsx`, `Canvas.tsx`, `MachineView.tsx`, `SimulateDialog.tsx`, `CompareDialog.tsx`, `src/pages/machine/MachineSimSections.tsx` |

### Acceptance

Spec (M3.6): the machine model drives a kinematic replay; a deliberate head-into-clamp case is
caught; part compare colours a known gouge correctly. Measured in `tests/cam-fixtures.test.ts`,
`tests/cam-machine-sim.test.ts` and `tests/cam-compare.test.ts`:

| Criterion | Proof | Measured |
|---|---|---|
| The machine model drives a kinematic replay | `cam-machine-sim.test.ts` | 3 layouts x 300 random poses: the replayed chain's tool tip, direction and axes agree with the 3+2 kinematics within 5.1e-13 mm. 3-axis: every straight cutting move played, times rising, the tool change first; tip within 0.0101 mm of the toolpath's arcs. The sample 3+2 post's G-code read back as machine axes: 2167 steps, 2097 cutting points played within 0.0014 mm. A 5-axis program along a curve on the dome on a fork head C/B without tip control (pivot 150 mm): every toolpath point played within 0.0000 mm, the rotary axes turning while cutting. A table-table machine turns the part and its clamps with the table (within 1e-9 mm). The N-200 cannot replay tilted work: said, and the flat work replays |
| A deliberate head-into-clamp case is caught | `cam-machine-sim.test.ts`, `cam-fixtures.test.ts` | N-200, a tall clamp beside a pocket: the holder clears it (the cutting check is clean) but "Pocket, move 150: Spindle motor hits fixture "Clamp A" … (3.95 mm)"; 0.05 mm lower it is clear. With the N-200's invented parts a tall clamp is caught by the spindle motor (22.60 mm), a low one is not. 3+2 fork head: drilling the 45° chamfer, "Spindle housing hits fixture "Clamp A" … C0.00 B45.00 (76.28 mm)". The same caught from the sample 3+2 post's output read back (with its line number) and from the N-200's own woodWOP program read back. A tall clamp between the tool change and the part is hit "between operations". An axis past its travel: "X goes to 3756.000, beyond its travel (0 to 3658 mm)" |
| Fixtures in the cutting checks (FIX-01) | `cam-fixtures.test.ts` | Distances against exact answers over 4000 random cases: worst 1.3e-8 mm. The holder into a tall clamp: "Pocket, moves 47-49: holder hits fixture "Clamp A" (2.88 mm)", where it starts, within the holder's reach; 0.05 mm further away it is clear. A through cut over a pod: "cutter hits fixture "Pod 1" (2.30 mm)"; moved clear, or switched off, not reported. First place along a 300 mm move by halving: 194.01 mm (exact). A tilted (45°) holder over a clamp: caught (42.40 mm). Four clamps placed round a part 14-16 mm off it (cutter 12 + margin 2), four pods under it, every one clear of every move; one pushed onto the cut-out is caught. A part whose holder hits its clamp blocks the job export (`CAM_COLLISION` naming the fixture); clear, it does not. An imported L-shaped clamp keeps the space under its arm (10 mm and 1 mm off as built). Round trip in a part file; Configure badge until confirmed |
| Part compare colours a known gouge correctly | `cam-compare.test.ts` | A flat design 5 mm down, a Ø8 spot 0.5 mm too deep: 208 red points, all inside the spot, deepest 0.5000 mm; nothing else red; a strip left uncut is blue at 5.000 mm; the rest within ±0.05 mm. A closed design: a groove 2 mm too deep red at 2.000 mm, a strip left outside it 0.750 mm, the part cut away round it clean. Three parts simulated to their ends: clean (within 100.0 %, no red in its top view), gouged (0.800 mm at the spot), short (5.000 mm left). The compare uses the simulator's own stock, one point per cell |

In the app (screenshot 07): the demo relief door with a spot pocket cut 1 mm below the flat
shows "Deepest gouge 1 at X 213.625 Y 32.125 Z -15", red at the spot, and the material the ball
leaves where the dome meets the flat in blue (0.479 mm).

Also: `npm run sample` output unchanged (byte for byte); every Stage 1 and 3D golden unchanged;
lint 17 warnings (the old ones).

### Limits recorded

- **The machine's parts are invented** (sizes and places) until the shop measures them, so the
  machine collision check is only as good as those figures: it is shown in the simulator and does
  **not** block the export. Fixture hits by the tool, shank or holder do block it.
- **Fixtures from a model** are convex per height slice (12 slices): within a slice a hollow is
  filled, so a hit may be reported a little early, never missed; a drawn shape is exact.
- **Turns** are checked in half-degree steps, each grown by its bulge: safe, a little cautious.
- **Programs read back**: G-code with G0/G1/G2/G3 (arcs as straight moves within 0.01 mm), the
  rotary words, G53/G54, G90/G91, G20/G21, G93/G94, tool changes; drill cycles are refused. The
  woodWOP program is read with our MPR reader (what it understands).
- **Part compare** is as fine as the simulator's cells (0.5 mm or more) and compares the top
  surface the stock keeps (a heightfield has no undercuts; the tilted stock is used for tilted
  work); distances beyond the full-colour range are capped, except the highest 256 points, which
  are measured exactly. Gouges at the very edge of the cut can read a little deeper than the
  vertical depth (the distance is to the nearest point of the design).
- ~~Pocket toolpaths start with a rapid to the part's corner 3 mm above the top~~ (X0 Y0 Z3,
  then up to the safe height over the start). **Fixed in M3.6d** (pockets and facings), see below.

### Deferred items still open (owner decisions 22 and 23)

- 3D finishing, through cuts, rest machining and adaptive clearing on tilted planes.
- Going back in the simulator: the remaining stretch (about 2 s on the turned leg) still replays
  on the screen's thread.
- Jumping far ahead on a big 3+2 or 5-axis part replays on the screen's thread and can hold it.
- M3.6 did not build this machinery (the machine view replays the axes, not the stock), so none
  is closed.

### Test-suite note (M3.6)

The known timing test `tests/perf.test.ts` "adaptive clearing per Z level" (limit 90 s with the
whole suite running) failed by timing alone in the final full run: 108.9 s, everything else green
(1047 passed, 1 skipped). Run on its own it passes: 79.9 s after M3.6c and 76.2 s on the untouched
M3.5c baseline, the same 165,624 moves. M3.6 changes nothing it runs. The limit was not changed.

## M3.6 screenshots

In `docs/screenshots/stage-2-3/M3.6/` (demo data: a 500 x 350 panel with a pocket, holes and a
cut-out, four clamps placed automatically and a tall clamp over the cut-out; a relief door with a
dome, roughed and finished, and a spot pocket 1 mm too deep; the M3.4 test block with a tall
clamp, on an example 5-axis router): `01-fixtures-on-the-drawing` (the four clamps and the tall
one on the drawing, beside the fixtures panel), `02-fixtures-panel` (fixture cards with sizes,
Configure badges, add from the library / shapes / a model, Place), `03-cutting-check-fixture`
(Simulate: "Cut-out, move 7: cutter hits fixture "Tall clamp" … (18.00 mm)"),
`04-machine-n200-head-into-clamp` (Simulate → Machine on the N-200: gantry, head, spindle motor
and the clamps; "Spindle motor hits fixture "Tall clamp""), `05-machine-replay-woodwop-program`
(the same from the part's own woodWOP program read back), `06-machine-fork-head-into-clamp` (the
example router's fork head at B45 swinging its spindle housing into "Clamp B"),
`07-compare-relief-door` (Compare with the model: the gouge red with its dot, the dome green, the
material left at its foot blue; "Deepest gouge 1"), `08-compare-parts` (Compare with models…: the
relief door's row, deepest gouge 1, most left 0.479, 97.4 % within, top view),
`09-machine-parts` (Machine & tools → Machine parts: invented, Configure badge, gantry beam carried
by X), `10-fixture-library` (the shop's clamps and pods with badges), `11-feature-switch` (the
switch and what it covers).

## M3.6 licences

No new dependencies. All new code is our own (convex solids and GJK distance, fixtures, automatic
placing, the machine's parts and replay, the machine collision check, part compare). The
screenshots were taken with Playwright (Apache-2.0) installed outside the project, not added to it.

## M3.6 decisions needed

1. **The N-200's real head and gantry sizes** (for the machine simulation): the spindle motor,
   head plate, vertical drill block, gantry beam and legs as boxes or cylinders. Invented until
   then, with a Configure badge (Machine & tools → Machine parts). No answer needed now; the
   machine check stays simulator-only meanwhile.
2. **The shop's real clamps, pods and rails** (sizes; the N-200 is a vacuum nesting table, so
   possibly none): invented examples with Configure badges until then.
3. **Should a machine-part hit ever block the export?** Today only a tool, shank or holder hit on
   a fixture blocks it. Recommendation: keep machine-part hits simulator-only until decision 1 is
   answered, then make them block like any collision.
4. **The pocket's opening rapid to the part's corner** (X0 Y0, 3 mm above the top): fix it to go
   to the safe height first? It changes no woodWOP output but changes pocket goldens and any
   script post's text. Recommendation: fix it in a later run with the goldens explained. Safe
   meanwhile: the collision checks catch it against a fixture, and script-post output is off.

## M3.6d pocket and facing opening move: what was fixed (owner decision 24.4)

**The fault.** Pocket toolpaths (offset, back-and-forth and spiral; not adaptive or rest, which
already checked) lifted "out of the cut" before their first ring, but before the first move there
is no cut: the toolpath builder starts at X0 Y0, so every pocket opened with a rapid to the part's
corner 3 mm above the top, then rose diagonally to the safe height over the real start. A scan of
every reference part's toolpaths found the same fault in **facing** (M2.6a), which has the same
code; it is fixed the same way (the owner's decision named pockets; this is the identical move,
noted in the report). Every other generator already opened over its first cut.

**The fix** (`src/cam/toolpath.ts`, `genPocket` and `genFace`): no lift before the first move. A
pocket or facing now opens with a rapid at the safe height straight over its first cut, then down
to the rapid height and the entry (helix, ramp or plunge), like profiles and drilling. Nothing else
in the toolpaths changes: the same cuts, entries, links and lifts between levels.

**What it touches.** The moves only (simulator, collision and machine checks, script posts, times).
The woodWOP output is untouched: pockets go out as pocket or contour macros and facings as contour
macros, which never carried that move. The 3+2 generator already cut that opening move off its
tilted pockets (its goldens are unchanged); the guard stays. A part saved with hand edits on a
pocket keeps them: edits are anchored to the point a move ends at, and each now sits one move
earlier, so they re-attach with a one-time "moved to the matching moves" note and none is lost
(decision 7: one-time marks are acceptable).

**Goldens changed** (each: one rapid fewer, the opening rapid to X0 Y0 removed from the first
moves listed; cut length, extents, depths, intents, warnings and every `.mpr` unchanged):

| Golden | Reason |
|---|---|
| `tests/golden/cam/ref07/toolpaths.json` | Pocket opens at safe height over (229.2, 145.8), not with a rapid to X0 Y0 Z3. |
| `tests/golden/cam/ref08/toolpaths.json` | Pocket with an island opens over (350.589, 142.227), not at X0 Y0 Z3. |
| `tests/golden/cam/ref09/toolpaths.json` | Back-and-forth pocket opens over (340.182, 56), not at X0 Y0 Z3. |
| `tests/golden/cam/ref10/toolpaths.json` | Spiral pocket opens over its centre (150, 150), not at X0 Y0 Z3. |
| `tests/golden/cam25d/edit03/toolpaths.json` | Pocket with a start point opens over (296, 215.4), not at X0 Y0 Z3; the unedited toolpath's hash (`edited.base`) changes with it; both edits still applied as made. |
| `tests/golden/cam25d/face01/toolpaths.json` | Facing opens over (0, 2.7) and the pocket after it over (320.4, 199.6), not at X0 Y0 (Z3 and Z2 below the faced top). |
| `tests/golden/cam25d/face02/toolpaths.json` | Facing in rings opens over (100, 100), not at X0 Y0 Z3. |
| `tests/golden/cam25d/face03/toolpaths.json` | Round-top facing opens over (341.908, 17.51), not at X0 Y0 Z3. |

Stage 1 MPR goldens (`tests/golden/cam/ref01..ref20/part.mpr`), every `cam25d` `part.mpr`, the
Stage 1 cabinet goldens and `npm run sample` (diffed): **byte-identical**. The Stage 1 part files
(`part.json`, version 1) are unchanged.

**Test added** (`tests/cam-golden.test.ts`): every toolpath of the 20 reference parts and the 2.5D
reference parts (saw, facing, chamfer, curves, hand-drawn, edited, edge work; 59 toolpaths) opens
with a rapid at its safe height (measured from a faced top where there is one) and goes straight
down from there. It fails on the code before the fix (ref07 opened at Z3).

**Limit recorded (unchanged, not part of decision 24.4).** Between depth levels a pocket or facing
still rises to the safe height at the end of a level, drops to the rapid height (3 mm above the
top) over that same point, then rises diagonally to the safe height over the next level's start.
Both ends are over the area just cut, so it is wasted motion rather than a risk; removing it would
change every multi-level pocket golden. It can go in a later run if the owner wants it.

## Next run

- M3.7 (record the out-of-scope items in ROADMAP.md; nothing built), when the owner says go.

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
- **Run 10 (M2.8a-e)**: areas and costs; shared-line cutting; bridged nesting; flip-side sheets and
  the sheet backplot; manual nesting, screenshots, README, ROADMAP. M2.8 complete. See `git log`.
- **Run 11 (M2.9a-d)**: other machines and process steps (`51ccb91`); SQLite storage option
  (`bc4bcb2`); assemblies, fittings by face and batch steps (`1fafaee`); wizards, admin tools,
  screenshots, README, ROADMAP. M2.9 complete. See `git log`.
- **Run 12 (M2.10a-d)**: explicit timeouts for three heavy tests (`deefe9e`); plugin sandbox and
  API (`0d80ba4`); script posts (`eeb407d`); reading programs back (`33910cd`); program manager,
  screenshots, README, ROADMAP. M2.10 complete. See `git log`.
- **Run 13 (M2.11a-b)**: relief import (`9546b82`); Stage 2 exit test, screenshots, README,
  ROADMAP. M2.11 complete; Stage 2 complete. See `git log`.
- **Run 14 (M3.1a)**: radial and spiral finishing, shared pass code, format 5, switch. See `git log`.
- **Run 14 (M3.1b)**: scallop finishing with an independent cusp check. See `git log`.
- **Run 14 (M3.1c)**: flat-area and helical finishing. See `git log`.
- **Run 14 (M3.1d)**: undercut finishing with lollipop tools, dexel stock. See `git log`.
- **Run 14 (M3.1e)**: curve-driven finishing. See `git log`.
- **Run 14 (M3.1f)**: screenshots, README, ROADMAP. **M3.1 complete.** See `git log`.
- **Run 15 (M3.1g)**: flat-area flat layers and lollipop badges (`077d6d3`); undercut roughing
  (`3ea2283`); solid face rows and columns and the plan view (`f0a258d`); docs. See `git log`.
- **Run 15 (M3.2)**: thread milling, fold/flatten/wrap, hatching, detail views and line types
  (`d68e3d3`); stroke fonts and rapid surfaces (`9d40204`); screenshots (M3.1g and M3.2), docs.
  **M3.2 complete.** See `git log`.
- **Run 16 (M3.3a-c)**: rotary core, wrapped planes, rotary stock and checks, format 8
  (`d966d34`); rotary output through a script post (`f73544e`); rotary screens and simulator
  (`1d5a33e`); screenshots, docs. **M3.3 complete.** See `git log`.
- **Run 17 (M3.4a-c)**: 3+2 core, tilted planes, kinematics, conversion, three-way stock and
  checks, format 9, `CAM_ROTARY` naming (`9519a5d`); 3+2 output through a script post (`5610196`);
  3+2 screens, simulator, step-back checkpoints, screenshots, docs. **M3.4 complete.** See `git log`.
- **Run 18 (M3.5a-c)**: 5-axis engine interface, stub, preview engine, tool axes in the IR, barrel
  and form tools, format 10 (`4e80843`); simultaneous kinematics with head flip, 5-axis
  simulation, axis-turn check, N-200 refusal, script post (`836c846`); 5-axis screens,
  screenshots, docs. **M3.5 complete.** See `git log`.
- **Run 19 (M3.6a-c)**: clamps, pods and rails, convex distance engine, fixtures in every
  collision check, format 11 (`5d28787`); machine simulation and part compare cores (`54131fe`);
  machine view, compare screens, fixtures panel, screenshots, docs. **M3.6 complete.** See
  `git log`.
- **Run 20 (M3.6d)**: pocket and facing toolpaths open over their first cut (owner decision 24.4),
  goldens explained, woodWOP output byte-identical. See `git log`.
