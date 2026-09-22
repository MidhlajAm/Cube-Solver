/**
 * Cross-checks our hand-written facelet move engine against the vendored
 * solver's completely independent piece-based model. If our Singmaster cycles
 * are wrong in any way, the two will disagree on some scramble.
 */

import { describe, expect, it } from 'vitest';
import { applyMove, applyMoves, isSolved, solvedFacelets } from '@/lib/cube/state';
import { invertMoves, moveToString, movesToString, parseMoves } from '@/lib/cube/notation';
import { faceletsToString, FACES, type Move, type Turns } from '@/lib/cube/types';
import { Cube } from './helpers/vendorSolver';

/** Deterministic PRNG so failures reproduce. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randomSequence(rng: () => number, length: number): Move[] {
  const moves: Move[] = [];
  for (let i = 0; i < length; i++) {
    const face = FACES[Math.floor(rng() * FACES.length)];
    const turns = (Math.floor(rng() * 3) + 1) as Turns;
    moves.push({ face, turns });
  }
  return moves;
}

describe('facelet move engine', () => {
  it('starts solved', () => {
    expect(isSolved(solvedFacelets())).toBe(true);
    expect(faceletsToString(solvedFacelets())).toBe(
      'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB',
    );
  });

  it('returns to solved after four quarter turns of any face', () => {
    for (const face of FACES) {
      let state = solvedFacelets();
      for (let i = 0; i < 4; i++) {
        state = applyMove(state, { face, turns: 1 });
      }
      expect(isSolved(state), `${face} x4 should be identity`).toBe(true);
    }
  });

  it('treats a half turn as two quarter turns', () => {
    for (const face of FACES) {
      const viaHalf = applyMove(solvedFacelets(), { face, turns: 2 });
      const viaQuarters = applyMoves(solvedFacelets(), [
        { face, turns: 1 },
        { face, turns: 1 },
      ]);
      expect(viaHalf).toEqual(viaQuarters);
    }
  });

  it('undoes any sequence with its inverse', () => {
    const rng = makeRng(7);
    for (let trial = 0; trial < 50; trial++) {
      const seq = randomSequence(rng, 25);
      const scrambled = applyMoves(solvedFacelets(), seq);
      const restored = applyMoves(scrambled, invertMoves(seq));
      expect(isSolved(restored)).toBe(true);
    }
  });

  it('a single face turn never leaves the cube solved', () => {
    for (const face of FACES) {
      for (const turns of [1, 2, 3] as Turns[]) {
        expect(isSolved(applyMove(solvedFacelets(), { face, turns }))).toBe(false);
      }
    }
  });

  // The real test: agree with the vendored solver's independent model.
  it('matches the vendored solver facelet-for-facelet on random scrambles', () => {
    const rng = makeRng(20260922);

    for (let trial = 0; trial < 300; trial++) {
      const seq = randomSequence(rng, 20);
      const notation = movesToString(seq);

      const ours = faceletsToString(applyMoves(solvedFacelets(), seq));
      const theirs = new Cube().move(notation).asString();

      expect(ours, `disagreement on "${notation}"`).toBe(theirs);
    }
  });

  it('matches the vendored solver for every single move', () => {
    for (const face of FACES) {
      for (const turns of [1, 2, 3] as Turns[]) {
        const move: Move = { face, turns };
        const notation = moveToString(move);
        const ours = faceletsToString(applyMove(solvedFacelets(), move));
        const theirs = new Cube().move(notation).asString();
        expect(ours, `disagreement on "${notation}"`).toBe(theirs);
      }
    }
  });

  it('parses and replays a known sequence identically', () => {
    const notation = "R U R' U' R' F R2 U' R' U' R U R' F'"; // T-perm
    const ours = faceletsToString(applyMoves(solvedFacelets(), parseMoves(notation)));
    const theirs = new Cube().move(notation).asString();
    expect(ours).toBe(theirs);
  });
});
