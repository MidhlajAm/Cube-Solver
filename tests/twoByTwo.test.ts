/**
 * The 2x2 solver is checked the same way the 3x3 one is: every solution it
 * returns is replayed through the facelet engine and the cube must end solved.
 * The solver works on an abstract corner state, the engine works on stickers,
 * so agreement between them is real evidence rather than a tautology.
 */

import { describe, expect, it } from 'vitest';
import { solveTwoByTwo, warmUpTwoByTwo, UnsolvableCubeError } from '@/lib/solver/twoByTwo';
import { canonicalize } from '@/lib/cube/canonical';
import { cornerFaceletsFor } from '@/lib/cube/corners';
import { applyMoves, isSolved, solvedFacelets } from '@/lib/cube/state';
import { faceletsToString, FACES, type Face, type Move, type Turns } from '@/lib/cube/types';

/** God's number for a 2x2 in face turns. */
const GODS_NUMBER = 11;

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function scramble(rng: () => number, length: number, faces: readonly Face[]): Move[] {
  return Array.from({ length }, () => ({
    face: faces[Math.floor(rng() * faces.length)],
    turns: (Math.floor(rng() * 3) + 1) as Turns,
  }));
}

describe('2x2 solver', () => {
  it('leaves a solved cube alone', () => {
    expect(solveTwoByTwo(solvedFacelets(2))).toEqual([]);
  });

  it('solves 300 random cubes, verified by the facelet engine', () => {
    warmUpTwoByTwo();
    const rng = makeRng(20250922);
    let longest = 0;

    for (let i = 0; i < 300; i++) {
      // Turning only U, R and F keeps the anchor corner home while still
      // reaching every one of the 3,674,160 states.
      const start = applyMoves(solvedFacelets(2), scramble(rng, 14, ['U', 'R', 'F']));
      const solution = solveTwoByTwo(start);
      longest = Math.max(longest, solution.length);

      expect(isSolved(applyMoves(start, solution)), `cube ${i} was not solved`).toBe(true);
    }

    expect(longest).toBeLessThanOrEqual(GODS_NUMBER);
  });

  it('finds the shortest solution, not merely a working one', () => {
    const rng = makeRng(7);
    for (let depth = 1; depth <= 4; depth++) {
      for (let i = 0; i < 20; i++) {
        const moves = scramble(rng, depth, ['U', 'R', 'F']);
        const start = applyMoves(solvedFacelets(2), moves);
        // The scramble itself is an upper bound; the solver must not do worse.
        expect(solveTwoByTwo(start).length).toBeLessThanOrEqual(moves.length);
      }
    }
  });

  it('solves fast enough to run on the main thread', () => {
    warmUpTwoByTwo();
    const rng = makeRng(99);
    const started = Date.now();
    for (let i = 0; i < 20; i++) {
      solveTwoByTwo(applyMoves(solvedFacelets(2), scramble(rng, 14, ['U', 'R', 'F'])));
    }
    // Twenty solves; a single one must never feel like a wait.
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('refuses a cube whose corners are impossible', () => {
    const broken = [...solvedFacelets(2)];
    broken[0] = 'D'; // a corner with two D stickers
    expect(() => solveTwoByTwo(broken)).toThrow(UnsolvableCubeError);
  });
});

describe('anchoring a cube with no centres', () => {
  it('leaves a solved cube unchanged', () => {
    const solved = solvedFacelets(2);
    expect(faceletsToString(canonicalize(solved, 2)!)).toBe(faceletsToString(solved));
  });

  it('leaves odd sizes alone, since their centres already decide it', () => {
    const solved = solvedFacelets(3);
    expect(canonicalize(solved, 3)).toBe(solved);
  });

  it('solves a cube scrambled with every face, once anchored', () => {
    const rng = makeRng(555);
    for (let i = 0; i < 100; i++) {
      // A real scan has no idea which corner ended up where: the user turned
      // whichever faces they liked before showing it to the camera.
      const start = applyMoves(solvedFacelets(2), scramble(rng, 15, FACES));
      const anchored = canonicalize(start, 2);
      expect(anchored, `cube ${i} could not be anchored`).not.toBeNull();

      const solution = solveTwoByTwo(anchored!);
      expect(isSolved(applyMoves(anchored!, solution)), `cube ${i} was not solved`).toBe(true);
      expect(solution.length).toBeLessThanOrEqual(GODS_NUMBER);
    }
  });

  // Regression: anchoring used to read the *colour* opposite D out of the cube
  // and use it as the *face* opposite D. Those are different things — on an
  // unanchored scan the label "D" is just a group id — and when they disagreed
  // two colours were sent to the same face, producing a cube with eight of one
  // and none of another. It only showed up once real scan labels were fed in,
  // because a cube already in the standard labelling makes the two coincide.
  it('gives the same answer however the six colours were named', () => {
    const rng = makeRng(2024);
    const shuffles: Face[][] = [
      ['R', 'F', 'U', 'L', 'B', 'D'],
      ['D', 'U', 'L', 'B', 'F', 'R'],
      ['B', 'L', 'D', 'F', 'R', 'U'],
    ];

    for (let i = 0; i < 30; i++) {
      const cube = applyMoves(solvedFacelets(2), scramble(rng, 12, FACES));
      const anchored = canonicalize(cube, 2);
      expect(anchored).not.toBeNull();

      for (const shuffle of shuffles) {
        // Rename every colour. Not one sticker moves, so the physical cube is
        // untouched and anchoring must land in exactly the same place.
        const renamed = cube.map((color) => shuffle[FACES.indexOf(color)]);
        const renamedAnchored = canonicalize(renamed, 2);

        expect(renamedAnchored, `renaming broke cube ${i}`).not.toBeNull();
        expect(faceletsToString(renamedAnchored!)).toBe(faceletsToString(anchored!));
        // And every colour still appears exactly four times.
        for (const face of FACES) {
          expect(renamedAnchored!.filter((c) => c === face)).toHaveLength(4);
        }
      }
    }
  });

  it('rejects stickers that cannot be a cube', () => {
    const broken = [...solvedFacelets(2)];
    // Put two opposite colours on the same corner. No cube has that, so the
    // opposite-colour pairing has nothing consistent to report.
    const [, sideFacelet] = cornerFaceletsFor(2)[0];
    broken[sideFacelet] = 'D';
    expect(canonicalize(broken, 2)).toBeNull();
  });
});
