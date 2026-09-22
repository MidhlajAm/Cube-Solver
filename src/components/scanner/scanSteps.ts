/**
 * The guided scanning order.
 *
 * These instructions deliberately never mention a colour. A scrambled cube has
 * no "white face" to find at a glance — only a white *centre* buried in a mess
 * of stickers — so asking for one makes the user hunt before every shot. Worse,
 * naming colours assumes a particular colour scheme: cubes ship in two mirror
 * arrangements, and on the other one "show white with blue at the top" is a
 * position that does not exist, so every scan would come out impossible.
 *
 * Instead the user points *any* face at the camera and is then told how to
 * turn the cube in their hands. Whichever face they start with becomes the
 * front, and the solution is expressed relative to that grip, which is exactly
 * the frame they are holding the cube in anyway.
 *
 * Which face the camera sees only fixes two of the three axes — the third is
 * how the cube is rolled — so each step also records the face that ends up at
 * the top of the screen. That pins the orientation completely and is verified
 * against the net layout in tests/scanSteps.test.ts.
 */

import type { Face } from '@/lib/cube/types';

export interface ScanStep {
  /** The facelet slot this capture fills. */
  face: Face;
  /** The face that ends up at the top of the camera view. */
  topFace: Face;
  /** What to do with the cube before tapping capture. */
  instruction: string;
  /** Supporting detail, shown smaller. */
  detail: string;
}

/**
 * Six captures built from two motions only: spinning the cube sideways, and
 * tipping it over. Each step states the *result* of the motion rather than a
 * direction, so there is nothing to get backwards.
 */
export const SCAN_STEPS: readonly ScanStep[] = [
  {
    face: 'F',
    topFace: 'U',
    instruction: 'Point any face at the camera',
    detail: 'It does not matter which one. Keep this grip for the whole scan.',
  },
  {
    face: 'R',
    topFace: 'U',
    instruction: 'Spin the cube so its right-hand side faces the camera',
    detail: 'Turn the whole cube, keeping the same face on top.',
  },
  {
    face: 'B',
    topFace: 'U',
    instruction: 'Spin it the same way again',
    detail: 'You are now looking at the back of where you started.',
  },
  {
    face: 'L',
    topFace: 'U',
    instruction: 'Spin it the same way once more',
    detail: 'Three sides down, one to go before the top and bottom.',
  },
  {
    face: 'U',
    topFace: 'B',
    instruction: 'Spin back to the face you started on, then tip its top toward the camera',
    detail: 'Tilt the cube forward so you are looking straight down at it.',
  },
  {
    face: 'D',
    topFace: 'F',
    instruction: 'Tip it back upright, then tip its bottom toward the camera',
    detail: 'Tilt the other way so you are looking straight up at the base.',
  },
];

/** One-line instruction for a step. */
export function instructionFor(step: ScanStep): string {
  return step.instruction;
}
