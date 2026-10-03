import { Edges, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import { toWorld } from '@/core/geometry'
import type { Library, Part, Vec3 } from '@/core/types'

const S = 0.001

/** Cabinet coordinates (Z up, Y = depth) -> three.js (Y up, -Z = away from viewer). */
const T = (p: Vec3): [number, number, number] => [p[0] * S, p[2] * S, -p[1] * S]

function partBox(p: Part) {
  const corners: Vec3[] = []
  for (const a of [0, p.length]) for (const b of [0, p.width]) for (const c of [0, p.thickness]) corners.push(toWorld(p.frame, a, b, c))
  const min: Vec3 = [Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1])), Math.min(...corners.map((c) => c[2]))]
  const max: Vec3 = [Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[2]))]
  return { min, max }
}

function explodeOffset(p: Part, amount: number, width: number): Vec3 {
  const d = amount
  switch (p.role) {
    case 'side':
      return p.frame.origin[0] < width / 2 ? [-d, 0, 0] : [d, 0, 0]
    case 'bottom':
    case 'toekick':
      return [0, 0, -d * 0.6]
    case 'top':
    case 'rail':
      return [0, 0, d * 0.6]
    case 'back':
      return [0, d, 0]
    case 'door':
    case 'drawer':
      return [0, -d * 1.4, 0]
    case 'shelf':
      return [0, -d * 0.5, 0]
    default:
      return [0, 0, 0]
  }
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
  return (
    <group>
      <mesh
        position={center}
        onClick={(e) => {
          e.stopPropagation()
          onSelect?.(part.key)
        }}
      >
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={selected ? '#f59e0b' : color}
          roughness={0.75}
          metalness={0}
          transparent={ghost}
          opacity={ghost ? 0.35 : 1}
          emissive={selected ? '#7c4a03' : '#000000'}
          emissiveIntensity={selected ? 0.25 : 0}
        />
        <Edges color={selected ? '#92400e' : '#5b5348'} threshold={15} />
      </mesh>
      {ops.map((op) => {
        if (op.kind === 'drill') {
          const depth = Math.min(op.depth, part.thickness)
          const mid = toWorld(part.frame, op.x, op.y, depth / 2 - 0.2)
          return (
            <mesh key={op.id} position={T([mid[0] + offset[0], mid[1] + offset[1], mid[2] + offset[2]])} rotation={holeRotation(part.frame.n)}>
              <cylinderGeometry args={[(op.diameter / 2) * S, (op.diameter / 2) * S, (depth + 0.6) * S, 20]} />
              <meshStandardMaterial color={op.purpose === 'hinge-cup' ? '#3f3a33' : op.purpose === 'slide' ? '#1d4ed8' : op.purpose === 'mounting-plate' ? '#7c2d12' : '#2b2722'} />
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
        .filter((p) => !(hideDoors && p.role === 'door'))
        .map((p) => {
          const mat = library.materials.find((m) => m.id === p.materialId)
          return (
            <PartMesh
              key={p.key}
              part={p}
              color={mat?.color ?? '#d8d2c4'}
              selected={selected === p.key}
              offset={explodeOffset(p, explode, width)}
              showOps={showOps}
              ghost={p.role === 'door' && !hideDoors && selected !== p.key && explode === 0}
              onSelect={onSelect ?? undefined}
            />
          )
        })}
      <OrbitControls target={target} makeDefault enableDamping={false} />
    </Canvas>
  )
}
