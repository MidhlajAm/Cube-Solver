/**
 * The bridge between facelet indices and 3D space.
 *
 * Coordinates: +x right, +y up, +z toward the viewer (front). A cubie's
 * coordinate along each axis is `i - (size - 1) / 2`, which puts the cube's
 * centre at the origin for any size — whole numbers on a 3x3, halves on a 2x2.
 * Every facelet maps to one cubie and an outward normal.
 *
 * The layout of each face follows the unfolded net described in types.ts, so
 * e.g. the U face's first row is the one adjacent to B, while the D face's
 * first row is the one adjacent to F.
 *
 * This is also where the move engine gets its permutations from: turning a face
 * is a rotation of the cubies in that layer, and where each sticker lands falls
 * straight out of the coordinates. See state.ts.
 */

import { FACES, faceOffsetFor, stickersPerFace, type CubeSize, type Face } from './types';

export type Vec3 = readonly [number, number, number];

export interface FaceletGeometry {
  /** Facelet index within its cube. */
  index: number;
  /** Which face it belongs to. */
  face: Face;
  /** The cubie this sticker is attached to. */
  position: Vec3;
  /** Outward-pointing normal of the sticker. */
  normal: Vec3;
}

const FACE_NORMALS: Record<Face, Vec3> = {
  U: [0, 1, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  D: [0, -1, 0],
  L: [-1, 0, 0],
  B: [0, 0, -1],
};

/** Distance from the centre to the outer layer, in cubie coordinates. */
export function extentOf(size: CubeSize): number {
  return (size - 1) / 2;
}

/**
 * Position of a sticker within its face, given the row and column it occupies
 * when that face is read in the net's reading order.
 */
export function positionFor(face: Face, row: number, column: number, size: CubeSize): Vec3 {
  const m = extentOf(size);
  switch (face) {
    // Seen from above, with the back edge at the top of the net.
    case 'U':
      return [column - m, m, row - m];
    // Seen from below, with the front edge at the top of the net.
    case 'D':
      return [column - m, -m, m - row];
    case 'F':
      return [column - m, m - row, m];
    // Seen from behind: the net's left column is the cube's right side.
    case 'B':
      return [m - column, m - row, -m];
    // Seen from the right: the net's left column touches the front face.
    case 'R':
      return [m, m - row, m - column];
    // Seen from the left: the net's right column touches the front face.
    case 'L':
      return [-m, m - row, column - m];
  }
}

/** Stable string key for a cubie position or a normal. */
export function cubieKey(position: Vec3): string {
  return position.join(',');
}

/** Everything the renderer and the move engine need about one cube size. */
export interface CubeGeometry {
  size: number;
  facelets: readonly FaceletGeometry[];
  /** The drawn cubies: every one except those fully inside the cube. */
  cubies: readonly Vec3[];
  /** "position|normal" to facelet index; absent for hidden faces. */
  faceletAt: ReadonlyMap<string, number>;
}

function build(size: CubeSize): CubeGeometry {
  const facelets: FaceletGeometry[] = [];
  for (const face of FACES) {
    for (let i = 0; i < stickersPerFace(size); i++) {
      facelets.push({
        index: faceOffsetFor(face, size) + i,
        face,
        position: positionFor(face, Math.floor(i / size), i % size, size),
        normal: FACE_NORMALS[face],
      });
    }
  }
  facelets.sort((a, b) => a.index - b.index);

  const m = extentOf(size);
  const cubies: Vec3[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const position: Vec3 = [x - m, y - m, z - m];
        // A cubie with no coordinate at the surface is never visible.
        if (position.every((c) => Math.abs(c) !== m)) continue;
        cubies.push(position);
      }
    }
  }

  const faceletAt = new Map<string, number>();
  for (const geometry of facelets) {
    faceletAt.set(`${cubieKey(geometry.position)}|${cubieKey(geometry.normal)}`, geometry.index);
  }

  return { size, facelets, cubies, faceletAt };
}

const CACHE = new Map<number, CubeGeometry>();

/** Geometry for one cube size, built once and reused. */
export function geometryFor(size: CubeSize): CubeGeometry {
  const cached = CACHE.get(size);
  if (cached) return cached;
  const built = build(size);
  CACHE.set(size, built);
  return built;
}

/** Geometry for all facelets of a 3x3, indexed by facelet number. */
export const FACELET_GEOMETRY: readonly FaceletGeometry[] = geometryFor(3).facelets;

/** The 26 drawn cubie positions of a 3x3. */
export const CUBIE_POSITIONS: readonly Vec3[] = geometryFor(3).cubies;

/** Facelets attached to each cubie of a cube, keyed by cubie position. */
export function faceletsByCubie(size: CubeSize): ReadonlyMap<string, FaceletGeometry[]> {
  const map = new Map<string, FaceletGeometry[]>();
  for (const geometry of geometryFor(size).facelets) {
    const key = cubieKey(geometry.position);
    const list = map.get(key);
    if (list) list.push(geometry);
    else map.set(key, [geometry]);
  }
  return map;
}

/** Facelets attached to each cubie of a 3x3. */
export const FACELETS_BY_CUBIE: ReadonlyMap<string, FaceletGeometry[]> = faceletsByCubie(3);

/** Facelet index on `position` facing `normal`, or undefined if hidden. */
export function faceletIndexAt(position: Vec3, normal: Vec3, size: CubeSize = 3): number | undefined {
  return geometryFor(size).faceletAt.get(`${cubieKey(position)}|${cubieKey(normal)}`);
}

/** The six outward directions, for iterating a cubie's faces. */
export const DIRECTIONS: readonly { normal: Vec3; face: Face }[] = FACES.map((face) => ({
  face,
  normal: FACE_NORMALS[face],
}));

/** The outward normal of a face. */
export function normalOf(face: Face): Vec3 {
  return FACE_NORMALS[face];
}

/** Negating a zero coordinate yields -0, which compares unequal to 0. */
function unsign(n: number): number {
  return n === 0 ? 0 : n;
}

/**
 * Rotate a vector a quarter turn about a face's axis, in the direction that
 * face turns clockwise when viewed from outside the cube.
 */
export function rotateAboutFace(v: Vec3, face: Face): Vec3 {
  const [x, y, z] = v;
  switch (face) {
    case 'U':
      return [unsign(-z), y, x];
    case 'D':
      return [z, y, unsign(-x)];
    case 'R':
      return [x, z, unsign(-y)];
    case 'L':
      return [x, unsign(-z), y];
    case 'F':
      return [y, unsign(-x), z];
    case 'B':
      return [unsign(-y), x, z];
  }
}

/** The axis a face turns about, and the sign of a clockwise turn about it. */
export const FACE_AXIS: Record<Face, { axis: 'x' | 'y' | 'z'; sign: 1 | -1 }> = {
  U: { axis: 'y', sign: -1 },
  D: { axis: 'y', sign: 1 },
  R: { axis: 'x', sign: -1 },
  L: { axis: 'x', sign: 1 },
  F: { axis: 'z', sign: -1 },
  B: { axis: 'z', sign: 1 },
};

/** The coordinate a cubie must have to be part of a given face's layer. */
export function isInLayer(position: Vec3, face: Face, size: CubeSize = 3): boolean {
  const m = extentOf(size);
  const [x, y, z] = position;
  switch (face) {
    case 'U':
      return y === m;
    case 'D':
      return y === -m;
    case 'R':
      return x === m;
    case 'L':
      return x === -m;
    case 'F':
      return z === m;
    case 'B':
      return z === -m;
  }
}

/** The cubies that move when a face turns. */
export function cubiesInLayer(face: Face, size: CubeSize = 3): Vec3[] {
  return geometryFor(size).cubies.filter((position) => isInLayer(position, face, size));
}

/** The eight corner cubies, which are the only pieces a 2x2 has. */
export function cornerPositions(size: CubeSize): Vec3[] {
  const m = extentOf(size);
  return geometryFor(size).cubies.filter((p) => p.every((c) => Math.abs(c) === m));
}
