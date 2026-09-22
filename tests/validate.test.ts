/**
 * The validator is the gate in front of the solver, so it has to be right in
 * both directions: never reject a real cube, never accept an impossible one.
 */

import { describe, expect, it } from 'vitest';
import { applyMoves, solvedFacelets } from '@/lib/cube/state';
import { validateFacelets } from '@/lib/cube/validate';
import { CENTER_INDEX, faceletsFromString, FACES, type Facelets, type Move, type Turns } from '@/lib/cube/types';
import { Cube } from './helpers/vendorSolver';

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randomSequence(rng: () => number, length: number): Move[] {
  return Array.from({ length }, () => ({
    face: FACES[Math.floor(rng() * FACES.length)],
    turns: (Math.floor(rng() * 3) + 1) as Turns,
  }));
}

describe('validateFacelets — accepts real cubes', () => {
  it('accepts the solved cube', () => {
    expect(validateFacelets(solvedFacelets()).ok).toBe(true);
  });

  it('accepts 500 cubes reachable by turning', () => {
    const rng = makeRng(99);
    for (let i = 0; i < 500; i++) {
      const state = applyMoves(solvedFacelets(), randomSequence(rng, 25));
      const result = validateFacelets(state);
      expect(result.ok, `rejected a reachable cube: ${result.issues.map((x) => x.message).join('; ')}`).toBe(true);
    }
  });

  it("accepts the solver's own random cubes", () => {
    for (let i = 0; i < 200; i++) {
      const facelets = faceletsFromString(Cube.random().asString());
      const result = validateFacelets(facelets);
      expect(result.ok, `rejected: ${result.issues.map((x) => x.message).join('; ')}`).toBe(true);
    }
  });
});

describe('validateFacelets — rejects impossible cubes', () => {
  it('rejects a wrong color count', () => {
    const state = solvedFacelets();
    state[0] = 'R'; // ten reds, eight whites
    const result = validateFacelets(state);
    expect(result.ok).toBe(false);
    expect(result.issues[0].kind).toBe('color-count');
    expect(result.badIndices.length).toBeGreaterThan(0);
  });

  it('rejects duplicate centers', () => {
    // Two faces claiming the same center color, with the sticker counts kept
    // at nine each so the count check cannot be what catches it.
    const state = solvedFacelets();
    state[CENTER_INDEX.L] = 'B'; // L center now blue
    state[47] = 'L'; // a non-center B sticker becomes orange to keep counts
    const result = validateFacelets(state);
    expect(result.ok).toBe(false);
    expect(result.issues[0].kind).toBe('center-duplicate');
    expect(result.issues[0].message).toMatch(/same center color/i);
  });

  it('rejects centers transposed by scanning faces out of order', () => {
    // Centers are all distinct, but L and B are swapped — an arrangement no
    // real cube can show, and a plausible mis-scan.
    const state = solvedFacelets();
    state[CENTER_INDEX.L] = 'B';
    state[CENTER_INDEX.B] = 'L';
    const result = validateFacelets(state);
    expect(result.ok).toBe(false);
    expect(result.issues[0].kind).toBe('center-duplicate');
    expect(result.issues[0].message).toMatch(/scanned in the order/i);
  });

  it('rejects a single twisted corner', () => {
    // Rotate the stickers of one corner in place: counts stay correct, every
    // piece still exists, but the orientation sum is no longer divisible by 3.
    const state = solvedFacelets();
    const [a, b, c] = [8, 9, 20]; // the URF corner
    const tmp = state[a];
    state[a] = state[c];
    state[c] = state[b];
    state[b] = tmp;

    const result = validateFacelets(state);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.kind === 'corner-twist')).toBe(true);
  });

  it('rejects a single flipped edge', () => {
    const state = solvedFacelets();
    const [a, b] = [5, 10]; // the UR edge
    const tmp = state[a];
    state[a] = state[b];
    state[b] = tmp;

    const result = validateFacelets(state);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.kind === 'edge-flip')).toBe(true);
  });

  it('rejects two swapped edges (parity)', () => {
    const state = solvedFacelets();
    // Swap the UR and UF edges wholesale. Every piece still exists exactly
    // once and all orientations are fine — only parity gives it away.
    const ur: [number, number] = [5, 10];
    const uf: [number, number] = [7, 19];
    for (let i = 0; i < 2; i++) {
      const tmp = state[ur[i]];
      state[ur[i]] = state[uf[i]];
      state[uf[i]] = tmp;
    }

    const result = validateFacelets(state);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.kind === 'permutation-parity')).toBe(true);
  });

  it('rejects an impossible corner (white next to yellow)', () => {
    const state = solvedFacelets();
    state[8] = 'D'; // URF corner now has both a white-face and yellow sticker
    state[27] = 'U'; // keep the counts balanced
    const result = validateFacelets(state);
    expect(result.ok).toBe(false);
  });

  it('rejects the all-one-color pattern the solver would silently accept', () => {
    const state = Array<'U'>(54).fill('U') as Facelets;
    const result = validateFacelets(state);
    expect(result.ok).toBe(false);
    expect(result.issues[0].kind).toBe('color-count');
  });

  it('points at specific stickers so the editor can highlight them', () => {
    const state = solvedFacelets();
    state[0] = 'R';
    const result = validateFacelets(state);
    expect(result.badIndices).toContain(0);
  });
});
