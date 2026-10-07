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

1. **Library**: cabinet templates, sheet materials, edgebands and hardware. Each row has an Edit
   form. Fields that move holes, cut sizes or sheets are marked; code and name are labels.
   Items are stored by id, so renaming one does not break jobs. If a geometry change is already
   used by a job, the form lists those jobs and asks whether to update them or keep the old
   values. New cabinets use the new value. Templates stay a copy: existing jobs change only when
   you choose Update existing jobs. Bulk-import CSV / XLSX / JSON (see `examples/import/`). The
   whole library can be exported or imported as a JSON bundle.
2. **Parametric cabinets**: base, wall and tall carcasses. Settings cover width, height and depth;
   materials; toe kick (notched sides); rails or a full top; a dado or butt bottom; and screw,
   dowel or confirmat joinery. The back can be grooved, rabbeted or applied. There are 32 mm
   shelf-pin rows, Salice Silentia+ 110° hinge cups with 3 mm mounting plates, Blum TANDEM
   undermount slides (15, 18 and 21 in, chosen from the cabinet depth), drawer boxes, and
   edgebanding. Hinge and slide holes are bored into the parts automatically.
3. **Per-job customisation**: each cabinet in a job is a copy of its template. You can change any
   parameter, exclude parts, change the edgeband on any edge, or add custom holes. A 3D view
   (orbit, exploded view, holes shown) updates live. The **Room** tab places every cabinet in the
   job. Switch between 3D, a top-down plan (back wall at the top, fronts marked) and an elevation
   of each wall. Click a cabinet in any of those views to change its size, doors and drawers
   there, or open the full editor and come back to the room. Snap is on by default: cabinets
   meet side to side, fronts and tops line up, and a wall cabinet sits on a base. Turn Snap off,
   or hold Alt, to place freely, including overlaps.
4. **Millimetres or inches.** The sidebar switches the whole shop. Lengths are stored in
   millimetres. Inches display as fractions to the nearest 1/16 in (for example `23-1/4"`), and
   you can type a decimal or a fraction. Showing the same value again does not change the stored
   millimetres.
5. **Cut list** with edgeband compensation and optional pre-mill allowance, plus a BOM: sheets,
   edgeband metres and hardware. The default sheet is **5 ft × 12 ft (1524 × 3658 mm)**.
6. **Nesting** (built in): MaxRects with 16 heuristic and order combinations, keeping the result
   with the fewest sheets. It respects grain, rotation rules, edge trim and part spacing (the
   cut-out tool diameter plus extra). The cut order puts small parts first.
   **Nesting additions** (switch "Nesting additions", on; each kind of program output has its
   own switch, **off**):
   - **Area and cost**: each part's true area, and per sheet the parts, the remnants kept and the
     scrap; cost per m² (per ft² in inches) or per kg with the density, entered per material
     (Library → Materials → Edit). A sheet costs its whole area; each part also shows its share
     of the sheet. No price is invented: until one is entered the material shows a Configure
     badge. "Areas and costs CSV" on the Output tab.
   - **Shared-line cutting**: rectangular parts nest exactly one cut-out tool diameter apart and
     the line between neighbours is cut once (whole rows in one straight pass). Small parts keep
     their own cut-out for hold-down (0.05 m² / 120 mm, placeholder, badged). The sample kitchen
     needs 18 % less cutting, an eight-cabinet job 25 % less. Shown on the sheet; written only
     with "Write shared-line cuts to MPR" (off).
   - **Bridged nesting**: small parts are linked by short bridges and cut as one path round each
     group, so they stay one piece on the vacuum (with the onion skin when set); bridge width,
     longest bridge and part size are placeholders with badges. Written only with its own switch.
   - **Flip-side sheets**: parts with underside holes nest on their own sheets. Side 1 (run first,
     sheet face down) mills a reference strip off one end and drills the underside; the sheet is
     turned over onto that milled edge for its normal program. The sheet backplot shows side 1,
     side 2 and both together, with the registration (0.000 mm in the tests). Written only with
     its own switch and the custom-part switch.
   - **Edit layout**: drag parts on a sheet, turn them, snap them beside their neighbours, in line
     with their edges or to the trim, move them to another or a new sheet, undo, and save the
     layout with the job (or as a nest list file to load again). A live check marks overlaps,
     parts too close, off the trim or against the grain; the export checker runs in full on the
     saved layout. Parts added later are nested after the saved sheets; parts removed are listed.
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

## Custom parts (CAD/CAM)

A second side of the program draws and machines parts that are not cabinet boxes: doors, arched
panels, brackets, signs. It shares the job, materials, tool table, nesting, labels, units switch
and MPR writer with the cabinet side. Every feature has its own switch under **Machine & tools →
Custom-part features**. MPR output for custom parts is **off by default** and goes through the same
export checker. Tool numbers are still placeholders.

- **Part designer** (Parts page): lines, arcs, rectangles, slots, splines and text. Edit with
  move, copy, mirror, array, offset, fillet (including T-bone relief), trim, extend, and unite,
  subtract or intersect (arcs are kept). Snaps, typed coordinates, layers, undo, and DXF in and out.
- **Import**: DXF (join tolerance, tangent-only join, combine, units, blocks, splines) and PDF or
  Illustrator vectors. DXF only: convert DWG files to DXF first with the free ODA File Converter.
- **Machining**: profile (sides, leads, tabs, multiple passes), pocket (contour, zig-zag, spiral,
  islands, ramps), drill and peck, engrave, V-carve, saw groove and profiled sweep. **Layer rules**
  machine an imported drawing from its layer names.
- **Rest machining** (pocket option): a smaller tool cuts only what the earlier operations left,
  such as corners, necks the bigger tool could not enter, and wall stock. The leftover is worked
  out from the earlier toolpaths themselves, level by level. Pieces that would cut less than a
  set length are skipped. Each piece is written to woodWOP as a contour-milling pass, so the
  earlier operations must run first, in the order shown.
- **Adaptive clearing** (pocket pattern): the tool keeps a steady width of cut (set as a share of
  the tool diameter or as an engagement angle) instead of following offset rings. It turns into
  the material when the cut gets light and away when it gets heavy, goes back through cleared
  area lifted a little, enters new areas by helix, and clears channels too narrow for that with
  trochoidal loops. Optional adaptive feed speeds up the lighter cuts. It is calculated in the
  background and can be simulated; it is **not written to woodWOP** yet (the export checker
  blocks it, `CAM_ADAPTIVE_NO_OUTPUT`).
- **Parametric doors**: slab, shaker, arched and cathedral, driven by variables or a door-list CSV.
  Hinge cups and pulls are placed automatically.
- **Native woodWOP**: each operation is written as an editable macro (`<105` contour on the drawn
  arcs, `<102`/`<103` drilling, `<112` pocket, `<109` groove), not as a point list. Holes on face 6
  go into a second program, run after the part is turned over.
- **Nesting**: true-shape nesting (no-fit polygons on Clipper2) runs beside the rectangular
  engine, and the result with fewer sheets is kept. It handles grain (only half turns when grain
  is locked), priorities, kits kept on one sheet, small parts placed inside cut-outs and cut
  first, an onion-skin final pass, offcuts back into stock, and label copy counters.
- **3D models** (switch: 3D models): import STL (binary or text), OBJ or 3MF reliefs and shaped
  parts. Import runs in the background with a progress bar and Cancel. Units and which way is up
  can be chosen (by default the model is laid flat). The importer joins the facets, closes gaps
  up to 0.01 mm, turns facets that face the wrong way, and reports holes and other problems. Bad
  files give a plain message. Per model you can:
  - place it (turn, scale, mirror, position, top height);
  - fit the part to it with extra material around, above and below;
  - cut sections every few mm into closed contours that the normal machining operations use
    (each keeps its depth);
  - add its outline seen from above, or use it as the part outline;
  - turn its folds into 3D polylines;
  - simplify it by percent, or within a tolerance (the change is measured, not estimated);
  - remove downward facets, or go back to the original.

  The 3D view shows the stock, the models and the drawing. Model data is stored as compressed
  files in `data/blobs` next to the shop file, never inside it. Part files (`.csp.json`) carry
  their models with them. Unused model files are removed after 30 days.
- **Relief import** (switch: Relief import, on; part designer → **Relief**, or 3D tab → Import
  relief): brings in a carved relief made elsewhere, either an STL, OBJ or 3MF exported from
  relief software, or a greyscale **height-map picture** (PNG or TIFF; 16-bit greyscale keeps
  the most detail, 8-bit pictures show their 256 steps and can be smoothed). The app imports
  reliefs; it does not design them.
  - **Size and depth are exact**: you give the length, width (proportions kept or not) and depth.
    For a picture, white is the top and black the full depth (or the other way round); its own
    lightest-to-darkest can be stretched over the depth; transparent pixels count as the top or
    the bottom; the point spacing sets the detail (a picture has no depth of its own, so the depth
    must be typed in). For an STL, the file's units are used (or chosen), a flat base under the
    carving is found and can be taken off, and the relief can be stretched to a new size or depth.
  - **Placed on the part**: centred or at a corner, its top flush with face 1 or lower.
  - **Machined with the 3D strategies**: Z-level roughing and parallel finishing can be added at
    once (placeholder cutting values with their Configure badges). On a relief, every 3D
    operation stays inside the relief's outline and treats the panel face round it as solid, so
    **the panel round a relief is never cut** (also for a relief set below the face).
  - Relief toolpaths follow the 3D output rules: roughing (and waterline) only with "Write 3D
    roughing and waterline to MPR" (off); parallel finishing is not written to woodWOP until a
    sample 3D program from woodWOP decides the form. Simulate before cutting.
- **Solid models** (STEP AP203 / AP214 / AP242, IGES, BREP; switch: Solid models, on):
  - **Import solid** (Custom parts page, also a job's Custom parts tab): each panel in the file
    becomes a part, laid flat (face 1 up, length along X, the smallest rectangle round it), sized
    to it, with its **outline, cut-outs, pockets (depth, islands) and holes (diameter, depth,
    drill point, face 1 or the underside, edge holes)** found and put on layers the layer rules
    already machine (`Outline`, `INSIDE`, `POCKET_D6`, `DRILL_D5_13`, `THRU_DRILL_D8`,
    `DRILL_D35_13_BACK`, `DRILL_D8_30_EDGE`). Repeated bodies in an assembly become one part
    with a quantity; names, properties and the material (from a "Material" property that
    matches the library) come from the file. Pockets on the underside go on `BACK_POCKET_...`
    and are not machined from the top; a warning says so.
  - In the part designer, a solid added with **3D model** keeps its face ids and colours.
    **Find features** shows what was found; **Lay flat and use as the part** puts it on layers
    (and applies the layer rules). Click faces in the 3D view (Shift adds), or select them by
    colour or type, then **Machine** them directly (profile, pocket, drill, saw: no 2D extract
    first), colour them, or send them to a layer (with a recipe). Grain can follow a face (its
    longest straight edge becomes the length). When the file changes, **New version** reads it
    again, the operations on its shapes are marked out of date and **Update shapes** makes them
    again from the same faces.
  - **Surfaces and wires**: revolve, extrude, flat, ruled, loft and sweep from drawn shapes;
    surface from faces, untrim, fillet between two flat faces, edges as 3D polylines, extend and
    split; 3D polylines typed in and edited point by point. New surfaces are 3D models the 3D
    strategies machine.
  - The solid reader is OpenCascade (occt-import-js, LGPL-2.1), shipped as separate, unmodified,
    replaceable files that load only when a solid is opened, offline (Settings → About; and
    `THIRD_PARTY_NOTICES.md`). Recognition runs in the background. Solid parts go through the
    same custom-part MPR switch (off) and export checker as every other part.
- **3D roughing (Z-level)** (Machining → Add operation, when the part has a model): cuts the
  stock away in flat levels from the top of the part down, leaving a set amount on the walls and
  on the floors. Each level is cleared like a pocket (follow the shape from the inside out, or
  back and forth), ending with a pass along the model, or with **adaptive clearing** (a steady
  width of cut, as in pockets; calculated in the background, simulation only, not written to
  woodWOP). You set:
  - the step-down, step-over, direction and pattern;
  - the entry: helix, ramp, or straight down (a tool that cannot plunge gets a ramp instead);
  - extra levels on the model's flat areas, so they are left with only the floor stock;
  - the boundary and facet groups, as for finishing.

  Every cutting move is checked against the model before it is kept. Tests prove it never leaves
  less than the stock to leave, and never more than the stock plus one step-down. If the model
  does not reach every edge of the panel (a part standing on its own) and no boundary is drawn,
  the panel round it is roughed down to the model's lowest point; a warning says so.
- **3D finishing** (Machining → Add operation → 3D finishing, when the part has a model):
  - **Parallel**: passes across the model at any angle, back and forth or one way.
  - **Waterline**: passes at constant heights around the model, best on steep walls. It can
    fill the flatter areas with parallel passes.
  - **Projection**: drawn lines, arcs, curves and text dropped straight down onto the model. The
    tool centre follows each shape in plan while the tool rides the surface. Set a depth to
    engrave below the surface (lettering on a carved or curved face), in passes like 2D
    engraving. Below the surface, protected facet groups and groups not chosen are kept clear.
    The smallest ball-nose is picked unless you choose a tool (a V-bit works too).
  - **Pencil**: one pass along each valley and inside corner of the model, where the tool touches
    two surfaces at once (for example where a panel's bevel meets its border). Valleys flatter
    than a set angle are left out. The smallest ball-nose is picked unless you choose a tool.
  - **More 3D finishing** (switch: More 3D finishing, on; screens and simulation only):
    - **Radial**: straight passes out from a centre (the middle of the boundary, or a point you
      set), no further apart than a set gap at the outer edge; passes stop in turn towards the
      centre so it is not cut over and over. **Spiral**: one continuous spiral round a centre,
      a set gap between turns.
    - **Scallop**: passes offset over the surface (not in plan) so the ridge left between passes
      (the cusp) is the same height everywhere, on slopes and curves too; from the boundary in,
      or out from shapes you pick. Measured independently in the tests: within ±10 % of the
      target over the whole test surface.
    - **Flat areas**: offset passes only where the tool rests on a face flatter than 0.5°, the
      first one following the edge of each flat area (found to 0.01 mm). A flat-bottomed tool
      is picked first. On level flats every pass runs at one height, so it can go to woodWOP as
      an ordinary contour pass (see 3D output below); a face flatter than 0.5° but not level
      keeps it simulation only.
    - **Helical**: one continuous descent round steep walls (a hill or a hollow), one step-down
      per round, no step-down in one place; where walls split or join it cuts waterline passes.
    - **Undercut**: a **lollipop** tool (a ball on a narrower neck; new tool shape with its neck
      diameter, placeholder T108) reaches under overhangs. Its neck keeps the collision margin
      clear of the model; it goes in and out sideways. The simulator then keeps material under
      overhangs (a stock with several layers per column) and checks the neck too. The ball, neck,
      flute and stick-out of every lollipop keep their Configure badges until each is confirmed
      (the sizes are not known yet).
    - **Undercut roughing** (3D roughing → pattern "Undercuts (lollipop)"): clears the material
      under overhangs that roughing from above leaves, before undercut finishing. Level by level,
      the ball works in from the open side (passes a step-over apart, then one along the edge of
      where it can go); it goes down and up only beside the overhang and leaves sideways. It
      reaches in as far as its radius less its neck and the collision margin (2 mm for the
      placeholder T108). Its own placeholder step-down and step-over with Configure badges.
      Simulation only: never written to a machine.
    - **Curve-driven**: passes guided by one drive curve and copies of it a step-over apart, by
      two drive curves (passes blended from one to the other), by an earlier operation's
      toolpath, along the line where two surfaces (two sets of facet groups) meet (a ball-nose
      touching both), or along the rows or columns of a surface made in the app (Surfaces:
      revolve, ruled, loft, sweep, extrude, or a solid's face untrimmed) or of an imported
      solid's face (below). Optionally the tool is kept on one side of chosen facet groups,
      which are never cut.
    - **Rows and columns of an imported solid's face** (solid's faces → pick one face → Rows and
      columns): the face's own parameter lines, true to its surface (free-form faces too), from
      a full OpenCascade B-rep kernel (replicad-opencascadejs, LGPL-2.1, about 23 MB) that loads
      only the first time, in the background, from the app's own files (works offline). The
      lines stop at the face's edges and holes. STEP and BREP files (IGES: save as STEP first).
  - **Rest machining** (every finishing strategy except projection): a smaller tool cuts only
    where the earlier operations left material it can reach. The earlier toolpaths are
    simulated to find what they left; rest thinner than a set amount is left out.

  You set:
  - the step-over (or step-down), stock to leave and tolerance;
  - slope limits, and skip flat areas;
  - a boundary (tool centre inside, whole tool inside, or allowed to overhang);
  - facet groups to protect or to machine only.

  The tool (ball-nose, bull-nose or flat) is placed exactly against the model at every point,
  and the moves are refined until they stay within the tolerance. An independent check in the
  tests measures how far the tool goes below the surface (limit 0.005 mm). Toolpaths are
  calculated in the background and can be simulated. In the drawing, very large toolpaths are
  drawn simplified for the screen (within a stated tolerance, prepared in the background); the
  simulation, the checks and every program use every point.
- **3D output to woodWOP** (switch: Write 3D roughing, waterline and flat areas to MPR, **off**
  by default): Z-level roughing, waterline and flat-area finishing on level flats are written as
  ordinary contour-milling macros, one per pass (per level), so each one can be edited in woodWOP.
  The machine makes its own approach for each pass. The job page calculates the 3D toolpaths in
  the background before export.
  - Parallel, projection and pencil finishing, the other M3.1 strategies (radial, spiral,
    scallop, helical, undercut, curve-driven), undercut roughing, and waterline with the
    shallow-area fill, need true 3D output. The export checker always blocks them
    (`CAM_3D_NO_OUTPUT`) until the format is confirmed with a program from the machine. A
    flat-area pass on a face that is not quite level is blocked too (`CAM_NO_OUTPUT`). Adaptive
    Z-level roughing is blocked as adaptive clearing (`CAM_ADAPTIVE_NO_OUTPUT`).
  - With the switch off, the checker blocks the flat-layer operations too (`CAM_3D_OUTPUT_OFF`).
  - Batch runs cannot calculate 3D toolpaths yet (`CAM_3D_NOT_READY`).
- **More 2.5D machining** (switch: More 2.5D machining, on; Machining → Add operation → More 2.5D):
  - **Saw cuts**: the saw operation gets blade settings: tilt (angled cuts) and the side it
    leans to; **extend to clear** (full depth right to the line ends, the blade running past
    them by its run-out) or keep the cut on the line at the surface; extra length; skip lines
    shorter than a minimum; join lines that lie on one line; **keep off neighbouring parts**
    (the blade never cuts outside the outline; the uncut length is reported). The run-out comes
    from the blade diameter (Machine & tools → tool → Blade Ø; without it a placeholder 200 mm
    blade is assumed, with a warning). The drawing shows each cut's footprint and the blade at
    both ends; the simulator draws the blade standing in the cut.
  - **Facing**: mills the top of the panel (or picked closed shapes) down by a set amount, back
    and forth or in rings, in passes. **Re-set the stock top** makes later operations on the
    top measure their depths from the faced surface (through cuts still end where they did).
  - **Chamfer**: a V cutter's flank makes a bevel along the picked edges, set by width or by
    depth, optionally with the tip lower than the bevel; from shapes on the top, or from level
    3D edges of a solid at their own height.
  - **Cut between two curves** (the surface joining two shapes or 3D polylines, finished with
    passes from one to the other, the tool placed exactly on that surface), **cut along a 3D
    curve** (the tip follows a 3D polyline, or a smooth curve through its points) and
    **Z-wave** (the depth rises and falls along a shape). These move the tool up and down while
    cutting: simulated only, never written to woodWOP (`CAM_NO_OUTPUT`).
  - **Hand-drawn toolpath**: pick feed lines, arcs (through a point, then the end) and rapids on
    the drawing at a set height; undo last; edit each step in a table.
  - **Edit toolpath** (any operation except notes and drilling): slow down in corners (distance,
    steps, feed % at the corner), feed % on single moves, heights point by point, moves between
    cuts at another height, reverse, and pocket start points. Point edits are tied to the moves
    they were made on; when the toolpath is recalculated they are applied again, moved to the
    move that ends at the same point, or marked **Edits lost** (export refused until you keep or
    clear them).
  - **Edge work (aggregate)**: a flat tool on an aggregate that turns about the vertical axis,
    kept square to the edge, pushed a set distance into it at a set height (for example a
    groove round a door's edge), in passes. Simulated only: the machine model has no aggregate
    and no aggregate macro is confirmed, so the export checker always refuses it.
  - **Output** (switch: Write facing, chamfers and saw cuts to MPR, **off**, also needs the
    custom-part switch): facing, chamfers, hand-drawn toolpaths at one depth and edited
    toolpaths become contour-milling passes; saw cuts become saw-groove macros. While it is off
    the checker blocks them (`CAM_25D_OUTPUT_OFF`). **Saw cuts are refused while the machine
    model has no saw unit** (`MACHINE_CANNOT`, the N-200 default), whatever the switches; angled
    saw cuts, curve cuts, edge work, toolpaths with heights edited point by point and lost edits
    are never written (`CAM_NO_OUTPUT`). A facing cutter's reach or a saw blade's run-out into
    another part on the sheet is an error (`OP_HITS_NEIGHBOUR`).
- **CAD and tool additions** (switch: CAD and tool additions, on; part designer → **CAD** menu,
  the **Dimension** tools, and the Machine page):
  - **Turn-by-turn sketch**: describe an outline element by element (lines and arcs, each
    direction from +X or as the turn from the one before, 0 = tangent), press **?** on the values
    you don't know, and the solver works them out so the outline closes (a closed outline can work
    out two, for example a door's side height and its arch radius). Blends and chamfers on the
    corners. The sketch stays with the shape and can be opened and changed later.
  - **Dimensions**: linear (horizontal, vertical, aligned), angle, radius, diameter and ordinate.
    Their ends stick to the shapes' corners and centres, so they follow every change. Inches show
    as fractions; each can show the other unit too. **Measure angle** at a corner. **Print to
    scale** makes a PDF at 1:1 to 1:50, split over several sheets with crop marks and an overlap
    strip for full-size templates; measure the check bar on each sheet before trusting it.
  - **Geometry query**: find shapes (layer, type, size, area, length, radius, holes inside,
    inside another shape, the outline...), faces of a solid (type, diameter, facing, depth,
    colour) or models, then select them or move them to a layer. A query can be kept in a rule
    table as an **auto-query**: it runs before the layer rules on every import (Library → Rules
    lists them). The layer rules themselves now run on the same query engine, with the same
    results as before.
  - **Fill with holes**: a grid, staggered grid or rings of holes inside the selected closed
    shapes (shapes inside them stay clear), with a margin from every edge, optionally with a
    drilling operation.
  - **Split into panels**: a drawing bigger than a sheet becomes sheet-sized parts that overlap by
    a set amount; shapes cut at a join are closed again along it, and each panel keeps the
    operations on its pieces.
  - **Trace a picture**: a PNG, JPEG, GIF, BMP or WebP picture (a logo) becomes closed contours,
    with threshold, invert, smoothing, sharp corners and speck cleaning. Our own tracer.
  - **Holders for every router**: tools that name no holder use the shop's **default holder**; a
    tool with no stick-out given is checked as if the holder sat right at the top of its flutes
    (the shortest possible, so the check errs on the safe side) and shows a Configure badge. The
    simulator draws the holder on 2D tools too, and the collision check uses it. Holders are
    edited on the Machine page point by point, or made from a model of the holder (STL, OBJ,
    3MF, STEP, IGES, BREP: its widest point at every height).
  - **Angle heads and aggregates**: offsets, tool tilt, allowed head angles and housing, assigned
    per tool. Edge work warns when the head would need an angle it cannot be set to, or its
    housing would hit the panel's edge or the spoilboard; the simulator draws the housing.
    Listing an aggregate never fits one on the machine.
  - **Tool table**: edit it as a grid (arrows, Tab, Enter; type to edit; Ctrl+Z / Ctrl+Y; Save /
    Discard); export every tool field to a spreadsheet (.xlsx or CSV) and import it back with each
    change shown first; **Tool data in operations** lists every operation whose tool has changed
    since its toolpath was accepted (diameter 8 → 10, …) and updates it on request.
- **Small extras** (switch: Small extras, on):
  - **Thread milling** (Machining → Add operation → More 2.5D → Thread milling, on picked
    circles): internal or external threads, metric pitch, right or left hand, top-down or
    bottom-up, radial passes out to the full depth (ISO basic depth by default) and a spring pass.
    The helix is written as half-turn arcs that each drop exactly their share of the pitch, so
    pitch and length are exact in the toolpath. It checks the tool (a thread mill; it fits the
    core hole; its tooth reaches the depth past its neck) and asks for a core hole cut first
    (**Add core holes** makes the circles and a pocket). Simulated in the stock with the 60°
    tooth. **Simulation only**: no woodWOP form is confirmed for helical moves, so the checker
    always refuses it (`CAM_NO_OUTPUT`). The thread mill T109 is a placeholder with Configure
    badges; thread mills are never picked on their own for pockets, engraving or facing.
  - **Fold, flatten, wrap** (3D tab): **wrap** picked shapes (text too) along a curve: distance
    along the curve and distance out from it are kept, so lengths along the baseline stay exact
    (within 0.01 mm); **flatten** a surface model into a flat pattern (every facet keeps its edge
    lengths; a surface that is not developable is reported with how far off it is); **fold** a
    flat pattern along drawn fold lines by an angle into a surface model (folding then flattening
    gives the pattern back).
  - **Hatching, detail views, line types** (Dimension tools → **Hatch**, **Detail view**; Layers →
    line type): a hatch fills the picked closed shapes (holes stay empty) at an angle and
    spacing, optionally crossed, and follows the shapes when they change; a detail view shows a
    circle of the drawing magnified elsewhere, marked and labelled; each layer can be solid,
    dashed, hidden, centre or dotted. All of them print to scale: hatch spacing and part lengths
    divide by the print scale, a detail is its own factor larger again, and dashes keep their
    paper length at any scale. Notes only: never machined.
  - **Stroke fonts** (Library → Fonts): make single-stroke engraving fonts: draw each letter's
    strokes on a grid, set its advance, start from a copy of the built-in font, import and export
    them. The text tool and a text's properties pick the font. A text keeps a copy of the
    letters it uses, so changing a font never changes parts already drawn; letters a font lacks
    use the built-in ones.
  - **Rapid surfaces** (any operation → Moves between cuts): moves between cuts follow a cylinder
    or a dome over the panel instead of the flat safe height (a suggested arch, from the
    clearance height at the edges to the safe height in the middle, marked until checked).
    Never below the clearance height. The cutting moves are unchanged; the simulation, the
    collision check and text (G-code) programs use it. woodWOP programs move between cuts at the
    machine's own safety height, so MPR output is not affected.
- **Rotary (4-axis)** (switch: Rotary (4-axis), on; screens and simulation only on the N-200):
  - **Set-up** (3D tab → Rotary): the axis (along X, Y or Z of the part's drawing, through a
    point you give), the blank (round, by diameter, or square, by side) and where it starts and
    ends along the axis. Or put the axis on a cylindrical face of an imported solid (**Axis onto
    this face**).
  - **Wrapped planes**: a cylinder round the axis at a radius, from one angle to another and
    between two places along the axis, drawn unrolled on the part's drawing (along the axis as
    it is; round it as arc length at its radius, with 90° ticks). Made from the blank's radius,
    from extents, or **from a solid's cylindrical face** (radius, length and angles fitted to the
    face). Shapes drawn inside a plane's rectangle wrap onto it.
  - **Rotary operations** (Machining → Add operation → Rotary roughing, finishing, rings,
    spiral or wrapped shapes): passes **along the axis**, **rings round it** or **one spiral**,
    on a model (STL, OBJ, 3MF or a solid); roughing in
    levels from the blank's surface in to the model, or one finishing pass; **wrapped shapes**
    (drawn on a plane) cut to a depth below the plane or below the model, also with a saw
    blade straight along or round the axis. The tool stands square to the axis and points at
    it; between passes it lifts clear of the blank before it turns. Step-over and roughing
    step-down are placeholders with Configure badges.
  - **Simulated on a rotary stock**: the top view shows the blank's surface unrolled; 3D turns
    the blank under the tool as the machine would. Positions read as X, A and the distance from
    the axis. The collision check covers the shank, holder, rapids through material and a tool
    tip reaching the axis. (The tests check every pass against the model with an independent
    gouge check that shares no code with the toolpaths.)
  - **Output**: never to woodWOP. The N-200 has no rotary axis, so a turned part is left out of
    nesting and the job export refuses it with a clear message (`CAM_ROTARY`). Another machine
    whose machine model declares an A, B or C axis (Machine & tools → machine model → Rotary
    axis) can write rotary programs only through a **script post** written for it (a sample,
    `examples/plugins/rotary-4axis-post.js`: Settings → Plugins → **Add the sample rotary
    post**), with the new "Write rotary programs through script posts" switch on (off by default) as well as the
    script-post switch and the plugin's machine-output grant. The built-in template post never
    writes a rotary operation. Until then the Program dialog shows the program as a preview with
    the reasons it is not written. A job with a turned part in it is refused as a whole; the
    message names each turned part and says to remove it from the job to export the rest.
- **Positional 3+2** (switch: Positional 3+2, on; screens and simulation only on the N-200):
  - **Tilted planes** (part designer → 3D tab → Tilted planes (3+2)): a plane through the
    part at any angle: **typed in** (tilt, the direction it tilts towards, a turn on the plane,
    its origin and size), **a side of the part's block** (front, right, back, left, top,
    underside) or **a flat face of a solid** (fitted to the face; how far the face strays from
    a flat plane is shown). Each plane has a dashed orange rectangle on the drawing with its
    name and angle; shapes drawn inside it lie on the plane (x and y from its thick corner).
  - **Operations on a tilted plane**: drilling, pockets, profiles and engraving get a **Work
    plane** choice; their depths are measured below the plane and the tool runs along the
    plane's normal. Router tools only (no aggregates, saw or lollipop cutters); a hole
    larger than the drill, a through cut or a shape outside the plane's rectangle is refused
    or warned about with the reason.
  - **Kinematics** (Machine & tools → machine model → 3+2 axes): a machine model can declare two
    rotary axes for 3+2: a fork head (head-head), a trunnion table (table-table) or a rotary
    table with a tilting head (table-head), which letters, their travel, the head's pivot
    length, the table's centre, where the part sits and whether the control keeps the tool tip
    on the point. The app works out the two locked angles for each plane (the solution with
    the least turn of the first axis inside the travel, or the other one with **Use the
    machine's other solution**) and the machine's X, Y, Z for every move. The figures of the
    placeholder 3+2 axes carry Configure badges; the N-200's model has none.
  - **Simulated with the tool tilted**: the stock is held as rays in three directions, so cuts
    from any side show. The tool turns between operations after backing off clear of the block.
    The collision check covers the shank, holder, rapids through material, the spoilboard and
    table, the side of the cutter in a tilted cut and anything reaching below the part. The
    tests replay the machine's own program (angles and X, Y, Z read back through the kinematics)
    on that stock and check every cut point on a test block with holes and pockets on four
    tilted planes against the drawing, for all three layouts (within 0.01 mm; measured
    0.001 mm, the chord tolerance on arcs).
  - **Going back in the simulator** (rotary and 3+2): the background check hands back up to
    eight stock states along the program, so stepping back replays at most a short stretch on
    the screen instead of the whole program from the start.
  - **Output**: never to woodWOP. The N-200 cannot tilt its tool, so a part with tilted
    operations is left out of the cut list and nesting, and the job export refuses it with a
    clear message (`CAM_POSITIONAL`) naming the part and its tilted operations. Another machine
    whose machine model declares 3+2 axes can write the program only through a **script post**
    written for it (a sample, `examples/plugins/positional-3plus2-post.js`: Settings → Plugins
    → **Add the sample 3+2 post**), with "Write 3+2 programs through script posts" on (off by
    default), the script-post switch, the plugin's machine-output grant and every angle and
    position inside the axes' travel. The built-in template post never writes a tilted
    operation. The post also gets each operation in its plane's own frame, so a control with
    its own tilted-plane cycle can be written for instead.
- **Simultaneous 5-axis** (switch: Simultaneous 5-axis, on; screens and simulation only on the
  N-200): operations whose tool tilts while it cuts.
  - **The 5-axis engine**: the toolpaths come from a 5-axis engine behind our own interface
    (`MultiAxisEngine`). The intended real engine is a licensed commercial one; **none is
    licensed or installed** (an owner decision; nothing is bought, downloaded or signed up for
    without a written OK), so the shop's engine answers "**5-axis engine not licensed**" and
    nothing is calculated. Machine & tools shows the engine's status under the switch.
  - **Built-in preview engine** (pick it on the operation): simple methods of our own so a 5-axis
    set-up can be simulated: along 3D curves or solid edges, swarf (the side of a flat end mill
    along a leaning wall between a bottom and a top curve) and ball-nose surface finishing (the
    ball sits where 3-axis finishing puts it, the tool turned about the ball's centre). It plans
    no collision avoidance for the shaft and holder and does no roughing; its toolpaths are
    **never written** to any machine.
  - **Operations** (part designer → Add operation → 5-axis): along curves, swarf, surface
    finishing and multi-axis roughing (licensed engine only). **Tool axis**: along the surface
    normal or square to the curve (with lead along the cut and tilt to the left), a fixed tilt,
    through or away from a point or a line, towards a guide curve, or straight up; a largest
    tilt and axis smoothing. Cut **as made, reversed or there and back**; **head flip**: the
    usual axis solution, the other one (head turned 180°) or whichever stays inside the travel.
    Step-over, step-down, largest tilt and axis smoothing are placeholders with Configure badges.
  - **Barrel and form tools** (Machine & tools → tool → Cutting shape): a barrel (widest at its
    diameter, a side arc and a rounded tip) or any outline typed in as heights and radii (arcs
    allowed), with a drawing of the outline; the simulator, the stocks and the collision checks
    use the outline. A placeholder barrel T110 is in the placeholder tool table.
  - **Our checks on any engine's toolpath**: straight moves with a tool direction on every move;
    our own gouge check against the model (exact for a ball-nose at any tilt; a groove meant to go
    into the model counts only past its depth).
  - **Simulated with the tool tilted on every move** on the three-way stock, with the collision
    check; replayed through a machine's kinematics. Where the tool direction changes between
    operations (3+2 or 5-axis) the tool backs off, rises clear above the block, turns while moving
    over and comes down, and that turn is checked too.
  - **Kinematics** (Machine & tools → machine model → 3+2 axes → "The rotary axes also move while
    it cuts"): our own conversion to the machine's X, Y, Z and both rotary angles for every move,
    following one axis solution (angles never wrapped, the free axis held when the tool points
    along it, a rotary axis that would swing round within a cutting move refused), and moves
    split until the machine's even axis motion keeps the tip within 0.01 mm of each move.
  - **Output**: never to woodWOP. The N-200 has three axes, so a part with 5-axis operations is
    left out of the cut list and nesting, and the job export refuses it with a clear message
    (`CAM_MULTIAXIS`) naming the part and its 5-axis operations. Another machine whose model
    declares simultaneous 5-axis can write a **licensed engine's** toolpath (never the preview's)
    only through a **script post** written for it (a sample,
    `examples/plugins/simultaneous-5axis-post.js`: Settings → Plugins → **Add the sample 5-axis
    post**; both rotary axes on every move, inverse-time feeds where they turn; not
    machine-validated), with "Write 5-axis programs through script posts" on (off by default),
    the script-post switch, the plugin's machine-output grant, our gouge check passing and every
    angle and position inside the travel.
- **Clamps, pods and rails** (switch: Machine simulation, part compare and fixtures, on; part
  designer → 3D tab → Clamps, pods and rails): fixtures that hold the part, from the shop's
  library (Machine & tools → Fixtures; invented example sizes with Configure badges until the shop
  enters its own), from closed shapes drawn on the part (stood up to a height), or from a model
  file (STL, OBJ, 3MF, STEP, IGES, BREP; kept as slices, each the convex outline of all the model
  has between two heights, so an arm reaching over the part leaves the space under it free). Place
  them by typing, by **dragging them on the drawing**, or **automatically**: clamps round the part
  as close as the toolpaths let them, pods under it where no tool reaches below, each kept clear
  of the whole tool (cutter, shank and holder plus the collision margin). The collision checks
  (3-axis, tilted and 5-axis) keep the tool the margin away from every fixture: a hit is a
  collision (`fixture`) that names the fixture, jumps to its move and **blocks the export**
  (`CAM_COLLISION`). Fixtures are never machined or written to a machine. Less used on a vacuum
  nesting table like the N-200.
- **Machine simulation** (switch as above; Simulate → **Machine**): the whole machine replayed in
  3D from the machine model: gantry, carriage, head, spindle, tool and holder, the table and
  spoilboard (or a rotary table and cradle), the part with its fixtures and the material left.
  What is replayed: the toolpaths converted for the chosen machine (the N-200, or another machine
  from Machines and process steps; 3+2 and 5-axis through the machine model's own kinematics), the
  part's **own woodWOP program read back**, or a **program file** such as a post's output (G-code
  with the rotary axes; G53 Z read from the top of the Z travel). Between operations it goes to the
  tool change, and rises and turns the rotary axes as the sample posts do. Every moving part is
  checked against the table, the part's block and its fixtures (exactly along straight moves;
  where the rotary axes turn, in half-degree steps), keeping the collision margin, and every axis
  against its travel; each hit names what hits what, its line or move, and jumps there. The
  machine's parts are **invented** until measured (Machine & tools → Machine parts, Configure
  badge): boxes and cylinders carried by an axis. A check of our own programs against the
  machine's parts as entered, not of the real machine; nothing new is written to any machine.
- **Part compare** (switch as above; Simulate → 3D → **Compare with the model**, or Custom parts →
  **Compare with models…** for several parts at once): the finished stock coloured against the
  part's 3D models: **gouges** (cut into the model) red, **material left** blue, within the
  tolerance (0.05 mm, settable) green, with the deepest gouge marked and the most material left,
  for one part or a list of parts with a small top view each. A closed model is its own solid; an
  open one (a relief or a surface) counts down to the underside inside its outline. As fine as the
  simulation's cells.
- **Values still to confirm**: every value that is a placeholder or a built-in default (tools,
  the saw blade, tool lengths, feeds, holders, the machine-model figures, whether a saw unit or an
  aggregate is fitted, and the default cutting values) shows a **Configure** badge where it is
  used: operation editor, tool table, Machine page, simulator and the export checker's messages.
  Configure opens the exact field for the real value; **Mark as confirmed** keeps the value
  shown. The Machine page lists them all, and the sidebar shows how many are left. Every value can
  be changed at any time (the tool table, the Machine page's **Default cutting values**, or on
  one operation); changes mark the affected operations out of date and the checks run again.
  Confirming a value never switches on any output.
- **Simulate**: plays the toolpaths in program order, with cutting moves, rapids and the tool.
  The material left is shown as a shaded top view or in 3D (with the tool's shank and holder,
  see-through stock and a section cut across the width or the length), with depth readouts and
  the volume removed.
  - Play, pause, one move back or forward, previous or next operation, go to or run to a chosen
    move; separate speeds for cutting and for rapids; stop at each tool change.
  - **Collision check** (in the background): the shank (above the flutes) and the holder must
    keep a margin (Machine & tools → Collision margin, 2 mm) from the material; rapids must not
    touch it; cuts must not go deeper than the spoilboard limit, or into the table. Each
    collision in the list jumps to its move. A collision blocks export (`CAM_COLLISION`). 3D
    operations whose shank or holder would hit the model are flagged as soon as they are
    calculated, with the stick-out or flute length they need.
  - **Cut-free pieces**: after through cuts, slugs from openings and offcuts round a shaped part
    are shown faded and drop out of the through-cuts-only view; the part stays.
  - **Save stock as STL**: the material left, as a closed model.
  - A full 5 x 12 ft sheet plays smoothly at 1 mm cells.

  This checks our own toolpaths, not the machine; woodWOP's simulation is still required.
- **Drilling patterns** (Library → Drilling patterns): verified Salice and Blum patterns come
  built from the published numbers below. Patterns can also come from manufacturer DXF (circles,
  with depth in the layer name such as `DRILL_D12`) or CSV (`pattern,manufacturer,x,y,diameter,depth,face,units`).
  **Draft from spec sheet** reads a manufacturer PDF, scan or photo and drafts the pattern
  plus the item's library data (part number, category, cup / plate / runner / screw numbers).
  The **Hardware** button in the part designer places only verified or approved patterns, and an
  approved pattern linked to the plate or a TANDEM runner also drives the cabinet-side boring
  (newest approved pattern wins; library item edits flow through; a job's kept values still win).
- **Draft from customer drawing** (Custom parts page, also in a job's Custom parts tab): a
  customer's spec, drawing, scan or photo of one piece, such as a sliding door, becomes a complete
  editable part: outline (square, rounded, arched or polygon), size and quantity, material,
  edge treatments, grooves and dados (a groove that matches a router bit is cut in one pass with
  it), holes, cut-outs and recesses, and hardware bored from approved library patterns. Edge
  grooves, edge profiles and underside milling are drafted into the notes with a warning, since
  they are not machined from this side.
- **Safety rules for every draft** (hardware and parts): every value cites its page, the printed
  text, and a box on the page; values the reader can't find stay **blank**, never guessed;
  quotes missing from the PDF's text layer are flagged. The review dialog shows the source page
  beside the drafted geometry, and clicking a value's source chip highlights its box. **Nothing
  can be saved, placed, added to a job or nested until a named person ticks that they checked
  it**: drafts are refused by the library, the part store and the cut list.
- **Readers**: under **Settings → Spec-sheet reader**, choose a vision model provider: OpenAI,
  **Anthropic (default, Claude Sonnet 4.5)**, Google Gemini or xAI Grok. Each provider has its
  own API key and an editable model (defaults `gpt-4.1`, `claude-sonnet-4-5`,
  `gemini-2.5-flash`, `grok-4`). PDF pages are rendered, photos are scaled to 2000 px, and the
  images are sent to that provider. Without internet or a key, the **offline built-in reader**
  is used: it reads numbers printed as text (hole sizes, depths, spacing, overall size,
  thickness, corner radius, quantity, groove sizes) and leaves the rest blank. Scans and photos
  need a provider. Keys come from each provider's developer console; chat subscriptions,
  including Cursor's, can't be used. Keys are kept on this computer only, in
  `secrets/ai-keys.json` under the app's data folder, never in the shop file, its backups or the
  repository. The desktop app encrypts them with the system keychain and makes the calls from
  the main process. The browser preview keeps them unencrypted in browser storage.
  Samples to try: `examples/specs/top-roller-tr50.pdf` and `examples/specs/sliding-door-cohen.pdf`.
- **Batch runs**: drop a part-list CSV (cabinet-side parts, DXF drawings, or doors) into an inbox
  folder. Nested MPRs, labels, sheet maps, a cut list, a BOM and a report appear in the outbox
  without touching the UI. A list with validator errors is reported and not exported. Cancel
  stops the current list. Use the **Batch runs** page, the desktop watcher, or the command line:

  ```bash
  npm run batch -- run examples/batch/parts.csv --out /tmp/out
  npm run batch -- watch ./inbox --out ./outbox
  ```

  Pass `--data <cabinet-studio.json>` to use the shop's library, machine and settings. With the
  built-in defaults, custom-part MPR output is off, so the example order is reported as blocked
  and no programs are written. That is the intended safe default.

  **Batch additions** (switch "Batch additions", on; programs for other machines have their own
  switch, **off**):
  - **Other machines and process steps** (Machine page → Machines and process steps): each has
    its own tool table, machine model, holders and confirmations, edited on the same page. A new
    one starts as a placeholder copy with every value badged. A batch setup sends the same list
    to several machines: each gets its own nest, programs and export check; the main machine's
    files stay in the order folder, the others go in a sub-folder. Written only with "Write
    programs for other machines" (off: they are checked and listed in the report).
  - **Batch setups and the setup wizard** (Batch page → New batch setup): machines, outputs and
    extra steps, step by step, ending with a check run of a small list.
  - **Assemblies and fittings in part lists**: an `assembly` column (kept together on a sheet,
    printed on the labels) and `fitting` rows: a library hardware item on a panel by face (top,
    bottom, front, back, left, right: the part's faces 1-6), from an edge, at a distance. The
    holes come only from the hardware's approved drilling pattern (the same placement as the
    Parts designer); hardware without one goes in the BOM only. Nothing is assumed: a drilled
    fitting without its position is a row problem.
  - **Batch steps**: run after nesting and before output for every machine. They can report,
    hold an order back and add report files, never change the programs. Built in: **Waste
    areas** (each sheet's scrap and remnant pieces as a CSV). Plugins add their own steps (M2.10).
  - **Layer-rule wizard** (Library → Machining rules → New table with the wizard): layer names
    typed or read from a DXF, the machining for each (starting from what the shop's rules do),
    and a check on the drawing.
  - **Admin tools** (Settings): a password on the machine page and the machining rules (not
    security; everything stays visible, and unlocking makes it editable), screens hidden from
    the side bar, the tool-change order used by "Order by tool" (Machine page), and the
    missing-recipe report (rules and door styles pointing at deleted recipes, shapes no
    operation machines).
  - **Shop data storage** (Settings, desktop app): the JSON file stays the default; as an option
    the data is kept in a SQLite database beside it (materials, tools and jobs as tables other
    programs can query), with the JSON file still written on every save. Export to and import
    from a database file. Uses the SQLite built into Electron's Node: nothing extra installed.
    `npm run batch -- ... --data cabinet-studio.sqlite` reads it too.

  **Plugins, script posts and program tools** (switch "Plugins and program tools", on; every
  kind of output they could produce has its own switch, **off**):
  - **Plugins** (Settings → Plugins): JavaScript files that add designer and job-page menu
    commands, batch steps and script posts. Each runs in its own sandbox (QuickJS in
    WebAssembly): it cannot see the app, your files or the network, and is stopped after 5 s or
    64 MB. A plugin's header *asks* for folders, https hosts or machine output; only what you
    tick is granted, every refusal is logged, and the desktop app checks the grants again on the
    real file system. New or changed code starts switched off with nothing granted. A plugin
    never switches output on and never gets past the export checker: its part changes come back
    checked (it cannot confirm values, approve drafts or mark toolpaths up to date), and its batch
    steps cannot add programs. Samples in `examples/plugins/`; the typed API is offered on the
    Plugins screen as `cabinet-studio-plugin.d.ts`.
  - **Macro recorder** (Parts designer → Plugins → Record a macro): what you change becomes a
    plugin with one command that makes the same changes again.
  - **Script posts**: a plugin's post turns the toolpaths into program text for another
    controller. Machines other than the N-200 can use the woodWOP writer, the sample G-code
    template or a script post (Machine page); the N-200 always gets woodWOP. The Program dialog
    previews a part through another machine's post with the checks; writing needs "Write programs
    through script posts" (off), the plugin's machine-output grant and a clean export check, and
    is refused for work G-code cannot describe (edge or turned-over drilling, aggregates,
    operations without one tool).
  - **Read a program** (Custom parts page): a G-code program or one of our MPR files back into
    toolpaths, one per tool change, then the simulator with the collision check.
  - **Program manager** (job → Output → Programs): open each program in an editor with line
    numbers and simple maths on values (add, subtract, multiply, divide or set one word or key on
    a range of lines), check it, simulate it, keep the edit with the job, and copy programs to the
    machine folder (Machine page). Programs as generated follow the export rules; programs edited
    by hand also need "Copy hand-edited programs to the machine folder" (off) and a clean check
    (reads back, on the table, above the spoilboard allowance, tools from the table).

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
electron/          main process: window (app://bundle), JSON (or SQLite) storage with backups, folder export,
                   plugin file and network access with its own grant check (IPC)
src/core/          pure TypeScript, no React — everything below is unit tested
  types.ts         domain model (mm internally; cabinet X=width, Y=depth, Z=up; part x=length/grain)
  units.ts         mm storage, fractional-inch display, parse 23-1/4 and 23.25
  hardware/        published Salice Silentia+ and Blum TANDEM boring numbers
  room.ts          placements, wall and neighbour snap (including tops), arrange a run
  elevation.ts     plan-facing walls and the door/drawer divisions drawn on an elevation
  library/         CSV/XLSX/JSON import, and keep-or-update when a library edit hits existing jobs
  geometry.ts      frames, world<->part transforms, polygons
  construction/    parametric carcass generator -> parts with drilling/grooves in part coords
  cutlist.ts       job expansion, part numbering/IDs, edgeband cut-size compensation, BOM
  nesting.ts       MaxRects nesting with grain/rotation/spacing/trim
  sheetCuts.ts     shared-line cutting and bridged groups (plans, measuring, independent checks)
  flipSide.ts      flip-side sheets: side-1 program, reference edge, registration
  manualNest.ts    layouts edited by hand: apply, snap, turn, live check, nest list files
  areas.ts         areas and costs per sheet and part
  machining.ts     sheet programs: tool selection, placement transforms, contours, pockets
  mpr/             woodWOP MPR 4.0 writer + minimal parser (tests)
  validator.ts     pre-export checks
  labels/          label placement on parts, labels/sheet-map PDF (jsPDF), ZPL
  pipeline.ts      runJob(): expand -> nest -> programs -> validate -> labels
  nestShape.ts     true-shape nesting (no-fit polygons, Clipper2)
  batch.ts         part-list CSV -> orders -> runJob per machine; batchWatch.ts inbox watcher
  machines.ts      other machines and process steps (own profiles), batch targets
  fittings.ts      fittings placed by face in part lists (approved drilling patterns only)
  batchSteps.ts    batch steps after nesting / before output, waste areas, step registry
  wizards.ts       batch-setup and layer-rule wizards (answers -> setups)
  admin.ts         tool-change order, missing-recipe report, admin password, hidden screens
  shopDb.ts        SQLite storage option (tables for materials, tools, jobs; lossless)
  programEdit.ts   program manager: maths on values, checks for edited programs, copy rules
  sha256.ts        SHA-256 (plugin grants belong to the exact code)
  hardware/patterns.ts, patternImport.ts   drilling patterns, DXF/CSV import, PDF drafts
src/cam/           custom-part kernel: arcs, offsets, booleans, DXF/PDF, toolpaths, native MPR, sim
  mesh/            3D meshes: STL/OBJ/3MF readers, repair, placement, sections, outline, simplify;
                   surfaces made in the app (revolve, ruled, loft, sweep, extrude, flat, fillet...)
  solid/           solid models: OpenCascade reader loading, exact face types, STEP text metadata,
                   panel alignment, feature recognition, assemblies, face machining, wires
  model/           model data store (compressed, by SHA-256, outside the shop file), part files
  stock/           stock model interface, the heightfield, rotary and three-way (tri-dexel) stocks,
                   playback, cut-free pieces
  collision/       shank, holder, rapid, spoilboard and fixture checks (simulation, and against 3D
                   models); convex solids and their distances (GJK) for fixtures and the machine
  fixtures/        clamps, pods and rails: shapes, slices of a model, the library, automatic placing
  machine/         machine simulation: the machine's parts and kinematic chain, the replay of
                   toolpaths or a program read back, the machine collision check
  compare/         part compare: the stock against the design model, colour map, several parts
src/core/confirm.ts  unconfirmed values: what is still a placeholder, where its real value goes
  more25d/         saw cuts (run-out, joining, keep-off), curve cuts (between curves, 3D curves,
                   Z-waves), hand-drawn toolpaths and toolpath edits (anchors, corners, reverse),
                   thread milling, rapid surfaces
  rotary/          rotary (4-axis): axis frames and wrapped planes, rotary passes, the rotary stock,
                   gouge and collision checks, planes from a solid's cylindrical faces
  positional/      positional 3+2: tilted plane frames, kinematics for three layouts, toolpaths
                   to machine axes (and back) or the plane's own frame, the tilted-tool timeline
                   and checks, planes from a solid's flat faces
  multiaxis/       simultaneous 5-axis: the engine interface and the "not licensed" stub, the
                   built-in preview engine, tool-axis rules, our checks on an engine's toolpath
                   (reversed / both ways, gouge check), the simultaneous conversion with head flip
  worker/          background compute worker (3D tasks) with progress and cancel
  plugin/          plugin sandbox (QuickJS), the typed API, grants, part-change checks, batch
                   steps, script posts, macro recorder
  post.ts          the post input shared by the template post and script posts
  programRead.ts   G-code and our MPR read back into toolpaths
src/core/machineModel.ts   machine model (placeholder N-200), tool and holder outline, default holder
src/core/toolData.ts       tool fields, grid editing, spreadsheet export/import, tool data in operations
  tools/holder.ts  holder outline from a model (revolved envelope)
  tools/form.ts    barrel and form tool outlines (TOOL-07)
  turnSketch.ts    turn-by-turn sketch on the constraint solver (solver.ts)
  dims.ts, print.ts  associative dimensions, print to scale (PDF)
  annotate.ts      hatching, detail views, line types (notes, printed to scale)
  develop.ts       wrap along a curve, flatten a surface, fold a flat pattern
  font.ts          the built-in stroke font and stroke fonts made in the library
  query.ts         geometry queries and auto-queries (the layer rules run on it)
  holeFill.ts, panelling.ts, trace.ts   fill with holes, split into panels, image trace
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

- The **machine model**: table size, travel, tool change position, safe height, spoilboard
  thickness, and whether a saw unit or aggregate is fitted. All of these are **placeholders**.
  The saw unit is treated as absent, so saw grooves are blocked by the export checker until it
  is confirmed. Every export warns while the figures are placeholders.
- Tool data per tool (Edit): cutting shape (ball-nose, bull-nose with corner radius), shank
  diameter, flute length, stick-out, holder and aggregate. The ball-nose 6 and 3 mm, bull-nose
  12 mm, the stick-outs of the 2D routers T101-T104, the collet-chuck holder (the shop default)
  and the rotating aggregate in the built-in table are invented placeholders.

- The **machine's parts** for the machine simulation (gantry, head, spindle, tables) and the
  **fixture library** (clamps, pods, rails): invented sizes with Configure badges.

- Tool numbers and diameters (placeholder data).
- Whether drills are addressed by diameter or by tool number.
- Whether a horizontal drill unit is fitted (off by default).
- Router pockets versus saw grooves.
- Through depth into the spoilboard and the spoilboard limit.
- Contour approach and direction.
- The `OP` and `FM` header values.

See [ROADMAP.md](ROADMAP.md) for the open questions and what comes next.
