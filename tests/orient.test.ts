/**
 * Holding a face the wrong way up is the single easiest mistake to make while
 * scanning, and the hardest to diagnose from the error it causes. These tests
 * pin down that the app can undo it by itself.
 */

import { describe, expect, it } from 'vitest';
import { Cube } from './helpers/vendorSolver';
import { repairOrientation, rotateFaceStickers } from '@/lib/cube/orient';
import { validateFacelets } from '@/lib/cube/validate';
import { faceletsFromString, faceletsToString, FACES, type Face } from '@/lib/cube/types';

function randomCube() {
  return faceletsFromString(Cube.random().asString());
}

describe('face rotation', () => {
  it('returns to the start after four quarter turns', () => {
    const cube = randomCube();
    for (const face of FACES) {
      expect(faceletsToString(rotateFaceStickers(cube, face, 4))).toBe(faceletsToString(cube));
    }
  });

  it('leaves the centre and the other five faces alone', () => {
    const cube = randomCube();
    const turned = rotateFaceStickers(cube, 'F', 1);
    expect(turned[22]).toBe(cube[22]);
    for (const face of FACES) {
      if (face === 'F') continue;
      const base = FACES.indexOf(face) * 9;
      expect(turned.slice(base, base + 9)).toEqual(cube.slice(base, base + 9));
    }
  });

  it('moves the top-left sticker to the top-right', () => {
    const cube = randomCube();
    const turned = rotateFaceStickers(cube, 'U', 1);
    expect(turned[2]).toBe(cube[0]);
  });
});

describe('orientation repair', () => {
  it('leaves a good scan untouched', () => {
    const cube = randomCube();
    const repair = repairOrientation(cube);
    expect(repair).not.toBeNull();
    expect(repair!.corrected).toEqual([]);
    expect(faceletsToString(repair!.facelets)).toBe(faceletsToString(cube));
  });

  it('undoes a single mis-held face', () => {
    for (let i = 0; i < 20; i++) {
      const cube = randomCube();
      const face = FACES[i % FACES.length];
      const turns = (i % 3) + 1;
      const misheld = rotateFaceStickers(cube, face, turns);

      // Precondition: this really is the failure the user sees.
      expect(validateFacelets(misheld).ok, `${face} x${turns} stayed valid`).toBe(false);

      const repair = repairOrientation(misheld);
      expect(repair, `${face} x${turns} was unrepairable`).not.toBeNull();
      expect(validateFacelets(repair!.facelets).ok).toBe(true);
      expect(faceletsToString(repair!.facelets)).toBe(faceletsToString(cube));
      expect(repair!.corrected).toEqual([face]);
    }
  });

  it('undoes two mis-held faces', () => {
    for (let i = 0; i < 10; i++) {
      const cube = randomCube();
      const a: Face = FACES[i % 6];
      const b: Face = FACES[(i + 2) % 6];
      const misheld = rotateFaceStickers(rotateFaceStickers(cube, a, 1), b, 3);

      const repair = repairOrientation(misheld);
      expect(repair, `${a}/${b} was unrepairable`).not.toBeNull();
      expect(validateFacelets(repair!.facelets).ok).toBe(true);
    }
  });

  it('gives up on a cube whose colours were genuinely misread', () => {
    const cube = randomCube();
    // Swap two stickers of different colours on the same face: no rotation of
    // any face can undo it, because it is not a rotation.
    const broken = [...cube];
    const a = broken.findIndex((c, i) => i % 9 !== 4 && c !== broken[0]);
    [broken[0], broken[a]] = [broken[a], broken[0]];

    if (validateFacelets(broken).ok) return; // degenerate draw; nothing to prove
    expect(repairOrientation(broken)).toBeNull();
  });

  it('searches the whole space fast enough to run inline', () => {
    const cube = rotateFaceStickers(randomCube(), 'B', 2);
    const started = Date.now();
    repairOrientation(cube);
    // Worst case is all 4096 combinations; this must not block the UI.
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
