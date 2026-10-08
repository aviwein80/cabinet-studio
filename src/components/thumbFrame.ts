/**
 * The SVG frame of a part drawing (part coordinates, Y up): its view box and the transform of the
 * group drawn in it. Polish-2: `upright` stands the part up, its X axis vertical: a door (built
 * lying with its height along X) is drawn as it hangs, seen from the front, hinge edge (high Y)
 * on the left. A 15" x 30" door was drawn wider than tall.
 */
export function thumbFrame(b: { minX: number; minY: number; maxX: number; maxY: number }, upright = false) {
  const w = Math.max(1, b.maxX - b.minX)
  const h = Math.max(1, b.maxY - b.minY)
  const pad = Math.max(w, h) * 0.06
  // screen point of part (x, y): flat (x, -y); upright (-y, -x)
  return upright
    ? { viewBox: `${-b.maxY - pad} ${-(b.maxX + pad)} ${h + 2 * pad} ${w + 2 * pad}`, transform: 'scale(1,-1) rotate(90)', width: h + 2 * pad, height: w + 2 * pad }
    : { viewBox: `${b.minX - pad} ${-(b.maxY + pad)} ${w + 2 * pad} ${h + 2 * pad}`, transform: 'scale(1,-1)', width: w + 2 * pad, height: h + 2 * pad }
}
