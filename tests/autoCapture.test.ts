/**
 * Auto-capture takes the shot on its own, so the two judgements it makes have
 * to be right: that the view has settled, and that this is not a face already
 * in the bag. Getting the second wrong is the expensive one — two copies of the
 * same face make a cube with ten of one colour, which only shows up much later
 * as "this cannot be solved".
 */

import { describe, expect, it } from 'vitest';
import {
  CENTRE_MATCH_DISTANCE,
  STEADY_FRAMES,
  isLitWellEnough,
  isSteady,
  matchCapturedFace,
  steadiness,
} from '@/lib/vision/autoCapture';
import { rgbToLab, type Rgb } from '@/lib/vision/color';
import type { StickerSample } from '@/lib/vision/sampler';
import type { Color, Face } from '@/lib/cube/types';

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

/** Photograph one face: nine sticker colours, with exposure and sensor noise. */
function shoot(
  colors: Color[],
  rng: () => number,
  { gain = 1, noise = 4 }: { gain?: number; noise?: number } = {},
): StickerSample[] {
  return colors.map((color) => {
    const base = STICKER_RGB[color];
    const jitter = () => (rng() * 2 - 1) * noise;
    const rgb: Rgb = {
      r: Math.max(0, Math.min(255, base.r * gain + jitter())),
      g: Math.max(0, Math.min(255, base.g * gain + jitter())),
      b: Math.max(0, Math.min(255, base.b * gain + jitter())),
    };
    return { rgb, lab: rgbToLab(rgb) };
  });
}

/** A face with the given centre and a plausible scramble around it. */
const WHITE_FACE: Color[] = ['R', 'F', 'B', 'D', 'U', 'L', 'F', 'B', 'R'];
const GREEN_FACE: Color[] = ['U', 'L', 'D', 'B', 'F', 'R', 'D', 'U', 'L'];
const RED_FACE: Color[] = ['B', 'D', 'U', 'F', 'R', 'L', 'U', 'B', 'D'];
const ORANGE_FACE: Color[] = ['B', 'D', 'U', 'F', 'L', 'R', 'U', 'B', 'D'];

function still(colors: Color[], rng: () => number, count: number): StickerSample[][] {
  return Array.from({ length: count }, () => shoot(colors, rng));
}

describe('holding still', () => {
  it('is not satisfied before enough frames have been seen', () => {
    const rng = makeRng(1);
    expect(isSteady(still(WHITE_FACE, rng, STEADY_FRAMES - 1))).toBe(false);
    expect(steadiness([])).toBe(0);
  });

  it('settles once the cube stops moving', () => {
    const rng = makeRng(2);
    const frames = still(WHITE_FACE, rng, STEADY_FRAMES);
    expect(steadiness(frames)).toBe(1);
    expect(isSteady(frames)).toBe(true);
  });

  it('resets the moment the cube is turned', () => {
    const rng = makeRng(3);
    // Settled on one face, then turned to another: the newest frame no longer
    // agrees with the run before it.
    const frames = [...still(WHITE_FACE, rng, STEADY_FRAMES), shoot(GREEN_FACE, rng)];
    expect(isSteady(frames)).toBe(false);
    expect(steadiness(frames)).toBeCloseTo(1 / STEADY_FRAMES, 5);
  });

  it('builds back up over successive settled frames', () => {
    const rng = makeRng(4);
    const seen: StickerSample[][] = [shoot(GREEN_FACE, rng)];
    const progress: number[] = [];
    for (let i = 0; i < STEADY_FRAMES; i++) {
      seen.push(shoot(WHITE_FACE, rng));
      progress.push(steadiness(seen));
    }
    // Monotonically rising, reaching 1 exactly when the run is long enough.
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('tolerates sensor noise but not a moved cube', () => {
    const rng = makeRng(5);
    expect(isSteady(still(WHITE_FACE, rng, STEADY_FRAMES))).toBe(true);

    const drifting = Array.from({ length: STEADY_FRAMES }, (_, i) =>
      shoot(WHITE_FACE, rng, { gain: 1 - i * 0.12 }),
    );
    expect(isSteady(drifting)).toBe(false);
  });
});

describe('lighting check', () => {
  it('accepts a normally lit face', () => {
    expect(isLitWellEnough(shoot(WHITE_FACE, makeRng(6)))).toBe(true);
    expect(isLitWellEnough(shoot(GREEN_FACE, makeRng(6)))).toBe(true);
  });

  it('rejects a covered lens', () => {
    expect(isLitWellEnough(shoot(WHITE_FACE, makeRng(7), { gain: 0.03, noise: 1 }))).toBe(false);
  });
});

describe('spotting a face already scanned', () => {
  it('finds nothing when nothing has been captured', () => {
    expect(matchCapturedFace(shoot(WHITE_FACE, makeRng(8)), {})).toBeNull();
  });

  it('recognises the same face a moment later', () => {
    const rng = makeRng(9);
    const captured: Partial<Record<Face, StickerSample[]>> = {
      F: shoot(WHITE_FACE, rng),
    };
    expect(matchCapturedFace(shoot(WHITE_FACE, rng), captured)).toBe('F');
  });

  it('recognises it even if the cube has been rolled a quarter turn', () => {
    const rng = makeRng(10);
    const captured: Partial<Record<Face, StickerSample[]>> = {
      F: shoot(WHITE_FACE, rng),
    };
    // Same stickers, read starting from a different corner.
    const rolled: Color[] = [
      WHITE_FACE[6], WHITE_FACE[3], WHITE_FACE[0],
      WHITE_FACE[7], WHITE_FACE[4], WHITE_FACE[1],
      WHITE_FACE[8], WHITE_FACE[5], WHITE_FACE[2],
    ];
    expect(matchCapturedFace(shoot(rolled, rng), captured)).toBe('F');
  });

  it('lets a genuinely new face through', () => {
    const rng = makeRng(11);
    const captured: Partial<Record<Face, StickerSample[]>> = {
      F: shoot(WHITE_FACE, rng),
      R: shoot(GREEN_FACE, rng),
    };
    expect(matchCapturedFace(shoot(RED_FACE, rng), captured)).toBeNull();
  });

  it('does not mistake the orange face for the red one', () => {
    const rng = makeRng(12);
    const captured: Partial<Record<Face, StickerSample[]>> = {
      F: shoot(RED_FACE, rng),
    };
    // These two differ only in their centre, which is the hardest pair of
    // colours on the cube to tell apart.
    expect(matchCapturedFace(shoot(ORANGE_FACE, rng), captured)).toBeNull();
  });

  it('still recognises a face photographed under changed exposure', () => {
    const rng = makeRng(13);
    const captured: Partial<Record<Face, StickerSample[]>> = {
      B: shoot(GREEN_FACE, rng, { gain: 1 }),
    };
    expect(matchCapturedFace(shoot(GREEN_FACE, rng, { gain: 0.92 }), captured)).toBe('B');
  });

  it('keeps red and orange centres comfortably outside the match threshold', () => {
    // The whole duplicate check rests on centres being far apart; if this pair
    // ever came close, the scanner would start refusing a real face.
    const red = rgbToLab(STICKER_RGB.R);
    const orange = rgbToLab(STICKER_RGB.L);
    const distance = Math.sqrt(
      ((red.l - orange.l) * 0.5) ** 2 + (red.a - orange.a) ** 2 + (red.b - orange.b) ** 2,
    );
    expect(distance).toBeGreaterThan(CENTRE_MATCH_DISTANCE * 2);
  });
});
