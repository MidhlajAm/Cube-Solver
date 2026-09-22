/**
 * The facelet move engine.
 *
 * This is deliberately independent of the vendored Kociemba solver: the solver
 * produces a move sequence, and this engine replays it. Because the two are
 * written from different first principles, replaying a solution through this
 * engine and asserting the cube ends solved is a genuine cross-check of both
 * (see tests/solver.test.ts).
 *
 * Moves are expressed as Singmaster facelet cycles, which is far less
 * error-prone to write and review than 54-entry permutation tables.
 */

import {
  FACELET_COUNT,
  FACE_OFFSET,
  FACES,
  type Face,
  type Facelets,
  type Move,
  solvedFacelets,
} from './types';

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
 * `sourceIndicesFor(face)[i]` is the facelet whose color ends up at index `i`
 * after one clockwise turn. Exposed so the 3D view can be checked against the
 * same permutation the engine actually uses.
 */
export function sourceIndicesFor(face: Face): readonly number[] {
  return SOURCE[face];
}

/**
 * `destinationIndicesFor(face)[i]` is where the sticker currently at index `i`
 * ends up after one clockwise turn — the inverse of the above.
 */
export function destinationIndicesFor(face: Face): readonly number[] {
  const src = SOURCE[face];
  const dest = new Array<number>(FACELET_COUNT);
  for (let i = 0; i < FACELET_COUNT; i++) dest[src[i]] = i;
  return dest;
}

/** Apply a single quarter turn (clockwise) of a face. Returns a new array. */
function quarterTurn(facelets: Facelets, face: Face): Facelets {
  const src = SOURCE[face];
  const next: Facelets = new Array(FACELET_COUNT);
  for (let i = 0; i < FACELET_COUNT; i++) {
    next[i] = facelets[src[i]];
  }
  return next;
}

/** Apply one move (1, 2 or 3 quarter turns). Returns a new array. */
export function applyMove(facelets: Facelets, move: Move): Facelets {
  let result = facelets;
  for (let i = 0; i < move.turns; i++) {
    result = quarterTurn(result, move.face);
  }
  return result;
}

/** Apply a sequence of moves in order. Returns a new array. */
export function applyMoves(facelets: Facelets, moves: Move[]): Facelets {
  return moves.reduce(applyMove, facelets);
}

/** True when every face is a single color. */
export function isSolved(facelets: Facelets): boolean {
  for (const face of FACES) {
    const base = FACE_OFFSET[face];
    const color = facelets[base];
    for (let i = 1; i < 9; i++) {
      if (facelets[base + i] !== color) return false;
    }
  }
  return true;
}

/**
 * Which facelet indices physically sit on a given face's layer, including the
 * adjacent strips. Used by the 3D view to decide which cubies to rotate.
 */
export function faceletsAffectedBy(face: Face): number[] {
  return CYCLES[face].flat();
}

/** A solved cube. Re-exported here so callers need only import from state. */
export { solvedFacelets };
