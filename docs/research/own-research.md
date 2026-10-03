# HOMAG / woodWOP: custom cabinet software, independent research

*Prepared for Avi Weinreb, 3 Oct 2026 (Asia/Jerusalem). Every claim links to its source. **[UNCERTAIN]** marks inference or claims I could not check against a primary source. **[VERIFIED-FILE]** means I downloaded and read the actual file.*

Local working files (on the box, under `/workspace/cabinet-research/`):
- `woodwop.cps`: Autodesk Fusion woodWOP post, rev 44226, dated 2026-05-19
- `samples/`: real MPR files (a woodWOP 9.0.152 export, HOMAG's own intelliDivide samples, and 82-file shop-data examples)
- `spec.md`: a markdown copy of the 2006 MPR 4.x spec (9-080-42-7190-D00)
- `hc/`: a clone of HOMAG's official HOMAG-Connect repo

---

## 0. TL;DR

1. **MPR 4.0 is still the current text format, and woodWOP 9 writes it.** A file saved by woodWOP **9.0.152** still starts `[H` / `VERSION="4.0 Alpha"`. It uses the same macro IDs as the 2006 spec (100, 102, 103, 105, 109…) and adds header fields: `WW="9.0.152"`, `CUSTOMER`, `ORDER`, `PARTID`, `MPRCOUNT`, `INFO1-5`. [VERIFIED-FILE] [sample](https://github.com/Svi-ra/CNC-fitting/blob/main/Examples/WoodWop_export/0_472x420-F_1_Standard-mode.mpr). Generating plain MPR 4.0 is a sound, low-risk target.
2. **HOMAG publishes an official GitHub repo with real MPR samples and a documented import format.** [HomagGroup/HOMAG-Connect](https://github.com/HomagGroup/HOMAG-Connect) was last committed 2026-10-02. It has C# clients and REST docs for intelliDivide, productionManager, materialManager and productionAssist. It also has a public **`project.xml` import spec** ([ImportSpecification.md](https://github.com/HomagGroup/HOMAG-Connect/blob/main/DataExchange/ImportSpecification.md), v3.00 dated 20 Mar 2026) with fields for parts, edges, `EdgeDiagram`, `CncProgramName1-3` and `MPR:<variable>`. This is a sanctioned way to feed HOMAG's cloud tools. The prior brief didn't mention it.
3. **HOMAG has a documented hook for production feedback inside MPR.** Put a comment macro with `HOMAG_PRODUCTIONMANAGER_FEEDBACK={Version:1.00,PARTID:…,MPRNUMBER:n,MPRCOUNT:m}` in the program, and machines report finished parts back as `.hol` files ([docs](https://docs.homag.cloud/en/data-exchange/homag-file-agent/feedback-of-machines)).
4. **HOMAG sells its own cabinet design tool, SmartWOP.** It's made by Tibek and integrates both ways with woodWOP ([HOMAG](https://www.homag.com/en/software-detail/software/order-creation/smartwop), [docs](https://docs.homag.cloud/docs/smartwop-kurz-erklaert-interaktion-mit-woodwop.md)). It belongs on the list of Cabinet Vision replacements. The prior brief didn't mention it either.
5. **There is still no mature open-source MPR library.** What exists is small, mostly unlicensed, and mostly "not yet proven on a machine." The most useful is [Svi-ra/CNC-fitting](https://github.com/Svi-ra/CNC-fitting) (Python, active Sept 2026). [CADialog-FreeWop](https://github.com/CADialog/CADialog-FreeWop), cited in the prior brief, **contains no code**. It holds only a README and screenshots. [VERIFIED by clone]
6. **MPRX/MPRXE is OpenCascade-OCAF XML with no public schema.** Don't target it. Plain MPR loads in all woodWOP versions.

---

## 1. MPR anatomy

### 1.1 Sources used
- The 2006 spec "woodWOP FILE-Description (MPR-Format) 4.2.7, 9-080-42-7190-D00" ([yumpu](https://www.yumpu.com/en/document/view/7153217/woodwop-file-description-mpr-format-postprocessor-woodwop); a markdown copy is [in this repo](https://github.com/Svi-ra/CNC-fitting/blob/main/Docs/homag-mpr4x-format-us_compress.md)).
- The Autodesk Fusion woodWOP post, rev 44226 / 2026-05-19 ([page](https://cam.autodesk.com/posts/view.php?name=woodwop), downloaded via `https://cam.autodesk.com/posts/download.php?name=woodwop`). [VERIFIED-FILE]
- Real files:
  - woodWOP 9 export ([link](https://github.com/Svi-ra/CNC-fitting/tree/main/Examples/WoodWop_export))
  - HOMAG's own samples `PartA.mpr`, `PartB.mpr` and `Generic.mpr` ([link](https://github.com/HomagGroup/HOMAG-Connect/tree/main/Applications/IntelliDivide/Samples/Postman))
  - 82 shop programs ([link](https://github.com/Svi-ra/CNC-fitting/tree/main/Examples/PAL_8681_SM_Alb_Diamant))

### 1.2 File-level syntax
| Token | Meaning | Source |
|---|---|---|
| `[H` | Header (data head), first section | spec §2, §5 |
| `[000` / `[001` | Variable table. Names ≤ 8 chars and must start with a letter. Each can be followed by a `KM="comment"` line (≤ 80 chars) | spec §6. The real files and the Fusion post all use `[001` |
| `[K` + `<00 \Koordinatensystem\` | User coordinate systems (NR, XP/YP/ZP, D1/KI/D2 Euler angles, MI) | spec §7, Fusion post lines 656-670 |
| `]n` | Start of contour number *n* | spec §2 |
| `$Em` | Contour element *m*. Element types: `KP` point, `KL` line, `KA` arc, `KR` round, `KF` chamfer, `KSL`/`KSA` split | spec §8 |
| `<ID \Name\` | Processing macro. The name between backslashes is formally a comment | spec §9 |
| `\ …` | Comment to end of line | spec §2 |
| `!` | End of file. Embedded component MPRs may follow it | spec §2, §9.2.20 |

**Value quoting.** Header, variable and macro parameters are written `KEY="expr"`, and the value may be a formula (`YA="B-28"`, `AB="L/6"`). Contour-element values are **unquoted** (`X=1182.0000`). Spec §3. Confirmed in every sample. [VERIFIED-FILE]

**Parser built-ins.** `_BSX`, `_BSY`, `_BSZ` are the finished-part size. `_mirror`/`_nonmirror` and `_cw`/`_cc`/`_CW`/`_CC` are arc-direction constants. `_lf`/`_ri` are radius-correction constants. `_ok`/`_no` are 1/0. Conditions use `??="expr"`. Spec §4.

**Line endings and encoding.**
- Svi-ra/CNC-fitting says woodWOP **needs CRLF**, and that an LF-only file "opens silently as an empty default panel." It writes cp1252 and enforces this with `.gitattributes` and `check_mpr.py` ([README](https://github.com/Svi-ra/CNC-fitting/blob/main/Tools/README.md), [.gitattributes](https://github.com/Svi-ra/CNC-fitting/blob/main/.gitattributes)). **[UNCERTAIN: a single author's claim, but cheap to obey. Use CRLF and cp1252/ASCII.]**
- The same author says single-space separator lines are "load bearing." That is contradicted by the woodWOP 9 export and HOMAG's own samples, which both use **empty** lines. [VERIFIED-FILE]. Single-space lines appear only in the PAL shop files, which came from some third-party generator.

### 1.3 Header (`[H`): fields seen in a woodWOP 9.0.152 export [VERIFIED-FILE]
`VERSION="4.0 Alpha"`, `WW="9.0.152"`, `OP`, `WRK2`, `SCHN`, `CVR`, `POI`, `HSP`, `O2`-`O5`, `SR`, `FM`, `ML`, `UF`, `ZS`, `DN`, `DST`, `GP`, `GY`, `GXY`, `NP`, `NE`, `NA`, `BFS`, `US`, `CB`, `UP`, `DW`, `MAT="HOMAG"`, `HP_A_O`, `OVD_U`, `OVD`, `OHD_U`, `OHD`, `OOMD_U`, `EWL`, `INCH="0"`, `VIEW="NOMIRROR"`, `ANZ`, `BES`, `ENT`, `MATERIAL`, `CUSTOMER`, `ORDER`, `ARTICLE`, `PARTID`, `PARTTYPE`, `MPRCOUNT`, `MPRNUMBER`, `INFO1`-`INFO5`, and computed `_BSX/_BSY/_BSZ/_FNX/_FNY/_RNX/_RNY/_RNZ/_RX/_RY`.

Meanings from the spec (§5):
- `OP`: drill optimization, 0/1/2
- `FM`: clearance/park direction, 0-4
- `CB`/`ML`: edge grouping and max length
- `NP`/`GP`/`GY`/`GXY`: generate normal / X-mirrored / Y-mirrored / XY-mirrored NC
- `DW`: rotate 0/90/-90
- `INCH`: 0 = mm, 1 = inch
- `MAT`: machine type `HOMAG`, `CF-HOMAG`, `FK-HOMAG` or `WEEKE`
- The `_*` values are informational for external tools. The NC generator ignores them.
- `R00`-`R27` (optional) is a 28×28 hex bitmap thumbnail.

A minimal header is accepted. The Fusion post writes only `VERSION="4.0"`, `INCH="0"`, `MAT`, `OP`, `FM` and `FW` (post lines 550-556). It maps inches to mm and also defines a variable `i="25.4"` for conversions.

The new woodWOP-9 header fields (`CUSTOMER`, `ORDER`, `PARTID`, `MPRCOUNT`, `MPRNUMBER`, `INFO1-5`) aren't in the 2006 spec. **[UNCERTAIN: semantics inferred from names. Line up with productionManager's MPRNUMBER/MPRCOUNT concept below.]**

### 1.4 Workpiece `<100 \WerkStck\` (spec §9.1.1)
| Key | Meaning |
|---|---|
| `LA`, `BR`, `DI` | Finished length (X), width (Y), thickness (Z). Usually written as formulas `"L"`, `"B"`, `"D"` that point at variables |
| `AX`, `AY` *or* `RL`, `RB` | Oversize (raw minus finished) *or* raw size |
| `FNX`, `FNY` | Finished-part offset from the fence |
| `RNX`, `RNY`, `RNZ` | Raw-part offset (template, raised pods) |

Origin `KO=0` is the bottom-left corner. KO 1/2/3 are bottom-right, top-right and top-left. 4-100 are user-defined (spec §9.2.1).

### 1.5 Common keys on every processing macro (spec §9.2)
- `??` condition and `EN` enable (default 1)
- `HP` hood position, `SP` spindle (0 auto / 1 left / 2 right / 3 both), `YVE` second-spindle Y offset
- `ASG` extraction (0 off / 1 on / 2 auto)
- `MX`, `MY`, `MZ` and `MXF`, `MYF`, `MZF` measurement dependence
- `KAT` / `MNM` category and name (for woodTime)
- `KO` coordinate system

woodWOP 9 adds `MLM`, `MXR`/`MYR`/`MZR`/`MLR`, `_MXF`, `SYA`, `SYV`, `ORI` (a running index) and `WW="40,41,42,…"`. **[UNCERTAIN: `WW` is undocumented. It looks like a list of allowed units/tool groups. Leave it out, or copy it from Avi's own exports.]**

### 1.6 Vertical drilling `<102 \BohrVert\` (spec §9.2.1)
| Key | Meaning |
|---|---|
| `XA`, `YA` | Position of the first hole (or the centre, if `MI=1`) |
| `TI` | Depth |
| `DU` *or* `TNO` | Diameter (the machine picks a drill from its bank) *or* tool number |
| `BM` | `LS` slow-fast, `SS` fast-fast, `LSL` through-hole slow-fast-slow, `SSS`, `LSU`/`LSLU` from below, or a custom cycle ID |
| `AN` *or* `LA` | Number of holes *or* row length |
| `AB` | Pitch (32 for System 32) |
| `WI` | Row direction angle (UI only). Alternatively `XR`/`YR` |
| `MI` | 0 = XA/YA is the row start, 1 = row centre |
| `S_` | Speed: 0 slow, 1 normal, 2 fast |
| `F_` | Feed in m/min or `STANDARD` |

A real HOMAG sample defines a full System-32 row in one macro: `XA="L-9.5" YA="26.5" TI="12" DU="8" LA="510" AB="96" WI="90"` ([PartA.mpr](https://github.com/HomagGroup/HOMAG-Connect/blob/main/Applications/IntelliDivide/Samples/Postman/PartA.mpr)). [VERIFIED-FILE]

The Fusion post shows deep-drilling extras: `ZT` peck increment, `RM` retract (`@`-prefixed means chip-break distance), `VW` dwell, `ZA` absolute Z reference (post lines 2061-2100).

### 1.7 Horizontal drilling `<103 \BohrHoriz\` (spec §9.2.2)
- `XA`, `YA`, `ZA`: the entry point on the edge. ZA is usually `D/2`.
- `BM`: `XP`/`XM`/`YP`/`YM` (drill toward +X/−X/+Y/−Y) or `C` with an angle `WI`
- `TI`: depth. `DU` or `T_`: diameter or tool.
- `AN`/`LA`, `AB`, `MI`: row options
- `ANA`: extra approach distance. `BM2`: `STD` or `BMR` (pecking, per the Fusion post).

Real woodWOP 9 example: `XA="472" YA="50" ZA="9" DU="8" TI="27.655" BM="XM"` drills into the right end edge. [VERIFIED-FILE]

### 1.8 Saw groove `<109 \Nuten\` (spec §9.2.5)
| Key | Meaning |
|---|---|
| `XA`, `YA` → `XE`, `YE` | Start and end. Alternatively `AN=1/2` with angle `WI` |
| `NB` | Groove width. HOMAG's PartA sample omits it, which presumably means the blade's own kerf width **[UNCERTAIN]**. The Fusion post always writes it |
| `RK` | `NOWRK` blade centred on the line, `WRKL` blade left of it, `WRKR` blade right of it |
| `TI` | Depth |
| `EM` | `MOD0` full depth at start and end, `MOD1` start/end at the coordinates, `MOD2` adds safety distance (for running right through the part) |
| `MN` | Grooving direction: `GL` climb (downcut) or `GGL` conventional |
| `TV`, `MV` | Scoring depth and scoring mode |
| `XY` | Overlap per pass, in % (used when `NB` > kerf, so a wide groove takes several passes) **[UNCERTAIN: wording in spec is "deliver factor"]** |
| `OP` | Wide-groove optimization |
| `T_` | Tool (saw unit) |

- The English spec and the Fusion post both write the comment name as `\grooveen\`. That is a translation artifact of `Nuten`. Real woodWOP 9 output writes `<109 \Nuten\` [VERIFIED-FILE]. Use `Nuten`.
- The angled saw groove is `<124 \groove_R\`.
- Contour sawing (Fusion post) is `<193 \Kontursaegen\`.

### 1.9 Pockets
- `<112 \Tasche\` rectangular pocket (spec §9.2.9):
  - `XA`, `YA` = **centre**; `LA`, `BR` = size; `RD` = corner radius; `WI` = rotation
  - `TI` depth; `ZT` depth step; `XY` stepover %; `DS` direction (0 CW / 1 CCW)
  - `T_` tool; `F_` feed; `ZA` Z reference
- Other pocket macros: `<123 \HTasc\` horizontal, `<181 \FreiFormTasche\` free-form contour pocket, `<141 \VTasche\` vector pocket, `<151 \UflurTasche\` from below.

### 1.10 Contours and routing
Geometry goes in a contour block: `]1`, then `$E0 KP X= Y= Z= KO=`, then `$E1 KL X= Y=`, `$E2 KA X= Y= R= DS=`, and so on.

- Arc `DS`: 0 = ≤180° CW, 1 = ≤180° CCW, 2 = >180° CW, 3 = >180° CCW (spec §8.3).
- The Fusion post writes `R` plus `DS` and flips `DS` when mirrored (lines 1868-1885). Its arc radius gets +0.002 mm "around rounding issue."
- The fallguy04 notes say the `KA` direction sign is ambiguous, so that project tessellates arcs into lines ([notes](https://github.com/fallguy04/cabinet-cnc-post-processors/blob/main/formats/woodwop.md)). **[UNCERTAIN. The spec and Fusion post are consistent, so test one arc on the machine.]**

Machining is referenced by element range:
- `<105 \Konturfraesen\` vertical routing (spec §9.3.1):
  - `EA="1:0"` start element, `EE="1:5"` end element
  - `MDA`/`MDE` approach and exit: `TAN`, `SEI`, `SEN` and the `_AB` variants
  - `RK` radius correction `NOWRK`/`WRKL`/`WRKR`; `EM` 0 plunge / 1 ramp; `RI` direction
  - `TNO` tool; `SM` 0 % / 1 rpm; `S_`/`S_A` speed; `F_` feed
  - `AB` offset; `ZA` depth (`"@0"` = use the element Z values; HOMAG sample uses `ZA="-0.2"` with `AF="0.2"`)
  - `STUFEN`, `ZSTART`, `ANZZST` step-down passes
- Other routing macros: `<133>` horizontal routing, `<140>` 5-axis vector routing, `<119 \Polygonzug\` polygon path, `<106>` edgebanding on a contour (for CNCs with a gluing unit), `<107>` flush trim, `<108>` end trim.

### 1.11 Reuse: components, blocks, comments
- `<139 \Komponente\`:
  - `IN="file.mpr"` include file; `EM` 0 = external, 1 = embedded after `!`
  - `VA="VarName value"` lines override the component's variables; `PR` private flag
  - This is how hinge boring and connector "macros" are reused (spec §9.2.20). The Fusion post uses it to call HOMAG's `ABD_ENU.MPR` dowel-insert component (lines 2183-2205).
- `<121 \Block\` groups macros, saved as `.blk`.
- `<101 \Kommentar\` takes `KM=` lines.

### 1.12 Annotated minimal example: cabinet side panel
720 mm tall (X) × 560 mm deep (Y) × 18 mm thick. Features:
- Two rows of 5 mm shelf-pin holes at System-32 pitch
- An 18 mm dado for a fixed bottom, sawn across the panel 100 mm from the bottom
- A 6 mm back-panel groove sawn along the full height
- One horizontal dowel hole into the top edge
- The productionManager feedback comment

> ⚠️ **Not machine-tested.** Before the first real cut you need Avi's tool and saw numbers, depth conventions and a woodWOP check. Comments after `\` are allowed per spec §2, but strip them if woodWOP complains.

```text
[H
VERSION="4.0"
\ MPR 4.0 data head. Keep it minimal; woodWOP fills in defaults on save
MAT="HOMAG"
\ HOMAG | WEEKE | CF-HOMAG | FK-HOMAG
INCH="0"
\ always mm in file (convert inches yourself)
OP="1"
\ let woodWOP optimise drilling order
FM="1"
\ park rear-right after program
_BSX=720.000000
_BSY=560.000000
_BSZ=18.000000

[001
L="720"
KM="Panel length X (cabinet height)"
B="560"
KM="Panel width Y (cabinet depth)"
D="18"
KM="Thickness"
SETB="37"
KM="Shelf-pin row setback from front/back edge"
BOT="100"
KM="Bottom dado position from panel end"

<100 \WerkStck\
LA="L"
BR="B"
DI="D"
FNX="0"
FNY="0"
AX="0"
AY="0"

<102 \BohrVert\
\ front shelf-pin row: 12 holes, 32 mm pitch, running in +X (WI=0)
XA="BOT+64"
YA="SETB"
TI="12"
DU="5"
BM="LS"
AN="12"
AB="32"
WI="0"
MI="0"
S_="2"
F_="STANDARD"
KO="00"

<102 \BohrVert\
\ rear shelf-pin row
XA="BOT+64"
YA="B-SETB"
TI="12"
DU="5"
BM="LS"
AN="12"
AB="32"
WI="0"
MI="0"
S_="2"
F_="STANDARD"
KO="00"

<109 \Nuten\
\ 18 mm dado for fixed bottom, full width (Y). Saw makes several passes since NB > kerf
XA="BOT"
YA="0"
XE="BOT"
YE="B"
NB="18"
RK="WRKR"
\ widen to the right of the programmed line [UNCERTAIN which side = +X; dry-run]
TI="8"
EM="MOD2"
\ start/end with safety distance -> runs out of both edges
MN="GL"
XY="80"
OP="1"
F_="STANDARD"
KO="00"

<109 \Nuten\
\ 6 mm back-panel groove along full length, 10 mm in from rear edge, 8 deep
XA="0"
YA="B-10"
XE="L"
YE="B-10"
NB="6"
RK="WRKR"
TI="8"
EM="MOD2"
MN="GL"
F_="STANDARD"
KO="00"

<103 \BohrHoriz\
\ dowel hole into top edge (X=L), drilling toward -X
XA="L"
YA="100"
ZA="D/2"
DU="8"
TI="25"
BM="XM"
AN="1"
F_="STANDARD"
KO="00"

<101 \Kommentar\
KM="HOMAG_PRODUCTIONMANAGER_FEEDBACK={Version:1.00,PARTID:JOB123-SIDE-L,MPRNUMBER:1,MPRCOUNT:1}"
KM="Side L / Job 123"
!
```

Notes:
- For a **nesting** machine, the outline cut is normally added by the nesting step: woodWOP's Nesting plugin, intelliDivide Nesting or Cut Rite Nesting. For a stand-alone router job you would add a `]1` rectangle contour and a `<105>` with `RK="WRKL"`, as in [PartA.mpr](https://github.com/HomagGroup/HOMAG-Connect/blob/main/Applications/IntelliDivide/Samples/Postman/PartA.mpr). [VERIFIED-FILE]
- A dado on a nesting router without a saw unit would instead be a `<112 \Tasche\` (centre XA/YA, LA/BR) or a contour route. MprConvert, for example, has rules for "saw grooves become pockets when no saw is available" ([camsol](https://camsol.de/pdf/MprConvert_Overview.pdf)).
- **Parametric trick:** keep one "template" MPR per part type, with variables L/B/D…. intelliDivide Nesting can now assign parts-list values to MPR(X) variables on import ([HOMAG docs, Jul 2026](https://docs.homag.cloud/docs/variablen-aus-stueckliste-einem-mpr-programm-zuweisen.md)). The project.xml spec supports `MPR:<variable>` ([ImportSpecification.md](https://github.com/HomagGroup/HOMAG-Connect/blob/main/DataExchange/ImportSpecification.md)).

---

## 2. Open-source projects that read or write MPR/MPRX

| Project | Lang | What it does | Status / licence | Notes |
|---|---|---|---|---|
| [HomagGroup/HOMAG-Connect](https://github.com/HomagGroup/HOMAG-Connect) | C# (.NET, NuGet) | **Official HOMAG** clients for intelliDivide, productionManager, materialManager, productionAssist, orderManager, MMR Mobile. Also the project.xml import spec and sample MPRs | Very active (commit 2026-10-02). **No LICENSE file found [UNCERTAIN terms]** | Doesn't parse MPR itself, but it's the sanctioned cloud API. Needs paid HOMAG Connect add-ons and tapio subscription credentials |
| [Svi-ra/CNC-fitting](https://github.com/Svi-ra/CNC-fitting) | Python (stdlib only) | DXF (ACIS solids) / Rhino Grasshopper Brep → MPR writer covering 100, 102, 131, 103, 104, contours/105 and 109. `check_mpr.py` validator | Active (v0.9.0, 2026-09-22). "**Not yet proven on a machine**". **No licence file** (all rights reserved by default). Redistributes HOMAG's spec | Best reference code. Includes a woodWOP 9.0.152 export and 82 real shop MPRs |
| [cebdan/freecad-woodwop-postprocessor](https://github.com/cebdan/freecad-woodwop-postprocessor) and [cebdan/woodwop-post-processor](https://github.com/cebdan/woodwop-post-processor) | Python | FreeCAD CAM post → MPR 4.0: contours, drilling, pockets | Last push Dec 2025 / Jan 2026. No licence file | Single developer |
| [fallguy04/cabinet-cnc-post-processors](https://github.com/fallguy04/cabinet-cnc-post-processors) | Docs | Clean-room notes for MPR, Biesse CIX, Xilog, OpenSBP and DXF, from the WoodWright app | CC BY 4.0. MPR post marked "**Awaiting a first cut**" | Useful on cabinet conventions |
| [Autodesk Fusion woodWOP post](https://cam.autodesk.com/posts/view.php?name=woodwop) | JS (.cps) | Full MPR writer: header, vars, coordinate systems, 102/103/104/105/109/124/133/139/140/193/119 | Maintained by Autodesk (rev dated 2026-05-19) | Most authoritative non-HOMAG writer. Readable source |
| [FunkJetDie/Autodesk_to_WoodWop5_PostProcessor](https://github.com/FunkJetDie/Autodesk_to_WoodWop5_PostProcessor) | JS | Inventor HSM → woodWOP 5 (BOF 211) | 2019, stale | |
| [mustafayildizmuh/prgToMPR](https://github.com/mustafayildizmuh/prgToMPR) | C# | MasterWood PRG → woodWOP 7 MPR. No arcs, no pockets | GPL-3.0, 2 commits (2023) | Toy |
| [stormychel/Xil2WOP](https://github.com/stormychel/Xil2WOP) | Python | SCM Xilog3 → woodWOP | 2021, "works, could be improved" | |
| [deneka28/WoodWopLite](https://github.com/deneka28/WoodWopLite) | C++/Qt | Tiny woodWOP-like editor with drilling icons | 2020, no README content | Abandoned |
| [CADialog/CADialog-FreeWop](https://github.com/CADialog/CADialog-FreeWop) | (FreeCAD) | README claims a parametric cupboard workbench that generates woodWOP programs | **The repo contains only a README, screenshots and a stub file. No code** [VERIFIED by clone, commit 2026-06-26]. README says Unlicense, LICENSE.md says LGPL-3 | Prior brief overstated this. The code may be distributed via [cadialog.com](https://cadialog.com/en/) |

**MPRX/MPRXE:** no open-source reader or writer was found.
- MPRX is XML built on **Open CASCADE OCAF** with HOMAG-specific attributes ([Open Cascade success story](https://www.opencascade.com/success-stories/homag-2/)).
- A HOMAG forum user edited MPRX "as XML" by finding `TDataStd_Name`/`TDataStd_RealArray` nodes ([forum](https://forum.homag.com/forum/index.php?pageNo=2&thread%2F11220-part-dimensions-from-file-name%2F=)).
- HOMAG introduced MPRXE in woodWOP 8.0 (2021), billed as "write- and readable for external CAD/CAM systems" via the **HOMAG DocumentPlugin** ([homag docs](https://docs.homag.cloud/en/news/article/new-mprxe-storage-format-since-woodwop-80)). No public schema was found.
- The same forum thread notes that "older Homag machines will read only .mpr."

**Commercial converters:** [MprConvert by camsol](https://camsol.de/pdf/MprConvert_Overview.pdf) converts MPR to other CAM formats, with a formula interpreter and component expansion.

---

## 3. Cheap or open cabinet and cut-list tools: do any output HOMAG files?

| Tool | Cost | HOMAG output? | Source |
|---|---|---|---|
| **OpenCutList** (SketchUp) | Free / OSS | **No MPR.** CSV/XLSX parts list (customizable with Ruby formulas), cutting diagrams, labels, DXF/SVG part drawings. CSV can feed Cut Rite or intelliDivide via an import template | [docs](https://docs.opencutlist.org/features/parts/export-to-csv), [llms.txt](https://docs.opencutlist.org/llms.txt) |
| **ABF** (SketchUp) | Free | DXF only (for CAM) | [3dshouse](https://3dshouse.com/abf-plugin/) |
| **One Click Cabinet** (SketchUp) | Basic free; Pro $599, Premium $799 | **Yes. Exports .MPR**, plus .CIX and .NC. A March 2026 forum user tested MPR with Homag and called it efficient | [SketchUp forum](https://forums.sketchup.com/t/export-cnc-code-nc-mpr-cix-directly-in-sketchup-no-need-for-dxf/326472), [EW listing](https://extensions.sketchup.com/extension/b16d4cc7-683e-461c-b5fa-9ee113624d58/one-click-cabinet) |
| HOMAG's official stance on SketchUp | | Its forum admin (Nov 2025) says SketchUp can't write MPR directly. Import the drawing and assign drilling in woodWOP | [HOMAG forum](https://forum.homag.com/forum/index.php?thread%2F12997-exporting-mpr-files-from-sketch-up-to-cnc-drilling%2F=) |
| **FreeCAD Woodworking** (dprojects) | Free, MIT | Cut-list to CSV/JSON/HTML/MD. magicCNC drilling attributes. **No MPR** | [GitHub](https://github.com/dprojects/Woodworking) |
| FreeCAD + cebdan post | Free | MPR via the CAM workbench (unproven) | above |
| **PolyBoard Pro-PP** | Paid (mid-range) | **Yes, native MPR.** Lists nesting (CENTATEQ N-210/510/600), pod-and-rail (P-110…510) and drilling (DRILLTEQ V-200, D-110, H-600…). Supports auto dowel insertion. Free sample MPRs to download | [Wood Designer](https://wooddesigner.org/help-centre/homag-weeke-integration-polyboard/) |
| **Mozaik CNC** | Paid subscription | MPR output, with tools mapped via "Map T#" | [Mozaik tool props](https://mozaik.support.cyncly.com/hc/en-us/articles/44026731852817-Tool-Properties-Customer-Guide), [WOODWEB](https://woodweb.com/cgi-bin/forums/cad.pl?read=791727) |
| **SmartWOP (HOMAG/Tibek)** | Reseller prices seen: ~€275/mo rental; ~€5,025 CAD/CAM, €3,100 CAD **[UNCERTAIN, search-snippet reseller figures]** | **Native.** Two-way with woodWOP; sends orders to productionManager via the SmartWOPConnect add-on | [HOMAG](https://www.homag.com/en/software-detail/software/order-creation/smartwop), [Tibek](https://tibek-cnc-technik.de/en/products/smartwop/what-can-smartwop/), [partner doc](https://github.com/HomagGroup/HOMAG-Connect/blob/main/Documentation/Partner/Authorization/Readme.md) |
| WoodWright | Free tier (Windows); AI credits paid | Claims MPR post, "awaiting a first cut" | [notes](https://github.com/fallguy04/cabinet-cnc-post-processors), [Stork review](https://www.stork.ai/en/woodwright) |
| KWAL, Millwork.App, shayanultra/woodworkingshop (MIT) | Browser / cheap | DXF / G-code / CSV only. No MPR | [kwal](https://kwal.design/), [millwork.app](https://millwork.app/), [GitHub](https://github.com/shayanultra/woodworkingshop) |
| IMOS, Cabinet Vision S2M, Microvellum | Expensive | MPR (HOMAG forum confirms IMOS; S2M has point-to-point and drill/dowel options) | [HOMAG forum](https://forum.homag.com/forum/index.php?thread%2F12997-exporting-mpr-files-from-sketch-up-to-cnc-drilling%2F=), [S2M](https://smartconnectedsolutionssea.com/cabinetvision_mach/) |

---

## 4. What file each machine type expects

| Machine type (HOMAG naming) | What it consumes | How it gets there | Sources |
|---|---|---|---|
| **Nesting CNC**, flat table (CENTATEQ N-xxx, older BOF/Venture nesting) | A **nest-level MPR(X)** per sheet: part outlines, drilling and grooves, sheet as workpiece. Single-part MPRs are nested by woodWOP's Nesting plugin (imports CSV/XLSX), intelliDivide Nesting, or Cut Rite Nesting | intelliDivide "Download (ZIP)" gives MPR(X) programs for a network share, or productionAssist Nesting, or HOMAG File Agent auto-transfer | [intelliDivide results](https://docs.homag.cloud/en/intellidivide/tutorial/using-the-results), [woodWOP versions](https://www.homag.com/en/software/woodwop-versions) |
| **Point-to-point / pod-and-rail** (CENTATEQ P-xxx, BHX/Venture) | **One MPR per part per setup** (side 1 / side 2). Parts are pre-cut on a saw, so programs use finished-part coordinates and the machine's drill bank (DU) and horizontal units | Network folder. Barcode on the part label selects the program | [PolyBoard](https://wooddesigner.org/help-centre/homag-weeke-integration-polyboard/), [CNC-fitting -F/-B naming](https://github.com/Svi-ra/CNC-fitting) |
| **Vertical / through-feed drilling** (DRILLTEQ V-200/V-310, DRILLTEQ D/H) | **MPR too.** woodWOP drives these. Vertical machines have limits on reachable faces. The HOMAG feedback doc mentions BHX 500 / DRILLTEQ H-600 "MODE 3 sandwich machining" | Same | [feedback doc](https://docs.homag.cloud/en/data-exchange/homag-file-agent/feedback-of-machines), [PolyBoard list](https://wooddesigner.org/help-centre/homag-weeke-integration-polyboard/) |
| **Panel saw** (SAWTEQ, CADmatic control) | **Cutting patterns, not parts.** Formats: `.SAW` (HOMAG CADmatic run file, one per run, e.g. `00032.SAW`, CADmatic ≥4.1), or **PTX**, the ASCII CSV "pattern exchange" with `JOBS`, `PARTS_REQ`, `MATERIALS`, `BOARDS`, `PATTERNS` records (full field list is in the non-public "Interface guide"). CADmatic can also take CSV part lists for its built-in CADplan optimizer. Patterns come from Cut Rite, intelliDivide or similar | intelliDivide sends directly over tapio (CADmatic ≥5.2), or SAW/PTX download to a share. Cut Rite imports CSV/XLS/PTX parts lists | [intelliDivide results](https://docs.homag.cloud/en/intellidivide/tutorial/using-the-results), [Magi-Cut CADmatic](https://www.magi-cut.co.uk/files/html/V12webhelp/mct1269.htm), [PTX rules](https://www.magi-cut.co.uk/files/html/V12webhelp/mct1404.htm), [Cut Rite brochure](https://www.homag.com/fileadmin/product/paneldividing/brochures/cutrite/panel-dividing-saw-cut-rite-en.pdf) |
| **Edgebander** (EDGETEQ, powerTouch / woodCommander) | No geometry file. The operator or a barcode picks a **machine-side edge program**. Barcode control usually matches the barcode to a program name. Edge data per part (EdgeFront/Right/Back/Left, EdgeDiagram `"011:011:000:000"`) lives in the parts list / productionManager / ControllerMES. Feedback comes back as `.hol` CSV | Labels printed at the saw carry the barcode | [WoodTecPedia barcode](https://wtp.hoechsmann.com/al/lexikon/25/commande_par_code-barres), [HOMAG CNC brochure via search](https://www.optimat-group.com/wp-content/uploads/2022/03/Software-CNC-en-1.pdf), [ImportSpecification](https://github.com/HomagGroup/HOMAG-Connect/blob/main/DataExchange/ImportSpecification.md), [feedback doc](https://docs.homag.cloud/en/data-exchange/homag-file-agent/feedback-of-machines). **[UNCERTAIN: no public spec of the edgebander's barcode-to-program table. Expect a dealer (Stiles) setup]** |
| **CNC with edgebanding unit** (e.g. CENTATEQ E-xxx) | MPR macro `<106 \Contourverleimen\`, plus the woodWOP 8 "wizard macro" for edge data (MPRXE can drive it) | | spec §9.3.2, [MPRXE news](https://docs.homag.cloud/en/news/article/new-mprxe-storage-format-since-woodwop-80) |

**Feedback across machines** ([doc](https://docs.homag.cloud/en/data-exchange/homag-file-agent/feedback-of-machines)):
- Supported on saws from CADmatic 3.0, CNCs from PC85, and edgebanders with reference-number or barcode operation.
- Output is a comma-separated `.hol` file: position 1 timestamp `yyyyMMddHHmmss`, position 2 `PNL`, position 6 quantity, position 31 recommended for part ID.
- It's a paid machine option.

---

## 5. New in 2025-2026

- **woodWOP 9.0** has been available since May 2025 and ships on all CNC and drilling machines from LIGNA 2025 ([HOMAG news](https://www.homag.com/en/company/news/news/article/new-in-woodwop-9-focused-on-focus), [Schuler](https://www.schuler-consulting.com/en/about-us/news/article/focused-on-the-essentials-the-woodwop-9-cnc-programming-software-is-now-even-simpler-and-clearer), [versions](https://www.homag.com/en/software/woodwop-versions)).
  - New UI with dark mode, favorites mode, drag-and-drop macros and contours, smartSnapping (32 mm grid for drilling), multi-select "mover"
  - **Travel-path optimization** that reorders programs coming from external systems and nesting
  - Nesting-plugin auto-placement; block-macro "Use" column; hide-variable column; Windows 11 office
  - **No file-format change found.** woodWOP 9.0.152 still writes `VERSION="4.0 Alpha"` MPR with new header metadata. [VERIFIED-FILE]
- **CNC control software on the PC87 base, NCCenter 1.22** (HOMAG docs, Aug 2026): woodMotion 8, woodTime 8, ClampManager and a new **CNC-TestSuite** for automated checking, simulation and runtime analysis of woodWOP programs ([docs](https://docs.homag.cloud/docs/design-news-neuerungen-in-der-homag-cnc-software-basis-nccenter-1-22.md)). Potentially useful for validating generated MPRs before they reach the machine. **[UNCERTAIN: licensing/availability]**
- **HOMAG Connect APIs** ([repo](https://github.com/HomagGroup/HOMAG-Connect), [Connect-API docs](https://docs.homag.cloud/en/data-exchange/homag-connect/connect-api)):
  - REST plus a .NET client (NuGet `HomagGroup.HomagConnect.IntelliDivide.Client`)
  - Basic auth: SubscriptionId plus a customer-generated key. HOMAG forbids using it client-side.
  - intelliDivide optimization requests can be sent as an object model, as a CSV/Excel/PNX file plus a template, or as a project ZIP.
  - Import spec v3.00 (20 Mar 2026) refactored the fields.
  - Requires the HOMAG Connect add-on, which is included in intelliDivide Advanced/Premium licences.
- **tapio developer APIs** cover machine state and events ([state API](https://developer.tapio.one/machine-data/state-api), [available APIs](https://developer.tapio.one/general/available-apis)). These are telemetry, not program upload. **[UNCERTAIN whether Avi's machines are tapio-connected]**
- **intelliDivide Nesting** can assign parts-list variables into MPR(X) templates (Jul 2026) and use woodWOP components in nesting ([docs index](https://docs.homag.cloud/llms.txt)).
- **productionManager:** auto-injects part IDs into the MPR comment macro, and **auto-transfers MPRs to the selected CNC on order release** via the File Agent ([docs](https://docs.homag.cloud/docs/productionmanager-kurz-erklaert-cnc-datenhandling.md)).
- **MPRX adoption:** woodWOP has had MPRX since 6.0 and MPRXE since 8.0 (2021). Cut Rite optimizes "machining library, MPR(X) or DXF programs." Third-party tools such as Magi-Cut convert MPRX to MPR, which requires woodWOP installed ([Magi-Cut](https://www.magi-cut.co.uk/files/html/V12webhelp/mct2443.htm)). There's no sign of a public MPRX spec. Plain MPR remains the interoperable lowest common denominator.

---

## 6. Implications for Avi's build (my read)

1. **Write MPR 4.0 text, never MPRX.** Use one parametric template per part family (variables + `<139>` components for hinge/connector patterns). Generate CRLF, cp1252/ASCII.
2. **Copy, don't guess.** Have Avi export three or four of his existing Cabinet Vision MPRs and three or four woodWOP-saved files from his own machine. Diff your output against them. These files hold his tool numbers, `WW` lists, `KO` conventions and saw units.
3. **Let HOMAG tools nest and cut wherever possible.**
   - Generate per-part MPRs plus a parts list (CSV, or `project.xml` for intelliDivide/productionManager).
   - Let woodWOP's nesting plugin, intelliDivide or Cut Rite make sheet programs and saw patterns.
   - This avoids writing a nester and a PTX/SAW generator.
4. **Use the feedback comment** and `PARTID`, `MPRNUMBER` and `MPRCOUNT` for traceability.
5. **Legal:** generating text files in a documented format doesn't modify or decompile HOMAG software. Still, Svi-ra redistributes HOMAG's spec without a licence, and HOMAG-Connect has no explicit licence. Treat both as reference only. **[UNCERTAIN: not legal advice]**

---

## 7. Open questions only Avi can answer
1. **Exact machines:** model, year and control (PC85 / PC87 / powerTouch version) for each. That means the CNC (nesting N-series vs pod-and-rail P-series vs BHX/DRILLTEQ), the saw (SAWTEQ + CADmatic version), and the edgebander (EDGETEQ model, barcode or reference-number option?).
2. **woodWOP version** on each machine and on office PCs (8.x vs 9.x). Is the office licence tied to one PC?
3. **HOMAG software already licensed:** Cut Rite? intelliDivide (which tier; does it include the HOMAG Connect add-on)? productionManager? tapio-connected machines? The machine-feedback option?
4. **Which Cabinet Vision features he actually relies on:** design/rendering, quoting, door and drawer libraries, hardware auto-boring (Blum, etc.), S2M nesting, labels, saw optimization, edgebanding data, BOM/ordering. Which posts (MPR, saw) does his S2M currently run?
5. **Workflow:** nested-based manufacturing vs saw → edgebander → P2P. Who creates labels and barcodes now?
6. **Construction standards:** System 32? Dowel vs cam-lock vs confirmat? Dado vs butt? Material thicknesses? Inches or mm in the shop?
7. **Tooling:** drill bank layout, saw-unit tool numbers, router tool numbers. A sample of real exported MPRs from his machine would cover all three.
8. **Build appetite:** is SmartWOP, PolyBoard or Mozaik with native MPR good enough? Or is custom software a must? Budget and timeline?
