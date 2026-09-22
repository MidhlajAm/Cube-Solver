/**
 * The bridge between facelet indices and 3D space.
 *
 * Coordinates: +x right, +y up, +z toward the viewer (front). Each of the 26
 * visible cubies sits at a position in {-1, 0, 1}^3 (the 27th, the core, is
 * never drawn). Every facelet maps to one cubie and an outward normal.
 *
 * The layout of each face follows the unfolded net described in types.ts, so
 * e.g. the U face's first row is the one adjacent to B, while the D face's
 * first row is the one adjacent to F.
 */

import { FACES, FACE_OFFSET, type Face } from './types';

export type Vec3 = readonly [number, number, number];

export interface FaceletGeometry {
  /** Facelet index, 0..53. */
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

/**
 * Position of a sticker within its face, given the row and column it occupies
 * when that face is read in the net's reading order.
 */
function positionFor(face: Face, row: number, column: number): Vec3 {
  switch (face) {
    // Seen from above, with the back edge at the top of the net.
    case 'U':
      return [column - 1, 1, row - 1];
    // Seen from below, with the front edge at the top of the net.
    case 'D':
      return [column - 1, -1, 1 - row];
    case 'F':
      return [column - 1, 1 - row, 1];
    // Seen from behind: the net's left column is the cube's right side.
    case 'B':
      return [1 - column, 1 - row, -1];
    // Seen from the right: the net's left column touches the front face.
    case 'R':
      return [1, 1 - row, 1 - column];
    // Seen from the left: the net's right column touches the front face.
    case 'L':
      return [-1, 1 - row, column - 1];
  }
}

/** Geometry for all 54 facelets, indexed by facelet number. */
export const FACELET_GEOMETRY: readonly FaceletGeometry[] = (() => {
  const out: FaceletGeometry[] = [];
  for (const face of FACES) {
    for (let i = 0; i < 9; i++) {
      out.push({
        index: FACE_OFFSET[face] + i,
        face,
        position: positionFor(face, Math.floor(i / 3), i % 3),
        normal: FACE_NORMALS[face],
      });
    }
  }
  return out.sort((a, b) => a.index - b.index);
})();

/** The 26 drawn cubie positions. */
export const CUBIE_POSITIONS: readonly Vec3[] = (() => {
  const out: Vec3[] = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        out.push([x, y, z]);
      }
    }
  }
  return out;
})();

/** Stable string key for a cubie position. */
export function cubieKey(position: Vec3): string {
  return position.join(',');
}

/** Facelets attached to each cubie, keyed by cubie position. */
export const FACELETS_BY_CUBIE: ReadonlyMap<string, FaceletGeometry[]> = (() => {
  const map = new Map<string, FaceletGeometry[]>();
  for (const geometry of FACELET_GEOMETRY) {
    const key = cubieKey(geometry.position);
    const list = map.get(key);
    if (list) list.push(geometry);
    else map.set(key, [geometry]);
  }
  return map;
})();

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
export function isInLayer(position: Vec3, face: Face): boolean {
  const [x, y, z] = position;
  switch (face) {
    case 'U':
      return y === 1;
    case 'D':
      return y === -1;
    case 'R':
      return x === 1;
    case 'L':
      return x === -1;
    case 'F':
      return z === 1;
    case 'B':
      return z === -1;
  }
}

/** The cubies that move when a face turns. */
export function cubiesInLayer(face: Face): Vec3[] {
  return CUBIE_POSITIONS.filter((position) => isInLayer(position, face));
}
