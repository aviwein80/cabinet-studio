# Roadmap

Status: first vertical slice. The path from template to MPR, labels and sheet map works
end to end. It has **not** been run through woodWOP or on the N-200.

## Phase 0: prove the output on the real machine (next)

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
