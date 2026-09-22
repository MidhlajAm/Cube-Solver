/**
 * Reading a 2x2 from camera samples is harder than a 3x3, and for one specific
 * reason: there are no centre stickers. On a 3x3 the six centres hand the
 * classifier six known-correct reference colours before it starts. A 2x2 gives
 * it twenty-four stickers and nothing else, so it has to find the six colours
 * itself and then work out which face is which from the corners.
 */

import { describe, expect, it } from 'vitest';
import { classifyFacelets } from '@/lib/vision/classify';
import { paletteFromFacelets } from '@/lib/vision/palette';
import { rgbToLab, type Rgb } from '@/lib/vision/color';
import type { StickerSample } from '@/lib/vision/sampler';
import { canonicalize } from '@/lib/cube/canonical';
import { applyMoves, isSolved, solvedFacelets } from '@/lib/cube/state';
import { validateFacelets } from '@/lib/cube/validate';
import { solveTwoByTwo } from '@/lib/solver/twoByTwo';
import { FACES, faceletsToString, type Color, type Move, type Turns } from '@/lib/cube/types';

const STICKER_RGB: Record<Color, Rgb> = {
  U: { r: 245, g: 245, b: 245 },
  D: { r: 255, g: 213, b: 0 },
  F: { r: 0, g: 155, b: 72 },
  B: { r: 0, g: 70, b: 173 },
  R: { r: 183, g: 18, b: 52 },
  L: { r: 255, g: 88, b: 0 },
};

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function render(
  facelets: Color[],
  rng: () => number,
  { lighting = 0, noise = 0 }: { lighting?: number; noise?: number } = {},
): StickerSample[] {
  const faceGain = FACES.map(() => 1 + (rng() * 2 - 1) * lighting);
  return facelets.map((color, index) => {
    const base = STICKER_RGB[color];
    const gain = faceGain[Math.floor(index / 4)];
    const jitter = () => (rng() * 2 - 1) * noise;
    const rgb: Rgb = {
      r: Math.max(0, Math.min(255, base.r * gain + jitter())),
      g: Math.max(0, Math.min(255, base.g * gain + jitter())),
      b: Math.max(0, Math.min(255, base.b * gain + jitter())),
    };
    return { rgb, lab: rgbToLab(rgb) };
  });
}

function scrambled(rng: () => number): Color[] {
  const moves: Move[] = Array.from({ length: 12 }, () => ({
    face: FACES[Math.floor(rng() * 6)],
    turns: (Math.floor(rng() * 3) + 1) as Turns,
  }));
  return applyMoves(solvedFacelets(2), moves);
}

describe('classifying a 2x2', () => {
  it('reads a clean cube back exactly, up to the corner it anchors on', () => {
    const rng = makeRng(4242);
    for (let i = 0; i < 40; i++) {
      const truth = scrambled(rng);
      const read = classifyFacelets(render(truth, rng), 2);
      // With no centres, the labels are whatever the anchor corner dictates —
      // so the result should match the truth put through the same anchoring.
      expect(faceletsToString(read.facelets), `cube ${i}`).toBe(
        faceletsToString(canonicalize(truth, 2)!),
      );
    }
  });

  it('holds up under uneven lighting and sensor noise', () => {
    const rng = makeRng(31337);
    let perfect = 0;
    for (let i = 0; i < 40; i++) {
      const truth = scrambled(rng);
      const read = classifyFacelets(render(truth, rng, { lighting: 0.18, noise: 14 }), 2);
      if (faceletsToString(read.facelets) === faceletsToString(canonicalize(truth, 2)!)) perfect++;
    }
    expect(perfect).toBe(40);
  });

  it('produces something the validator accepts and the solver can solve', () => {
    const rng = makeRng(99);
    for (let i = 0; i < 25; i++) {
      const truth = scrambled(rng);
      const read = classifyFacelets(render(truth, rng, { lighting: 0.12, noise: 10 }), 2);

      expect(validateFacelets(read.facelets).ok, `cube ${i} failed validation`).toBe(true);

      const anchored = canonicalize(read.facelets, 2)!;
      const solution = solveTwoByTwo(anchored);
      expect(isSolved(applyMoves(anchored, solution)), `cube ${i} was not solved`).toBe(true);
    }
  });

  it('gives every face a distinct swatch without a centre to read', () => {
    const rng = makeRng(8);
    const truth = scrambled(rng);
    const samples = render(truth, rng, { lighting: 0.15, noise: 10 });
    const read = classifyFacelets(samples, 2);
    const palette = paletteFromFacelets(samples, read.facelets);
    expect(new Set(Object.values(palette)).size).toBe(6);
  });
});
