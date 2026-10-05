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

## Custom-part Stage 2 and 3 (in progress)

Plan: `docs/stage-2-3-spec.md`. Progress and open questions: `docs/stage-2-3-progress.md`.

- **M2.0 audit: done.** **M2.1 3D foundation: done** (October 2026). It covers 3D model import,
  mesh tools, the work volume from a model, the machine model, tool holder fields, the stock
  model, background workers, and part format version 2. **M2.2a parallel finishing: done.** **M2.2b Z-level roughing, waterline
  finishing and flat-layer output (switch off): done.** **M2.2c projection finishing and faster
  waterline: done.** **M2.3a 2D rest machining: done.** **M2.3b adaptive clearing in pockets: done**
  (simulation only; woodWOP output is a decision). **M2.3c adaptive Z-level roughing, 3D rest
  machining and the pencil pass: done** (simulation only). M2.3 complete. **M2.4 stock
  simulation, collision checking and cut-free pieces: done** (October 2026), with the fix for
  Z-level roughing of models that do not cover the panel. Next: M2.5 (solid models).
- Decisions (October 2026):
  - 3D output to woodWOP starts with flat-layer operations (Z-level roughing, waterline) as
    normal contour macros. True 3D paths stay off until a sample program comes from the shop PC.
  - N-200 machine figures stay placeholders; the saw unit is absent until confirmed.
  - Placeholder 3D tools and cutting values are used until the real ones are supplied.
  - 3D models are stored as separate compressed files next to the shop file.
  - The new milestone order and the M2.2 split are approved.

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
