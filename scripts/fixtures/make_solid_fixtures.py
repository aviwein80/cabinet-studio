"""
Builds the solid-model test fixtures in tests/fixtures/solid/ (M2.5).

Dev tool only: it is not part of the app and nothing here ships. It needs the OpenCascade Python
bindings (LGPL-2.1), installed outside the repo:

    python3 -m venv .ocp && .ocp/bin/pip install cadquery-ocp==8.0.1.0.0
    .ocp/bin/python scripts/fixtures/make_solid_fixtures.py

Every fixture is built from exact numbers in the part's own frame (face 1 at z = 0, the underside
at z = -T, x along the length, y along the width, origin at the outline's lower-left corner) and
then moved to where a CAD program would have it (standing up, turned, offset). Next to each file
a `.truth.json` lists what was built, from these numbers only (never from the app's recognition),
so the tests compare recognition against the design.
"""
import json, math, os, sys
from OCP.gp import gp_Pnt, gp_Vec, gp_Dir, gp_Ax1, gp_Ax2, gp_Trsf
from OCP.GC import GC_MakeArcOfCircle, GC_MakeSegment
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakeFace, BRepBuilderAPI_Transform
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeCone
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE
from OCP.TopoDS import TopoDS
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Plane
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString, TCollection_AsciiString
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorType
from OCP.TDataStd import TDataStd_Name
from OCP.Quantity import Quantity_Color, Quantity_TOC_RGB
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_AsIs
from OCP.Interface import Interface_Static
from OCP.IGESCAFControl import IGESCAFControl_Writer
from OCP.BRepTools import BRepTools
from OCP.TopLoc import TopLoc_Location

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'tests', 'fixtures', 'solid')
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------------------------------------
# 2D profiles (lists of lines and arcs) -> faces -> prisms
# ---------------------------------------------------------------------------------------------

def P(x, y, z=0.0):
    return gp_Pnt(float(x), float(y), float(z))

def wire(segs, z=0.0):
    """segs: ('L', a, b) or ('A', a, mid, b) with 2D points."""
    w = BRepBuilderAPI_MakeWire()
    for s in segs:
        if s[0] == 'L':
            e = BRepBuilderAPI_MakeEdge(GC_MakeSegment(P(*s[1], z), P(*s[2], z)).Value()).Edge()
        else:
            e = BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(P(*s[1], z), P(*s[2], z), P(*s[3], z)).Value()).Edge()
        w.Add(e)
    return w.Wire()

def polygon(pts):
    return [('L', pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]

def rounded_rect(x0, y0, x1, y1, r):
    """Counter-clockwise rounded rectangle; r = 0 gives sharp corners."""
    if r <= 0:
        return polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
    c = math.cos(math.pi / 4) * r
    return [
        ('L', (x0 + r, y0), (x1 - r, y0)),
        ('A', (x1 - r, y0), (x1 - r + c, y0 + r - c), (x1, y0 + r)),
        ('L', (x1, y0 + r), (x1, y1 - r)),
        ('A', (x1, y1 - r), (x1 - r + c, y1 - r + c), (x1 - r, y1)),
        ('L', (x1 - r, y1), (x0 + r, y1)),
        ('A', (x0 + r, y1), (x0 + r - c, y1 - r + c), (x0, y1 - r)),
        ('L', (x0, y1 - r), (x0, y0 + r)),
        ('A', (x0, y0 + r), (x0 + r - c, y0 + r - c), (x0 + r, y0)),
    ]

def slot(x0, x1, y, w):
    """Slot along x with full round ends (width w)."""
    r = w / 2
    return [
        ('L', (x0, y - r), (x1, y - r)),
        ('A', (x1, y - r), (x1 + r, y), (x1, y + r)),
        ('L', (x1, y + r), (x0, y + r)),
        ('A', (x0, y + r), (x0 - r, y), (x0, y - r)),
    ]

def prism(segs, ztop, zbot):
    f = BRepBuilderAPI_MakeFace(wire(segs, ztop)).Face()
    return BRepPrimAPI_MakePrism(f, gp_Vec(0, 0, zbot - ztop)).Shape()

def cut(a, b):
    c = BRepAlgoAPI_Cut(a, b)
    c.Build()
    assert c.IsDone()
    return c.Shape()

def fuse(a, b):
    f = BRepAlgoAPI_Fuse(a, b)
    f.Build()
    return f.Shape()

def hole(x, y, d, depth, T, from_top=True, tip_angle=None):
    """Drill body: cylinder from beyond the surface to `depth`, optional cone tip (included angle)."""
    r = d / 2
    if from_top:
        z_shoulder = -depth
        cyl = BRepPrimAPI_MakeCylinder(gp_Ax2(P(x, y, z_shoulder), gp_Dir(0, 0, 1)), r, depth + 2).Shape()
        if tip_angle:
            h = r / math.tan(math.radians(tip_angle / 2))
            cone = BRepPrimAPI_MakeCone(gp_Ax2(P(x, y, z_shoulder), gp_Dir(0, 0, -1)), r, 0.0, h).Shape()
            cyl = fuse(cyl, cone)
        return cyl
    z_shoulder = -T + depth
    cyl = BRepPrimAPI_MakeCylinder(gp_Ax2(P(x, y, z_shoulder), gp_Dir(0, 0, -1)), r, depth + 2).Shape()
    return cyl

def faces(shape):
    out = []
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        out.append(TopoDS.Face(ex.Current()))
        ex.Next()
    return out

def plane_at(face, z, nz):
    s = BRepAdaptor_Surface(face)
    if s.GetType() != GeomAbs_Plane:
        return False
    pl = s.Plane()
    n = pl.Axis().Direction()
    if face.Orientation() == 1:  # reversed
        n = n.Reversed()
    return abs(n.Z() - nz) < 1e-9 and abs(pl.Location().Z() - z) < 1e-9

def area(face):
    g = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, g)
    return g.Mass()

def moved(shape, trsf):
    return BRepBuilderAPI_Transform(shape, trsf, True).Shape()

def trsf(rot_axis=None, angle=0.0, move=(0, 0, 0), then=None):
    t = gp_Trsf()
    if rot_axis:
        t.SetRotation(gp_Ax1(P(0, 0, 0), gp_Dir(*rot_axis)), math.radians(angle))
    m = gp_Trsf()
    m.SetTranslation(gp_Vec(*move))
    r = m.Multiplied(t)
    if then is not None:
        r = then.Multiplied(r)
    return r

# ---------------------------------------------------------------------------------------------
# Writers (XDE document: names, colours, per-face colours, properties, assembly instances)
# ---------------------------------------------------------------------------------------------

def rgb(h):
    h = h.lstrip('#')
    return Quantity_Color(int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255, Quantity_TOC_RGB)

def new_doc():
    doc = TDocStd_Document(TCollection_ExtendedString('XmlOcaf'))
    main = doc.Main()
    return doc, XCAFDoc_DocumentTool.ShapeTool_s(main), XCAFDoc_DocumentTool.ColorTool_s(main)

def add_part(st, ct, shape, name, color=None, face_colors=(), props=None):
    """face_colors: list of (predicate(face) -> bool, hex)."""
    lab = st.AddShape(shape, False)
    TDataStd_Name.Set_s(lab, TCollection_ExtendedString(name))
    if color:
        ct.SetColor(lab, rgb(color), XCAFDoc_ColorType.XCAFDoc_ColorSurf)
    for pred, hexc in face_colors:
        for f in faces(shape):
            if pred(f):
                sub = st.AddSubShape(lab, f)
                ct.SetColor(sub, rgb(hexc), XCAFDoc_ColorType.XCAFDoc_ColorSurf)
    if props:
        nd = st.GetNamedProperties(lab, True)
        for k, v in props.items():
            if isinstance(v, (int, float)):
                nd.SetReal(TCollection_ExtendedString(k), float(v))
            else:
                nd.SetString(TCollection_ExtendedString(k), TCollection_ExtendedString(str(v)))
    return lab

def write_step(doc, path, schema):
    # schema: 3 = AP203, 4 = AP214 IS, 5 = AP242 DIS
    Interface_Static.SetIVal_s('write.step.schema', schema)
    Interface_Static.SetCVal_s('write.step.unit', 'MM')
    Interface_Static.SetIVal_s('write.surfacecurve.mode', 1)
    w = STEPCAFControl_Writer()
    w.SetColorMode(True)
    w.SetNameMode(True)
    w.SetLayerMode(True)
    w.SetPropsMode(True)
    try:
        w.SetMetadataMode(True)
    except Exception:
        pass
    assert w.Transfer(doc, STEPControl_AsIs)
    assert int(w.Write(path)) == 1
    # stable files: drop the time stamp OpenCascade writes into the header
    txt = open(path, encoding='latin-1').read()
    import re
    txt = re.sub(r"FILE_NAME\('([^']*)','[^']*'", r"FILE_NAME('\1','2026-10-01T00:00:00'", txt, count=1)
    open(path, 'w', encoding='latin-1', newline='\n').write(txt)

def write_iges(doc, path, unit='MM'):
    from OCP.IGESControl import IGESControl_Controller
    IGESControl_Controller.Init_s()  # the IGES settings exist only once the controller is loaded
    assert Interface_Static.SetCVal_s('write.iges.unit', unit)
    Interface_Static.SetIVal_s('write.iges.brep.mode', 1)
    w = IGESCAFControl_Writer()
    w.SetColorMode(True)
    w.SetNameMode(True)
    assert w.Transfer(doc)
    assert w.Write(path)
    txt = open(path, encoding='latin-1').read()
    import re
    txt = re.sub(r'15H\d{8}\.\d{6}', '15H20261001.000000', txt)
    open(path, 'w', encoding='latin-1', newline='\n').write(txt)

def truth(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=1, sort_keys=True)
        f.write('\n')

# ---------------------------------------------------------------------------------------------
# 1. Cabinet side with holes (AP214): standing up as in a cabinet, thickness along X
# ---------------------------------------------------------------------------------------------

def cabinet_side():
    L, W, T = 720.0, 560.0, 19.0
    notch = (100.0, 75.0)  # toe kick: along the length from x = 0, along the width from y = 0
    outline = [(notch[0], 0), (L, 0), (L, W), (0, W), (0, notch[1]), (notch[0], notch[1])]
    body = prism(polygon(outline), 0.0, -T)
    holes = []
    # system holes: 5 mm, 13 deep, flat floor, two rows
    for row_y in (37.0, W - 37.0):
        for k in range(13):
            x = 200.0 + 32.0 * k
            holes.append({'x': x, 'y': row_y, 'd': 5.0, 'depth': 13.0, 'face': 1, 'through': False, 'floor': 'flat'})
    # connector holes: 8 mm, 13 deep to the shoulder, 118 degree drill point
    for x in (150.0, 650.0):
        holes.append({'x': x, 'y': 300.0, 'd': 8.0, 'depth': 13.0, 'face': 1, 'through': False, 'floor': 'cone', 'tipAngle': 118.0, 'tipDepth': 13.0 + 4.0 / math.tan(math.radians(59))})
    # through holes: 8 mm
    for y in (180.0, 420.0):
        holes.append({'x': 40.0, 'y': y, 'd': 8.0, 'depth': T, 'face': 1, 'through': True, 'floor': 'none'})
    for h in holes:
        body = cut(body, hole(h['x'], h['y'], h['d'], h['depth'] if not h['through'] else T + 1, T, True, h.get('tipAngle')))
    pockets = []
    # stopped groove for the back panel: 6.5 wide, 9.5 deep, round ends
    g = slot(30.0, 690.0, W - 22.0, 6.5)
    body = cut(body, prism(g, 1.0, -9.5))
    pockets.append({'depth': 9.5, 'area': 660.0 * 6.5 + math.pi * 3.25 ** 2, 'box': [30.0 - 3.25, W - 22.0 - 3.25, 690.0 + 3.25, W - 22.0 + 3.25]})
    # hinge-plate recess: 40 x 20 R3, 3 deep
    body = cut(body, prism(rounded_rect(300.0, 100.0, 340.0, 120.0, 3.0), 1.0, -3.0))
    pockets.append({'depth': 3.0, 'area': 40.0 * 20.0 - (4 - math.pi) * 9.0, 'box': [300.0, 100.0, 340.0, 120.0]})
    # stepped pocket: 80 x 50 R6 at 4 deep with a 30 x 20 R4 at 10 deep inside it
    body = cut(body, prism(rounded_rect(480.0, 150.0, 560.0, 200.0, 6.0), 1.0, -4.0))
    body = cut(body, prism(rounded_rect(505.0, 165.0, 535.0, 185.0, 4.0), 1.0, -10.0))
    pockets.append({'depth': 4.0, 'area': 80.0 * 50.0 - (4 - math.pi) * 36.0, 'box': [480.0, 150.0, 560.0, 200.0]})
    pockets.append({'depth': 10.0, 'area': 30.0 * 20.0 - (4 - math.pi) * 16.0, 'box': [505.0, 165.0, 535.0, 185.0]})
    # inner cut-out (cable opening): 120 x 40 R10, through
    body = cut(body, prism(rounded_rect(300.0, 250.0, 420.0, 290.0, 10.0), 1.0, -T - 1.0))
    cutouts = [{'area': 120.0 * 40.0 - (4 - math.pi) * 100.0, 'box': [300.0, 250.0, 420.0, 290.0]}]
    outline_area = L * W - notch[0] * notch[1]
    # standing up: part z (thickness) -> file -X, part x (length) -> file +Z, part y -> file +Y;
    # then moved into the cabinet
    t = gp_Trsf()
    t.SetValues(0, 0, -1, 0,
                0, 1, 0, 0,
                1, 0, 0, 0)
    m = gp_Trsf()
    m.SetTranslation(gp_Vec(18.0, 25.0, 100.0))
    placed = moved(body, m.Multiplied(t))
    doc, st, ct = new_doc()
    # inside face (face 1) coloured: the show face, used to set the grain
    is_top = lambda f: plane_at_world(f, placed_top_normal=(-1, 0, 0), level=-18.0)
    add_part(st, ct, placed, 'Cabinet side', color='#d8c39a', face_colors=[(is_top, '#cc3333')], props={'Material': 'Maple ply 19', 'Grain': 'Length'})
    write_step(doc, os.path.join(OUT, 'cabinet-side.step'), 4)
    truth(os.path.join(OUT, 'cabinet-side.truth.json'), {
        'name': 'Cabinet side', 'schema': 'AP214', 'length': L, 'width': W, 'thickness': T,
        'outline': {'area': outline_area, 'vertices': outline},
        'holes': holes, 'pockets': pockets, 'cutouts': cutouts,
        'faceColors': {'#cc3333': 'face 1 (the inside face)'},
        'properties': {'Material': 'Maple ply 19', 'Grain': 'Length'},
    })
    return body

def plane_at_world(face, placed_top_normal, level):
    s = BRepAdaptor_Surface(face)
    if s.GetType() != GeomAbs_Plane:
        return False
    pl = s.Plane()
    n = pl.Axis().Direction()
    if face.Orientation() == 1:
        n = n.Reversed()
    nx, ny, nz = placed_top_normal
    if abs(n.X() - nx) > 1e-9 or abs(n.Y() - ny) > 1e-9 or abs(n.Z() - nz) > 1e-9:
        return False
    loc = pl.Location()
    return abs(loc.X() * nx + loc.Y() * ny + loc.Z() * nz - level) < 1e-6

# ---------------------------------------------------------------------------------------------
# 2. Shaped door (AP203): arched top, recessed field on the front, hinge cups in the back
# ---------------------------------------------------------------------------------------------

def shaped_door():
    Wd, H, T = 400.0, 700.0, 19.0
    rise = 100.0
    R = (200.0 ** 2 + rise ** 2) / (2 * rise)  # 250
    cy = H - R  # arc centre y = 450
    outline = [('L', (0, 0), (Wd, 0)), ('L', (Wd, 0), (Wd, H - rise)), ('A', (Wd, H - rise), (Wd / 2, H), (0, H - rise)), ('L', (0, H - rise), (0, 0))]
    body = prism(outline, 0.0, -T)
    # recessed field 6 deep, 70 in from every edge, the arch concentric (R 180)
    inset = 70.0
    r2 = R - inset
    # where the inner arch meets x = inset
    dx = Wd / 2 - inset
    yi = cy + math.sqrt(r2 ** 2 - dx ** 2)
    field = [('L', (inset, inset), (Wd - inset, inset)), ('L', (Wd - inset, inset), (Wd - inset, yi)), ('A', (Wd - inset, yi), (Wd / 2, cy + r2), (inset, yi)), ('L', (inset, yi), (inset, inset))]
    body = cut(body, prism(field, 1.0, -6.0))
    # field area: rectangle up to yi plus the circular segment above it
    half = math.asin(dx / r2)
    seg = r2 ** 2 * (2 * half - math.sin(2 * half)) / 2
    field_area = (Wd - 2 * inset) * (yi - inset) + seg
    # arch area of the outline
    half_o = math.asin(200.0 / R)
    seg_o = R ** 2 * (2 * half_o - math.sin(2 * half_o)) / 2
    outline_area = Wd * (H - rise) + seg_o
    holes = []
    # hinge cups from the back (face 6): 35 mm, 13 deep, flat floor (Forstner)
    for y in (100.0, 600.0 - 0.0):
        holes.append({'x': 22.5, 'y': y, 'd': 35.0, 'depth': 13.0, 'face': 6, 'through': False, 'floor': 'flat'})
    for h in holes:
        body = cut(body, hole(h['x'], h['y'], h['d'], h['depth'], T, from_top=False))
    # knob hole: 5 mm through
    holes.append({'x': 360.0, 'y': 350.0, 'd': 5.0, 'depth': T, 'face': 1, 'through': True, 'floor': 'none'})
    body = cut(body, hole(360.0, 350.0, 5.0, T + 1, T, True))
    # file position: lying on its back, turned 30 degrees, offset
    placed = moved(body, trsf((0, 0, 1), 30.0, (500.0, -120.0, 40.0)))
    doc, st, ct = new_doc()
    add_part(st, ct, placed, 'Arched door', color='#b8875a')
    write_step(doc, os.path.join(OUT, 'shaped-door.step'), 3)
    truth(os.path.join(OUT, 'shaped-door.truth.json'), {
        'name': 'Arched door', 'schema': 'AP203', 'length': H, 'width': Wd, 'thickness': T,
        'note': 'built with x across the door (400) and y up the door (700); the part frame puts the longer side along X',
        'outline': {'area': outline_area, 'archRadius': R},
        'holes': holes,
        'pockets': [{'depth': 6.0, 'area': field_area, 'archRadius': r2}],
        'cutouts': [],
    })
    # same door as BREP (no names or colours in that format)
    BRepTools.Write_s(placed, os.path.join(OUT, 'shaped-door.brep'))
    return body

# ---------------------------------------------------------------------------------------------
# 3. Five-part assembly (AP242): two identical sides (one product, two instances), top, bottom, back
# ---------------------------------------------------------------------------------------------

def assembly():
    T = 19.0
    H, D, Wc = 720.0, 560.0, 600.0
    def panel(L, W, holes=(), name=''):
        b = prism(polygon([(0, 0), (L, 0), (L, W), (0, W)]), 0.0, -T)
        for (x, y, d, dep) in holes:
            b = cut(b, hole(x, y, d, dep, T, True))
        return b
    side_holes = [(200.0 + 32 * k, 37.0, 5.0, 13.0) for k in range(5)] + [(200.0 + 32 * k, D - 37.0, 5.0, 13.0) for k in range(5)]
    side = panel(H, D, side_holes)
    bottom = panel(Wc - 2 * T, D, [(9.5 + 0.0, 100.0, 8.0, 12.0)])
    top = panel(Wc - 2 * T, 100.0)
    back = prism(polygon([(0, 0), (H - T, 0), (H - T, Wc - 2 * T), (0, Wc - 2 * T)]), 0.0, -6.0)
    doc, st, ct = new_doc()
    asm = st.NewShape()
    TDataStd_Name.Set_s(asm, TCollection_ExtendedString('Base cabinet 600'))
    def product(shape, name, color, props):
        return add_part(st, ct, shape, name, color=color, props=props)
    p_side = product(side, 'Side', '#d8c39a', {'Material': 'Maple ply 19', 'Edge': 'Front'})
    p_bottom = product(bottom, 'Bottom', '#d8c39a', {'Material': 'Maple ply 19'})
    p_top = product(top, 'Top rail', '#d8c39a', {'Material': 'Maple ply 19'})
    p_back = product(back, 'Back', '#8a7350', {'Material': 'MDF 6'})
    # instances (part frame -> cabinet): sides stand with thickness along X
    stand = gp_Trsf()
    stand.SetValues(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0)
    def at(t, x, y, z):
        m = gp_Trsf()
        m.SetTranslation(gp_Vec(x, y, z))
        return m.Multiplied(t) if t is not None else m
    st.AddComponent(asm, p_side, TopLoc_Location(at(stand, 0.0, 0.0, 0.0)))
    st.AddComponent(asm, p_side, TopLoc_Location(at(stand, Wc - T, 0.0, 0.0)))
    st.AddComponent(asm, p_bottom, TopLoc_Location(at(None, T, 0.0, T)))
    st.AddComponent(asm, p_top, TopLoc_Location(at(None, T, 0.0, H)))
    back_t = gp_Trsf()
    back_t.SetValues(0, 1, 0, 0, 0, 0, -1, 0, -1, 0, 0, 0)
    st.AddComponent(asm, p_back, TopLoc_Location(at(back_t, T, D + 6.0, H)))
    st.UpdateAssemblies()
    write_step(doc, os.path.join(OUT, 'assembly-5.step'), 5)
    truth(os.path.join(OUT, 'assembly-5.truth.json'), {
        'name': 'Base cabinet 600', 'schema': 'AP242',
        'parts': [
            {'name': 'Side', 'qty': 2, 'length': H, 'width': D, 'thickness': T, 'holes': 10, 'properties': {'Material': 'Maple ply 19', 'Edge': 'Front'}},
            {'name': 'Bottom', 'qty': 1, 'length': D, 'width': Wc - 2 * T, 'thickness': T, 'holes': 1, 'properties': {'Material': 'Maple ply 19'}},
            {'name': 'Top rail', 'qty': 1, 'length': Wc - 2 * T, 'width': 100.0, 'thickness': T, 'holes': 0, 'properties': {'Material': 'Maple ply 19'}},
            {'name': 'Back', 'qty': 1, 'length': H - T, 'width': Wc - 2 * T, 'thickness': 6.0, 'holes': 0, 'properties': {'Material': 'MDF 6'}},
        ],
    })

# ---------------------------------------------------------------------------------------------
# 4. IGES in inches: a small shelf with two holes (units and the IGES reader)
# ---------------------------------------------------------------------------------------------

def iges_shelf():
    L, W, T = 304.8, 254.0, 19.05  # 12 x 10 x 3/4 in
    b = prism(polygon([(0, 0), (L, 0), (L, W), (0, W)]), 0.0, -T)
    holes = [{'x': 50.8, 'y': 50.8, 'd': 6.35, 'depth': 12.7, 'face': 1, 'through': False, 'floor': 'flat'}, {'x': 254.0, 'y': 203.2, 'd': 6.35, 'depth': T, 'face': 1, 'through': True, 'floor': 'none'}]
    for h in holes:
        b = cut(b, hole(h['x'], h['y'], h['d'], h['depth'] if not h['through'] else T + 1, T, True))
    doc, st, ct = new_doc()
    add_part(st, ct, b, 'Shelf', color='#a0b0c0')
    write_iges(doc, os.path.join(OUT, 'shelf-inch.igs'), 'INCH')
    truth(os.path.join(OUT, 'shelf-inch.truth.json'), {'name': 'Shelf', 'length': L, 'width': W, 'thickness': T, 'holes': holes, 'pockets': [], 'cutouts': [], 'outline': {'area': L * W}})

if __name__ == '__main__':
    cabinet_side()
    shaped_door()
    assembly()
    iges_shelf()
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)))
