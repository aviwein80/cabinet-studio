# Roadmap

Status: design is the current focus (units, room layout, Salice hinges, Blum TANDEM slides).
Proving MPR output on the N-200, and replacing the placeholder tool table, are paused. The path
from template to MPR, labels and sheet map still works end to end. It has **not** been run through
woodWOP or on the N-200.

## Decisions (October 2026)

- **DWG import: out.** DXF only. DWG files are converted to DXF first with the free ODA File
  Converter (a separate program); the app does not read DWG and will not bundle the commercial ODA SDK.
- **AI spec-sheet reader: built.** It covers library hardware (manufacturer PDFs, scans and
  photos to a drilling pattern plus item data) and full custom pieces (a customer's spec or
  drawing to an editable part). Every value cites its source, unread values stay blank, and
  nothing is saved, placed or nested until someone ticks that they checked it. Default provider:
  Anthropic Claude Sonnet 4.5, with the offline text reader as the fallback.
- **Cabinet-side boring from the pattern library.** Plate and TANDEM runner screws now come from
  the newest approved library pattern linked to the item, else the built-in pattern with the
  library item's numbers. Hinge cups still use each cabinet's door values.

Next for the reader: machine edge grooves and edge profiles (needs the aggregate or a saw step),
underside milling in the turned-over program, and a per-shop "likely features" list so the
reader recognises the shop's own hardware codes.

## Custom-part Stage 2 and 3 (Stage 2 complete; Stage 3 in progress)

Plan: `docs/stage-2-3-spec.md`. Progress and open questions: `docs/stage-2-3-progress.md`.

- **M2.0 audit: done.** **M2.1 3D foundation: done** (October 2026). It covers 3D model import,
  mesh tools, the work volume from a model, the machine model, tool holder fields, the stock
  model, background workers, and part format version 2. **M2.2a parallel finishing: done.** **M2.2b Z-level roughing, waterline
  finishing and flat-layer output (switch off): done.** **M2.2c projection finishing and faster
  waterline: done.** **M2.3a 2D rest machining: done.** **M2.3b adaptive clearing in pockets: done**
  (simulation only; woodWOP output is a decision). **M2.3c adaptive Z-level roughing, 3D rest
  machining and the pencil pass: done** (simulation only). M2.3 complete. **M2.4 stock
  simulation, collision checking and cut-free pieces: done** (October 2026), with the fix for
  Z-level roughing of models that do not cover the panel. **M2.5 solid models: done** (October
  2026): STEP / IGES / BREP import with face ids and colours (OpenCascade reader as separate,
  lazily loaded WebAssembly), feature recognition onto layers the Stage 1 rules machine (checked
  MPR, output still off), assemblies split into parts, faces to layers / colours / grain,
  machining picked faces, 3D wires and surfaces, `app://` in the desktop app. **M2.6 more 2.5D
  machining: done** (October 2026): saw cuts with blade run-out, joining and keep-off; facing
  with re-set stock top; chamfers; cuts between curves, along 3D curves and Z-waves; hand-drawn
  toolpaths; toolpath edits that survive recalculation or are flagged; edge work with a rotating
  aggregate (simulation only). Part format version 4. Saw and aggregate output are refused while
  the machine model has no such unit (the N-200 default); the new output switch is off. **M2.6e: done**: every
  unconfirmed value (tools, saw blade, holders, machine figures, saw / aggregate fitted, default
  cutting values) shows a Configure badge, can be confirmed or changed any time, and is listed by
  the export checker. **M2.7 CAD and tool additions: done** (October 2026): turn-by-turn sketch
  solved for unknown values, associative dimensions in inch fractions with print to scale,
  geometry queries and auto-queries (the layer rules run on them), fill with holes, panelling,
  image trace (own tracer), holders for every router (shop default holder, assumed stick-out =
  flute length, holder from a model) used by the simulator and collision checks, angle heads and
  aggregates, tool grid, spreadsheet export/import and tool data compare. Nothing writes machine
  output. **M2.8 nesting additions: done** (October 2026): areas and costs per sheet and part (no
  invented prices); shared-line cutting (measured 18-25 % less cutting on rectangle-heavy jobs);
  bridged nesting; flip-side sheets with a milled reference edge and a sheet backplot
  (registration 0.000 mm in the tests); editing the layout by hand with snapping, a live check,
  nest list files and the full export check. Each new kind of program output has its own switch,
  off. **M2.9 batch additions: done** (October 2026): other machines and process steps with
  their own profiles (a batch run to two machine models gives two program sets; output for the
  other machines has its own switch, off); the SQLite storage option (lossless, JSON stays the
  default; Node's built-in SQLite, no new dependency); assemblies and fittings placed by face in
  part lists (approved drilling patterns only); batch steps after nesting and before output
  (waste areas built in; plugin steps with M2.10); batch-setup and layer-rule wizards (their
  setups pass the Stage 1 batch tests file for file); admin password on the defaults, hidden
  screens, tool-change order and the missing-recipe report. **M2.10 plugins, script posts and
  program tools: done** (October 2026): plugins in a sandbox (QuickJS, MIT) with menu commands,
  batch steps, script posts and a macro recorder, nothing granted until the owner grants it; one
  post path for text programs (a sample script post writes byte-identical G-code to the template
  post on all 44 reference parts; text posts never for the N-200, output switch off); G-code and
  our MPR read back into toolpaths for the simulator; a program manager with an editor (line
  numbers, maths on values), checks and copying to the machine folder (edited programs behind
  their own switch, off). **M2.11 relief import: done** (October 2026): reliefs from relief
  software (STL, OBJ, 3MF; a base under the carving found and taken off) and height-map pictures
  (own PNG and TIFF readers, 16-bit kept) made to an exact size and depth, placed on a part, and
  machined with Z-level roughing and parallel finishing; on a relief the operations stay inside
  its outline and the panel face round it is never cut. Screens only (new switch "Relief
  import"); relief toolpaths follow the 3D output rules. **Stage 2 exit test: passed** (October
  2026): an STL relief door and a STEP shaped door each go from import to simulated,
  collision-free toolpaths and a checked MPR (custom-part and 3D output still off by default; the
  program written is read back and simulates the same). One limit stays: parallel finishing of a
  relief has no woodWOP form yet (decision 2: true 3D output waits for a sample program from
  woodWOP), so the checker stops it; roughing and waterline can be written once their switch is
  on. **Stage 2 complete.**
- **Stage 3.** **M3.1 more 3-axis finishing: done** (October 2026): radial and spiral finishing;
  scallop finishing (the same cusp height everywhere, within ±10 % over the whole test surface,
  measured independently); flat-area and helical finishing; undercut finishing with a new
  lollipop tool shape, and a simulator stock that keeps material under overhangs; curve-driven
  finishing (drive curves, an earlier toolpath, where two surfaces meet, a surface's rows and
  columns, the tool kept to one side of a surface). Same tolerances as Stage 2 (no gouge over
  0.005 mm by an independent check, stock to leave within ±0.01 mm). Screens and simulation
  only, behind the "More 3D finishing" switch; the export checker refuses all of them
  (`CAM_3D_NO_OUTPUT`) until true 3D output is confirmed with a woodWOP sample program.
  **M3.1g owner follow-ups: done** (October 2026): flat-area finishing on level flats written as
  ordinary contour passes behind the 3D flat-layer switch (still off); lollipop sizes stay badged
  placeholders; undercut roughing with a lollipop (simulation only, part format 6); rows and
  columns of an imported solid's face from a full OpenCascade B-rep kernel (replicad-opencascadejs,
  LGPL-2.1, separate 23 MB file loaded on first use, offline; occt-import-js stays the reader);
  the plan view draws very large toolpaths (a 472,100-point roughing draws in well under a second
  instead of stopping the screen).
  **M3.2 small extras: done** (October 2026): thread milling (pitch and depth exact in the
  toolpath; simulation only, never written to woodWOP); fold, flatten and wrap (wrap keeps arc
  length within 0.01 mm); hatching, detail views and layer line types, printed to scale; a
  stroke-font editor for engraving; rapid moves over a cylinder or dome (simulation, checks and
  text posts; woodWOP output unchanged). Part format 7.
  **M3.3 rotary (4-axis): done** (October 2026): a rotary axis along X, Y or Z with a round or
  square blank; wrapped planes (from a radius, extents or a solid's cylindrical face) drawn
  unrolled, with shapes drawn on them wrapping onto the cylinder; passes along the axis, rings
  round it and a spiral on a model, roughing in levels, wrapped shapes to a depth (also with a
  saw blade). Simulated on a new rotary stock with the collision check; a turned leg and a fluted
  column simulate with no gouges (independent check, within 0.005 mm). Output only through a
  script post for a machine model that declares that rotary axis (switch off); the N-200 export
  always refuses a turned part (`CAM_ROTARY`). Part format 8.
  **M3.4 positional 3+2: done** (October 2026): tilted work planes at any angle (typed in, a side
  of the part's block or a solid's flat face) with drilling, pockets, profiles and engraving on
  them; our own kinematics for a fork head, a trunnion table and a rotary table with a tilting
  head turn each plane into two locked angles and the machine's X, Y, Z (and back), or into the
  plane's own frame. Simulated with the tool tilted on a new three-way stock, with the collision
  check; holes and pockets on four tilted planes of a test block land within 0.001 mm after the
  conversion on all three layouts. Output only through a script post for a machine model that
  declares the 3+2 axes (switch off); the N-200 export always refuses a part with tilted
  operations (`CAM_POSITIONAL`). Part format 9.
  **M3.5 simultaneous 5-axis interface: done** (October 2026): the `MultiAxisEngine` interface
  (model or curves, tool with holder, strategy settings, machine kinematics in; our toolpath IR
  with a tool direction on every move out), the shop's engine as a stub that answers "5-axis
  engine not licensed", and a built-in preview engine (simulation only, never written) that the
  tests also use as a stand-in for a licensed engine. Tool-axis control, strategies along curves,
  swarf, surface finishing (roughing for a licensed engine), barrel and form tools, cutting
  reversed or both ways, the head flip; our own gouge check, simultaneous kinematics and kinematic
  replay; the axis turn between operations is now checked (M3.4 limit closed). Output only through
  a script post for a machine model with simultaneous 5-axis, from a licensed engine (switch off);
  the N-200 export always refuses (`CAM_MULTIAXIS`). **No engine licence bought, nothing
  downloaded.** Part format 10.
  **Owner decision on M3.5 (October 2026): do not buy a 5-axis engine licence** (ModuleWorks or
  any other). The shop's engine stays the "not licensed" stub, 5-axis output stays off, and the
  N-200 always refuses 5-axis work.
  **M3.6 machine simulation, part compare and fixtures: done** (October 2026): clamps, pods and
  rails on parts (from sizes, drawn shapes or a model file; placed by typing, dragging or
  automatically clear of the toolpaths) kept clear of the tool, shank and holder by every collision
  check (a hit blocks the export); the whole machine (gantry, head, spindle, tables, the part and
  its fixtures) replayed from the machine model, from the toolpaths or from a post's output read
  back, with every machine part checked against the table, the part and its fixtures and every
  axis against its travel (a deliberate head-into-clamp is caught on the N-200 and on a 3+2 fork
  head); part compare colours the finished stock against the 3D model (a known gouge red, where
  and as deep as it is), for one part or several. The machine's parts and the fixture library are
  invented placeholders with Configure badges; nothing new is written to any machine. Part format
  11.
  **M3.6d (owner decision on M3.6, October 2026):** pocket and facing toolpaths now open at the
  safe height straight over their first cut, no longer with a rapid to the part's corner 3 mm
  above the top; woodWOP output byte-identical.
  **M3.6e (owner decision on M3.6, October 2026):** the export checker replays each custom part
  where it is nested on its sheet: a machine-part hit (spindle motor, head plate, drill block...)
  is a warning while the machine's parts are invented and blocks the export once they are
  confirmed. Next: M3.7 (recording the out-of-scope items).
- Decisions (October 2026):
  - 3D output to woodWOP starts with flat-layer operations (Z-level roughing, waterline) as
    normal contour macros. True 3D paths stay off until a sample program comes from the shop PC.
  - N-200 machine figures stay placeholders; the saw unit is absent until confirmed.
  - Placeholder 3D tools and cutting values are used until the real ones are supplied.
  - 3D models are stored as separate compressed files next to the shop file.
  - The new milestone order and the M2.2 split are approved.
  - DXF only (DWG through the free ODA converter); no Rhino or SketchUp readers. LGPL only as a
    separately loaded, replaceable WebAssembly with notices.
  - M2.6: the saw unit and the rotating aggregate count as absent on the N-200 until confirmed;
    their operations ship, and the export checker refuses their output with a clear message. No
    saw or aggregate macro is presented as proven output.
- M2.10 answered (October 2026): half-circle arcs stay as they are until the owner simulates one
  circle in woodWOP (option b; pieces of at most 90 degrees only if woodWOP's circle is off);
  hand-edited programs are not copied to the machine (switch off); the machine folder stays
  empty; no plugins trusted, nothing granted.
- Open for M2.11 (see `docs/stage-2-3-progress.md`): how relief-software STL files arrive at the
  shop (units, with or without a base) - one real file would confirm the importer's defaults; and
  the cutting values for relief work (tools, step-overs, step-downs) - placeholders with
  Configure badges until then.
- M2.9 answered (October 2026): no second machine, the N-200 only (output for other machines
  off); process steps do not share work; the app's own face words; waste areas a report only.
- M2.8 answered (October 2026): prices later through Configure badges; hold-down and bridge
  sizes stay badged placeholders; flip end for end with a 5 mm strip; the three output switches
  stay off.
- Open for M2.8 (see `docs/stage-2-3-progress.md`): material prices (and densities if costed by
  weight); the hold-down limit for shared lines; bridge width, longest bridge and part size; how
  the shop turns a sheet over and how wide a reference strip to mill; and, before any of the three
  output switches goes on, one sheet of each checked in woodWOP.
- Open for M2.7 (see `docs/stage-2-3-progress.md`): the real stick-outs and holders of every
  router (2D ones now too) and the shop's usual holder; offsets, housing and allowed angles of
  any angle head or aggregate.
- Open for M2.6 (see `docs/stage-2-3-progress.md`): the real saw blade diameter and what
  woodWOP's saw-groove XA/XE mean (cut length at the surface or at full depth), whether a
  rotating aggregate will be fitted (and a sample program for it), and the shop's facing
  step-over and corner slow-down values.

## Phase 0: prove the output on the real machine (paused)

1. Replace the placeholder tool table with the real N-200 tools: export from Tool Manager, then
   import the CSV.
2. Collect 3–5 MPRs that the shop already runs (from Cabinet Vision S2M, or written by hand in
   woodWOP) and diff them against ours. Points to check:
   - header fields (`OP`, `FM`, `MAT`, `_BSX`/`_BSY`/`_BSZ`, `VIEW`);
   - the `KM` and `T_` conventions, `EM` modes and `ZA` sign;
   - the `<105` approach and ramp parameters;
   - whether `Tasche` or `Nuten` is preferred for grooves.
3. Open the sample job in woodWOP and simulate it. Fix the writer and add a golden test for every
   difference.
4. Cut one test sheet in cheap board with no hardware drilling. Then measure the outer dimensions,
   groove positions and 32 mm rows.
5. Confirm where the sheet origin and the stop corner are, and the `VIEW` orientation. The sheet
   map and label orientation depend on these.

## Phase 1: shop standards

- Write down the construction standards: setbacks, joinery spacing, hinge and plate positions,
  shelf clearances, and the dado or groove fits for the real board thicknesses. Store them as
  named "construction profiles" instead of per-template numbers.
- Fronts: drawer boxes and drawer fronts, false fronts, and a door/drawer split for base cabinets.
- Hardware library with real drilling patterns: Blum or Hettich hinges and plates, drawer runners,
  legs.
- Horizontal drilling (103 BohrHoriz) if the N-200 has the unit. Otherwise, a separate
  edge-drilling list for the boring machine.
- Fillers, end panels, kick boards and countertop cut-outs.

## Phase 2: nesting and machining

- Onion-skin or tab cutting for small parts (vacuum hold-down), with two-pass cut-outs.
- Remnant (offcut) library and reuse.
- True-shape nesting for non-rectangular parts.
- Flip-side operations: a second program for parts that need face-down machining.
- Cut order optimisation (shortest path) and a lead-in strategy per material.
- Labelling unit support, if the N-200 has a label printer on the machine. Otherwise keep printing
  by hand from the sheet map.

## Phase 3: office

- Quotes and costing: sheet, edgeband, hardware and machine time.
- Room or wall layout to place cabinets, with elevation drawings.
- A productionManager `project.xml`, or a woodWOP batch list, for sending a whole job to the
  machine PC.
- Reports: assembly sheets per cabinet, a hardware picking list, edgebanding list.
- Hebrew text on labels: embed a Hebrew TTF in jsPDF and check RTL rendering. On the Zebra, check
  the printer font or use a bitmap.
- SQLite storage once there are many jobs, with search and archive. Today it is one JSON file.
- Multi-user or network data folder.
- Signed installer and auto-update.

## Open questions for Avi

1. **Tool table.** Real tool numbers, diameters, cutting lengths and spindle layout. Can the
   drilling block be addressed by diameter?
2. **Real MPRs.** Can you share some programs the machine runs today, and a few woodWOP project
   files (`.mpr` / `.mprx`)?
3. **Machine setup.** Where is the sheet origin? Which spoilboard depth is allowed? Is there a
   horizontal drill unit? Do you use productionManager or load programs by USB / network?
4. **Construction standards.** System 32 start and pitch, back groove (depth, setback, panel
   thickness), bottom joint, connectors, toe-kick details, hinge brand and plate type.
5. **Edgebander.** Is pre-mill on, and how much? Band thicknesses per material?
6. **Labels.** Printer model (Zebra ZD/ZT?) and label stock size. Do you prefer driver PDF
   printing or raw ZPL? Should labels carry Hebrew text?
7. **Materials.** Real sheet sizes and grain rules for each board you stock.
