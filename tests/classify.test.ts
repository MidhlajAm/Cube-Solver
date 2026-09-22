/**
 * The classifier is tested against synthetic frames rather than real photos, so
 * the failure modes that matter can be dialled up deliberately: uneven lighting
 * between faces, sensor noise, and the red/orange confusion that breaks naive
 * threshold-based detection.
 */

import { describe, expect, it } from 'vitest';
import { classifyFacelets } from '@/lib/vision/classify';
import { rgbToLab, type Rgb } from '@/lib/vision/color';
import type { StickerSample } from '@/lib/vision/sampler';
import { applyMoves, solvedFacelets } from '@/lib/cube/state';
import { FACES, faceletsToString, type Color, type Move, type Turns } from '@/lib/cube/types';

/** Measured-ish sticker colors from a standard cube. */
const STICKER_RGB: Record<Color, Rgb> = {
  U: { r: 245, g: 245, b: 245 }, // white
  D: { r: 255, g: 213, b: 0 }, // yellow
  F: { r: 0, g: 155, b: 72 }, // green
  B: { r: 0, g: 70, b: 173 }, // blue
  R: { r: 183, g: 18, b: 52 }, // red
  L: { r: 255, g: 88, b: 0 }, // orange
};

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

interface RenderOptions {
  /** Per-face brightness multiplier range, simulating uneven room lighting. */
  lighting?: number;
  /** Per-channel noise amplitude in 0..255. */
  noise?: number;
}

/** Render a cube state into camera-like samples. */
function render(
  facelets: Color[],
  rng: () => number,
  { lighting = 0, noise = 0 }: RenderOptions = {},
): StickerSample[] {
  // One gain per scanned face: each face is photographed separately, so they
  // realistically differ in exposure.
  const faceGain = FACES.map(() => 1 + (rng() * 2 - 1) * lighting);

  return facelets.map((color, index) => {
    const base = STICKER_RGB[color];
    const gain = faceGain[Math.floor(index / 9)];
    const jitter = () => (rng() * 2 - 1) * noise;

    const rgb: Rgb = {
      r: Math.max(0, Math.min(255, base.r * gain + jitter())),
      g: Math.max(0, Math.min(255, base.g * gain + jitter())),
      b: Math.max(0, Math.min(255, base.b * gain + jitter())),
    };
    return { rgb, lab: rgbToLab(rgb) };
  });
}

describe('classifyFacelets', () => {
  it('reads a clean solved cube exactly', () => {
    const rng = makeRng(1);
    const state = solvedFacelets();
    const result = classifyFacelets(render(state, rng));
    expect(faceletsToString(result.facelets)).toBe(faceletsToString(state));
    expect(result.uncertain).toHaveLength(0);
  });

  it('reads scrambled cubes under clean conditions', () => {
    const rng = makeRng(2);
    for (let i = 0; i < 40; i++) {
      const state = applyMoves(solvedFacelets(), randomSequence(rng, 25));
      const result = classifyFacelets(render(state, rng));
      expect(faceletsToString(result.facelets)).toBe(faceletsToString(state));
    }
  });

  it('survives uneven lighting and sensor noise', () => {
    const rng = makeRng(3);
    let perfect = 0;
    const trials = 40;

    for (let i = 0; i < trials; i++) {
      const state = applyMoves(solvedFacelets(), randomSequence(rng, 25));
      const samples = render(state, rng, { lighting: 0.18, noise: 14 });
      const result = classifyFacelets(samples);
      if (faceletsToString(result.facelets) === faceletsToString(state)) perfect++;
    }

    expect(perfect, `${perfect}/${trials} cubes read perfectly`).toBe(trials);
  });

  it('always returns exactly nine of each color, even on garbage input', () => {
    const rng = makeRng(4);
    // Pure noise: no real cube in front of the camera at all.
    const samples: StickerSample[] = Array.from({ length: 54 }, () => {
      const rgb = { r: rng() * 255, g: rng() * 255, b: rng() * 255 };
      return { rgb, lab: rgbToLab(rgb) };
    });

    const result = classifyFacelets(samples);
    for (const face of FACES) {
      expect(result.facelets.filter((c) => c === face)).toHaveLength(9);
    }
  });

  it('pins every center to its own face', () => {
    const rng = makeRng(5);
    const state = applyMoves(solvedFacelets(), randomSequence(rng, 25));
    const result = classifyFacelets(render(state, rng, { lighting: 0.2, noise: 20 }));
    FACES.forEach((face, i) => {
      expect(result.facelets[i * 9 + 4]).toBe(face);
    });
  });

  it('distinguishes red from orange, the classic failure case', () => {
    const rng = makeRng(6);
    // A cube showing only red and orange on the faces that face the camera.
    const state = applyMoves(solvedFacelets(), randomSequence(rng, 25));
    const samples = render(state, rng, { lighting: 0.15, noise: 12 });
    const result = classifyFacelets(samples);

    const redIndices = state
      .map((c, i) => (c === 'R' ? i : -1))
      .filter((i) => i >= 0);
    for (const index of redIndices) {
      expect(result.facelets[index], `sticker ${index} should be red`).toBe('R');
    }
  });

  it('flags low-confidence stickers when two colors really are ambiguous', () => {
    const rng = makeRng(7);
    const state = solvedFacelets();
    const samples = render(state, rng);

    // Push one orange sticker most of the way toward red.
    const target = 36; // an L-face (orange) sticker
    const midway: Rgb = { r: 219, g: 53, b: 26 };
    samples[target] = { rgb: midway, lab: rgbToLab(midway) };

    const result = classifyFacelets(samples);
    expect(result.confidence[target]).toBeLessThan(0.5);
  });
});
