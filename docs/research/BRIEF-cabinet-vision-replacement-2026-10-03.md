# Cabinet Vision replacement on HOMAG/Weeke — research brief (Researcher, 2026-10-03)

## TL;DR
- MPR (plain-text .mpr) is feasible to generate. HOMAG's own 2022–2026 public samples (github.com/HomagGroup/HOMAG-Connect) still use MPR "4.0 Alpha", and Fusion, Mozaik, PolyBoard and Xil2WOP all write MPR. v1 targets MPR 4.0.
- MPRX/MPRXE: no public schema or samples (only commercial writers: CCSOFTCZ, Magi-Cut). woodWOP 8 still saves MPR, and HOMAG ships an MPRX->MPR batch converter. woodWOP 9 loading MPR is strongly implied but not explicitly confirmed; ask Stiles.
- No public success story of a fully custom replacement. Shops leaving CV went to Mozaik or PolyBoard. Recurring pains: tool-number mapping, horizontal drilling, material/labels on complex jobs.
- HOMAG natively supports barcode = woodWOP program name, so our tool writes MPR files plus a parts/label CSV or productionManager XML.

## 1. MPR format
Spec: leaked 2006 doc 9-080-42-7190-D00 https://pdfcoffee.com/homag-mpr4x-format-us-pdf-free.html ; German 2009 https://de.scribd.com/document/320951945/WoodWOP-Mpr4x-Format
Block order: [H header, [001 variables (names up to 8 chars, KM= comment), [K coordinate systems, ]n contours, <NNN \Name\ macros, ! end of file.
- [H: VERSION="4.0 Alpha", MAT=HOMAG/WEEKE, INCH, OP (optimization), FM, mirror flags, ANZ (quantity). HOMAG 2022+ samples add MATERIAL, CUSTOMER, ORDER, ARTICLE, PARTID, PARTTYPE, INFO1-5, and computed _BSX/_FNX/_RNX fields.
- <100 \WerkStck\: LA/BR/DI (length/width/thickness), FNX/FNY, RNX/Y/Z, AX/AY; MA = grain.
- Contours: ]1 starts one; $E0 KP X= Y= Z= KO= is the start point; KL = line; KA = arc (R, DS 0-3); KR = rounding, KF = chamfer; @ = relative value.
- <00 \Koordinatensystem\: NR, XP/YP/ZP, D1/KI/D2. Macros choose one with KO="00".
- 102 BohrVert (vertical drilling): XA, YA, BM (LS/SS/LSL; U suffix = from below), TI (depth), DU (diameter) or TNO (tool no.), AN (hole count, never 0), AB (pitch, 32 for 32 mm), WI (angle), MI (reference point), F_/S_, ZT/RM/VW.
- 103 BohrHoriz (horizontal drilling): XA, YA, ZA, BM (XP/XM/YP/YM, or C+WI), BM2="STD", TI, TNO/DU. Dowel insertion = <139 \Komponente\ ABD_ENU.MPR.
- 109 Nuten (saw groove): XA, YA, XE, YE, NB (width), TI (depth), RK (NOWRK/WRKL/WRKR), EM, MN="GL", T_ (saw tool). 124 groove_R = angled. Fusion writes \grooveen\ (likely a bug).
- 112 Tasche (pocket): XA, YA, LA, BR, RD (corner radius), WI, TI, ZT (step-down), XY (overlap %), T_.
- 105 Konturfraesen (contour milling): EA/EE (start/end element), MDA/MDE (approach/exit), RK (radius compensation), TNO, ZA, F_, S_.
- Other: 101 Kommentar, 152 Grafischer Kommentar; common fields ASG, KAT/MNM, ??=condition.
- Edgebanding: no macro in MPR 4.0 (MPRXE adds a Wizard edge macro). v1 passes edge codes on labels/parts list (productionManager EdgeFront/Back/Left/Right fields, label code like 011:000:011:000).
- Real HOMAG side-panel sample spl_01: 9 coordinate systems, 69 BohrVert, 14 Nuten, 14 Tasche, heavily parametric.
Sources: HOMAG-Connect repo (Applications/ProductionManager/Samples, intelliDivide Generic.mpr/PartA.mpr); Fusion post https://cam.autodesk.com/posts/view.php?name=woodwop ; Xil2WOP https://github.com/stormychel/Xil2WOP

## 2. MPR vs MPRX
MPRX since woodWOP 6.1, MPRXE since 8 (https://www.homag.com/en/software/woodwop-versions). woodWOP 8 saves MPR (formulas it can't represent are flattened), plus the MPRXPreprocessor_U.exe batch converter (https://forum.homag.com/forum/index.php?thread%2F12528-mprx-to-mpr-bulk-conversion%2F=). MPRX XML "not publicly known" (forum thread 11220). MPRXE docs: https://docs.homag.cloud/docs/neues-speicherformat-mprxe.md . Magi-Cut lists MPR(X) for woodWOP 4-9: https://www.magi-cut.co.uk/files/html/V12webhelp/mct2443.htm

## 3. Replacement stories
- Mozaik on Weeke/HOMAG: free post, happy users, about 4 h training. One shop with a CV deposit ($11k + $7k for S2M) reconsidered. https://woodweb.com/cgi-bin/forums/cnc.pl?read=828428
- Setup friction: tool numbers and the .mpr extension (woodweb 791727); "supply a known-good program" (845302).
- Counterpoint: Mozaik breaks down on large, multi-material custom jobs and has weak edgeband labels; fine for semi-standard boxes (woodweb 843594). Mozaik training $75/h vs CV $150/h (843166).
- DIY: SketchUp + CabinetSense + OpenCutList -> Excel -> master MPR (Weeke BHX050); a DRILLTEQ V-310 runs 50-100 variants chosen by barcode (HOMAG forum 11220); Excel VBA filling MPR templates (woodworker.de 84230); a VB program feeding Enroute (reddit r/CNC 74nzsb).
- Lesson: horizontal drilling by tool number fails until "Spindelauswahl immer verwenden" is enabled (forum thread 8931). Start from a working machine program.
- Thin: no in-house build timelines or costs found. Reddit content comes from snippets only.

## 4. Cabinet Vision features -> v1 scope
Sources: https://planitcanada.ca/wp-content/uploads/2019/03/CVR_S2M_english_COMPLETE.pdf , https://portalimages.blob.core.windows.net/products/pdfs/xwwa3c41_planit-brochure-2021-web.pdf
MUST: parametric product catalog; construction methods (32 mm system, back groove, dowels/cams, setbacks); material and edgeband library with grain and tool rules; cut list and BOM; one MPR per part plus left/right mirroring; grain flag; edge codes and pre-mill compensation; labels with barcode = program name; CSV or productionManager XML export.
NICE: nesting (hand off to intelliDivide/Cut Rite/OptiCut); quoting; assembly sheets; off-cut labels; 2D barcodes; preview (use woodWOP simulation).
SKIP v1: rendering, room layout, UCS engine, catalog editor, ERP beyond CSV, countertops, mouldings, true-shape nesting, saw/handling links.

## 5. HOMAG barcode and label workflows
- "The barcode corresponds to the name of the woodWOP program"; variables can be passed; woodBase handles second clamping (https://epimex.cz/app/uploads/2019/11/Software-CNC-en.pdf).
- Production list (Beleg, F11): `program; var1=2000; var2=800`, up to 10 variables; barcode license needed (50 test uses); USB scanner in virtual-COM mode (forum thread 6521). Prefix selects template, rest = variables (forum 11893).
- productionManager: part Barcode + CncProgramName1 with the MPR attached (HOMAG-Connect project.xml). Label fields: QR ID, article, sizes, material, "CNC Programm 1: 4711.mpr", edge code (https://docs.homag.cloud/docs/productionassist-cutting-kurz-erklaert-das-steht-auf-dem-etikett.md). Labels 100x80 or 100x70 on Zebra GK420d/ZD421 (https://docs.homag.cloud/en/product-sets/nesting-production-set/labels). Layout rules: https://docs.homag.cloud/docs/productionmanager-etikettenlayout.md . controllerMES is the on-premises option.
- woodScout = machine diagnostics, not labels. No "labelManager" product exists.
- CV labels: S2M Reports + UCS comments (https://planitcanada.ca/blog/awesome-resources/add-custom-comments-s2m-labels-cabinet-vision/). Microvellum: Face5/Face6Barcode. Generic: Code128 of the file name (http://www.astranest.com/files/cnc_on_label.pdf); CNC SCAN for BHX (https://disso.lt/en/furniture-solutions/cnc-scan/).

## Next steps / questions for Stiles
1. Get 3-5 real MPR files plus the tool table export from our machine.
2. Exact woodWOP version on the machine; does it load MPR 4.0?
3. Barcode/Beleg license active? Scanner in COM mode?
4. productionManager or file-based import?
5. PoC: one side panel, validated in woodWOP simulation before cutting.

## Annotated example
Reconstructed, unvalidated side panel (720x560x19, 32 mm shelf-pin rows, 8x8 back groove, horizontal dowels). Tool numbers are placeholders, and BM/RK/WI/ZA semantics must be validated in woodWOP simulation first. Saved in example-side-panel.mpr.
Local sources: /workspace/mpr/hc/ (HOMAG-Connect repo), woodwop.cps (Fusion post), xil.py (Xil2WOP).
