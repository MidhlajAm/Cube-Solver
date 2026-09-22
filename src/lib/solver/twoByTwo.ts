/**
 * An optimal 2x2 solver.
 *
 * The vendored Kociemba solver is 3x3-only, and a 2x2 does not need anything
 * that heavy. It has 3,674,160 states and can always be solved in at most 11
 * face turns, so the whole thing fits in a meet-in-the-middle search: every
 * state within five moves of solved is tabulated once (about twelve thousand
 * of them, built in milliseconds), and the scrambled cube is then searched
 * outward until it reaches one. Five plus six covers every cube there is.
 *
 * Nothing here is hand-tabulated. The effect each turn has on the corners is
 * read back out of the facelet engine, so this solver inherits whatever that
 * engine was verified against rather than repeating its assumptions.
 *
 * A 2x2 has no centres, so nothing on it is nailed down: "solved" is only
 * meaningful relative to one corner. The DBL corner is treated as home and
 * never moved, which is why the search only ever turns U, R and F.
 */

import { applyMove, solvedFacelets } from '@/lib/cube/state';
import { readCorners, type CornerState } from '@/lib/cube/corners';
import { invertMoves } from '@/lib/cube/notation';
import type { Face, Facelets, Move, Turns } from '@/lib/cube/types';

/** The corner held still; every solution is relative to it. */
export const ANCHOR_CORNER = 6; // DBL

/** Slots that can move, in the order their permutation is encoded. */
const MOBILE_SLOTS = [0, 1, 2, 3, 4, 5, 7];

/** Faces that move something, given the anchor. */
const MOVE_FACES: readonly Face[] = ['U', 'R', 'F'];

/** Turns of the three faces: U, U2, U-prime, R, R2, and so on. */
const MOVE_COUNT = MOVE_FACES.length * 3;

/** 2x2 states within this many moves of solved are tabulated up front. */
const BACKWARD_DEPTH = 5;

/** The number for a 2x2 in face turns is 11, so this can never be exceeded. */
const FORWARD_DEPTH = 6;

function decodeMove(id: number): Move {
  return { face: MOVE_FACES[Math.floor(id / 3)], turns: ((id % 3) + 1) as Turns };
}

/** Piece ids renumbered 0..6 with the anchor removed, for ranking. */
const PIECE_RANK = new Map<number, number>(MOBILE_SLOTS.map((slot, i) => [slot, i]));

/**
 * A state as one integer: the rank of the seven-corner permutation times the
 * 729 possible twists of the first six (the seventh is forced, since the total
 * must be a multiple of three).
 */
function encode(state: CornerState): number {
  const pieces = MOBILE_SLOTS.map((slot) => PIECE_RANK.get(state.permutation[slot])!);

  let rank = 0;
  for (let i = 0; i < pieces.length; i++) {
    let smaller = 0;
    for (let j = i + 1; j < pieces.length; j++) {
      if (pieces[j] < pieces[i]) smaller++;
    }
    rank = rank * (pieces.length - i) + smaller;
  }

  let twist = 0;
  for (let i = 0; i < MOBILE_SLOTS.length - 1; i++) {
    twist = twist * 3 + state.orientation[MOBILE_SLOTS[i]];
  }

  return rank * 729 + twist;
}

/**
 * What each quarter turn does to the corners, read out of the facelet engine
 * by applying it to a solved cube.
 */
const TURN_EFFECT: readonly CornerState[] = MOVE_FACES.map((face) => {
  const turned = applyMove(solvedFacelets(2), { face, turns: 1 });
  const state = readCorners(turned, 2);
  if (!state) throw new Error(`Turning ${face} on a solved 2x2 produced an impossible cube`);
  return state;
});

/** Apply one quarter turn to a corner state. */
function turn(state: CornerState, faceIndex: number): CornerState {
  const effect = TURN_EFFECT[faceIndex];
  const permutation = new Array<number>(8);
  const orientation = new Array<number>(8);

  for (let slot = 0; slot < 8; slot++) {
    const from = effect.permutation[slot];
    permutation[slot] = state.permutation[from];
    orientation[slot] = (state.orientation[from] + effect.orientation[slot]) % 3;
  }

  return { permutation, orientation };
}

/** Apply a whole move (1, 2 or 3 quarter turns of one face). */
function applyId(state: CornerState, id: number): CornerState {
  const faceIndex = Math.floor(id / 3);
  let result = state;
  for (let i = 0; i <= id % 3; i++) result = turn(result, faceIndex);
  return result;
}

const SOLVED: CornerState = {
  permutation: [0, 1, 2, 3, 4, 5, 6, 7],
  orientation: [0, 0, 0, 0, 0, 0, 0, 0],
};
const SOLVED_INDEX = encode(SOLVED);

/** Reverse a move-id sequence, inverting each turn. */
function invertIds(ids: number[]): number[] {
  const moves = invertMoves(ids.map(decodeMove));
  return moves.map((move) => MOVE_FACES.indexOf(move.face) * 3 + (move.turns - 1));
}

let backward: Map<number, number[]> | null = null;

/**
 * Every state within BACKWARD_DEPTH moves of solved, with the sequence that
 * reaches it. Built on first use and kept; it is about twelve thousand entries.
 */
function backwardTable(): Map<number, number[]> {
  if (backward) return backward;

  const table = new Map<number, number[]>([[SOLVED_INDEX, []]]);
  let frontier: { state: CornerState; sequence: number[] }[] = [{ state: SOLVED, sequence: [] }];

  for (let depth = 0; depth < BACKWARD_DEPTH; depth++) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      const lastFace = node.sequence.length
        ? Math.floor(node.sequence[node.sequence.length - 1] / 3)
        : -1;
      for (let id = 0; id < MOVE_COUNT; id++) {
        // Turning the same face twice running is always a wasted move.
        if (Math.floor(id / 3) === lastFace) continue;
        const state = applyId(node.state, id);
        const key = encode(state);
        if (table.has(key)) continue;
        const sequence = [...node.sequence, id];
        table.set(key, sequence);
        next.push({ state, sequence });
      }
    }
    frontier = next;
  }

  backward = table;
  return table;
}

/** Build the lookup up front, so the first solve is not the one that pays. */
export function warmUpTwoByTwo(): void {
  backwardTable();
}

export class UnsolvableCubeError extends Error {}

/**
 * Solve a 2x2, returning the shortest sequence of face turns that does it.
 *
 * The cube must already be in the frame the scanner canonicalises to, with the
 * DBL corner home — on a cube with no centres there is no other way to say what
 * "solved" means.
 */
export function solveTwoByTwo(facelets: Facelets): Move[] {
  const start = readCorners(facelets, 2);
  if (!start) throw new UnsolvableCubeError('These stickers do not make eight real corners.');
  if (start.permutation[ANCHOR_CORNER] !== ANCHOR_CORNER || start.orientation[ANCHOR_CORNER] !== 0) {
    throw new UnsolvableCubeError('The cube is not in its canonical orientation.');
  }
  if (encode(start) === SOLVED_INDEX) return [];

  const table = backwardTable();
  let best: number[] | null = null;

  let frontier: { state: CornerState; sequence: number[] }[] = [{ state: start, sequence: [] }];
  const seen = new Set<number>([encode(start)]);

  for (let depth = 0; depth <= FORWARD_DEPTH; depth++) {
    for (const node of frontier) {
      const tail = table.get(encode(node.state));
      if (!tail) continue;
      const total = node.sequence.length + tail.length;
      if (!best || total < best.length) {
        // The tail reaches this state *from* solved, so it is run backwards.
        best = [...node.sequence, ...invertIds(tail)];
      }
    }

    // Nothing deeper can be shorter than what we already have.
    if (best && best.length <= depth + 1) break;
    if (depth === FORWARD_DEPTH) break;

    const next: typeof frontier = [];
    for (const node of frontier) {
      const lastFace = node.sequence.length
        ? Math.floor(node.sequence[node.sequence.length - 1] / 3)
        : -1;
      for (let id = 0; id < MOVE_COUNT; id++) {
        if (Math.floor(id / 3) === lastFace) continue;
        const state = applyId(node.state, id);
        const key = encode(state);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ state, sequence: [...node.sequence, id] });
      }
    }
    frontier = next;
  }

  if (!best) throw new UnsolvableCubeError('No solution exists for this cube.');
  return best.map(decodeMove);
}
