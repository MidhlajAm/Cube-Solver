/**
 * End-to-end check of the vendored Kociemba solver.
 *
 * Every solution it returns is replayed through our own facelet engine — code
 * written from completely different first principles — and the cube must end
 * solved. That cross-validates both: the solver cannot be wrong in a way our
 * engine happens to mirror, and vice versa.
 */

import { describe, expect, it } from 'vitest';
import { Cube, initSolver } from './helpers/vendorSolver';
import { applyMoves, isSolved, solvedFacelets } from '@/lib/cube/state';
import { parseMoves } from '@/lib/cube/notation';
import { faceletsFromString, faceletsToString } from '@/lib/cube/types';
import { validateFacelets } from '@/lib/cube/validate';

const SAMPLE_SIZE = 200;

describe('Kociemba solver', () => {
  it(`solves ${SAMPLE_SIZE} random cubes, verified by our own move engine`, () => {
    initSolver();

    let longest = 0;
    let slowest = 0;

    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const cube = Cube.random();
      const facelets = faceletsFromString(cube.asString());

      // Anything the solver is handed must first pass our validator.
      expect(validateFacelets(facelets).ok, `generated an invalid cube at ${i}`).toBe(true);

      const started = Date.now();
      const notation = cube.solve();
      slowest = Math.max(slowest, Date.now() - started);

      const moves = parseMoves(notation);
      longest = Math.max(longest, moves.length);

      const result = applyMoves(facelets, moves);
      expect(
        isSolved(result),
        `solution "${notation}" did not solve ${faceletsToString(facelets)}`,
      ).toBe(true);
    }

    // God's number is 20; this solver is capped at a depth of 22.
    expect(longest).toBeLessThanOrEqual(22);
    // Not a benchmark, just a guard against a pathological regression.
    expect(slowest).toBeLessThan(10_000);
  });

  // Documents a quirk worth knowing: asked to solve an already-solved cube,
  // the two-phase search does not return nothing — it returns a sequence that
  // cancels itself out. The store short-circuits this case so the user is not
  // shown a dozen moves that do nothing (see cubeStore.solve).
  it('returns a self-cancelling sequence for an already-solved cube', () => {
    initSolver();
    const solution = new Cube().solve();
    const moves = parseMoves(solution);

    expect(moves.length).toBeGreaterThan(0);
    expect(isSolved(applyMoves(solvedFacelets(), moves))).toBe(true);
  });

  it('agrees with our engine about what "solved" means', () => {
    expect(new Cube().asString()).toBe(faceletsToString(solvedFacelets()));
  });
});
