/**
 * Builds the free-form solid fixture for M3.1g (rows and columns of an imported solid's face):
 * tests/fixtures/solid/dome-panel.step, the same solid as dome-panel.brep, and dome-panel.truth.json.
 *
 * Dev tool only (nothing here ships). It uses the OpenCascade B-rep build the app loads on first
 * use (replicad-opencascadejs, LGPL-2.1, a devDependency):
 *
 *     node scripts/fixtures/make_brep_fixture.mjs
 *
 * The top face is an exact biquadratic B-spline (Bezier) patch: x = X0 + L u, y = Y0 + W v,
 * z = Z0 + 16 a u (1 - u) v (1 - v), so its rows and columns are known in closed form (lines of
 * constant x and of constant y on that dome). The solid is the face pushed down 40 mm, cut flat 25 mm
 * under the dome's edge, with a round hole through the dome (so the face is trimmed). It sits away
 * from the origin, as a CAD program would leave it.
 */
import fs from 'node:fs'
import path from 'node:path'

const OUT = path.join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'solid')
const T = { name: 'dome-panel.step', L: 120, W: 80, a: 10, X0: 500, Y0: 300, Z0: 100, bottom: 75, hole: { x: 530, y: 340, r: 8 } }

const { default: Module } = await import('replicad-opencascadejs')
const oc = await Module({ print() {}, printErr() {} })
const { L, W, a, X0, Y0, Z0 } = T
const poles = new oc.NCollection_Array2_gp_Pnt(1, 3, 1, 3)
for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) poles.SetValue(i + 1, j + 1, new oc.gp_Pnt(X0 + (L * i) / 2, Y0 + (W * j) / 2, Z0 + (i === 1 && j === 1 ? 4 * a : 0)))
const knots = new oc.NCollection_Array1_double(1, 2)
knots.SetValue(1, 0)
knots.SetValue(2, 1)
const mults = new oc.NCollection_Array1_int(1, 2)
mults.SetValue(1, 3)
mults.SetValue(2, 3)
const surf = new oc.Geom_BSplineSurface(poles, knots, knots, mults, mults, 2, 2, false, false)
const face = new oc.BRepBuilderAPI_MakeFace(surf, 1e-6).Face()
const prism = new oc.BRepPrimAPI_MakePrism(face, new oc.gp_Vec(0, 0, -40), false, true).Shape()
const pr = new oc.Message_ProgressRange()
const box = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(X0 - 10, Y0 - 10, Z0 - 60), new oc.gp_Pnt(X0 + L + 10, Y0 + W + 10, T.bottom)).Shape()
const flat = new oc.BRepAlgoAPI_Cut(prism, box, pr)
flat.Build(pr)
const cyl = new oc.BRepPrimAPI_MakeCylinder(new oc.gp_Ax2(new oc.gp_Pnt(T.hole.x, T.hole.y, Z0 - 50), new oc.gp_Dir(0, 0, 1)), T.hole.r, 120).Shape()
const holed = new oc.BRepAlgoAPI_Cut(flat.Shape(), cyl, pr)
holed.Build(pr)
const w = new oc.STEPControl_Writer()
w.Transfer(holed.Shape(), oc.STEPControl_StepModelType.STEPControl_AsIs, true, pr)
w.Write('/out.step')
// (the writer stamps the date: keep the file the same from run to run)
const text = new TextDecoder().decode(oc.FS.readFile('/out.step')).replace(/FILE_NAME\('[^']*','[^']*'/, "FILE_NAME('dome-panel','2026-10-06T00:00:00'")
fs.writeFileSync(path.join(OUT, T.name), text)
// the same solid as a BREP file (OpenCascade's own text format)
fs.writeFileSync(path.join(OUT, 'dome-panel.brep'), oc.BRepToolsWrapper.Write(holed.Shape()))
fs.writeFileSync(path.join(OUT, 'dome-panel.truth.json'), JSON.stringify(T, null, 1) + '\n')
console.log(`wrote ${T.name} (${text.length} bytes)`)
