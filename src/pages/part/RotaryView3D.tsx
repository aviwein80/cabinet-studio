/**
 * The simulator's 3D view of a rotary stock (M3.3): the blank turns under the tool as it does on a
 * rotary machine. The tool stays upright over the axis; the stock is turned so the angle the tool
 * is cutting is on top. The stock's outer surface is rebuilt when the material changes (at most
 * four times a second while playing).
 */
import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { RotaryStock } from '@/cam/rotary/stock'
import type { StockSimulation } from '@/cam/stock/simulation'
import type { CutterOutline } from '@/core/machineModel'

export function RotaryView3D({ sim, t, base, pos, rapid, outline, r, blade, opacity, sectionAt, onCarved }: {
  sim: StockSimulation
  t: number
  base: [number, number, number]
  /** Tool tip in the stock frame (x along the axis from the blank's start, y = Rs·θ, z = ρ - Rs). */
  pos: { x: number; y: number; z: number }
  rapid: boolean
  outline: CutterOutline | null
  r: number
  blade: { R: number; plane: 'axial' | 'ring'; kerf: number } | null
  opacity: number
  /** Show only the stock before this share of its length (a section across the axis), or null. */
  sectionAt: number | null
  onCarved: () => void
}) {
  const stock = sim.stock as RotaryStock
  const L = stock.length
  const Rs = stock.Rs
  const theta = pos.y / Rs
  const rho = pos.z + Rs
  const max = Math.max(L, 4 * Rs)
  return (
    <div className="h-[56vh] min-h-72 overflow-hidden rounded-md border border-white/10 bg-[#0e1013]" data-testid="rotary-view">
      <Canvas camera={{ position: [0, max * 0.65, max * 1.0], fov: 40, near: 1, far: max * 20 }}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[-max, max * 1.5, max]} intensity={1.6} />
        {/* local frame: X along the axis, Z up (θ = 0), centred on the blank */}
        <group rotation={[-Math.PI / 2, 0, 0]} position={[-L / 2, 0, 0]}>
          <group rotation={[-theta, 0, 0]}>
            <RotaryStockMesh sim={sim} t={t} base={base} opacity={opacity} sectionAt={sectionAt} onCarved={onCarved} />
          </group>
          {/* the axis and the centres holding the blank */}
          <mesh position={[L / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.6, 0.6, L + 60, 8]} />
            <meshStandardMaterial color="#64748b" />
          </mesh>
          {[-18, L + 18].map((x) => (
            <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[Rs * 0.35, Rs * 0.35, 30, 24]} />
              <meshStandardMaterial color="#475569" transparent opacity={0.7} />
            </mesh>
          ))}
          {blade ? <BladeModel at={[pos.x, 0, rho]} blade={blade} rapid={rapid} /> : <ToolModel at={[pos.x, 0, rho]} outline={outline} r={r} rapid={rapid} />}
        </group>
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  )
}

function RotaryStockMesh({ sim, t, base, opacity, sectionAt, onCarved }: { sim: StockSimulation; t: number; base: [number, number, number]; opacity: number; sectionAt: number | null; onCarved: () => void }) {
  const stock = sim.stock as RotaryStock
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null)
  const [tick, setTick] = useState(0)
  const last = useRef(0)
  const pending = useRef(false)
  const built = useRef<string | null>(null)
  const key = `${sectionAt}`
  useLayoutEffect(() => {
    sim.syncTo(t)
    const changed = !!stock.takeDirty() || pending.current
    if (!changed && built.current === key) return
    const now = performance.now()
    if (built.current === key && now - last.current < 250) {
      pending.current = true
      const id = setTimeout(() => setTick((k) => k + 1), 260 - (now - last.current))
      return () => clearTimeout(id)
    }
    pending.current = false
    last.current = now
    built.current = key
    const m = stock.outerMesh(sectionAt !== null ? Math.max(1, Math.round(sectionAt * stock.nu)) : undefined)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
    g.setIndex(new THREE.BufferAttribute(m.indices, 1))
    g.computeVertexNormals()
    setGeo(g)
    onCarved()
  }, [sim, stock, t, key, sectionAt, tick, onCarved])
  useEffect(() => () => geo?.dispose(), [geo])
  const color = useMemo(() => new THREE.Color(base[0] / 255, base[1] / 255, base[2] / 255), [base])
  if (!geo) return null
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={color} roughness={0.85} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} side={opacity < 1 ? THREE.FrontSide : THREE.DoubleSide} />
    </mesh>
  )
}

/** Tool, shank and holder as revolved shapes, tip at `at`, pointing down at the axis. */
function ToolModel({ at, outline, r, rapid }: { at: [number, number, number]; outline: CutterOutline | null; r: number; rapid: boolean }) {
  const parts = useMemo(() => {
    const o = outline ?? { r, flute: 30, shankR: r, gauge: Infinity, holder: [] }
    const top = Number.isFinite(o.gauge) ? o.gauge : o.flute + 30
    const lathe = (pts: [number, number][]) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 32)
    const out = [
      { geo: lathe([[0, 0], [o.r, 0], [o.r, o.flute], [0, o.flute]]), color: rapid ? '#f87171' : '#e7e5e4' },
      { geo: lathe([[0, o.flute], [o.shankR, o.flute], [o.shankR, top], [0, top]]), color: '#a8a29e' },
    ]
    if (o.holder.length) out.push({ geo: lathe([[0, o.holder[0].z], ...o.holder.map((p) => [p.r, p.z] as [number, number]), [0, o.holder[o.holder.length - 1].z]]), color: '#64748b' })
    return out
  }, [outline, r, rapid])
  useEffect(() => () => parts.forEach((p) => p.geo.dispose()), [parts])
  return (
    <group position={at} rotation={[Math.PI / 2, 0, 0]}>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.geo}>
          <meshStandardMaterial color={p.color} transparent opacity={0.7} metalness={0.4} roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

/** A saw blade with its lowest point at `at`: in the plane through the axis, or square to it. */
function BladeModel({ at, blade, rapid }: { at: [number, number, number]; blade: { R: number; plane: 'axial' | 'ring'; kerf: number }; rapid: boolean }) {
  // a cylinder's own axis is Y: lay it along Y (square to the axis plane) or along X (ring)
  return (
    <mesh position={[at[0], at[1], at[2] + blade.R]} rotation={blade.plane === 'axial' ? [0, 0, 0] : [0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[blade.R, blade.R, blade.kerf, 64]} />
      <meshStandardMaterial color={rapid ? '#f87171' : '#e7e5e4'} transparent opacity={0.55} metalness={0.5} roughness={0.3} side={THREE.DoubleSide} />
    </mesh>
  )
}
