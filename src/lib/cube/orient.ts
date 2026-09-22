/**
 * Recovering from a mis-held face.
 *
 * Scanning only fixes two of the three axes: pointing a face at the camera
 * still leaves the question of which way up it was held. Get that wrong by a
 * quarter turn and all nine stickers land in the wrong slots, producing a cube
 * that is not merely misread but *physically impossible* — and the resulting
 * error ("this corner can't exist") reads as though the colors were wrong,
 * which sends the user off correcting stickers that were never wrong.
 *
 * The saving grace is that the mistake is drawn from a very small set: each
 * face is off by 0, 1, 2 or 3 quarter turns, so there are only 4^6 = 4096
 * possible scans behind any given reading. That is small enough to simply try
 * them all and keep the one that is a real cube.
 */

import {
  FACES,
  faceOffsetFor,
  faceletCountFor,
  sizeOf,
  stickersPerFace,
  type CubeSize,
  type Face,
  type Facelets,
} from './types';
import { validateFacelets } from './validate';

/** Number of distinct ways a single face can have been held. */
const ORIENTATIONS = 4;

/**
 * Rotate one face's nine stickers a quarter turn clockwise, as seen by the
 * camera. Reading row-major, the sticker landing at (row, column) came from
 * (2 - column, row).
 */
export function rotateFaceStickers<T>(values: readonly T[], face: Face, quarters: number): T[] {
  const turns = ((quarters % ORIENTATIONS) + ORIENTATIONS) % ORIENTATIONS;
  if (turns === 0) return [...values];

  const size = sizeOf(values);
  const perFace = stickersPerFace(size);
  const out = [...values];
  const base = faceOffsetFor(face, size);

  for (let t = 0; t < turns; t++) {
    const before = out.slice(base, base + perFace);
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        out[base + row * size + column] = before[(size - 1 - column) * size + row];
      }
    }
  }
  return out;
}

/**
 * Apply a set of face rotations to any per-facelet array.
 *
 * Confidence scores are indexed by facelet too, so they have to travel with
 * the stickers — otherwise a straightened face would carry another face's
 * uncertainty and the net would ring the wrong squares.
 */
export function applyQuarters<T>(values: readonly T[], quarters: Record<Face, number>): T[] {
  let out = [...values];
  for (const face of FACES) {
    if (quarters[face] !== 0) out = rotateFaceStickers(out, face, quarters[face]);
  }
  return out;
}

/**
 * Where each facelet ends up under a repair: `mapIndices(q)[oldIndex]` is the
 * index that sticker occupies afterwards.
 */
export function mapIndices(quarters: Record<Face, number>, size: CubeSize): number[] {
  const count = faceletCountFor(size);
  const source = applyQuarters(
    Array.from({ length: count }, (_, i) => i),
    quarters,
  );
  const destination = new Array<number>(count).fill(0);
  source.forEach((from, to) => {
    destination[from] = to;
  });
  return destination;
}

export interface OrientationRepair {
  /** The corrected cube. */
  facelets: Facelets;
  /** Quarter turns applied to each face. */
  quarters: Record<Face, number>;
  /** The faces that actually needed turning; empty when the scan was fine. */
  corrected: Face[];
}

/**
 * Find the smallest set of face rotations that turns a scan into a real cube.
 *
 * Prefers leaving faces alone: candidates are tried in order of how many faces
 * they disturb, so a scan that only needs one face straightened is never
 * "fixed" by spinning four of them. Returns null when no combination works,
 * which means the colors themselves were misread and no amount of re-orienting
 * will help.
 */
export function repairOrientation(facelets: Facelets): OrientationRepair | null {
  const none: Record<Face, number> = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 };
  if (validateFacelets(facelets).ok) {
    return { facelets, quarters: none, corrected: [] };
  }

  // Enumerate every combination as a base-4 number, then sort by how many
  // faces it touches so the least invasive repair wins.
  const total = ORIENTATIONS ** FACES.length;
  const candidates: { code: number; disturbed: number }[] = [];
  for (let code = 1; code < total; code++) {
    let disturbed = 0;
    for (let i = 0; i < FACES.length; i++) {
      if (Math.floor(code / ORIENTATIONS ** i) % ORIENTATIONS !== 0) disturbed++;
    }
    candidates.push({ code, disturbed });
  }
  candidates.sort((a, b) => a.disturbed - b.disturbed || a.code - b.code);

  for (const { code } of candidates) {
    const quarters = { ...none };
    let candidate = facelets;
    FACES.forEach((face, i) => {
      const turns = Math.floor(code / ORIENTATIONS ** i) % ORIENTATIONS;
      quarters[face] = turns;
      if (turns !== 0) candidate = rotateFaceStickers(candidate, face, turns);
    });

    if (validateFacelets(candidate).ok) {
      return {
        facelets: candidate,
        quarters,
        corrected: FACES.filter((face) => quarters[face] !== 0),
      };
    }
  }

  return null;
}
