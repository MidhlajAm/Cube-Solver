/**
 * The scan decides what colour each face is drawn in, because the user starts
 * on whichever face they like. If this picked badly, the net they are asked to
 * check against their cube would not match it — the one thing the verify step
 * exists to make possible.
 */

import { describe, expect, it } from 'vitest';
import { paletteFromCenters } from '@/lib/vision/palette';
import { FACES, FACE_COLORS, type Face } from '@/lib/cube/types';
import type { Rgb } from '@/lib/vision/color';

function rgb(hex: string): Rgb {
  const v = hex.replace('#', '');
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

/** Roughly what a camera sees for each colour, not the exact display values. */
const SCANNED = {
  white: rgb('#e8e9e4'),
  red: rgb('#b02a24'),
  green: rgb('#1f8a44'),
  yellow: rgb('#e4c72c'),
  orange: rgb('#d9691f'),
  blue: rgb('#2352a8'),
};

describe('display palette', () => {
  it('falls back to the classic scheme when nothing was scanned', () => {
    expect(paletteFromCenters({})).toEqual(FACE_COLORS);
  });

  it('recovers the classic scheme from a classic-scheme scan', () => {
    const palette = paletteFromCenters({
      U: SCANNED.white,
      R: SCANNED.red,
      F: SCANNED.green,
      D: SCANNED.yellow,
      L: SCANNED.orange,
      B: SCANNED.blue,
    });
    expect(palette).toEqual(FACE_COLORS);
  });

  it('follows the cube when the user starts on a different face', () => {
    // Started on the blue face, so "front" really is blue and "up" is orange.
    const palette = paletteFromCenters({
      U: SCANNED.orange,
      R: SCANNED.yellow,
      F: SCANNED.blue,
      D: SCANNED.red,
      L: SCANNED.white,
      B: SCANNED.green,
    });

    expect(palette.F).toBe(FACE_COLORS.B); // blue
    expect(palette.U).toBe(FACE_COLORS.L); // orange
    expect(palette.R).toBe(FACE_COLORS.D); // yellow
    expect(palette.D).toBe(FACE_COLORS.R); // red
    expect(palette.L).toBe(FACE_COLORS.U); // white
    expect(palette.B).toBe(FACE_COLORS.F); // green
  });

  it('handles the mirrored colour scheme, which the old instructions could not', () => {
    // Same cube family, red and orange swapped relative to the classic scheme.
    const palette = paletteFromCenters({
      U: SCANNED.white,
      R: SCANNED.orange,
      F: SCANNED.green,
      D: SCANNED.yellow,
      L: SCANNED.red,
      B: SCANNED.blue,
    });
    expect(palette.R).toBe(FACE_COLORS.L); // orange
    expect(palette.L).toBe(FACE_COLORS.R); // red
  });

  it('never gives two faces the same swatch, however alike the scan looked', () => {
    // A dim, washed-out scan where red and orange came back nearly identical.
    const palette = paletteFromCenters({
      U: rgb('#b9b6b0'),
      R: rgb('#8e4030'),
      F: rgb('#3f6b4a'),
      D: rgb('#b6a83a'),
      L: rgb('#8e4632'),
      B: rgb('#33496f'),
    });
    expect(new Set(Object.values(palette)).size).toBe(6);
  });

  it('returns a swatch for every face', () => {
    const palette = paletteFromCenters({ F: SCANNED.blue });
    for (const face of FACES as readonly Face[]) {
      expect(palette[face]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
