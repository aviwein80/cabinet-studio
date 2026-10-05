import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Component, type ReactNode, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { entityContours } from '@/cam/doc'
import { toPoints } from '@/cam/geom'
import { placeMesh } from '@/cam/mesh/place'
import type { CamPart, ModelRef } from '@/cam/types'
import { useModelMesh } from './modelData'
import { faceColorMap, useModelSolid } from './solidData'

/**
 * 3D view of the part: the work volume as translucent stock, placed 3D models, and the face-1
 * drawing at the top. Part frame: X along the length, Y along the width, Z up from face 1.
 */
export function Model3DView({ part }: { part: CamPart }) {
  return (
    <NoWebGl>
      <View part={part} />
    </NoWebGl>
  )
}

/** Shows a message instead of breaking the page when the computer cannot draw 3D (no WebGL). */
class NoWebGl extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#0e1013] p-6 text-center text-xs text-stone-400">
        The 3D view could not start on this computer ({this.state.error}). The 2D view and every 3D model tool still work.
      </div>
    )
  }
}

function View({ part }: { part: CamPart }) {
  const max = Math.max(part.length, part.width, part.thickness * 4)
  return (
    <div className="absolute inset-0 bg-[#0e1013]" aria-label="3D view of the part">
      <Canvas camera={{ position: [max * 0.25, max * 1.0, max * 1.35], fov: 40, near: 0.5, far: max * 30 }}>
        <ambientLight intensity={0.35} />
        {/* low raking light so shallow carving reads */}
        <directionalLight position={[-max, max * 0.45, max * 0.6]} intensity={2.2} />
        <directionalLight position={[max, max * 0.8, -max]} intensity={0.35} />
        {/* part frame (x, y, z) -> three (x - L/2, z, -(y - W/2)) */}
        <group rotation={[-Math.PI / 2, 0, 0]} position={[-part.length / 2, 0, part.width / 2]}>
          <mesh position={[part.length / 2, part.width / 2, -part.thickness / 2]}>
            <boxGeometry args={[part.length, part.width, part.thickness]} />
            <meshStandardMaterial color="#c9a979" transparent opacity={0.18} depthWrite={false} />
          </mesh>
          <lineSegments position={[part.length / 2, part.width / 2, -part.thickness / 2]}>
            <edgesGeometry args={[new THREE.BoxGeometry(part.length, part.width, part.thickness)]} />
            <lineBasicMaterial color="#8a7350" />
          </lineSegments>
          <Drawing part={part} />
          {(part.models ?? [])
            .filter((m) => m.visible)
            .map((m) => (
              <ModelMesh key={m.id} model={m} />
            ))}
        </group>
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  )
}

const MODEL_COLOR = '#d6c3f5'

function ModelMesh({ model }: { model: ModelRef }) {
  const { mesh, error } = useModelMesh(model.blob)
  const { solid } = useModelSolid(model.blob, model.kind === 'solid')
  const colors = useMemo(() => (solid ? faceColorMap(solid, model.faceColors) : null), [solid, model.faceColors])
  const geo = useMemo(() => {
    if (!mesh) return null
    const placed = placeMesh(mesh, model.place)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(placed.positions, 3))
    g.setIndex(new THREE.BufferAttribute(placed.indices, 1))
    if (colors && placed.groups) {
      // solids: each face in its colour (faces have their own vertices, so per-vertex colours work)
      const rgb = new Float32Array(placed.positions.length)
      const base = new THREE.Color(MODEL_COLOR)
      const c = new THREE.Color()
      for (let t = 0; t < placed.groups.length; t++) {
        const hex = colors.get(placed.groups[t])
        const col = hex ? c.set(hex) : base
        for (let k = 0; k < 3; k++) {
          const v = placed.indices[t * 3 + k]
          rgb[v * 3] = col.r
          rgb[v * 3 + 1] = col.g
          rgb[v * 3 + 2] = col.b
        }
      }
      g.setAttribute('color', new THREE.BufferAttribute(rgb, 3))
    }
    g.computeVertexNormals()
    return g
  }, [mesh, model.place, colors])
  useEffect(() => () => geo?.dispose(), [geo])
  if (error) console.warn(error)
  if (!geo) return null
  const colored = !!geo.getAttribute('color')
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={colored ? '#ffffff' : MODEL_COLOR} vertexColors={colored} roughness={0.65} metalness={0.05} side={THREE.DoubleSide} flatShading={false} />
    </mesh>
  )
}

function Drawing({ part }: { part: CamPart }) {
  const geo = useMemo(() => {
    const pts: number[] = []
    for (const e of part.entities) {
      if (e.face !== 1) continue
      if (e.g.t === 'poly3d') {
        const p = e.g.pts
        for (let i = 0; i + 1 < p.length; i++) pts.push(...p[i], ...p[i + 1])
        continue
      }
      const z = e.depth !== undefined && e.layer === 'model-sections' ? -e.depth : 0.05
      for (const c of entityContours(e)) {
        const p = toPoints(c, 0.05)
        const n = c.closed ? p.length : p.length - 1
        for (let i = 0; i < n; i++) {
          const a = p[i]
          const b = p[(i + 1) % p.length]
          pts.push(a.x, a.y, z, b.x, b.y, z)
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
    return g
  }, [part.entities])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#38bdf8" />
    </lineSegments>
  )
}
