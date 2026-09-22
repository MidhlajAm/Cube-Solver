/**
 * Corners, for any cube size.
 *
 * A 2x2 is nothing but the corners of a 3x3, so both sizes share this. The
 * facelet indices differ between sizes but the pieces do not: the same eight
 * colour triples, in the same order, twisting the same way.
 *
 * Corner ordering follows the solver's convention — URF, UFL, ULB, UBR, DFR,
 * DLF, DBL, DRB — and each corner's three stickers are listed with the one on
 * the U or D face first. That first sticker is what orientation is measured
 * from: a corner is twisted 0, 1 or 2 clockwise steps out of place.
 */

import {
  faceletIndexAt,
  extentOf,
  normalOf,
  type Vec3,
} from './geometry';
import { type CubeSize, type Face, type Facelets } from './types';

/** The faces each corner touches, in the order its stickers are listed. */
export const CORNER_FACES: readonly (readonly [Face, Face, Face])[] = [
  ['U', 'R', 'F'],
  ['U', 'F', 'L'],
  ['U', 'L', 'B'],
  ['U', 'B', 'R'],
  ['D', 'F', 'R'],
  ['D', 'L', 'F'],
  ['D', 'B', 'L'],
  ['D', 'R', 'B'],
];

/** Where a corner sits, from the three faces it touches. */
function cornerPosition(faces: readonly [Face, Face, Face], size: CubeSize): Vec3 {
  const m = extentOf(size);
  const normals = faces.map(normalOf);
  return [0, 1, 2].map((axis) =>
    m * normals.reduce((total, normal) => total + normal[axis], 0),
  ) as unknown as Vec3;
}

const FACELET_CACHE = new Map<number, readonly (readonly [number, number, number])[]>();

/** Facelet index triples for the eight corners, for a given cube size. */
export function cornerFaceletsFor(
  size: CubeSize,
): readonly (readonly [number, number, number])[] {
  const cached = FACELET_CACHE.get(size);
  if (cached) return cached;

  const table = CORNER_FACES.map((faces) => {
    const position = cornerPosition(faces, size);
    return faces.map((face) => {
      const index = faceletIndexAt(position, normalOf(face), size);
      if (index === undefined) {
        throw new Error(`No facelet for corner ${faces.join('')} on face ${face}`);
      }
      return index;
    }) as unknown as readonly [number, number, number];
  });

  FACELET_CACHE.set(size, table);
  return table;
}

export interface CornerState {
  /** `permutation[slot]` is which piece is sitting in that slot. */
  permutation: number[];
  /** `orientation[slot]` is that piece's twist, 0, 1 or 2. */
  orientation: number[];
}

/** Which corner piece has exactly this set of colours, or -1. */
function pieceFor(colors: readonly Face[]): number {
  const wanted = [...colors].sort().join('');
  return CORNER_FACES.findIndex((faces) => [...faces].sort().join('') === wanted);
}

/**
 * Read the corners out of a sticker pattern.
 *
 * Returns null when the stickers do not describe eight real corners — a corner
 * with two reds, say, or one with no white or yellow sticker at all. That is a
 * misread rather than an impossible-but-well-formed cube, so callers report it
 * differently from a twist or parity failure.
 */
export function readCorners(facelets: Facelets, size: CubeSize): CornerState | null {
  const table = cornerFaceletsFor(size);
  const permutation: number[] = [];
  const orientation: number[] = [];

  for (const indices of table) {
    const colors = indices.map((index) => facelets[index]);

    // Exactly one sticker must be from the U/D pair, and where it sits in the
    // triple is the twist.
    const twist = colors.findIndex((color) => color === 'U' || color === 'D');
    if (twist === -1) return null;
    if (colors.filter((color) => color === 'U' || color === 'D').length !== 1) return null;

    const piece = pieceFor(colors);
    if (piece === -1) return null;

    permutation.push(piece);
    orientation.push(twist);
  }

  // Every piece must appear exactly once.
  if (new Set(permutation).size !== CORNER_FACES.length) return null;

  return { permutation, orientation };
}

/** Total twist across all corners; must be a multiple of 3 on a real cube. */
export function totalTwist(state: CornerState): number {
  return state.orientation.reduce((total, twist) => total + twist, 0);
}
