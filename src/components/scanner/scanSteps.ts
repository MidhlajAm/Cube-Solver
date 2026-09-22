/**
 * The guided scanning order.
 *
 * Which face the camera sees only fixes two of the three axes — the third is
 * how the cube is rolled, and getting it wrong silently rotates nine stickers
 * into the wrong facelet slots. So each step also names the color that must be
 * at the *top of the screen*, which pins the orientation completely (the camera
 * always looks at a face from outside, so "which way is up" is the only
 * remaining freedom).
 *
 * These directions are derived from the net layout in lib/cube/geometry.ts and
 * are verified against it in tests/scanSteps.test.ts.
 */

import { FACE_COLOR_NAMES, type Face } from '@/lib/cube/types';

export interface ScanStep {
  /** The face being captured. */
  face: Face;
  /** The face whose color must appear at the top of the camera view. */
  topFace: Face;
}

/**
 * Faces are captured in solver order (U, R, F, D, L, B) so the samples line up
 * with facelet indices without any reshuffling.
 */
export const SCAN_STEPS: readonly ScanStep[] = [
  { face: 'U', topFace: 'B' },
  { face: 'R', topFace: 'U' },
  { face: 'F', topFace: 'U' },
  { face: 'D', topFace: 'F' },
  { face: 'L', topFace: 'U' },
  { face: 'B', topFace: 'U' },
];

/** One-line instruction for a step, in colors rather than cube notation. */
export function instructionFor(step: ScanStep): string {
  return `Show the ${FACE_COLOR_NAMES[step.face]} face, with ${FACE_COLOR_NAMES[step.topFace]} at the top`;
}
