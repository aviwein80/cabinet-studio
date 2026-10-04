# Custom-part CAM: Stage 2 (Advanced) and Stage 3 (Rare) build spec

Owner: Avi Weinreb. Written October 2026 for Cabinet Studio.

This is the build spec for the next two stages of the custom-part side of Cabinet Studio (the
Parts page, `src/cam/`, `src/pages/part/`). Stage 1 is done: CAD, DXF/PDF import, 2D machining,
native woodWOP output, layer rules, parametric doors, true-shape nesting, batch runs, the 2.5D
backplot and the AI spec-sheet reader (README, "Custom parts").

Everything here is written in our own words and describes **what each function must do**. It is
not a copy of any other product's documentation, screens or names. Feature IDs (`CAD-02`,
`3D-01`, ...) are our own tracking numbers.

Effort figures are rough top-down estimates in person-weeks (pw), for sizing only.

---

## 1. Ground rules that apply to every item

1. **One system.** New work extends the existing job, part document (`CamPart`), tool table
   (`MachineProfile.tools`), nesting (`src/core/nesting.ts`, `src/core/nestShape.ts`),
   simulator (`src/cam/sim.ts`), toolpath IR (`src/cam/toolpath.ts`) and MPR writer
   (`src/cam/mpr.ts` -> `src/core/mpr/writer.ts`). No parallel copies.
2. **Associative operations.** Every operation stores its inputs (geometry/face/mesh ids, tool,
   parameters) and regenerates when they change. The existing stale flag (`opInputHash`,
   `opState` in `src/cam/doc.ts`) covers new operation kinds too.
3. **Millimetres inside.** All stored lengths are mm. Display follows the shop's mm/inch switch
   (`src/core/units.ts`); inch shows as fractions to 1/16 in. 2D contours stay native lines and
   arcs until a consumer needs points.
4. **Feature switches.** Each milestone adds its own switch under Machine & tools ->
   Custom-part features (`FeatureFlags` in `src/core/types.ts`, defaults in
   `src/core/features.ts`). Anything that writes machine files is **off by default**.
5. **Safety.** Output for the N-200 goes through the existing export checker
   (`src/core/validator.ts`). Tool numbers stay placeholders until the owner supplies the real
   table. Nothing is described as machine-proven.
6. **Tests.** Unit tests plus golden files (geometry in, toolpath digest and MPR out) for every
   milestone, deterministic output, and no regressions to the existing suite.

---

## 2. Our vocabulary

Use these names in code, UI and docs.

| Our name | Meaning |
|---|---|
| Profile | Cut along a contour (inside, outside, on line), multi-pass, with leads and tabs |
| Pocket | Clear the area inside a boundary, with islands |
| Adaptive clearing | Pocketing that holds tool engagement roughly constant (trochoidal-style moves) |
| Rest machining | Machining only what a previous, larger tool could not reach |
| Z-level roughing | 3D roughing in horizontal slices from the top down |
| Parallel finishing | 3D finishing with parallel passes, tool dropped onto the surface |
| Waterline finishing | 3D finishing along constant-Z contours, best on steep walls |
| Projection finishing | A 2D pattern projected down onto a 3D surface |
| Pencil pass | A single pass along internal corners and valleys |
| Scallop finishing | Passes spaced for a constant cusp height |
| Flat-area finishing | Offset passes only on horizontal flats |
| Helical finishing | A continuous spiral down steep walls |
| Curve-driven finishing | Passes guided by one or two drive curves |
| Stock model | The simulated material left after each move |
| Holder | The tool holder and shank geometry used for collision checks |
| Machine model | Axes, limits, table, heads and components, shared by simulation and posts |
| Positional (3+2) | Rotary axes lock at an angle, then 3-axis cutting |
| Simultaneous 5-axis | All five axes move during cutting |
| Rotary (4-axis) | Machining around a rotating axis, with a wrapped (developed) work plane |
| Relief | A 3D carved surface brought in as a mesh or height map |
| Recipe / layer rule | Saved operations, and the table that applies them by layer name (Stage 1) |
| Batch run | Unattended CSV/folder processing (Stage 1) |
| Plugin | Third-party code that runs against our API in a sandbox |
| Script post | A post processor written as a sandboxed script |

---

## 3. Stage 2: Advanced (54 features, about 210 pw)

### 3.1 Feature list

Grouped by milestone (section 3.2). "Approach" is the suggested build route.

**M2.1 3D foundation**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| CAD-13 | Mesh import | Read STL (binary and ASCII), OBJ, and 3MF if cheap. Units choice, scale, auto-orient onto the work volume, report bad facets. Rhino and SketchUp only if a permissive reader exists, otherwise list as a decision. | Own STL/OBJ parser; openNURBS for Rhino is optional | 2-4 |
| NEW-18 | Mesh utilities | Simplify (by percent or tolerance), cut into sections, turn facets or slices into polylines, delete facets, make 2D sections at a Z, project the outline to 2D. | meshoptimizer (MIT) or own | 2 |
| SOL-05 | Work volume from a model | Fit the work volume to a mesh or solid, set the top and bottom Z levels, set stock oversize. | Own | 1 |
| TOOL-04 (part) | Holder and shank geometry | Each router tool gets shank diameter, flute length, gauge length and a holder outline (revolved profile). Needed by collision checks. Aggregates come in M2.6. | Own schema, extends `Tool` | (in M2.7) |
| 3D-12 | Large-model performance | Chord and facet tolerances, worker threads for all heavy 3D work, cancel, progress. | Web Workers / Electron utility process | (in 3D) |

**M2.2 3D roughing and finishing**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| 3D-02 (carry-over) | Parallel finishing | Passes at an angle, step-over, one-way or zig-zag, climb or conventional, slope limits, skip flats. Listed as Stage 1 in the plan but not built yet; build it here first. | Drop-cutter on a mesh | 6-8 |
| 3D-01 | Z-level roughing | Slice the model from the top; clear each level by offset, zig-zag or spiral, or adaptive (M2.3); close open pockets; intermediate slices; extra levels on flats; stock to leave XY/Z; helix, ramp or pre-drilled entry with max-plunge checks; links that stay down when safe; account for material already removed. | Own slicing on the 2D kernel (`src/cam/kernel.ts`) | 8-12 |
| 3D-03 | Waterline finishing | Constant-Z passes with slope (contact angle) limits, optional fill of shallow areas, closed-loop ordering. | Waterline on a mesh | 4-6 |
| 3D-04 | Projection finishing | Project a 2D pattern (drawn geometry, text, engraving) down onto the surface; supports block engraving on a 3D face. | Drop-cutter along 2D paths | 4 |
| 3D-11 | Boundaries and protected surfaces | Limit any 3D op to a boundary (contained, centre-on, touching), skip protected faces, gouge-check against faces that are not being machined. | Own | 3 |

**M2.3 Adaptive clearing and rest machining**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| NEW-01 | Adaptive clearing | Inside pockets and Z-level roughing: target engagement (width or angle), smoothing radius, lifted fast back-moves, adaptive feed, trochoidal moves when the tool would cut full width. | Own on the 2D kernel; published adaptive-clearing papers as reference | 8-10 |
| 2D-07 | 2D rest machining | Machine only the area a previous tool left (from the actual swept area of earlier ops), with a minimum path length. | Clipper2 booleans of swept areas | 3-4 |
| 3D-06 | 3D rest and pencil | Find material left by a larger tool in 3D; pencil pass along valleys and internal corners. | Own (bitangency / curvature detection), hard | 6-8 |

**M2.4 Stock simulation and collision**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| SIM-02 | Stock simulation | Play, step, fast-forward; separate feed and rapid speeds; stop at tool change or at a chosen op/move; transparency and section view; save the stock as STL. | Extend the existing heightfield (exact for vertical 3-axis), behind an interface that a tri-dexel or voxel stock can replace in Stage 3 | 8-12 |
| SIM-03 | Collision checking | Detect tool shank, holder, rapids and (later) aggregate hitting stock, table, spoilboard or clamps; log with jump-to-move; safety margin setting. | three-mesh-bvh (MIT) or own BVH | 6-10 |
| SIM-05 | Cut-free pieces | Detect and drop pieces that are fully cut free after through-cuts; keep parts, mark scrap. Stage 1 already flags loose pieces; extend it. | Connected components on the stock grid | 2 |
| NEW-13 | Machine model | Axes, travel limits, table size (N-200: 5 x 12 ft), spoilboard, tool change position, safe area, heads; save/load; shared by sim, collision checks and posts. | Own data model | 3 |

**M2.5 Solid models**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| CAD-14 | Solid import | STEP (AP203/214/242), IGES, BREP. Keep face ids and colours. Native CAD formats are a buy decision (section 5). Read part names and custom properties when present. | OpenCascade (LGPL-2.1) as WASM | 6-12 |
| CAD-16 | 3D wire and surface extraction | Extract 3D edges, build contours from picked edges, take surfaces from faces, extend a surface, 3D polylines (create and edit point by point). | OpenCascade | 4-6 |
| NEW-19 | Surface creation and edit | Revolve, ruled between two curves, sweep through sections, extrude, flat; fillet between surfaces; split, untrim, extend, extract edges; convert to mesh. | OpenCascade | 4 |
| SOL-01 | Feature recognition | From a solid panel: outer outline, inner cut-outs, pockets (with depth and floor), blind and through holes (diameter, depth, face), minimum bounding-box alignment. Output goes to layers so the Stage 1 layer rules machine it. | OpenCascade topology walk + face classification | 8-12 |
| SOL-02 | Machine faces directly | Pick faces of a solid and profile, pocket, drill (cylindrical faces) or saw (edges) without first extracting 2D geometry. | OpenCascade | 6-8 |
| SOL-03 | Faces to layers | Send faces to layers or recipes by colour or type; set face colour; use a coloured face to set grain direction. | OpenCascade attributes | 2-3 |
| SOL-04 | Assemblies | Split an assembly or multi-body file into separate parts with names, quantities and properties; feed them to the job and nesting. | OpenCascade XDE | 3-4 |

**M2.6 More 2.5D machining**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| 2D-11 | Saw cuts | Vertical and angled saw cuts, extend to clear, minimum length, show the blade, avoid cutting into neighbours, join collinear cuts. Output as native woodWOP saw macros where the machine has a saw unit. | Own; woodWOP saw-groove macro | 3 |
| 2D-13 | Chamfer machining | Chamfer along edges with a V or chamfer tool: width or depth driven, from 2D geometry or solid edges. | Own | 2 |
| 2D-15 | Between-curves and 3D-curve cuts | Cut a surface between two curves; follow a 3D spline or polyline; convert a 2D path to a Z-wave. | Own | 2-3 |
| 2D-16 | Facing | Face mill the top of a panel to a level; re-set the stock top. | Own | 1 |
| NEW-09 | Hand-drawn toolpath | Build a path by picking feed lines, arcs and rapids, with undo last. | Own | 1 |
| NEW-11 | Toolpath edits | Slow down in corners (distance, steps, percent), edit feed, edit Z point by point, adjust rapids, reverse, set pocket start points. Edits survive regeneration or are flagged. | Own | 1.5 |
| 5AX-04 | Contour with rotating aggregate | Edge work with a vertical-tool rotating aggregate, if the N-200 has one (owner to confirm). | Own + woodWOP aggregate macros | 2-3 |

**M2.7 CAD and tool additions**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| CAD-02 | Turn-by-turn sketch | Draw a closed outline element by element (line, arc, blend, chamfer), leaving unknown lengths or angles for the solver to back-calculate. | Reuse `src/cam/solver.ts` | 3 |
| CAD-08 | Dimensions | Linear, aligned, angular, radius, diameter, ordinate; alternate units; measure distance and angle. Print to scale. | Own | 2 |
| CAD-17 | Geometry queries (full) | Query and auto-query rules: test, field, operator, value, result layer, for geometry, solids and faces. Stage 1 has a minimal version in `src/cam/rules.ts`; extend it. | Own query engine | 3 |
| CAD-18 | Fill with holes | Fill a boundary with a hole array (grid, staggered, radial; margin; spacing). | Own | 0.5 |
| NEW-05 | Panelling | Split geometry larger than a sheet into sheet-sized panels with overlap, closing contours at the joins. | Own on Clipper2 | 1 |
| NEW-06 | Image trace | Insert an image and trace it to vectors (threshold, smoothing, corner detection). | imagetracerjs (public domain) or own. Not potrace (GPL). | 3 |
| TOOL-04 | Holders and aggregates library | Holders as revolved profiles or imported solids; angle heads and aggregates with offsets and allowed angles; assign per tool. | Own + OpenCascade for solid holders | 3-4 |
| TOOL-05 | Tool data compare | Compare the tool data stored in each operation with the library and update on request; spreadsheet export/import of the tool table. | Own; SheetJS already in the app | 1 |
| NEW-15 | Tool table grid edit | Edit the tool table as a grid with keyboard navigation, save and undo. | Own (`EditableTable`) | 0.5 |

**M2.8 Nesting additions**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| NST-04 | Shared-line cutting | Place straight edges of neighbouring parts on one cut, removing the duplicate pass; join saw cuts. Respect hold-down: last cut and small parts. | Own | 3-4 |
| NST-05 | Bridged nesting | Link parts with short bridges into one continuous path, with onion-skin passes and maximum bridge length. | Own | 2-3 |
| NST-07 | Flip-side nesting | Nest parts that need underside work and produce the mirrored second-side sheet program with registration. Stage 1 already writes a turned-over program per part; extend to whole sheets. | Own; woodWOP mirrored program | 3 |
| NST-09 | Manual nesting | Drag, rotate and snap parts on a nested sheet; edge alignment; split or save sheets; reload a saved nest list and report missing parts. | Own | 2-3 |
| NEW-20 | Area and cost | Areas per part and per sheet (parts, scrap, remnant), cost by area or weight. | Own | 1 |

**M2.9 Batch additions**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| AM-03 | Setup wizards | Step-by-step wizards for a new batch setup and a new layer-rule set. | Own | 1-2 |
| AM-06 | Database storage option | Optional SQLite store for jobs, materials and tools beside the JSON file, with import/export. JSON stays the default. | better-sqlite3 (MIT) in the main process | 2 |
| AM-08 | Multiple machines | Send the same part list to several machines or process steps, each with its own machine model and post. | Own | 3 |
| AM-09 | Assemblies and fittings by face | Batch input that carries assemblies and hardware fittings placed by panel face (top, bottom, left, right, front, back). | Own | 3 |
| AM-10 | Batch extensions | Hooks after nesting and before output; process waste areas on sheets; plugin-provided steps. | Plugin API (M2.10) | 2-3 |
| AM-13 | Admin utilities | Tool ordering, missing-recipe report, password-protected defaults, hide screens. | Own | 1-2 |

**M2.10 Plugins, script posts, program tools**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| API-01 | Plugin API | A typed TypeScript API over the document, geometry, operations, tools, nesting, batch events and output hooks. Plugins run sandboxed with no file or network access unless granted; menu contributions; a macro recorder. | Worker / utility process sandbox, or QuickJS-WASM (MIT) | 4-6 |
| PST-02 | Script posts | Write a post as a sandboxed script that receives the toolpath IR and returns text. The native woodWOP writer stays built-in. | Same sandbox | 2 |
| PST-04 | Program manager and editor | List generated programs, open them in a text editor with line numbers and simple math on values, copy to the machine folder. | Own | 1-2 |
| NEW-22 | Read a program back | Read G-code (and our own MPR via `mprRead.ts`) back into toolpaths for backplot and simulation; split at tool changes. | Own | 1.5 |

**M2.11 Relief import**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| ART-01 | Relief import | Import reliefs made in Vectric software (STL export) or as greyscale height maps (PNG/TIFF with a depth range), place and scale them on a part, machine them with M2.2 roughing and finishing. **No relief modeller.** A partnership is the owner's decision. | Own import; reuse M2.1-M2.2 | 2-4 |

### 3.2 Stage 2 milestones and acceptance criteria

Order matters. Each milestone leaves the app shippable, behind its own switch.

| # | Milestone | IDs | Acceptance criteria |
|---|---|---|---|
| M2.0 | Audit | - | Written report on the current code, gaps against this spec, risks and the planned file layout. No code changes. |
| M2.1 | 3D foundation | CAD-13, NEW-18, SOL-05, holder fields, 3D-12 | A 1 M-triangle binary STL imports in under 5 s; a 10 MB ASCII STL imports; bad files give a clear error, not a crash. Simplify to 10% keeps the shape within the given tolerance (measured Hausdorff distance). Sections at Z return closed contours. The work volume fits the mesh with stock oversize. Heavy work runs off the UI thread and can be cancelled. |
| M2.2 | 3D roughing and finishing | 3D-02, 3D-01, 3D-03, 3D-04, 3D-11 | On analytic test surfaces (hemisphere, sine-wave relief, raised-panel field, cove moulding): no tool position gouges the surface by more than 0.005 mm (checked by an independent drop-cutter test); finish stock-to-leave is met within ±0.01 mm; roughing leaves at least the requested stock and never more than stock + one step-down on walls; scallop height on flat-to-gentle areas is within ±10% of the value implied by the step-over. Boundaries clip correctly. Golden digests are stable. A 600 x 400 mm relief with 200 k triangles, 6 mm ball, 10% step-over, finishes in under 30 s on a mid-range laptop. |
| M2.3 | Adaptive and rest | NEW-01, 2D-07, 3D-06 | Adaptive clearing never exceeds the target engagement by more than 10% (measured per move from the swept area) and has no full-width moves outside flagged trochoidal sections. 2D rest only cuts where the previous tool left material (verified against the swept-area boolean), and skips paths shorter than the minimum. 3D pencil follows valleys on a test model within 0.02 mm. |
| M2.4 | Stock simulation and collision | SIM-02, SIM-03, SIM-05, NEW-13 | Removed volume matches the analytic volume within 1% for a pocket and a profile at 0.5 mm cells. The collision test suite (shank too short for a deep pocket, holder into a wall, rapid through stock, cut below the spoilboard limit) has zero misses and zero false alarms. Each collision jumps to its move. Stock exports as a watertight STL. Full-sheet playback at 1 mm cells holds 30 fps. Cut-free pieces are detected on the Stage 1 test parts. |
| M2.5 | Solid models | CAD-14, CAD-16, NEW-19, SOL-01..04 | STEP files of a cabinet side with holes, a shaped door, and a 5-part assembly load with face ids. Feature recognition finds every outline, pocket and hole in the fixture set, with depths within 0.01 mm, and puts them on layers that the existing layer rules machine to an MPR that passes the export checker. The OpenCascade WASM loads only when needed and is not in the start-up bundle. Licence notices are in place. |
| M2.6 | More 2.5D | 2D-11, 2D-13, 2D-15, 2D-16, NEW-09, NEW-11, 5AX-04 | Each op has golden toolpaths on at least 3 reference parts. Saw and aggregate output use native woodWOP macros (only where the machine model says the unit exists). Toolpath edits survive or are flagged after regeneration. |
| M2.7 | CAD and tools | CAD-02, CAD-08, CAD-17, CAD-18, NEW-05, NEW-06, TOOL-04, TOOL-05, NEW-15 | The turn-by-turn sketch solves a door outline with two unknowns. Dimensions update with geometry and display in inches. Queries reproduce the Stage 1 rule results and add solid/face tests. Image trace turns a logo PNG into closed contours. Holders show in the simulator and are used by collision checks. |
| M2.8 | Nesting additions | NST-04, NST-05, NST-07, NST-09, NEW-20 | Shared-line cutting cuts total cut length by at least 15% on a rectangle-heavy reference job without changing part sizes (measured). Flip-side sheets line up within 0.1 mm in the backplot. Manual edits keep spacing rules and are re-validated. Area and cost numbers match hand calculation. |
| M2.9 | Batch additions | AM-03, AM-06, AM-08, AM-09, AM-10, AM-13 | A batch run to two machine models gives two sets of programs. The SQLite option round-trips the shop data without loss. Wizards create setups that pass the existing batch tests. |
| M2.10 | Plugins and posts | API-01, PST-02, PST-04, NEW-22 | A sample plugin adds a menu item and a batch hook and cannot read files it was not granted. A sample script post produces G-code identical to the built-in template post on the reference parts. A G-code file reads back and simulates. |
| M2.11 | Relief import | ART-01 | A Vectric-exported STL and a height-map PNG import at the right size and depth and machine with M2.2 strategies in the simulator. |

**Stage 2 exit:** a carved door panel from an STL relief and a shaped part from a STEP file go
from import to simulated, collision-free toolpaths and a checked MPR (with MPR output still off
by default), with all tests green.

---

## 4. Stage 3: Rare (23 features, about 80-100 pw plus licences)

The N-200 is a 3-axis nesting router. Rotary and 5-axis work is for future machines or other
shops. It must never be sent to the N-200; the export checker refuses any operation the machine
model cannot run.

### 4.1 Feature list

**M3.1 More 3-axis finishing**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| 3D-05 | Radial and spiral finishing | Passes radiating from a centre, or a spiral from a centre, within a boundary. | Drop-cutter reuse | 2-3 |
| 3D-07 | Scallop finishing | Passes offset across the surface to keep a constant cusp height. | Own surface offsets, hard | 6-8 |
| 3D-08 | Flat-area, helical and undercut finishing | Offset passes on flats only (with rest option); continuous helical finishing on steep walls; undercut finishing with lollipop tools. | Own | 4-6 |
| 3D-09 | Curve-driven finishing | Passes guided by drive curves or an existing toolpath; along the intersection of two surfaces; along surface parameter lines; with the tool kept on one side of a surface. | OpenCascade surfaces + own | 6-10 |

**M3.2 Small extras**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| NEW-08 | Thread milling | Internal/external threads, pitch, hand, top-down or bottom-up, pre-drill. | Own | 1 |
| NEW-07 | Fold, flatten, wrap | Fold/unfold, flatten a developable surface, wrap 2D geometry onto a curve. | Own | 3 |
| NEW-21 | Annotation and print | Hatch, detail magnify, line types, print or plot to scale. | Own; jsPDF already used | 1.5 |
| NEW-24 | Stroke font editor | Create and edit single-stroke engraving fonts (extends `src/cam/font.ts`). Digitiser input is skipped. | Own | 2 |
| 2D-18 | Rapid planes | Rapid moves on a cylindrical or spherical safety surface instead of a flat safe Z. | Own | 2 |

**M3.3 Rotary (4-axis)**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| 3D-10 | Rotary machining | Parallel and profiling passes around a rotary axis; drive geometry through the axis; disk and saw tools. | Own wrap math | 6-8 |
| NEW-14 | Wrapped work planes | Developed (unrolled) work planes around X, Y or Z from a radius, extents or a cylindrical face. | Own | 3 |

**M3.4 Positional (3+2)**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| 5AX-01 | Positional machining | Tilted work planes with locked rotary angles; convert a tilted-plane path to machine axes; convert to vertical. | Own kinematics on the machine model | 6-10 |

**M3.5 Simultaneous 5-axis (licensed engine)**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| 5AX-02 | Tool-axis control | Through a point or line, normal to a curve or surface, fixed tilt, boundaries, guide curves; 5-axis cut along a 3D curve or solid edge. | Licensed engine behind our interface | 16-30 |
| 5AX-03 | Advanced 5-axis strategies | Multi-axis roughing, swarf, surface finishing, gouge check, axis smoothing and optimisation. | Licensed engine (ModuleWorks or similar) | Buy |
| TOOL-07 | 5-axis tool shapes | Barrel and user-defined shaft profiles. | With the engine | (in 5AX) |
| NEW-26 | Head-flip solution | Choose the alternate axis solution (head turned 180°); cut a 3D path reversed or both ways. | With the engine | (in 5AX) |

**M3.6 Machine simulation, compare, fixtures**

| ID | Feature | What it must do | Approach | pw |
|---|---|---|---|---|
| SIM-06 | Machine simulation | Kinematic simulation of the whole machine (axes, heads, table, clamps) from the post output, with collision checks. | Own on the machine model; full commercial simulator only if needed | 20+ |
| SIM-04 | Part compare | Colour map of stock versus design model (gouge and leftover), for several parts. | Signed distance on meshes | 3-4 |
| FIX-01 | Clamps and fixtures | Define clamps, pods and rails from geometry or solids; place them by drag or automatically; include them in collision checks. Less relevant to a vacuum nesting table. | Own | 4-6 |

**M3.7 Recorded as out of scope**

| ID | Feature | Decision |
|---|---|---|
| 2D-19 | Polishing, waterjet, laser cycles | Skip. Not a router shop need. |
| AM-14 | Shop ERP and third-party cabinet software import | Skip. Cabinet Studio is the cabinet software. |
| ROB-01 | Robot output | Skip. |
| LAT-01 | Lathe, wire, stone, laser modules | Skip. |

### 4.2 Stage 3 milestones and acceptance criteria

| # | Milestone | IDs | Acceptance criteria |
|---|---|---|---|
| M3.1 | More 3-axis finishing | 3D-05, 3D-07, 3D-08, 3D-09 | Same gouge (0.005 mm) and stock (±0.01 mm) tolerances as M2.2. Scallop finishing holds cusp height within ±10% over the whole test surface. Golden digests. |
| M3.2 | Small extras | NEW-08, NEW-07, NEW-21, NEW-24, 2D-18 | Thread pitch and depth exact in the IR; wrap keeps arc length within 0.01 mm; prints measure to scale. |
| M3.3 | Rotary | 3D-10, NEW-14 | A turned leg and a fluted column simulate in a rotary stock model with no gouges. Output only through a script post for a machine model with a rotary axis; the N-200 export refuses it. |
| M3.4 | Positional | 5AX-01 | Tilted-plane holes and pockets on a test block land within 0.01 mm after the axis conversion, checked in simulation. N-200 export refuses it. |
| M3.5 | 5-axis engine interface | 5AX-02, 5AX-03, TOOL-07, NEW-26 | A `MultiAxisEngine` interface, a stub engine that returns a clear "not licensed" result, and tests with a fake engine. No licence is bought and no SDK is added without the owner's written OK. |
| M3.6 | Machine sim, compare, fixtures | SIM-06, SIM-04, FIX-01 | The machine model drives a kinematic replay; a deliberate head-into-clamp case is caught; part compare colours a known gouge correctly. |
| M3.7 | Out of scope | 2D-19, AM-14, ROB-01, LAT-01 | Listed in ROADMAP.md as skipped, with the reason. |

---

## 5. Buy versus build

| Area | Decision | Why |
|---|---|---|
| Simultaneous 5-axis, 3+2 conversion at scale, advanced multi-axis strategies | **Buy** a licensed engine (ModuleWorks is the usual choice), only when a machine needs it. Build the interface now, not the engine. | Years of work and high risk; the commercial engines are the industry standard. |
| Relief design | **Do not build a modeller.** Import STL or height maps from Vectric (or similar) and machine them ourselves. A partnership or OEM deal is the owner's call. | A sculpting modeller is a separate product. |
| 3-axis surfacing (parallel, waterline, Z-level) | **Build.** Use OpenCAMLib (LGPL-2.1) only if its WASM build works cleanly; otherwise write drop-cutter and waterline in TypeScript (the algorithms are published). | Shop 3D work is mostly reliefs and moulding shapes; this is manageable. |
| Solid import | **Build on OpenCascade** (LGPL-2.1) compiled to WASM: STEP, IGES, BREP. Native SolidWorks / Inventor / NX / Creo / CATIA need a commercial translator: owner decision. | Free kernel covers the neutral formats. |
| Stock simulation | **Build.** Heightfield for 3-axis (exact for a vertical tool), tri-dexel or voxel later for 3+2 and 5-axis. Manifold (Apache-2.0) for mesh booleans and STL export. | Already started in Stage 1. |
| Collision checks | **Build** on a BVH (three-mesh-bvh, MIT). | Small, well understood. |
| Machine simulation | **Build** a basic kinematic replay on our machine model; buy a full simulator only if a customer needs it. | The N-200 still gets woodWOP's own simulation. |
| Image trace | **Build** or use a public-domain tracer. Not potrace (GPL). | Low priority. |
| DWG | **Skip** (decided October 2026). | Needs a commercial SDK. |

### 5.1 Allowed libraries

Permissive (MIT, BSD, Apache-2.0, BSL-1.0, ISC, public domain) are fine. LGPL is fine when it is
dynamically loaded (a separate, replaceable `.wasm` or shared library), with its licence and
notice shipped and our changes to it (if any) published. **No GPL or AGPL code** in the app.
Nothing decompiled.

| Need | Library | Licence |
|---|---|---|
| B-rep kernel, STEP/IGES/BREP | OpenCascade (opencascade.js, occt-import-js, replicad wrapper) | LGPL-2.1 (wrappers vary; check each) |
| 2D offsets and booleans | Clipper2 (`clipper2-ts`, already used) | BSL-1.0 |
| 3D drop-cutter / waterline (optional) | OpenCAMLib | LGPL-2.1 |
| Mesh booleans, watertight stock | Manifold (`manifold-3d`) | Apache-2.0 |
| Mesh simplify | meshoptimizer | MIT |
| BVH for collision and picking | three-mesh-bvh | MIT |
| Script sandbox | quickjs-emscripten | MIT |
| SQLite | better-sqlite3 | MIT |
| Image trace | imagetracerjs | Public domain |
| Reading only, never copying code | FreeCAD CAM (LGPL), Kiri:Moto (MIT) | design reference |
| Not allowed | CAMotics, LibreDWG, potrace, any GPL/AGPL | - |

---

## 6. Clean-room rules

1. Build from this spec and from general CAM knowledge only. Do not use any other CAM product's
   help text, manuals, screenshots, posts, sample macros, tool or door libraries, report
   templates or key bindings.
2. Our own names (section 2), icons, layouts and UI. Do not reproduce another product's toolbar
   tab names and order, panel names, dialog tab layout, colour scheme or icon style.
3. No decompiling or reverse-engineering of anyone's binaries or private file formats. Interoperate
   only through open or documented formats: DXF, STEP, IGES, STL, CSV, G-code and woodWOP MPR as
   HOMAG documents it.
4. Only the licences in section 5.1.

---

## 7. Decisions the owner must make

1. Does the N-200 have a saw unit, a rotating or angle aggregate, a horizontal drill unit? (Drives
   M2.6.)
2. Real tool table, including ball-nose and tapered tools for 3D, shank lengths and holders.
3. How 3D toolpaths should go to woodWOP: as 3D polyline contours, and the point-count limits
   woodWOP accepts. Until confirmed, 3D output to MPR stays off.
4. Default feeds, speeds and step-downs for 3D work in the shop's materials.
5. Native CAD translators (SolidWorks and others): buy or skip.
6. A relief partnership with Vectric (or similar): yes or no. Until then, import only.
7. A 5-axis engine licence: only if a 5-axis or rotary machine is coming.
