import { Edges, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { DoubleSide, ExtrudeGeometry, Matrix4, Shape, Vector2 } from 'three'
import { toWorld } from '@/core/geometry'
import type { Library, Part, Vec3 } from '@/core/types'
import { refitCamera } from './viewerFit'

const S = 0.001

/** Polish-1: re-centre the camera when the framed size changes (the Canvas only reads `camera` once). */
function Refit({ target, size }: { target: [number, number, number]; size: number }) {
  const camera = useThree((st) => st.camera)
  const controls = useThree((st) => st.controls) as unknown as { target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null
  const last = useRef<{ target: [number, number, number]; size: number } | null>(null)
  const [tx, ty, tz] = target
  useEffect(() => {
    const prev = last.current
    const next = { target: [tx, ty, tz] as [number, number, number], size }
    last.current = next
    if (!prev || (prev.size === size && prev.target.every((v, i) => v === next.target[i]))) return
    const p = refitCamera([camera.position.x, camera.position.y, camera.position.z], prev, next)
    camera.position.set(p[0], p[1], p[2])
    controls?.target.set(tx, ty, tz)
    controls?.update()
  }, [camera, controls, tx, ty, tz, size])
  return null
}

/** Cabinet coordinates (Z up, Y = depth) -> three.js (Y up, -Z = away from viewer). */
const T = (p: Vec3): [number, number, number] => [p[0] * S, p[2] * S, -p[1] * S]

function partBox(p: Part) {
  const corners: Vec3[] = []
  for (const a of [0, p.length]) for (const b of [0, p.width]) for (const c of [0, p.thickness]) corners.push(toWorld(p.frame, a, b, c))
  const min: Vec3 = [Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1])), Math.min(...corners.map((c) => c[2]))]
  const max: Vec3 = [Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[2]))]
  return { min, max }
}

function explodeOffset(p: Part, amount: number): Vec3 {
  const d = amount
  // sides, backs and doors move away from the cabinet, against their machined face (Kitchen-3: so a
  // pie-cut's turned end side, side-wall back and side-wall door move the right way)
  const out = (k: number): Vec3 => [-p.frame.n[0] * d * k + 0, -p.frame.n[1] * d * k + 0, -p.frame.n[2] * d * k + 0]
  switch (p.role) {
    case 'side':
      return out(1)
    case 'bottom':
    case 'toekick':
      return [0, 0, -d * 0.6]
    case 'top':
    case 'rail':
      return [0, 0, d * 0.6]
    case 'back':
      return out(1)
    case 'door':
    case 'blind-panel':
      return out(1.4)
    case 'drawer':
      return [0, -d * 1.4, 0]
    case 'shelf':
      return [0, -d * 0.5, 0]
    default:
      return [0, 0, 0]
  }
}

/** Door, or a drawer front sitting in front of the cabinet face. Box parts stay solid. */
function isFront(p: Part) {
  return p.role === 'door' || p.role === 'blind-panel' || (p.role === 'drawer' && /front/i.test(p.name))
}

/**
 * Kitchen-3: a part with an outline (an L-shaped bottom, top or shelf; a side notched for the toe
 * kick) drawn as its outline extruded through its thickness, in three.js coordinates.
 */
function outlineGeometry(part: Part, offset: Vec3) {
  const g = new ExtrudeGeometry(new Shape(part.outline!.map((p) => new Vector2(p.x, p.y))), { depth: part.thickness, bevelEnabled: false })
  const f = part.frame
  // part (x, y, depth below the face) -> cabinet -> three.js
  const a = T(f.u)
  const b = T(f.v)
  const c = T([-f.n[0], -f.n[1], -f.n[2]])
  const t = T([f.origin[0] + offset[0], f.origin[1] + offset[1], f.origin[2] + offset[2]])
  g.applyMatrix4(new Matrix4().set(a[0], b[0], c[0], t[0], a[1], b[1], c[1], t[1], a[2], b[2], c[2], t[2], 0, 0, 0, 1))
  return g
}

function holeRotation(n: Vec3): [number, number, number] {
  if (Math.abs(n[0]) > 0.5) return [0, 0, Math.PI / 2]
  if (Math.abs(n[1]) > 0.5) return [Math.PI / 2, 0, 0]
  return [0, 0, 0]
}

function PartMesh({
  part,
  color,
  selected,
  offset,
  showOps,
  ghost,
  onSelect,
}: {
  part: Part
  color: string
  selected: boolean
  offset: Vec3
  showOps: boolean
  ghost: boolean
  onSelect?: (key: string) => void
}) {
  const { min, max } = useMemo(() => partBox(part), [part])
  const a = T([min[0] + offset[0], min[1] + offset[1], min[2] + offset[2]])
  const b = T([max[0] + offset[0], max[1] + offset[1], max[2] + offset[2]])
  const size: [number, number, number] = [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])]
  const center: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  const ops = showOps ? part.ops : []
  const [ox, oy, oz] = offset
  const shaped = useMemo(() => (part.outline && part.outline.length >= 3 ? outlineGeometry(part, [ox, oy, oz]) : null), [part, ox, oy, oz])
  useEffect(() => () => shaped?.dispose(), [shaped])
  return (
    <group>
      <mesh
        position={shaped ? [0, 0, 0] : center}
        geometry={shaped ?? undefined}
        onClick={(e) => {
          e.stopPropagation()
          onSelect?.(part.key)
        }}
      >
        {!shaped && <boxGeometry args={size} />}
        <meshStandardMaterial
          {...(shaped ? { side: DoubleSide } : {})}
          color={selected ? '#f59e0b' : color}
          roughness={0.75}
          metalness={0}
          transparent={ghost}
          opacity={ghost ? 0.28 : 1}
          depthWrite={!ghost}
          emissive={selected ? '#7c4a03' : '#000000'}
          emissiveIntensity={selected ? 0.25 : 0}
        />
        <Edges color={selected ? '#92400e' : '#5b5348'} threshold={15} />
      </mesh>
      {ops.map((op) => {
        if (op.kind === 'drill') {
          const depth = Math.min(op.depth, part.thickness)
          const proud = op.purpose === 'hinge-cup' || op.purpose === 'slide' ? 4 : 1.5
          const mid = toWorld(part.frame, op.x, op.y, (depth - proud) / 2)
          // Ø5 bores are a few pixels at cabinet scale, so the marker is drawn a little wider than the hole.
          const visual = op.purpose === 'slide' || op.purpose === 'mounting-plate' ? Math.max(op.diameter, 16) : op.diameter
          const color = op.purpose === 'hinge-cup' ? '#1c1917' : op.purpose === 'slide' ? '#1d4ed8' : op.purpose === 'mounting-plate' ? '#9a3412' : '#44403c'
          return (
            <mesh key={op.id} position={T([mid[0] + offset[0], mid[1] + offset[1], mid[2] + offset[2]])} rotation={holeRotation(part.frame.n)} renderOrder={2}>
              <cylinderGeometry args={[(visual / 2) * S, (visual / 2) * S, (depth + proud) * S, 24]} />
              <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
          )
        }
        if (op.kind === 'groove') {
          const c1 = toWorld(part.frame, op.x1, op.y1, -0.3)
          const c2 = toWorld(part.frame, op.x2, op.y2, op.depth)
          const ga = T([Math.min(c1[0], c2[0]) + offset[0], Math.min(c1[1], c2[1]) + offset[1], Math.min(c1[2], c2[2]) + offset[2]])
          const gb = T([Math.max(c1[0], c2[0]) + offset[0], Math.max(c1[1], c2[1]) + offset[1], Math.max(c1[2], c2[2]) + offset[2]])
          return (
            <mesh key={op.id} position={[(ga[0] + gb[0]) / 2, (ga[1] + gb[1]) / 2, (ga[2] + gb[2]) / 2]}>
              <boxGeometry args={[Math.abs(gb[0] - ga[0]), Math.abs(gb[1] - ga[1]), Math.abs(gb[2] - ga[2])]} />
              <meshStandardMaterial color="#6b5d4a" />
            </mesh>
          )
        }
        return null
      })}
    </group>
  )
}

export function Viewer3D({
  parts,
  library,
  width,
  height,
  depth,
  frame,
  selected,
  onSelect,
  explode = 0,
  showOps = true,
  hideDoors = false,
}: {
  parts: Part[]
  library: Library
  width: number
  height: number
  depth: number
  /** Camera frame in cabinet millimetres. Defaults to the single cabinet. */
  frame?: { width: number; depth: number; height: number }
  selected?: string | null
  onSelect?: (key: string | null) => void
  explode?: number
  showOps?: boolean
  hideDoors?: boolean
}) {
  const fw = frame?.width ?? width
  const fd = frame?.depth ?? depth
  const fh = frame?.height ?? height
  const size = Math.max(fw, fd, fh) * S
  const target: [number, number, number] = [(fw / 2) * S, (fh / 2) * S, (-fd / 2) * S]
  const cam: [number, number, number] = [target[0] + size * 1.25, target[1] + size * 0.7, target[2] + size * 1.9]
  return (
    <Canvas camera={{ position: cam, fov: 38, near: 0.01, far: 50 }} dpr={[1, 2]} onPointerMissed={() => onSelect?.(null)} gl={{ preserveDrawingBuffer: true, antialias: true }}>
      <color attach="background" args={['#f3f1ec']} />
      <hemisphereLight args={['#ffffff', '#b8ad9c', 1.1]} />
      <directionalLight position={[2, 4, 3]} intensity={1.6} />
      <directionalLight position={[-3, 2, -2]} intensity={0.5} />
      <gridHelper args={[4, 40, '#c9c2b4', '#e2ddd3']} position={[target[0], 0, target[2]]} />
      {parts
        .filter((p) => !(hideDoors && (isFront(p) || p.role === 'drawer')))
        .map((p) => {
          const mat = library.materials.find((m) => m.id === p.materialId)
          return (
            <PartMesh
              key={p.key}
              part={p}
              color={mat?.color ?? '#d8d2c4'}
              selected={selected === p.key}
              offset={explodeOffset(p, explode)}
              showOps={showOps}
              ghost={isFront(p) && !hideDoors && selected !== p.key && explode === 0}
              onSelect={onSelect ?? undefined}
            />
          )
        })}
      <OrbitControls target={target} makeDefault enableDamping={false} />
      <Refit target={target} size={size} />
    </Canvas>
  )
}
