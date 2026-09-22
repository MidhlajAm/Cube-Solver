'use client';

/**
 * The animated 3D cube.
 *
 * Colors always come from the facelet state, never from anything the renderer
 * tracks itself. A turn is animated by rotating a pivot group containing that
 * layer's cubies; when it lands, the store advances and the facelet state
 * already has the stickers in their new places, so the handover is seamless.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, type ThreeElements } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  CUBIE_POSITIONS,
  DIRECTIONS,
  FACE_AXIS,
  cubieKey,
  faceletIndexAt,
  isInLayer,
  type Vec3,
} from '@/lib/cube/geometry';
import { type Face, type Facelets } from '@/lib/cube/types';
import { useCubeStore, selectCurrentFacelets } from '@/store/cubeStore';

/** Spacing between cubie centers; slightly over 1 so the gaps read as seams. */
const SPACING = 1.04;
const CUBIE_SIZE = 0.97;
const STICKER_SIZE = 0.82;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Quaternion that points a +Z plane along the given normal. */
function quaternionFor(normal: Vec3): THREE.Quaternion {
  const from = new THREE.Vector3(0, 0, 1);
  const to = new THREE.Vector3(...normal);
  return new THREE.Quaternion().setFromUnitVectors(from, to);
}

interface CubieProps {
  position: Vec3;
  facelets: Facelets;
  bodyMaterial: THREE.Material;
  bodyGeometry: THREE.BufferGeometry;
  stickerGeometry: THREE.BufferGeometry;
  stickerMaterials: Record<string, THREE.Material>;
}

function Cubie({
  position,
  facelets,
  bodyMaterial,
  bodyGeometry,
  stickerGeometry,
  stickerMaterials,
}: CubieProps) {
  const world: [number, number, number] = [
    position[0] * SPACING,
    position[1] * SPACING,
    position[2] * SPACING,
  ];

  return (
    <group position={world}>
      <mesh geometry={bodyGeometry} material={bodyMaterial} />
      {DIRECTIONS.map(({ normal }) => {
        const index = faceletIndexAt(position, normal);
        if (index === undefined) return null;

        const color = facelets[index];
        const quaternion = quaternionFor(normal);
        // Lift the sticker just clear of the body so it never z-fights.
        const offset = CUBIE_SIZE / 2 + 0.006;

        return (
          <mesh
            key={cubieKey(normal)}
            geometry={stickerGeometry}
            material={stickerMaterials[color]}
            position={[normal[0] * offset, normal[1] * offset, normal[2] * offset]}
            quaternion={quaternion}
          />
        );
      })}
    </group>
  );
}

function CubeModel() {
  const facelets = useCubeStore(selectCurrentFacelets);
  const animation = useCubeStore((s) => s.animation);
  // Scanning starts on an arbitrary face, so the sticker colours come from the
  // scan rather than from the classic scheme.
  const faceColors = useCubeStore((s) => s.faceColors);

  const pivotRef = useRef<THREE.Group>(null);

  const bodyGeometry = useMemo(() => new THREE.BoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE), []);
  const stickerGeometry = useMemo(
    () => new THREE.PlaneGeometry(STICKER_SIZE, STICKER_SIZE),
    [],
  );
  const bodyMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#0b0b0f', roughness: 0.7, metalness: 0 }),
    [],
  );
  const stickerMaterials = useMemo(() => {
    const entries = Object.entries(faceColors).map(([face, color]) => [
      face,
      new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0 }),
    ]);
    return Object.fromEntries(entries) as Record<Face, THREE.Material>;
  }, [faceColors]);

  // Rescanning replaces the palette, so the materials it replaced have to go
  // back to the GPU rather than accumulating for the life of the page.
  useEffect(
    () => () => Object.values(stickerMaterials).forEach((material) => material.dispose()),
    [stickerMaterials],
  );

  useFrame(() => {
    const pivot = pivotRef.current;
    if (!pivot) return;

    if (!animation) {
      pivot.rotation.set(0, 0, 0);
      return;
    }

    // Purely visual: the store owns when the turn actually lands, so a dropped
    // frame or a suspended tab can never strand the playback mid-move.
    const { axis, sign } = FACE_AXIS[animation.move.face];
    const elapsed = performance.now() - animation.startedAt;
    const t = Math.min(1, Math.max(0, elapsed / animation.duration));
    const angle = easeInOutCubic(t) * (Math.PI / 2) * animation.move.turns * sign;

    pivot.rotation.set(0, 0, 0);
    pivot.rotation[axis] = angle;
  });

  const { turning, still } = useMemo(() => {
    if (!animation) return { turning: [] as Vec3[], still: CUBIE_POSITIONS as readonly Vec3[] };
    const face = animation.move.face;
    return {
      turning: CUBIE_POSITIONS.filter((p) => isInLayer(p, face)),
      still: CUBIE_POSITIONS.filter((p) => !isInLayer(p, face)),
    };
  }, [animation]);

  const shared = { bodyGeometry, bodyMaterial, stickerGeometry, stickerMaterials, facelets };

  return (
    <group>
      <group ref={pivotRef}>
        {turning.map((position) => (
          <Cubie key={cubieKey(position)} position={position} {...shared} />
        ))}
      </group>
      {still.map((position) => (
        <Cubie key={cubieKey(position)} position={position} {...shared} />
      ))}
    </group>
  );
}

export interface Cube3DProps {
  className?: string;
}

export default function Cube3D({ className }: Cube3DProps) {
  // Re-render the canvas only while something is moving; R3F drives its own
  // loop, so this is just about the React tree.
  const onCreated = useCallback((state: { gl: THREE.WebGLRenderer }) => {
    state.gl.setClearAlpha(0);
  }, []);

  return (
    <div className={className}>
      <Canvas
        // Cap the pixel ratio: phones with 3x screens gain nothing visible here
        // and lose a lot of frame budget.
        dpr={[1, 2]}
        camera={{ position: [4.2, 3.6, 5.2], fov: 42 }}
        gl={{ antialias: true, alpha: true }}
        onCreated={onCreated}
        style={{ touchAction: 'none' }}
      >
        <ambientLight intensity={1.15} />
        <directionalLight position={[6, 8, 6]} intensity={1.5} />
        <directionalLight position={[-6, -3, -5]} intensity={0.5} />
        <CubeModel />
        <OrbitControls
          enablePan={false}
          enableZoom
          minDistance={5}
          maxDistance={14}
          // Slow the drag a touch so a thumb-flick does not spin it wildly.
          rotateSpeed={0.7}
          zoomSpeed={0.6}
          enableDamping
          dampingFactor={0.12}
        />
      </Canvas>
    </div>
  );
}

export type { ThreeElements };
