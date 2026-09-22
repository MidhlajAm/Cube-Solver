/**
 * The facelet move engine.
 *
 * This is deliberately independent of the vendored Kociemba solver: the solver
 * produces a move sequence, and this engine replays it. Because the two are
 * written from different first principles, replaying a solution through this
 * engine and asserting the cube ends solved is a genuine cross-check of both
 * (see tests/solver.test.ts).
 *
 * Turns for any cube size are derived from the geometry: a face turn rotates
 * the cubies in that layer, and where each sticker lands falls straight out of
 * the coordinates. The hand-written Singmaster cycles below are kept as an
 * independent oracle — tests/state.test.ts asserts the derived 3x3
 * permutations match them exactly, so the general code is pinned to tables
 * that were themselves cross-checked against the vendored solver.
 */

import {
  FACELET_COUNT,
  FACE_OFFSET,
  FACES,
  faceOffsetFor,
  sizeOf,
  stickersPerFace,
  type CubeSize,
  type Face,
  type Facelets,
  type Move,
  solvedFacelets,
} from './types';
import { faceletIndexAt, geometryFor, isInLayer, rotateAboutFace } from './geometry';

/** Facelet index from a face and a 1-based Singmaster sticker number (1..9). */
function fi(face: Face, n: number): number {
  return FACE_OFFSET[face] + (n - 1);
}

/**
 * Four-element cycles per face turn, written in standard Singmaster form.
 * A cycle [a, b, c, d] means the sticker at a moves to b, b to c, c to d,
 * d back to a.
 *
 * Each face has two cycles for its own rotating surface (corners and edges)
 * and three for the adjacent strips it drags around.
 */
const CYCLES: Record<Face, number[][]> = {
  // Clockwise from above. Drags Front -> Left -> Back -> Right.
  U: [
    [fi('U', 1), fi('U', 3), fi('U', 9), fi('U', 7)],
    [fi('U', 2), fi('U', 6), fi('U', 8), fi('U', 4)],
    [fi('F', 1), fi('L', 1), fi('B', 1), fi('R', 1)],
    [fi('F', 2), fi('L', 2), fi('B', 2), fi('R', 2)],
    [fi('F', 3), fi('L', 3), fi('B', 3), fi('R', 3)],
  ],
  // Clockwise from the right. Drags Front -> Up -> Back -> Down.
  R: [
    [fi('R', 1), fi('R', 3), fi('R', 9), fi('R', 7)],
    [fi('R', 2), fi('R', 6), fi('R', 8), fi('R', 4)],
    [fi('F', 3), fi('U', 3), fi('B', 7), fi('D', 3)],
    [fi('F', 6), fi('U', 6), fi('B', 4), fi('D', 6)],
    [fi('F', 9), fi('U', 9), fi('B', 1), fi('D', 9)],
  ],
  // Clockwise from the front. Drags Up -> Right -> Down -> Left.
  F: [
    [fi('F', 1), fi('F', 3), fi('F', 9), fi('F', 7)],
    [fi('F', 2), fi('F', 6), fi('F', 8), fi('F', 4)],
    [fi('U', 7), fi('R', 1), fi('D', 3), fi('L', 9)],
    [fi('U', 8), fi('R', 4), fi('D', 2), fi('L', 6)],
    [fi('U', 9), fi('R', 7), fi('D', 1), fi('L', 3)],
  ],
  // Clockwise from below. Drags Front -> Right -> Back -> Left.
  D: [
    [fi('D', 1), fi('D', 3), fi('D', 9), fi('D', 7)],
    [fi('D', 2), fi('D', 6), fi('D', 8), fi('D', 4)],
    [fi('F', 7), fi('R', 7), fi('B', 7), fi('L', 7)],
    [fi('F', 8), fi('R', 8), fi('B', 8), fi('L', 8)],
    [fi('F', 9), fi('R', 9), fi('B', 9), fi('L', 9)],
  ],
  // Clockwise from the left. Drags Up -> Front -> Down -> Back.
  L: [
    [fi('L', 1), fi('L', 3), fi('L', 9), fi('L', 7)],
    [fi('L', 2), fi('L', 6), fi('L', 8), fi('L', 4)],
    [fi('U', 1), fi('F', 1), fi('D', 1), fi('B', 9)],
    [fi('U', 4), fi('F', 4), fi('D', 4), fi('B', 6)],
    [fi('U', 7), fi('F', 7), fi('D', 7), fi('B', 3)],
  ],
  // Clockwise from behind. Drags Up -> Left -> Down -> Right.
  B: [
    [fi('B', 1), fi('B', 3), fi('B', 9), fi('B', 7)],
    [fi('B', 2), fi('B', 6), fi('B', 8), fi('B', 4)],
    [fi('U', 3), fi('L', 1), fi('D', 7), fi('R', 9)],
    [fi('U', 2), fi('L', 4), fi('D', 8), fi('R', 6)],
    [fi('U', 1), fi('L', 7), fi('D', 9), fi('R', 3)],
  ],
};

/**
 * Source-index tables: `SOURCE[face][i]` is the facelet whose old color ends up
 * at index `i` after one clockwise turn of `face`.
 */
const SOURCE: Record<Face, number[]> = (() => {
  const tables = {} as Record<Face, number[]>;
  for (const face of FACES) {
    const src = Array.from({ length: FACELET_COUNT }, (_, i) => i);
    for (const [a, b, c, d] of CYCLES[face]) {
      src[b] = a;
      src[c] = b;
      src[d] = c;
      src[a] = d;
    }
    tables[face] = src;
  }
  return tables;
})();

/**
 * The hand-written 3x3 permutation, kept only as the oracle the derived tables
 * are checked against. Everything else goes through `sourceIndicesFor`.
 */
export function singmasterSourceIndices(face: Face): readonly number[] {
  return SOURCE[face];
}

/**
 * Build a face's permutation from the cube's geometry.
 *
 * Every sticker in the turning layer is carried round with its cubie: rotate
 * the cubie's position and the sticker's normal, and whichever facelet now sits
 * there is where it went. Works for any size without a table per size.
 */
function buildPermutation(face: Face, size: CubeSize): number[] {
  const { facelets } = geometryFor(size);
  const source = facelets.map((_, i) => i);

  for (const sticker of facelets) {
    if (!isInLayer(sticker.position, face, size)) continue;
    const destination = faceletIndexAt(
      rotateAboutFace(sticker.position, face),
      rotateAboutFace(sticker.normal, face),
      size,
    );
    if (destination === undefined) {
      throw new Error(`Turning ${face} sent facelet ${sticker.index} off the cube`);
    }
    source[destination] = sticker.index;
  }

  return source;
}

const PERMUTATIONS = new Map<string, readonly number[]>();

/**
 * `sourceIndicesFor(face, size)[i]` is the facelet whose color ends up at index
 * `i` after one clockwise turn. Exposed so the 3D view can be checked against
 * the same permutation the engine actually uses.
 */
export function sourceIndicesFor(face: Face, size: CubeSize = 3): readonly number[] {
  const key = `${size}${face}`;
  const cached = PERMUTATIONS.get(key);
  if (cached) return cached;
  const built = buildPermutation(face, size);
  PERMUTATIONS.set(key, built);
  return built;
}

/**
 * `destinationIndicesFor(face, size)[i]` is where the sticker currently at
 * index `i` ends up after one clockwise turn — the inverse of the above.
 */
export function destinationIndicesFor(face: Face, size: CubeSize = 3): readonly number[] {
  const src = sourceIndicesFor(face, size);
  const dest = new Array<number>(src.length);
  for (let i = 0; i < src.length; i++) dest[src[i]] = i;
  return dest;
}

/** Apply a single quarter turn (clockwise) of a face. Returns a new array. */
function quarterTurn(facelets: Facelets, face: Face, size: CubeSize): Facelets {
  const src = sourceIndicesFor(face, size);
  const next: Facelets = new Array(src.length);
  for (let i = 0; i < src.length; i++) {
    next[i] = facelets[src[i]];
  }
  return next;
}

/** Apply one move (1, 2 or 3 quarter turns). Returns a new array. */
export function applyMove(facelets: Facelets, move: Move): Facelets {
  const size = sizeOf(facelets);
  let result = facelets;
  for (let i = 0; i < move.turns; i++) {
    result = quarterTurn(result, move.face, size);
  }
  return result;
}

/** Apply a sequence of moves in order. Returns a new array. */
export function applyMoves(facelets: Facelets, moves: Move[]): Facelets {
  return moves.reduce(applyMove, facelets);
}

/** True when every face is a single color. */
export function isSolved(facelets: Facelets): boolean {
  const size = sizeOf(facelets);
  const perFace = stickersPerFace(size);
  for (const face of FACES) {
    const base = faceOffsetFor(face, size);
    const color = facelets[base];
    for (let i = 1; i < perFace; i++) {
      if (facelets[base + i] !== color) return false;
    }
  }
  return true;
}

/**
 * Which facelet indices physically sit on a given face's layer, including the
 * adjacent strips. Used by the 3D view to decide which cubies to rotate.
 */
export function faceletsAffectedBy(face: Face, size: CubeSize = 3): number[] {
  const src = sourceIndicesFor(face, size);
  return src.map((from, to) => (from === to ? -1 : to)).filter((i) => i >= 0);
}

/** A solved cube. Re-exported here so callers need only import from state. */
export { solvedFacelets };
