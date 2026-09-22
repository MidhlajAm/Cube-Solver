/**
 * The engine used to be 3x3-only, with hand-written permutation tables. It is
 * now derived from the cube's geometry so it works at any size — which is only
 * safe if the derived 3x3 tables are identical to the hand-written ones they
 * replaced, since those were themselves cross-checked against the vendored
 * solver over hundreds of scrambles.
 */

import { describe, expect, it } from 'vitest';
import {
  applyMove,
  applyMoves,
  isSolved,
  singmasterSourceIndices,
  sourceIndicesFor,
} from '@/lib/cube/state';
import { geometryFor } from '@/lib/cube/geometry';
import { cornerFaceletsFor, readCorners, totalTwist } from '@/lib/cube/corners';
import { CORNER_FACELETS } from '@/lib/cube/validate';
import { invertMoves } from '@/lib/cube/notation';
import {
  FACES,
  faceletsToString,
  sizeOf,
  solvedFacelets,
  type CubeSize,
  type Move,
  type Turns,
} from '@/lib/cube/types';

const SIZES: CubeSize[] = [2, 3];

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randomMoves(rng: () => number, length: number): Move[] {
  return Array.from({ length }, () => ({
    face: FACES[Math.floor(rng() * 6)],
    turns: (Math.floor(rng() * 3) + 1) as Turns,
  }));
}

describe('the derived engine matches the tables it replaced', () => {
  it('reproduces the hand-written Singmaster permutations exactly', () => {
    for (const face of FACES) {
      expect(sourceIndicesFor(face, 3), `${face} permutation drifted`).toEqual([
        ...singmasterSourceIndices(face),
      ]);
    }
  });

  it('reproduces the hand-written corner facelet table', () => {
    expect(cornerFaceletsFor(3).map((c) => [...c])).toEqual(CORNER_FACELETS.map((c) => [...c]));
  });
});

describe.each(SIZES)('a %ix%i cube', (size) => {
  const solved = solvedFacelets(size);

  it('has the right number of stickers and cubies', () => {
    expect(solved).toHaveLength(6 * size * size);
    expect(sizeOf(solved)).toBe(size);
    // Every cubie except the hidden interior.
    expect(geometryFor(size).cubies).toHaveLength(size ** 3 - (size - 2) ** 3);
  });

  it('starts solved', () => {
    expect(isSolved(solved)).toBe(true);
  });

  it('returns to solved after four quarter turns of any face', () => {
    for (const face of FACES) {
      let state = solved;
      for (let i = 0; i < 4; i++) state = applyMove(state, { face, turns: 1 });
      expect(faceletsToString(state), `${face} x4 is not the identity`).toBe(
        faceletsToString(solved),
      );
    }
  });

  it('is not solved after a single turn', () => {
    for (const face of FACES) {
      expect(isSolved(applyMove(solved, { face, turns: 1 })), `${face} did nothing`).toBe(false);
    }
  });

  it('moves every sticker to a real facelet, losing none', () => {
    for (const face of FACES) {
      const source = sourceIndicesFor(face, size);
      expect(new Set(source).size, `${face} duplicated a facelet`).toBe(source.length);
    }
  });

  it('undoes any scramble with its inverse', () => {
    const rng = makeRng(size * 31 + 7);
    for (let i = 0; i < 50; i++) {
      const moves = randomMoves(rng, 12);
      const scrambled = applyMoves(solved, moves);
      expect(faceletsToString(applyMoves(scrambled, invertMoves(moves)))).toBe(
        faceletsToString(solved),
      );
    }
  });

  it('keeps the corners physically possible under any scramble', () => {
    const rng = makeRng(size * 97 + 3);
    for (let i = 0; i < 50; i++) {
      const scrambled = applyMoves(solved, randomMoves(rng, 14));
      const corners = readCorners(scrambled, size);
      expect(corners, 'a scramble produced an impossible corner').not.toBeNull();
      expect(totalTwist(corners!) % 3, 'corner twist stopped summing to zero').toBe(0);
    }
  });
});

describe('the two sizes stay apart', () => {
  it('refuses a sticker count that is neither', () => {
    expect(() => sizeOf(new Array(30).fill('U'))).toThrow();
  });

  it('picks the engine from the cube it is given, not a default', () => {
    const small = applyMove(solvedFacelets(2), { face: 'U', turns: 1 });
    const big = applyMove(solvedFacelets(3), { face: 'U', turns: 1 });
    expect(small).toHaveLength(24);
    expect(big).toHaveLength(54);
  });
});
